// src/entities/fish-base.js
// Base class for all fish entities.
// Handles: boid steering composition + state machine (movement), spline rendering.
// Movement is built from composable steering behaviors — see src/movement/ and
// docs/boids-movement-reference.md. Rendering (spline body shape, swim wiggle) is
// unchanged and consumes only x, y, heading, steeringBend, swimPhase, length, color.

import { BEHAVIORS } from '../movement/behaviors.js';
import { pickStyle, stepGait, styleWeights, defaultStyleId } from '../movement/move-styles.js';
import { rollColor, getActivePalette, getSpecialPalette } from '../palettes/index.js';
import { assignSpawnLayer, entityTint, getLayers, drawLayerIdx, moveToLayer } from '../pond/layer-stack.js';

// ─── Size sampling ────────────────────────────────────────────────────────────
// curve: number → power exponent (1=uniform, >1=small-biased, <1=large-biased)
//        'normal' → bell curve centered on midpoint, σ = range/6
function _sampleSize(min, max, curve) {
  if (curve === 'normal') {
    const u1 = Math.random() || 1e-10, u2 = Math.random();
    const z   = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    const mid = (min + max) / 2, sigma = (max - min) / 6;
    return Math.max(min, Math.min(max, mid + z * sigma));
  }
  return min + Math.pow(Math.random(), curve) * (max - min);
}

// ─── Spline renderer ──────────────────────────────────────────────────────────

