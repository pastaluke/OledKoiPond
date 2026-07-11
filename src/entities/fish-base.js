// src/entities/fish-base.js
// Base class for all fish entities.
// Handles: boid steering composition + state machine (movement), spline rendering.
// Movement is built from composable steering behaviors — see src/movement/ and
// docs/boids-movement-reference.md. Rendering (spline body shape, swim wiggle) is
// unchanged and consumes only x, y, heading, steeringBend, swimPhase, length, color.

import { BEHAVIORS } from '../movement/behaviors.js';
import { STATES, nextState } from '../movement/states.js';
import { rollColor, getActivePalette, getSpecialPalette } from '../palettes/index.js';

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
  const { headFrac, tailFrac, pivotT, bendWaist, bendBody } = spline;

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
    if (wagBase !== 0 && t < pivotT && pivotT > 1e-6) {
      const d   = (pivotT - t) / pivotT;            // 0 at pivot → 1 at tail tip
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
  const widthAt = makeWidthFn(spline.points);
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
  if (sideSign === 0) {
    const rot = (fin.angle + swayDeg + flapDeg) * Math.PI / 180;
    const c = Math.cos(rot), s = Math.sin(rot);
    return { Rx: f.x, Ry: f.y, Dx: -Tx * c + Ty * s, Dy: -Tx * s - Ty * c };   // (-T) rotated
  }
  const Nsx = f.nx * sideSign, Nsy = f.ny * sideSign;
  const bw = makeWidthFn(spline.points)(fin.anchor);
  const rot = sideSign * (fin.angle + swayDeg + flapDeg) * Math.PI / 180;
  const c = Math.cos(rot), s = Math.sin(rot);
  return { Rx: f.x + Nsx * bw, Ry: f.y + Nsy * bw, Dx: Nsx * c - Nsy * s, Dy: Nsx * s + Nsy * c };
}

export function buildFinOutline(spline, motion, fin, sideSign, opts) {
  const finW = makeWidthFn(fin.profile);
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

// Nonzero-winding scanline fill of a world-unit polygon → Set of "cx,cy" display cells
// (cell centers at integer coords). Overlapping sub-loops stay filled — no holes.
export function fillOutlineCells(poly, d) {
  const pts = poly.map((p) => ({ x: p.x * d, y: p.y * d }));
  let minY = Infinity, maxY = -Infinity;
  for (const p of pts) { if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y; }
  const set = new Set();
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
    for (let i = 0; i < xs.length - 1; i++) {
      wind += xs[i].dir;
      if (wind !== 0) {
        const xa = Math.ceil(xs[i].x), xb = Math.floor(xs[i + 1].x);
        for (let cx = xa; cx <= xb; cx++) set.add(`${cx},${cy}`);
      }
    }
  }
  return set;
}

