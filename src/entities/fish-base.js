// src/entities/fish-base.js
// Base class for all fish entities.
// Handles: boid steering composition + state machine (movement), spline rendering.
// Movement is built from composable steering behaviors — see src/movement/ and
// docs/boids-movement-reference.md. Rendering (spline body shape, swim wiggle) is
// unchanged and consumes only x, y, heading, steeringBend, swimPhase, length, color.

import { BEHAVIORS } from '../movement/behaviors.js';
import { STATES, nextState } from '../movement/states.js';

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
const WAIST_FRAC = 0.28;   // tail bezier spans t ∈ [0, WAIST_FRAC]

// Half-width profile along fish body: t=0 (tail tip) → t=1 (head tip)
function _widthAt(t) {
  if (t < 0.06) return (t / 0.06) * 0.4;
  if (t < 0.13) return 0.4 + ((t - 0.06) / 0.07) * 1.4;  // tail fin widens
  if (t < 0.20) return 1.8 - ((t - 0.13) / 0.07) * 1.4;  // peduncle narrows
  if (t < 0.28) return 0.4 + ((t - 0.20) / 0.08) * 0.9;  // body rises
  if (t < 0.55) return 1.3 + ((t - 0.28) / 0.27) * 0.9;  // body widens
  if (t < 0.72) return 2.2;                                 // body max
  if (t < 0.88) return 2.2 - ((t - 0.72) / 0.16) * 1.4;  // taper to head
  return 0.8 - ((t - 0.88) / 0.12) * 0.7;                  // snout
}

// Snaps outline points to the DISPLAY-CELL grid (density cells per world unit). All
// inputs are world units; the `d` factor converts to cells just before rounding, so the
// fish keeps its world-unit shape but is rasterized finer as density rises.
function _outlinePx(set, bx, by, nx, ny, w, d) {
  if (w < 0.35) {
    set.add(`${Math.round(bx * d)},${Math.round(by * d)}`);
  } else {
    set.add(`${Math.round((bx + nx * w) * d)},${Math.round((by + ny * w) * d)}`);
    set.add(`${Math.round((bx - nx * w) * d)},${Math.round((by - ny * w) * d)}`);
  }
}

// Returns [{x,y}] DISPLAY-CELL coords relative to fish center (0,0).
// headAngle : direction the head points (radians; 0=east, π/2=south-screen)
// steeringBend : body curvature (+= clockwise/right, -= counter-clockwise/left)
// swimOsc  : swim oscillation in [-1, 1]
// length   : fish nose-to-tail length in world units
// density  : display cells per world unit (render fidelity). 1 = current behavior.
function _renderSpline(headAngle, steeringBend, swimOsc, length, density = 1) {
  const cosH = Math.cos(headAngle), sinH = Math.sin(headAngle);
  const cosP = -sinH, sinP = cosH;   // right-perpendicular

  const headDist  = length * 0.42;
  const tailDist  = length * 0.58;
  const waistDist = tailDist - length * WAIST_FRAC;

  const Hx =  cosH * headDist,    Hy =  sinH * headDist;
  const Tx = -cosH * tailDist,    Ty = -sinH * tailDist;
  const Wx = -cosH * waistDist - cosP * steeringBend * length * 0.12;
  const Wy = -sinH * waistDist - sinP * steeringBend * length * 0.12;

  const tailWigglePx = length * 0.156;   // ≈ 2.5 px at length=16
  const TCx = Tx + (Wx - Tx) * 0.5 + cosP * swimOsc * tailWigglePx;
  const TCy = Ty + (Wy - Ty) * 0.5 + sinP * swimOsc * tailWigglePx;

  const BCx = (Wx + Hx) * 0.5 - cosP * steeringBend * length * 0.22;
  const BCy = (Wy + Hy) * 0.5 - sinP * steeringBend * length * 0.22;

  const set = new Set();

  // Scale sample counts with density so the finer outline stays gap-free.
  const TAIL_STEPS = 18 * density, BODY_STEPS = 42 * density;

  for (let i = 0; i <= TAIL_STEPS; i++) {
    const s = i / TAIL_STEPS, t = s * WAIST_FRAC;
    const bx = (1-s)*(1-s)*Tx + 2*(1-s)*s*TCx + s*s*Wx;
    const by = (1-s)*(1-s)*Ty + 2*(1-s)*s*TCy + s*s*Wy;
    const dx = 2*(1-s)*(TCx-Tx) + 2*s*(Wx-TCx);
    const dy = 2*(1-s)*(TCy-Ty) + 2*s*(Wy-TCy);
    const dl = Math.sqrt(dx*dx + dy*dy) || 1;
    _outlinePx(set, bx, by, -dy/dl, dx/dl, _widthAt(t), density);
  }

  for (let i = 0; i <= BODY_STEPS; i++) {
    const s = i / BODY_STEPS, t = WAIST_FRAC + s * (1 - WAIST_FRAC);
    const bx = (1-s)*(1-s)*Wx + 2*(1-s)*s*BCx + s*s*Hx;
    const by = (1-s)*(1-s)*Wy + 2*(1-s)*s*BCy + s*s*Hy;
    const dx = 2*(1-s)*(BCx-Wx) + 2*s*(Hx-BCx);
    const dy = 2*(1-s)*(BCy-Wy) + 2*s*(Hy-BCy);
    const dl = Math.sqrt(dx*dx + dy*dy) || 1;
    _outlinePx(set, bx, by, -dy/dl, dx/dl, _widthAt(t), density);
  }

  return [...set].map(k => { const [x, y] = k.split(',').map(Number); return { x, y }; });
}