// Build a half-width(t) function from a profile [[t, halfWidth], ...] using
// Fritsch–Carlson MONOTONE cubic interpolation: smooth, but with no overshoot, so the
// peduncle pinch (a sharp dip then rise) stays clean instead of bulging. The spine
// sample t (0..1) is renormalized into the profile's first→last span, so moving an
// endpoint reflows proportions instead of leaving a stub / going negative-width
// (identity when the ends sit at 0 and 1). Tangents are computed once; the returned
// closure is cheap per sample.
export function makeWidthFn(points) {
  const n = points.length;
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const t0 = xs[0], tN = xs[n - 1], span = tN - t0;

  const m = new Array(n).fill(0);
  if (n >= 2) {
    const d = new Array(n - 1);
    for (let i = 0; i < n - 1; i++) {
      const dx = xs[i + 1] - xs[i];
      d[i] = dx > 1e-9 ? (ys[i + 1] - ys[i]) / dx : 0;
    }
    m[0] = d[0];
    m[n - 1] = d[n - 2];
    for (let i = 1; i < n - 1; i++) {
      m[i] = (d[i - 1] === 0 || d[i] === 0 || (d[i - 1] > 0) !== (d[i] > 0))
        ? 0 : (d[i - 1] + d[i]) / 2;
    }
    for (let i = 0; i < n - 1; i++) {
      if (d[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; }
      const a = m[i] / d[i], b = m[i + 1] / d[i], s = a * a + b * b;
      if (s > 9) { const tau = 3 / Math.sqrt(s); m[i] = tau * a * d[i]; m[i + 1] = tau * b * d[i]; }
    }
  }

  return (t) => {
    const pt = span > 1e-6 ? t0 + t * span : t0;
    let i = 0;
    while (i < n - 1 && pt > xs[i + 1]) i++;
    if (i >= n - 1) return Math.max(0, ys[n - 1]);
    const h = xs[i + 1] - xs[i];
    if (h <= 1e-9) return Math.max(0, ys[i]);
    const u = (pt - xs[i]) / h, u2 = u * u, u3 = u2 * u;
    const w = (2*u3 - 3*u2 + 1) * ys[i]
            + (u3 - 2*u2 + u) * h * m[i]
            + (-2*u3 + 3*u2) * ys[i + 1]
            + (u3 - u2) * h * m[i + 1];
    return Math.max(0, w);
  };
}

// Width-fn cache (E14-2): building the Fritsch–Carlson tangents + closure every
// frame for every part dominated the movement math. Cache per points-array with a
// self-validating flat snapshot — the editors mutate point values in place, so a
// 12-float compare (cheaper than one tangent solve) detects staleness with no
// cooperation needed from callers.
const _widthFnCache = new WeakMap();
export function cachedWidthFn(points) {
  let e = _widthFnCache.get(points);
  const n2 = points.length * 2;
  if (e && e.snap.length === n2) {
    let clean = true;
    for (let i = 0, j = 0; i < points.length; i++) {
      if (e.snap[j++] !== points[i][0] || e.snap[j++] !== points[i][1]) { clean = false; break; }
    }
    if (clean) return e.fn;
  }
  const snap = new Float64Array(n2);
  for (let i = 0, j = 0; i < points.length; i++) { snap[j++] = points[i][0]; snap[j++] = points[i][1]; }
  e = { snap, fn: makeWidthFn(points) };
  _widthFnCache.set(points, e);
  return e.fn;
}

// The body's kinematic skeleton in WORLD units, relative to the fish center. Returns
// { at(t), pivotT } where at(t) gives { x, y, nx, ny } — position + unit normal at
// body parameter t (0=tail tip, 1=snout), bent by steering and wiggled by swim. This is
// the shared spine the body outline AND (future) appendages + the editor's dots hang off.
//   headAngle    : head direction (rad; 0=east, π/2=south-screen)
//   steeringBend : body curvature (+= right, -= left)
//   swimOsc      : swim oscillation in [-1, 1]
//   length       : nose-to-tail world units
//   spline/motion: from a CreatureDef (see FishBase.CREATURE)
export function buildCenterline(spline, motion, { headAngle, steeringBend, swimPhase = 0, length, swimAmp = 1 }) {
  const { headFrac, tailFrac, pivotT } = spline;
  // Bend control-point gains come from the single Flex spread knob (E14-10); a
  // hand-authored blob may still carry the legacy pair, so honour it if present.
  const flex = flexAmounts(spline.flexSpread);
  const bendWaist = Number.isFinite(spline.bendWaist) ? spline.bendWaist : flex.waist;
  const bendBody  = Number.isFinite(spline.bendBody)  ? spline.bendBody  : flex.body;
  // WAG ORIGIN — deliberately independent of pivotT (the bend hinge) since E14-10.
  // Defaults equal, so the classic single-pivot look is unchanged. NOTE: the wag
  // envelope zeroes at wagPivotT, so C¹ continuity at the geometric hinge only
  // holds while the two coincide; separating them is an intentional authoring knob.
  const wagPivotT = Number.isFinite(motion.wagPivotT) ? motion.wagPivotT : pivotT;

  const cosH = Math.cos(headAngle), sinH = Math.sin(headAngle);
  const cosP = -sinH, sinP = cosH;   // right-perpendicular

  const headDist  = length * headFrac;
  const tailDist  = length * tailFrac;

  const Hx =  cosH * headDist,    Hy =  sinH * headDist;
  const Tx = -cosH * tailDist,    Ty = -sinH * tailDist;
  // Pivot W sits at fraction pivotT between tail tip (0) and nose (1) — a normalized
  // position, so it can never escape past either end regardless of head/tail offsets.
  const Wx = Tx + (Hx - Tx) * pivotT - cosP * steeringBend * length * bendWaist;
  const Wy = Ty + (Hy - Ty) * pivotT - sinP * steeringBend * length * bendWaist;

  // Front (body) control: bends to steer. Computed first — the back inherits from it.
  const BCx = (Wx + Hx) * 0.5 - cosP * steeringBend * length * bendBody;
  const BCy = (Wy + Hy) * 0.5 - sinP * steeringBend * length * bendBody;

  // Back (tail) rest control TC: placed so the back's tangent at W is colinear with the
  // front tangent (BC→W), so the back smoothly CONTINUES the front's steering curve
  // through the pivot (C¹). No swim wobble baked in — the wag is added per-t in at().
  const fdx = Wx - BCx, fdy = Wy - BCy;            // tail-ward tangent direction through W
  const fdl = Math.sqrt(fdx*fdx + fdy*fdy) || 1;
  const handle = 0.5 * Math.hypot(Wx - Tx, Wy - Ty);
  const TCx = Wx + (fdx / fdl) * handle;
  const TCy = Wy + (fdy / fdl) * handle;

  // Propulsive wag: a lateral offset that grows from 0 at the pivot → max at the tail
  // tip and travels tailward (phase lag wagK·d). Amplitude rides swimAmp (throttle).
  const wagK    = Math.PI * (motion.wagPeaks ?? 1);
  const wagBase = length * motion.wagAmp * swimAmp;
  const wagCurve = motion.wagCurve ?? 1;

  // Position + unit normal at body parameter t (0=tail tip, 1=snout). Two quadratic
  // bézier segments meet at the waist (profile-t === pivotT); the back half gets the wag.
  const at = (t) => {
    let bx, by, dx, dy;
    if (t <= pivotT) {
      const s = pivotT > 1e-6 ? t / pivotT : 0;
      bx = (1-s)*(1-s)*Tx + 2*(1-s)*s*TCx + s*s*Wx;
      by = (1-s)*(1-s)*Ty + 2*(1-s)*s*TCy + s*s*Wy;
      dx = 2*(1-s)*(TCx-Tx) + 2*s*(Wx-TCx);
      dy = 2*(1-s)*(TCy-Ty) + 2*s*(Wy-TCy);
    } else {
      const s = (t - pivotT) / (1 - pivotT);
      bx = (1-s)*(1-s)*Wx + 2*(1-s)*s*BCx + s*s*Hx;
      by = (1-s)*(1-s)*Wy + 2*(1-s)*s*BCy + s*s*Hy;
      dx = 2*(1-s)*(BCx-Wx) + 2*s*(Hx-BCx);
      dy = 2*(1-s)*(BCy-Wy) + 2*s*(Hy-BCy);
    }
    const dl = Math.sqrt(dx*dx + dy*dy) || 1;
    const nx = -dy/dl, ny = dx/dl;
    if (wagBase !== 0 && t < wagPivotT && wagPivotT > 1e-6) {
      const d   = (wagPivotT - t) / wagPivotT;      // 0 at wag origin → 1 at tail tip
      const env = Math.pow(d, wagCurve);            // 0 at pivot → C¹ continuity there
      const wag = wagBase * env * Math.sin(swimPhase - wagK * d);
      bx += nx * wag; by += ny * wag;
    }
    return { x: bx, y: by, nx, ny };
  };

  return { at, pivotT };
}

// Closed body outline ring {x,y} (world units): offset the centerline by ±half-width.
// top edge tail→head, then bottom edge head→tail. Caller scales to cells + rasterizes.
export function buildBodyOutline(spline, motion, opts) {
  const widthAt = cachedWidthFn(spline.points);
  const spine = buildCenterline(spline, motion, opts);
  const TAIL_STEPS = 30, BODY_STEPS = 66;   // resolution-independent polygon; density applied by the rasterizer

  const top = [], bot = [];
  const push = (t) => {
    const f = spine.at(t), w = widthAt(t);
    top.push({ x: f.x + f.nx * w, y: f.y + f.ny * w });
    bot.push({ x: f.x - f.nx * w, y: f.y - f.ny * w });
  };
  for (let i = 0; i <= TAIL_STEPS; i++) push((i / TAIL_STEPS) * spine.pivotT);
  for (let i = 1; i <= BODY_STEPS; i++) push(spine.pivotT + (i / BODY_STEPS) * (1 - spine.pivotT));

  const ring = top.slice();
  for (let i = bot.length - 1; i >= 0; i--) ring.push(bot[i]);
  return ring;
}

// A fin/appendage is a "mini-outline": its own [s,w] profile (s: 0=root → 1=tip) run
// through the same makeWidthFn, laid along a short straight spine rooted at the body
// edge at `anchor`, swept by `angle` (0 = straight out the side, 90 = straight
// tailward), modulated by turning (swayOnTurn) and swimming (flapOnAccel). sideSign
// ±1 places/mirrors it. Returns a closed ring {x,y} in world units, like the body.
const FIN_SWAY_DEG = 28;   // fin deflection (deg) per unit steeringBend × swayOnTurn
// The fin's local spine for one side: root point + unit direction (world units).
// sideSign 0 = centered (roots on the body spine, points tailward); ±1 = side fin
// (roots at the body edge, sweeps straight-out→tailward as `angle` goes 0→90).
// Shared by buildFinOutline (geometry) and the editor (dot placement on a fin).
export function finSpineFrame(spline, motion, fin, sideSign, opts) {
  const spine = buildCenterline(spline, motion, opts);
  const f = spine.at(fin.anchor);
  const Tx = f.ny, Ty = -f.nx;   // unit tangent toward the head
  const swayDeg = (fin.swayOnTurn || 0) * (opts.steeringBend || 0) * FIN_SWAY_DEG;
  const flapDeg = (fin.flapOnAccel?.amp || 0) * (opts.swimOsc || 0) * (opts.swimAmp ?? 1);
  // Omni fin channels (E14-4): while maneuvering, body-frame thrust deflects fins.
  // Backpaddle (reverse thrust) sweeps every fin forward; a sidestep (lateral
  // thrust) breaks symmetry (added OUTSIDE the sideSign flip so the two pectorals
  // scull oppositely). Both fade with the maneuver fraction → no cruise change.
  const man    = opts.maneuver || 0;
  const revDeg = man * Math.max(0, -(opts.finFwd || 0)) * FIN_REV_DEG;
  const latDeg = man * (opts.finLat || 0) * FIN_LAT_DEG;
  if (sideSign === 0) {
    const rot = (fin.angle + swayDeg + flapDeg + revDeg + latDeg) * Math.PI / 180;
    const c = Math.cos(rot), s = Math.sin(rot);
    return { Rx: f.x, Ry: f.y, Dx: -Tx * c + Ty * s, Dy: -Tx * s - Ty * c };   // (-T) rotated
  }
  const Nsx = f.nx * sideSign, Nsy = f.ny * sideSign;
  const bw = cachedWidthFn(spline.points)(fin.anchor);
  const rot = (sideSign * (fin.angle + swayDeg + flapDeg + revDeg) + latDeg) * Math.PI / 180;
  const c = Math.cos(rot), s = Math.sin(rot);
  return { Rx: f.x + Nsx * bw, Ry: f.y + Nsy * bw, Dx: Nsx * c - Nsy * s, Dy: Nsx * s + Nsy * c };
}

export function buildFinOutline(spline, motion, fin, sideSign, opts) {
  const finW = cachedWidthFn(fin.profile);
  const { Rx, Ry, Dx, Dy } = finSpineFrame(spline, motion, fin, sideSign, opts);
  const Px = -Dy, Py = Dx;   // fin-spine perpendicular

  const STEPS = 26;
  const top = [], bot = [];
  for (let i = 0; i <= STEPS; i++) {
    const s = i / STEPS, w = finW(s);
    const cx = Rx + Dx * (s * fin.length), cy = Ry + Dy * (s * fin.length);
    top.push({ x: cx + Px * w, y: cy + Py * w });
    bot.push({ x: cx - Px * w, y: cy - Py * w });
  }
  const ring = top.slice();
  for (let i = bot.length - 1; i >= 0; i--) ring.push(bot[i]);
  return ring;
}

// All appendage outline rings for a creature (world units), honoring `mirror`.
export function buildAppendageOutlines(creature, opts) {
  const out = [];
  for (const fin of creature.appendages || []) {
    if (!Array.isArray(fin.profile) || fin.profile.length < 2) continue;
    const sides = fin.mirror ? [1, -1] : [fin.side ?? 1];
    for (const s of sides) out.push(buildFinOutline(creature.spline, creature.motion, fin, s, opts));
  }
  return out;
}

// Cell-set rasterizers (E14-2). Cells are packed into INTEGER keys —
// key = (cy + 2048) * 4096 + (cx + 2048) — instead of "cx,cy" strings: integer
// Set ops avoid the string allocation + parse per cell per part per frame that
// dominated draw(). Coordinates are fish-relative display cells, well within
// ±2048. Both functions return a SHARED Set, valid only until the next call —
// consume immediately (decode: cx = (k & 4095) - 2048, cy = (k >>> 12) - 2048).
export const CELL_OFF = 2048, CELL_SHIFT = 12, CELL_MASK = 4095;
const _cellSet = new Set();

// Nonzero-winding scanline fill of a world-unit polygon → shared Set of packed
// cells (cell centers at integer coords). Overlapping sub-loops stay filled.
export function fillOutlineCells(poly, d) {
  const pts = poly.map((p) => ({ x: p.x * d, y: p.y * d }));
  let minY = Infinity, maxY = -Infinity;
  for (const p of pts) { if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y; }
  const set = _cellSet;
  set.clear();
  const yLo = Math.ceil(minY), yHi = Math.floor(maxY), n = pts.length;
  for (let cy = yLo; cy <= yHi; cy++) {
    const xs = [];
    for (let i = 0; i < n; i++) {
      const a = pts[i], b = pts[(i + 1) % n];
      if ((a.y <= cy && b.y > cy) || (b.y <= cy && a.y > cy)) {
        xs.push({ x: a.x + (cy - a.y) / (b.y - a.y) * (b.x - a.x), dir: b.y > a.y ? 1 : -1 });
      }
    }
    if (xs.length < 2) continue;
    xs.sort((p, q) => p.x - q.x);
    let wind = 0;
    const rowBase = (cy + CELL_OFF) << CELL_SHIFT;
    for (let i = 0; i < xs.length - 1; i++) {
      wind += xs[i].dir;
      if (wind !== 0) {
        const xa = Math.ceil(xs[i].x), xb = Math.floor(xs[i + 1].x);
        for (let cx = xa; cx <= xb; cx++) set.add(rowBase + cx + CELL_OFF);
      }
    }
  }
  return set;
}

// Connected-segment outline of a world-unit polygon → shared Set of packed cells
// (Bresenham between consecutive ring vertices, so the stroke is gap-free).
export function strokeOutlineCells(poly, d) {
  const set = _cellSet;
  set.clear();
  const line = (x0, y0, x1, y1) => {
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      set.add(((y0 + CELL_OFF) << CELL_SHIFT) + x0 + CELL_OFF);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
  };
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    line(Math.round(a.x * d), Math.round(a.y * d), Math.round(b.x * d), Math.round(b.y * d));
  }
  return set;
}