// Connected-segment outline of a world-unit polygon → Set of "cx,cy" cells (Bresenham
// between consecutive ring vertices, so the stroke is gap-free).
export function strokeOutlineCells(poly, d) {
  const set = new Set();
  const line = (x0, y0, x1, y1) => {
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      set.add(`${x0},${y0}`);
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
  // Normalize (all versions): backfill optional blocks so no consumer — renderer,
  // editors, registry — ever meets a hand-edited/ancient blob missing them.
  if (!Array.isArray(c.appendages)) c.appendages = [];
  if (!c.patterns) c.patterns = { spawnMode: 'mix', active: null, variations: [] };
  c.motion = { wagAmp: 0.16, wagRate: 1, wagCurve: 1.4, wagPeaks: 1, wagFreqMul: 1, ...c.motion };
  return c;
}

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

// ─── FishBase ─────────────────────────────────────────────────────────────────
// The single creature engine class (E13-9 / E14-1): everything that used to be a
// per-subclass static lives on the SPECIES RECORD passed to the constructor
// (src/species/species-registry.js). All species reads go through `this.species`
// fresh each frame, so menu edits to the shared record apply to living fish
// instantly — the same live-read semantics the class statics had.
export class FishBase {
  /** When true, the creature's maxBend drives maxTurnRate (the visible bend and the
   *  real turn radius agree); when false, turn rate stays the size-interpolated cap
   *  and only the rendered bend is gated/clamped. Compare toggle (Movement menu). */
  static BEND_DRIVES_TURN = false;

  /** When true, draw() fills the fish body solid rather than outline-only.
   *  Toggled globally from the Fish menu section. */
  static FILLED = false;

  /** When true, fish are hard-clamped to the world bounds each frame (safety net).
   *  When false, only the edge force keeps them away from walls — fish can
   *  overshoot at high speed or with the edge weight lowered. */
  static HARD_BORDER = true;

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

    // Burst-and-coast throttle state — seeded random so fish breathe out of phase.
    this._throttle  = 0.3 + Math.random() * 0.7;
    this._thrTarget = this._throttle;
    this._phase     = Math.random() < 0.5 ? 'burst' : 'glide';
    this._thrHold   = Math.random() * species.tuning.glideMsMax;   // random initial offset

    // Movement state machine + wander angle (consumed by movement/ behaviors).
    this.state           = 'swim';
    this._wanderTheta    = Math.random() * Math.PI * 2;
    this._wanderOmega    = 0;   // smoothly-evolving wander rotation rate (rad/ms)
    this._neighborCount  = 0;   // fish within PERCEPTION_RADIUS, refreshed each update()
    this._orbitChirality = 0;   // ±1 set on first entry to attract orbit; 0 = unassigned

    this.color = rollColor(getActivePalette(), getSpecialPalette());
  }

  /** Max steering force for this fish (logical px/ms²). A fixed internal constant
   *  per species (the size-interpolated Arc sliders were retired in E13-4). Live. */
  get maxForce() {
    return this.species.tuning.forceMax;
  }

  /** Hard turn-rate ceiling (rad/s) for this fish, interpolated by size.
   *  Small fish turn faster; large fish sweep wider arcs. Live getter. */
  get maxTurnRate() {
    const t = this.species.tuning;
    // Coupled mode: the turn-rate cap is whatever exactly saturates the creature's
    // maxBend (targetBend = turnRate × 0.8), so the body bend == the real turn.
    if (FishBase.BEND_DRIVES_TURN) return (this.species.body.spline.maxBend ?? 1.2) / 0.8;
    return t.turnRateMax - this._sizeFrac * (t.turnRateMax - t.turnRateMin);
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

  /** Advance the burst/glide cycle: hold the current phase for a randomized duration,
   *  then flip and re-sample a fresh target level + hold from the species ranges. The
   *  live throttle eases toward the target (exponential smoothing) for organic motion.
   *  Every fish rolls its own values each cycle, so no two breathe in lockstep. */
  _updateThrottle(deltaMs) {
    const t = this.species.tuning;
    this._thrHold -= deltaMs;
    if (this._thrHold <= 0) {
      if (this._phase === 'glide') {
        this._phase     = 'burst';
        this._thrTarget = t.burstMin + Math.random() * (1 - t.burstMin);
        this._thrHold   = t.burstMsMin + Math.random() * (t.burstMsMax - t.burstMsMin);
      } else {
        this._phase     = 'glide';
        this._thrTarget = t.coastMin + Math.random() * (t.coastThrottle - t.coastMin);
        this._thrHold   = t.glideMsMin + Math.random() * (t.glideMsMax - t.glideMsMin);
      }
    }
    const k = 1 - Math.exp(-deltaMs / Math.max(1, t.throttleEaseMs));
    this._throttle += (this._thrTarget - this._throttle) * k;
  }

  /**
   * Update physics for one frame.
   * @param {number}    deltaMs   - frame time (ms)
   * @param {object}    grid      - Grid instance with logicalW / logicalH
   * @param {FishBase[]} neighbors - fish within PERCEPTION_RADIUS (from Simulation)
   */
  update(deltaMs, grid, neighbors, attractPoint = null) {
    const { logicalW, logicalH } = grid;
    const { tuning, body } = this.species;
    const maxSpeed = this.maxSpeed;

    // ── 0. Advance the burst/glide cruise throttle (drives cruiseSpeed + drag + tail) ──
    this._updateThrottle(deltaMs);

    // Fish within PERCEPTION_RADIUS this frame. Retained for later use (social-state
    // triggers, density-aware behavior, tuning) — not currently displayed.
    this._neighborCount = neighbors.length;

    // ── 1. Compose steering forces from the active state's behaviors ─────────
    // Reset orbit chirality on the first frame after attraction ends so the next
    // approach picks a fresh random direction (the attract behavior resets it during
    // approach, but it can't run when weight=0 — this covers the cleared-point case).
    if (!attractPoint && this._orbitChirality) this._orbitChirality = 0;
    const ctx = { neighbors, bounds: { width: logicalW, height: logicalH }, dt: deltaMs, attractPoint };
    this.state = nextState(this, ctx);
    const weights = STATES[this.state].behaviors(this, ctx);
    let ax = 0, ay = 0;
    for (const name in weights) {
      const w = weights[name];
      if (!w) continue;
      const f = BEHAVIORS[name](this, ctx);
      ax += f.x * w;
      ay += f.y * w;
    }

    // ── 2. Integrate (delta-time scaled), apply drag, clamp to max speed ─────
    this.vx += ax * deltaMs;
    this.vy += ay * deltaMs;

    // Water drag — the medium (E14-1). Per-species velocity retention per second,
    // ALWAYS on (no throttle gating): the water doesn't care whether the fish is
    // bursting or coasting. tuning.drag = 1.0 → frictionless (the pre-E14 default
    // behavior, since the old GLIDE_DRAG also defaulted to 1.0); lower values bleed
    // momentum so coasts end in a near-stop instead of gliding on forever.
    const drag = Math.pow(tuning.drag, deltaMs / 1000);
    this.vx *= drag;
    this.vy *= drag;

    // Clamp to full maxSpeed (unthrottled ceiling, so bursts can reach top speed).
    const sp = Math.sqrt(this.vx * this.vx + this.vy * this.vy);
    if (sp > maxSpeed) {
      this.vx = (this.vx / sp) * maxSpeed;
      this.vy = (this.vy / sp) * maxSpeed;
    }

    // ── 2b. Hard turn-rate clamp ─────────────────────────────────────────────
    // After forces + drag, the velocity direction may have rotated more than
    // maxTurnRate allows in one frame — most visibly at low speed where even a
    // small net force dominates a near-zero velocity vector (the spin cycle).
    // Clamp the heading change to maxTurnRate×dt; preserve speed unchanged.
    const spAfterDrag = Math.sqrt(this.vx * this.vx + this.vy * this.vy);
    if (spAfterDrag > 1e-6) {
      const prospH  = Math.atan2(this.vy, this.vx);
      const delta   = _angleDiff(prospH, this.heading);
      const maxDelta = this.maxTurnRate / 1000 * deltaMs;
      if (Math.abs(delta) > maxDelta) {
        const clampedH = this.heading + Math.sign(delta) * maxDelta;
        this.vx = Math.cos(clampedH) * spAfterDrag;
        this.vy = Math.sin(clampedH) * spAfterDrag;
      }
    }

    // ── 3. Move + optional hard boundary clamp ──────────────────────────────
    this.x += this.vx * deltaMs;
    this.y += this.vy * deltaMs;
    if (FishBase.HARD_BORDER) {
      this.x = Math.max(this.half, Math.min(logicalW - this.half, this.x));
      this.y = Math.max(this.half, Math.min(logicalH - this.half, this.y));
    }

    // ── 4. Heading + steering bend — derived from the actual turn rate, which
    //       drives the body curve in the renderer. ───────────────────────────
    const curSpeed = Math.sqrt(this.vx * this.vx + this.vy * this.vy);
    const maxBend  = body.spline.maxBend ?? 1.2;
    if (curSpeed > 0.0001) {
      const newHeading = Math.atan2(this.vy, this.vx);
      const turnRate   = _angleDiff(newHeading, this.heading) / deltaMs * 1000; // rad/s
      // Front bends only to turn, only while moving: clamp to the creature's maxBend,
      // then gate by a ramped speed factor so a near-stopped fish holds straight.
      const gTurn      = _smoothstep(0, 0.15, curSpeed / maxSpeed);
      const targetBend = Math.max(-maxBend, Math.min(maxBend, turnRate * 0.8)) * gTurn;
      this.steeringBend += (targetBend - this.steeringBend) * 0.005 * deltaMs;
      this.heading = newHeading;
    } else {
      this.steeringBend *= Math.pow(0.98, deltaMs / 16);
    }

    // ── 5. Wag drive — cadence + amplitude ride the propulsion throttle, so a coasting
    //       fish's tail goes quiet and a bursting fish beats hard. wagFreqMul (CREATURE
    //       v5) is the user's frequency knob, orthogonal to the throttle. ────────────
    this.swimPhase += tuning.swimBeatRate * (body.motion.wagRate ?? 1)
                    * (body.motion.wagFreqMul ?? 1) * this._throttle * deltaMs;
    if (this.swimPhase > Math.PI * 2) this.swimPhase -= Math.PI * 2;
    this.swimAmp = this._throttle;
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
    };
    const filled = FishBase.FILLED, color = this.color;
    const parts = [{ poly: buildBodyOutline(creature.spline, creature.motion, opts), filled, color }];
    for (const poly of buildAppendageOutlines(creature, opts)) parts.push({ poly, filled, color });

    const ocx = Math.round(this.x * D), ocy = Math.round(this.y * D);
    for (const part of parts) {
      const { r, g, b } = part.color;
      const cells = part.filled ? fillOutlineCells(part.poly, D) : strokeOutlineCells(part.poly, D);
      for (const key of cells) {
        const ci = key.indexOf(',');
        const cx = +key.slice(0, ci), cy = +key.slice(ci + 1);
        grid.drawCell(ocx + cx, ocy + cy, r, g, b);
      }
    }
  }
}