// ─── Angle utilities ──────────────────────────────────────────────────────────
function _normalizeAngle(a) {
  while (a >  Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}
function _angleDiff(a, b) { return _normalizeAngle(a - b); }

// ─── FishBase ─────────────────────────────────────────────────────────────────
export class FishBase {
  // ── Subclasses SHOULD override these statics ───────────────────────────────
  static TYPE_ID    = 'fish';
  static SIZE_MIN   = 10;
  static SIZE_MAX   = 18;
  /** Size distribution: number = power exponent, 'normal' = bell curve */
  static SIZE_CURVE = 1.0;
  static SPEED_MAX  = 0.03;   // logical px/ms
  static COLORS     = [{ r: 200, g: 200, b: 200 }];

  // Schooling (boids) — SCHOOL_WEIGHT 0=solitary, 1=strong schooler.
  // Scales the alignment + cohesion forces (separation always applies).
  static SCHOOL_WEIGHT     = 0.5;
  static PERCEPTION_RADIUS = 20;   // px — boids neighborhood radius (used by Simulation)
  static SEPARATION_DIST   = 8;    // px — desired minimum gap between fish

  // Steering-behavior weights (per-frame force composition, see movement/states.js).
  static SEPARATION_WEIGHT = 1.6;
  static ALIGNMENT_WEIGHT  = 1.0;   // effective weight = this × SCHOOL_WEIGHT
  static COHESION_WEIGHT   = 0.8;   // effective weight = this × SCHOOL_WEIGHT
  static WANDER_WEIGHT     = 0.45;
  static EDGE_WEIGHT       = 2.6;   // ≥1.5× separation so containment dominates near walls
  /** Inside the wall-avoidance band, fade wander + alignment + cohesion by up to
   *  this fraction (0 = no change, 1 = those fully off at the wall) so edge steering
   *  isn't overpowered by schooling/wander near walls. Ramps with depth into band. */
  static EDGE_YIELD        = 0.9;

  /** Max steering force (logical px/ms²), interpolated by size: small fish are
   *  nimbler (higher force → tighter turns), large fish turn lazily. Low relative
   *  to SPEED_MAX → smooth, fish-like arcs rather than snappy banking. */
  static MAX_FORCE_MAX = 0.00045;   // smallest fish — nimble; /SPEED_MAX ≈ 0.015 (≈ Shiffman)
  static MAX_FORCE_MIN = 0.00022;   // largest fish  — lazy but wall-safe; /SPEED_MAX ≈ 0.0073

  constructor(grid) {
    const cls = this.constructor;
    const { logicalW, logicalH } = grid;

    this.length = _sampleSize(cls.SIZE_MIN, cls.SIZE_MAX, cls.SIZE_CURVE);
    this.half   = this.length / 2;

    // Size fraction 0 (smallest) → 1 (largest), used to scale agility.
    const sizeFrac = Math.max(0, Math.min(1,
      (this.length - cls.SIZE_MIN) / Math.max(1, cls.SIZE_MAX - cls.SIZE_MIN)
    ));
    // Per-fish steering variation: small fish turn harder; slight speed jitter so the
    // school never moves as a rigid block. Stored as fractions and combined with the
    // class statics in the maxForce/maxSpeed getters, so live menu-slider edits to
    // those statics take effect on existing fish immediately.
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

    // Movement state machine + wander angle (consumed by movement/ behaviors).
    this.state        = 'swim';
    this._wanderTheta = Math.random() * Math.PI * 2;

    this.color = cls.COLORS[Math.floor(Math.random() * cls.COLORS.length)];
  }

  /** Max steering force for this fish (logical px/ms²), interpolated by size from
   *  the class statics. Computed live so menu-slider edits apply instantly. */
  get maxForce() {
    const c = this.constructor;
    return c.MAX_FORCE_MAX - this._sizeFrac * (c.MAX_FORCE_MAX - c.MAX_FORCE_MIN);
  }

  /** Max speed for this fish (logical px/ms), class static × per-fish jitter. Live. */
  get maxSpeed() {
    return this.constructor.SPEED_MAX * this._speedJitter;
  }

  /**
   * Update physics for one frame.
   * @param {number}    deltaMs   - frame time (ms)
   * @param {object}    grid      - Grid instance with logicalW / logicalH
   * @param {FishBase[]} neighbors - fish within PERCEPTION_RADIUS (from Simulation)
   */
  update(deltaMs, grid, neighbors) {
    const { logicalW, logicalH } = grid;
    const maxSpeed = this.maxSpeed;

    // ── 1. Compose steering forces from the active state's behaviors ─────────
    const ctx = { neighbors, bounds: { width: logicalW, height: logicalH }, dt: deltaMs };
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

    // ── 2. Integrate (delta-time scaled) + clamp to max speed ────────────────
    this.vx += ax * deltaMs;
    this.vy += ay * deltaMs;
    const sp = Math.sqrt(this.vx * this.vx + this.vy * this.vy);
    if (sp > maxSpeed) {
      this.vx = (this.vx / sp) * maxSpeed;
      this.vy = (this.vy / sp) * maxSpeed;
    }

    // ── 3. Move + hard boundary clamp (safety net beneath the `edges` force) ──
    this.x += this.vx * deltaMs;
    this.y += this.vy * deltaMs;
    this.x = Math.max(this.half, Math.min(logicalW - this.half, this.x));
    this.y = Math.max(this.half, Math.min(logicalH - this.half, this.y));

    // ── 4. Heading + steering bend — derived from the actual turn rate, which
    //       drives the body curve in the renderer. ───────────────────────────
    const curSpeed = Math.sqrt(this.vx * this.vx + this.vy * this.vy);
    if (curSpeed > 0.0001) {
      const newHeading = Math.atan2(this.vy, this.vx);
      const turnRate   = _angleDiff(newHeading, this.heading) / deltaMs * 1000; // rad/s
      const targetBend = Math.max(-1.2, Math.min(1.2, turnRate * 0.8));
      this.steeringBend += (targetBend - this.steeringBend) * 0.005 * deltaMs;
      this.heading = newHeading;
    } else {
      this.steeringBend *= Math.pow(0.98, deltaMs / 16);
    }

    // ── 5. Swim oscillation ──────────────────────────────────────────────────
    this.swimPhase += 0.006 * deltaMs;
    if (this.swimPhase > Math.PI * 2) this.swimPhase -= Math.PI * 2;
  }

  draw(grid) {
    const D       = grid.density;
    const swimOsc = Math.sin(this.swimPhase);
    const pixels  = _renderSpline(this.heading, this.steeringBend, swimOsc, this.length, D);
    // Center on the display-cell grid; spline offsets are already in display cells.
    const ocx = Math.round(this.x * D), ocy = Math.round(this.y * D);
    const { r, g, b } = this.color;
    for (const { x, y } of pixels) grid.drawCell(ocx + x, ocy + y, r, g, b);
  }
}