// Load boundary for any stored CreatureDef: clone, version-route (migrate), return.
// Returns null if unrecognizable. (The pre-E13-2 flat-SHAPE format is no longer read.)
export function upgradeCreature(raw) {
  if (!raw || typeof raw !== 'object' || !raw.spline || !Array.isArray(raw.spline.points)) return null;
  const c = JSON.parse(JSON.stringify(raw));   // clone — never mutate the caller's blob
  // v1 → v2 (E13-4): waistFrac → pivotT scalar; swish* motion → wag* motion.
  if ((c.schemaVersion ?? 1) < 2) {
    c.spline.pivotT = c.spline.pivotT ?? c.spline.waistFrac ?? 0.229;
    delete c.spline.waistFrac;
    const m = c.motion ?? {};
    c.motion = {
      wagAmp:   m.wagAmp   ?? (m.swishAmp || 0.16),   // old swish was a different mechanism; give the wag a visible default
      wagRate:  m.wagRate  ?? m.swishRate  ?? 1,
      wagCurve: m.wagCurve ?? m.swishCurve ?? 1.4,
      wagPeaks: m.wagPeaks ?? 1,
    };
    c.schemaVersion = 2;
  }
  // v2 → v3 (E13-4): pivotT becomes a normalized 0..1 position between tail tip and
  // nose. Was length-scaled (waist = pivotT − tailFrac), which let the waist cross the
  // head when pivotT > headFrac + tailFrac. Divide by the span to preserve the look.
  if ((c.schemaVersion ?? 1) < 3) {
    const span = (c.spline.headFrac ?? 0.7) + (c.spline.tailFrac ?? 0.624);
    c.spline.pivotT = Math.max(0, Math.min(1, (c.spline.pivotT ?? 0.229) / (span || 1)));
    c.schemaVersion = 3;
  }
  // v3 → v4 (E13-4): per-creature max front-bend replaces the global ±1.2 clamp.
  if ((c.schemaVersion ?? 1) < 4) {
    c.spline.maxBend = c.spline.maxBend ?? 1.2;
    c.schemaVersion = 4;
  }
  // v4 → v5 (E14-1): wag frequency user multiplier — decouples visible tail-beat
  // rate from the throttle-only scaling. 1 = unchanged.
  if ((c.schemaVersion ?? 1) < 5) {
    c.motion ??= {};
    c.motion.wagFreqMul = c.motion.wagFreqMul ?? 1;
    c.schemaVersion = 5;
  }
  // v5 → v6 (E14-10): the turn-look consolidation.
  //   • maxBend (0..2.5 clamp)      → bendDepth (0..1 fraction of BEND_DEPTH_SCALE)
  //   • bendWaist + bendBody (pair) → flexSpread (one shape knob; see flexAmounts)
  //   • wag origin splits off the bend hinge → motion.wagPivotT (defaults equal)
  //   • turnStyle names HOW a turn is shown at all ('none' = rigid creatures)
  if ((c.schemaVersion ?? 1) < 6) {
    const maxBend = Number.isFinite(c.spline.maxBend) ? c.spline.maxBend : 1.2;
    c.spline.bendDepth = Math.max(0, Math.min(1, maxBend / BEND_DEPTH_SCALE));
    if (!Number.isFinite(c.spline.flexSpread)) {
      c.spline.flexSpread = inverseFlexSpread(c.spline.bendWaist, c.spline.bendBody);
    }
    delete c.spline.maxBend; delete c.spline.bendWaist; delete c.spline.bendBody;
    c.motion ??= {};
    c.motion.wagPivotT = c.motion.wagPivotT ?? c.spline.pivotT ?? 0.173;
    c.turnStyle = (c.turnStyle === 'none' || c.turnStyle === 'bend') ? c.turnStyle : 'bend';
    c.schemaVersion = 6;
  }
  // Normalize (all versions): backfill optional blocks so no consumer — renderer,
  // editors, registry — ever meets a hand-edited/ancient blob missing them.
  if (!Array.isArray(c.appendages)) c.appendages = [];
  if (!c.patterns) c.patterns = { spawnMode: 'mix', active: null, variations: [] };
  c.motion = { wagAmp: 0.16, wagRate: 1, wagCurve: 1.4, wagPeaks: 1, wagFreqMul: 1, wagPivotT: c.spline.pivotT ?? 0.173, ...c.motion };
  if (c.turnStyle !== 'none' && c.turnStyle !== 'bend') c.turnStyle = 'bend';
  if (!Number.isFinite(c.spline.bendDepth))  c.spline.bendDepth = 0.48;
  if (!Number.isFinite(c.spline.flexSpread)) c.spline.flexSpread = 0.5;
  return c;
}

/** bendDepth 0..1 → the legacy front-bend clamp magnitude (old maxBend units). */
export const BEND_DEPTH_SCALE = 2.5;

/** Flex spread (0..1) → the two bend control-point gains. Constant TOTAL, so this
 *  is a pure SHAPE knob (WHERE the bow sits) and stays orthogonal to bendDepth
 *  (HOW MUCH bow). 0.5 reproduces koi's historical (0.097, 0.297) exactly. */
export function flexAmounts(spread) {
  const s = Math.max(0, Math.min(1, Number.isFinite(spread) ? spread : 0.5));
  const TOTAL = 0.394;                         // koi's historical bendWaist + bendBody
  const wFrac = 0.246 + (s - 0.5) * 0.49;      // s=0 → bow all mid-body; s=1 → shared
  return { waist: TOTAL * wFrac, body: TOTAL * (1 - wFrac) };
}

/** Inverse of flexAmounts, for migrating a stored (bendWaist, bendBody) pair. */
export function inverseFlexSpread(waist, body) {
  const w = Number.isFinite(waist) ? waist : 0.097;
  const b = Number.isFinite(body) ? body : 0.297;
  const total = w + b;
  if (total <= 1e-6) return 0.5;
  return Math.max(0, Math.min(1, (w / total - 0.246) / 0.49 + 0.5));
}

// Fallback wag floors when a style omits them (frequency/amplitude ride throttle).
const ZERO_WAG = { freqFloor: 0, ampFloor: 0 };

// ─── Angle utilities ──────────────────────────────────────────────────────────
function _normalizeAngle(a) {
  while (a >  Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}
function _angleDiff(a, b) { return _normalizeAngle(a - b); }
// Hermite smoothstep, clamped: 0 below a, 1 above b, eased between.
function _smoothstep(a, b, x) {
  const t = Math.max(0, Math.min(1, (x - a) / ((b - a) || 1)));
  return t * t * (3 - 2 * t);
}
function _lerp(a, b, t) { return a + (b - a) * t; }
// Interpolate a→b along the SHORTEST arc by fraction t (for blending headings).
function _angleLerp(a, b, t) { return a + _angleDiff(b, a) * t; }

// Omni low-speed maneuvering (E14-4) ─────────────────────────────────────────
// Fallback block for records predating E14-4 (species-registry backfills the real
// one; this only guards a hand-built record with no omni field).
const DEFAULT_OMNI = { hoverThreshold: 0.32, pivotSec: 0.524, scoot: 0.5 };
// Omni fin-channel gains (deg): how far body-frame thrust deflects fins while
// maneuvering. Backpaddle sweeps fins forward; a sidestep spreads them asymmetrically.
const FIN_REV_DEG = 34, FIN_LAT_DEG = 40;
// Feed etiquette (E14-5): after eating, a fish can't eat again for this long — the
// decaying eatCooldownMs ranks rivals (smaller = hungrier = higher priority).
const EAT_COOLDOWN_MS = 5000;

// ─── FishBase ─────────────────────────────────────────────────────────────────
// The single creature engine class (E13-9 / E14-1): everything that used to be a
// per-subclass static lives on the SPECIES RECORD passed to the constructor
// (src/species/species-registry.js). All species reads go through `this.species`
// fresh each frame, so menu edits to the shared record apply to living fish
// instantly — the same live-read semantics the class statics had.
export class FishBase {
  /** When true, draw() fills the fish body solid rather than outline-only.
   *  Toggled globally from the Fish menu section. */
  static FILLED = false;

  /** When true, fish are hard-clamped to the world bounds each frame (safety net).
   *  When false, only the edge force keeps them away from walls — fish can
   *  overshoot at high speed or with the edge weight lowered. */
  static HARD_BORDER = true;

  /** When true, draw() also records each fish's rasterized cells + origin so the
   *  caustics shadow pass (E7-10) can re-fill the silhouette, offset toward the
   *  floor, next frame. Set per-frame by Simulation.draw from the caustics state. */
  static CAPTURE_SHADOW_CELLS = false;

  /**
   * @param {import('../grid.js').Grid} grid
   * @param {object} species - live species record (see species-registry.js)
   */
  constructor(grid, species) {
    this.species = species;
    const { sizes } = species;
    const { logicalW, logicalH } = grid;

    this.length = _sampleSize(sizes.min, sizes.max, sizes.curve);
    this.half   = this.length / 2;

    // Size fraction 0 (smallest) → 1 (largest), used to scale agility.
    const sizeFrac = Math.max(0, Math.min(1,
      (this.length - sizes.min) / Math.max(1, sizes.max - sizes.min)
    ));
    // Per-fish steering variation: small fish turn harder; slight speed jitter so the
    // school never moves as a rigid block. Stored as fractions and combined with the
    // species tuning in the maxForce/maxSpeed getters, so live menu-slider edits to
    // the record take effect on existing fish immediately.
    this._sizeFrac    = sizeFrac;                    // 0 (smallest) → 1 (largest)
    this._speedJitter = 0.85 + Math.random() * 0.3;  // per-fish speed multiplier

    // Spawn within safe margins (center-based position)
    this.x = this.half + 5 + Math.random() * (logicalW - this.length - 10);
    this.y = this.half + 5 + Math.random() * (logicalH - this.length - 10);

    const initSpeed = this.maxSpeed * (0.3 + Math.random() * 0.7);
    const initAngle = Math.random() * Math.PI * 2;
    this.vx = Math.cos(initAngle) * initSpeed;
    this.vy = Math.sin(initAngle) * initSpeed;

    this.heading      = initAngle;
    this.steeringBend = 0;
    this.swimPhase    = Math.random() * Math.PI * 2;   // stagger fish
    this.swimAmp      = 1;                              // tail amplitude (set by speed each frame)

    // Gait throttle state (E14-3) — seeded random so fish breathe out of phase.
    // The active move style owns the gait loop; _phaseIdx indexes its phases,
    // -1 = "sample a fresh phase on the next step".
    this._throttle  = 0.3 + Math.random() * 0.7;
    this._thrTarget = this._throttle;
    this._phaseIdx  = -1;
    this._phaseName = 'coast';
    this._thrHold   = Math.random() * species.tuning.glideMsMax;   // random initial offset

    // Move-style arbiter state (E14-3): current style + ms spent in it (hysteresis).
    this._styleId  = defaultStyleId(species);
    this._styleMs  = Math.random() * 1000;   // stagger so switches don't sync

    // Omni intent (E14-4): explicit facing override in radians (null = auto from
    // motion) + face-only flag (suppress translation, just rotate — the etiquette
    // showcase). Styles (E14-5) + scripted scenarios set these; default is auto.
    this._intentFace     = null;
    this._intentFaceOnly = false;
    this._intentManaged  = false;   // true when a style set the intent (so it clears cleanly)
    // Body-frame thrust (normalized −1..1) + maneuver fraction, published each frame
    // by the actuator for the fin-animation channels in draw().
    this._finFwd    = 0;
    this._finLat    = 0;
    this._maneuver  = 0;
    // Feed etiquette (E14-5): decaying re-eat timer + this frame's perceived-food info.
    this.eatCooldownMs   = 0;
    this._foodInfo       = null;

    this._wanderTheta    = Math.random() * Math.PI * 2;
    this._wanderOmega    = 0;   // smoothly-evolving wander rotation rate (rad/ms)
    this._neighborCount  = 0;   // fish within PERCEPTION_RADIUS, refreshed each update()
    this._orbitChirality = 0;   // ±1 set on first entry to attract orbit; 0 = unassigned

    this.color = rollColor(getActivePalette(), getSpecialPalette());

    // Depth layer (E14-6): { from, to, t, dur } — the plane this fish swims on.
    // Locked layer if the species pins one, else random across the stack.
    assignSpawnLayer(this);
  }

  /** Max steering force for this fish (logical px/ms²). A fixed internal constant
   *  per species (the size-interpolated Arc sliders were retired in E13-4). Live. */
  get maxForce() {
    return this.species.tuning.forceMax;
  }

  /** Hard turn-rate ceiling (rad/s) — the ONE physics turn knob (E14-10). Authored
   *  as Agility: seconds per 180° U-turn, converted here. A ceiling, not a drive:
   *  fish only turn this fast when steering actually demands it. Live getter. */
  get maxTurnRate() {
    return Math.PI / Math.max(0.05, this.species.tuning.agilitySec);
  }

  /** Max speed for this fish (logical px/ms), species tuning × per-fish jitter. Live. */
  get maxSpeed() {
    return this.species.tuning.speedMax * this._speedJitter;
  }

  /** Throttled cruise speed (logical px/ms) the propulsive behaviors aim for. The
   *  burst-and-coast throttle pulses this between ~0 (glide) and maxSpeed (burst). */
  get cruiseSpeed() {
    return this.maxSpeed * this._throttle;
  }

  /** Steer toward (tx, ty) at targetSpeed (Reynolds seek), truncated to maxForce.
   *  Returns a fresh {x, y} force — used by the feed/inspect approach (E14-5). */
  _seekForce(tx, ty, targetSpeed) {
    const dx = tx - this.x, dy = ty - this.y;
    const mag = Math.hypot(dx, dy);
    if (mag < 1e-9) return { x: 0, y: 0 };
    const s = targetSpeed / mag;
    let fx = dx * s - this.vx, fy = dy * s - this.vy;
    const fmag = Math.hypot(fx, fy), maxF = this.maxForce;
    if (fmag > maxF) { const k = maxF / fmag; fx *= k; fy *= k; }
    return { x: fx, y: fy };
  }

  /** Nearest live pellet within perception + the count of neighbors near it that
   *  are hungrier (strictly smaller eatCooldownMs). Drives the feed trigger +
   *  etiquette (architecture §4.4). Returns { pellet, dist, smaller } or null. */
  _perceiveFood(ctx) {
    const food = ctx.food;
    if (!food || !food.length) return null;
    const R = this.species.tuning.perceptionRadius, R2 = R * R;
    let best = null, bestD2 = R2;
    for (let i = 0; i < food.length; i++) {
      const p = food[i];
      if (!p.alive) continue;
      const dx = p.x - this.x, dy = p.y - this.y, d2 = dx * dx + dy * dy;
      if (d2 <= bestD2) { bestD2 = d2; best = p; }
    }
    if (!best) return null;
    // Rivals = neighbors within perception of the pellet with a smaller eat-cooldown.
    let smaller = 0;
    const my = this.eatCooldownMs, ns = ctx.neighbors;
    for (let i = 0; i < ns.length; i++) {
      const o = ns[i];
      const dx = o.x - best.x, dy = o.y - best.y;
      if (dx * dx + dy * dy <= R2 && (o.eatCooldownMs ?? 0) < my) smaller++;
    }
    return { pellet: best, dist: Math.sqrt(bestD2), smaller };
  }

  /** Feed actuation (E14-5): 0 hungrier rivals → approach + eat; exactly 1 → hold
   *  and face the food (the omni face-only showcase). Returns a force delta or null. */
  _actuateFeed() {
    const fi = this._foodInfo;
    if (!fi) { this._clearManagedIntent(); return null; }   // safety — trigger gates entry
    const { pellet, dist, smaller } = fi;
    const ang = Math.atan2(pellet.y - this.y, pellet.x - this.x);
    if (smaller >= 1) {
      // Defer: face the food and hold position, letting the hungrier fish eat.
      this._intentFace = ang; this._intentFaceOnly = true; this._intentManaged = true;
      return { fx: 0, fy: 0, replace: true };
    }
    // Hungriest here → approach; eat when the mouth reaches the pellet.
    this._intentFace = null; this._intentFaceOnly = false; this._intentManaged = true;

    // Depth-coherent feeding (E14-11): move toward the pellet's layer as we
    // approach, and only eat once we've reached its depth. In a single-layer pond
    // every entity is on layer 0, so this is a no-op — feeding is unchanged.
    const pelletLayer = drawLayerIdx(pellet);
    const sameLayer = drawLayerIdx(this) === pelletLayer;
    if (!sameLayer && this.layer && this.layer.to !== pelletLayer) {
      moveToLayer(this, pelletLayer, 1200);   // follow it (incl. a sinking pellet) down/up
    }

    if (sameLayer && dist <= this.half + pellet.radius + 1) {
      pellet.alive = false;
      this.eatCooldownMs = EAT_COOLDOWN_MS;
      return { fx: 0, fy: 0, replace: true };
    }
    const f = this._seekForce(pellet.x, pellet.y, this.maxSpeed);
    return { fx: f.x, fy: f.y, replace: false };
  }

  /** Inspect actuation (E14-5): approach the nearest near-stationary neighbor to a
   *  standoff, then hold and face it (shared maneuvering base with feed). */
  _actuateInspect(ctx) {
    const R = this.species.tuning.perceptionRadius, R2 = R * R;
    let best = null, bestD2 = R2;
    const ns = ctx.neighbors;
    for (let i = 0; i < ns.length; i++) {
      const o = ns[i];
      if (Math.hypot(o.vx || 0, o.vy || 0) >= 0.12 * (o.maxSpeed || 1)) continue;
      const dx = o.x - this.x, dy = o.y - this.y, d2 = dx * dx + dy * dy;
      if (d2 <= bestD2) { bestD2 = d2; best = o; }
    }
    if (!best) { this._clearManagedIntent(); return null; }
    const dist = Math.sqrt(bestD2);
    const ang = Math.atan2(best.y - this.y, best.x - this.x);
    const standoff = this.length * 2.5;
    if (dist <= standoff) {
      this._intentFace = ang; this._intentFaceOnly = true; this._intentManaged = true;
      return { fx: 0, fy: 0, replace: true };
    }
    this._intentFace = null; this._intentFaceOnly = false; this._intentManaged = true;
    const f = this._seekForce(best.x, best.y, this.maxSpeed * 0.6);
    return { fx: f.x, fy: f.y, replace: false };
  }

  _clearManagedIntent() {
    if (this._intentManaged) { this._intentFace = null; this._intentFaceOnly = false; this._intentManaged = false; }
  }

  /**
   * Update physics for one frame.
   * @param {number}    deltaMs   - frame time (ms)
   * @param {object}    grid      - Grid instance with logicalW / logicalH
   * @param {FishBase[]} neighbors - fish within PERCEPTION_RADIUS (from Simulation)
   */
  update(deltaMs, grid, neighbors, attractPoint = null, food = null) {
    const { logicalW, logicalH } = grid;
    const { tuning, body } = this.species;
    const maxSpeed = this.maxSpeed;

    // Fish within PERCEPTION_RADIUS this frame — read before the arbiter so the
    // neighborCount trigger sees the current count.
    this._neighborCount = neighbors.length;
    // Eat-cooldown decays every frame (E14-5) — the rival-ranking timer.
    if (this.eatCooldownMs > 0) this.eatCooldownMs = Math.max(0, this.eatCooldownMs - deltaMs);

    // ── 0. Arbiter picks the active move style; its gait loop drives the cruise
    //       throttle (→ cruiseSpeed + drag + tail). (E14-3) ────────────────────
    if (!attractPoint && this._orbitChirality) this._orbitChirality = 0;
    const ctx = { neighbors, bounds: { width: logicalW, height: logicalH }, dt: deltaMs, attractPoint, food };
    // Perceive food BEFORE the arbiter so the foodReady trigger can read _foodInfo.
    this._foodInfo = this._perceiveFood(ctx);
    const style = pickStyle(this, ctx, deltaMs);
    stepGait(this, style, deltaMs);

    // ── 1. Compose steering forces from the active style's behavior weights ───
    const weights = styleWeights(this, ctx, style);
    let ax = 0, ay = 0;
    for (const name in weights) {
      const w = weights[name];
      if (!w) continue;
      const f = BEHAVIORS[name](this, ctx);
      ax += f.x * w;
      ay += f.y * w;
    }
    // ── Feeding / inspecting (E14-5): styles that seek a specific target and can
    //    override facing. _actuate* returns a force delta (additive, or replacing
    //    it for the face-only/eat cases). Non-facing styles clear style-managed
    //    intent so the omni actuator returns to auto-facing. ───────────────────
    if (this._styleId === 'feed') {
      const r = this._actuateFeed();
      if (r) { if (r.replace) { ax = r.fx; ay = r.fy; } else { ax += r.fx; ay += r.fy; } }
    } else if (this._styleId === 'inspect') {
      const r = this._actuateInspect(ctx);
      if (r) { if (r.replace) { ax = r.fx; ay = r.fy; } else { ax += r.fx; ay += r.fy; } }
    } else if (this._intentManaged) {
      this._intentFace = null; this._intentFaceOnly = false; this._intentManaged = false;
    }
    // Debug/scenario override (E14-4): a fixed desired-force vector for scripted
    // maneuver tests (rotate-in-place, sidestep, back-up). Never set in normal use.
    if (this._debugForce) { ax = this._debugForce.x; ay = this._debugForce.y; }

    // ── 2. ACTUATE + INTEGRATE — two-regime blend (E14-4, architecture §4.2) ──
    // Water drag — the medium (E14-1). Per-species velocity retention per second,
    // ALWAYS on (no throttle gating). drag = 1.0 → frictionless (pre-E14 default).
    const drag = Math.pow(tuning.drag, deltaMs / 1000);
    const omni = this.species.omni ?? DEFAULT_OMNI;
    const prevHeading = this.heading;
    const preSpeed = Math.sqrt(this.vx * this.vx + this.vy * this.vy);
    // w = 1 swimming (steer like a boat), 0 hovering (maneuver like an RCS).
    // Derived from the single Hover threshold knob (E14-10): it is the band TOP,
    // the bottom trails at 0.28× it. threshold 0 ⇒ w pinned to 1 ⇒ this creature
    // never hovers (how a species opts out of the second regime entirely).
    const hoverHi = omni.hoverThreshold ?? 0.26;
    const w = hoverHi <= 0 ? 1 : _smoothstep(hoverHi * 0.28, hoverHi, preSpeed / maxSpeed);

    // Desired facing: explicit intent (styles / scenarios) wins; else the steering
    // direction; else keep travelling forward.
    const fMag = Math.hypot(ax, ay);
    let faceDir;
    if (this._intentFace != null)   faceDir = this._intentFace;
    else if (fMag > 1e-9)           faceDir = Math.atan2(ay, ax);
    else                            faceDir = preSpeed > 1e-6 ? Math.atan2(this.vy, this.vx) : this.heading;
    const faceOnly = !!this._intentFaceOnly;

    // ── Cruise branch: today's model — force → velocity, drag, clamp, turn-rate cap ──
    let cvx = (this.vx + ax * deltaMs) * drag;
    let cvy = (this.vy + ay * deltaMs) * drag;
    let csp = Math.hypot(cvx, cvy);
    if (csp > maxSpeed) { const k = maxSpeed / csp; cvx *= k; cvy *= k; csp = maxSpeed; }
    let cHeading = this.heading;
    if (csp > 1e-6) {
      const prospH   = Math.atan2(cvy, cvx);
      const delta    = _angleDiff(prospH, this.heading);
      const maxDelta = this.maxTurnRate / 1000 * deltaMs;
      if (Math.abs(delta) > maxDelta) {
        cHeading = this.heading + Math.sign(delta) * maxDelta;   // clamp heading change; preserve speed
        cvx = Math.cos(cHeading) * csp;
        cvy = Math.sin(cHeading) * csp;
      } else cHeading = prospH;
    }

    // ── Maneuver branch: RCS — heading rotates toward faceDir at finTurnRate; the
    //    desired force is decomposed into the BODY frame and clamped per axis, so
    //    sideways/backward translation is possible but weaker than forward. ──────
    // Pivot speed is authored in the same felt unit as Agility (seconds per 180°).
    const maxYaw   = (Math.PI / Math.max(0.05, omni.pivotSec ?? 0.524)) / 1000 * deltaMs;
    const mHeading = this.heading + Math.max(-maxYaw, Math.min(maxYaw, _angleDiff(faceDir, this.heading)));
    const ch = Math.cos(this.heading), sh = Math.sin(this.heading);
    const F  = this.maxForce;
    // Scoot (0..1) is the single back-up/sidestep authority knob; forward is always
    // full. 0.5 reproduces the pre-E14-10 reverse 0.35 / lateral 0.55 pair.
    const scoot  = omni.scoot ?? 0.5;
    const revCap = 0.7 * scoot * F, latCap = 1.1 * scoot * F;
    let fFwd = faceOnly ? 0 : ax * ch + ay * sh;      // component along facing
    let fLat = faceOnly ? 0 : -ax * sh + ay * ch;     // component to the right
    fFwd = Math.max(-revCap, Math.min(F, fFwd));
    fLat = Math.max(-latCap, Math.min(latCap, fLat));
    const mfx = fFwd * ch - fLat * sh;                // recompose body frame → world
    const mfy = fFwd * sh + fLat * ch;
    let mvx = (this.vx + mfx * deltaMs) * drag;
    let mvy = (this.vy + mfy * deltaMs) * drag;
    const msp = Math.hypot(mvx, mvy);
    if (msp > maxSpeed) { const k = maxSpeed / msp; mvx *= k; mvy *= k; }

    // ── Blend regimes → velocity + heading; publish body-frame thrust for the fins ──
    this.vx = mvx + (cvx - mvx) * w;
    this.vy = mvy + (cvy - mvy) * w;
    this.heading = _angleLerp(mHeading, cHeading, w);
    this._finFwd   = fFwd / F;
    this._finLat   = fLat / F;
    this._maneuver = 1 - w;

    // ── 3. Move + optional hard boundary clamp ──────────────────────────────
    this.x += this.vx * deltaMs;
    this.y += this.vy * deltaMs;
    if (FishBase.HARD_BORDER) {
      this.x = Math.max(this.half, Math.min(logicalW - this.half, this.x));
      this.y = Math.max(this.half, Math.min(logicalH - this.half, this.y));
    }

    // ── 4. Steering bend — from the actual heading change, gated so a maneuvering
    //       (low-speed) fish keeps its body STRAIGHT while it yaws in place. The w
    //       factor + gTurn both vanish in the maneuver regime, so only cruise turns
    //       curve the body; the fins (not the spine) do the low-speed work. ───────
    //       SELF-NORMALIZING (E14-10): the shown bend is the creature's authored
    //       depth scaled by how hard it is turning AS A FRACTION OF ITS OWN MAX —
    //       so any Agility setting saturates its full curve at its hardest turn.
    //       (Replaced the `× 0.8` glue constant, which left slow-turning creatures
    //       permanently unable to reach their own authored bend.)
    const curSpeed = Math.sqrt(this.vx * this.vx + this.vy * this.vy);
    const turnRate = _angleDiff(this.heading, prevHeading) / deltaMs * 1000;   // rad/s
    const gTurn    = _smoothstep(0, 0.15, curSpeed / maxSpeed);
    let targetBend = 0;
    if (body.turnStyle !== 'none') {
      const maxBend = (body.spline.bendDepth ?? 0.48) * BEND_DEPTH_SCALE;
      const frac    = Math.min(1, Math.abs(turnRate) / this.maxTurnRate);
      targetBend = maxBend * frac * Math.sign(turnRate) * gTurn * w;
    }
    this.steeringBend += (targetBend - this.steeringBend) * 0.005 * deltaMs;

    // ── 5. Wag drive — cadence + amplitude scale with the propulsion throttle, but
    //       the active style's freq/amp FLOORS keep a coasting fish subtly alive
    //       (flow) or go fully quiet (burst). wagFreqMul (CREATURE v5) is the user's
    //       frequency knob, orthogonal to throttle and style. (E14-3) ──────────────
    const wf = style.wag || ZERO_WAG;
    const freqScale = wf.freqFloor + (1 - wf.freqFloor) * this._throttle;
    this.swimPhase += tuning.swimBeatRate * (body.motion.wagRate ?? 1)
                    * (body.motion.wagFreqMul ?? 1) * freqScale * deltaMs;
    if (this.swimPhase > Math.PI * 2) this.swimPhase -= Math.PI * 2;
    this.swimAmp = wf.ampFloor + (1 - wf.ampFloor) * this._throttle;
  }

  draw(grid) {
    const D       = grid.density;
    const swimOsc = Math.sin(this.swimPhase);
    const creature = this.species.body;

    // Parts-based render: body + appendages, each a closed polygon rasterized below.
    // (Patterns add more parts with their own colors in E13-6.)
    const opts = {
      headAngle: this.heading, steeringBend: this.steeringBend,
      swimOsc, swimPhase: this.swimPhase, length: this.length, swimAmp: this.swimAmp,
      // Omni fin channels (E14-4): body-frame thrust + maneuver fraction drive the
      // low-speed fin flaps (finSpineFrame). Zero at cruise → no visual change.
      finFwd: this._finFwd, finLat: this._finLat, maneuver: this._maneuver,
    };
    const filled = FishBase.FILLED, color = this.color;
    const parts = [{ poly: buildBodyOutline(creature.spline, creature.motion, opts), filled, color }];
    for (const poly of buildAppendageOutlines(creature, opts)) parts.push({ poly, filled, color });

    // Depth filter (E14-6): the layer's tint mixes into every part's color once
    // per fish. Null / alpha 0 (the single-layer default) → no change, identical.
    const tint = getLayers().length > 1 ? entityTint(this) : null;
    const ta = tint ? tint.a : 0, ia = 1 - ta, tr = tint ? tint.r : 0, tg = tint ? tint.g : 0, tb = tint ? tint.b : 0;

    const ocx = Math.round(this.x * D), ocy = Math.round(this.y * D);
    // Shadow capture (E7-10): keep this frame's cells so the next frame's shadow
    // pass (which runs before fish draw) can restamp the silhouette on the floor.
    let sc = null;
    if (FishBase.CAPTURE_SHADOW_CELLS) {
      sc = this._shadowCells ?? (this._shadowCells = []);
      sc.length = 0;
      this._shadowOx = ocx;
      this._shadowOy = ocy;
    }
    for (const part of parts) {
      let { r, g, b } = part.color;
      if (ta > 0) { r = (r * ia + tr * ta) | 0; g = (g * ia + tg * ta) | 0; b = (b * ia + tb * ta) | 0; }
      // Shared packed-int cell set (see rasterizers) — consumed before the next part.
      const cells = part.filled ? fillOutlineCells(part.poly, D) : strokeOutlineCells(part.poly, D);
      grid.beginCells(r, g, b);   // one fillStyle per part, not per cell (E14-2)
      for (const key of cells) {
        const cx = (key & CELL_MASK) - CELL_OFF;
        const cy = (key >>> CELL_SHIFT) - CELL_OFF;
        grid.drawCellFast(ocx + cx, ocy + cy);
        if (sc !== null) sc.push(key);
      }
    }
  }
}
