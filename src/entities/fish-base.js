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

function _outlinePx(set, bx, by, nx, ny, w) {
  if (w < 0.35) {
    set.add(`${Math.round(bx)},${Math.round(by)}`);
  } else {
    set.add(`${Math.round(bx + nx * w)},${Math.round(by + ny * w)}`);
    set.add(`${Math.round(bx - nx * w)},${Math.round(by - ny * w)}`);
  }
}

// Returns [{x,y}] pixel coords relative to fish center (0,0).
// headAngle : direction the head points (radians; 0=east, π/2=south-screen)
// steeringBend : body curvature (+= clockwise/right, -= counter-clockwise/left)
// swimOsc  : swim oscillation in [-1, 1]
// length   : fish nose-to-tail length in logical pixels
function _renderSpline(headAngle, steeringBend, swimOsc, length) {
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

  const TAIL_STEPS = 18, BODY_STEPS = 42;

  for (let i = 0; i <= TAIL_STEPS; i++) {
    const s = i / TAIL_STEPS, t = s * WAIST_FRAC;
    const bx = (1-s)*(1-s)*Tx + 2*(1-s)*s*TCx + s*s*Wx;
    const by = (1-s)*(1-s)*Ty + 2*(1-s)*s*TCy + s*s*Wy;
    const dx = 2*(1-s)*(TCx-Tx) + 2*s*(Wx-TCx);
    const dy = 2*(1-s)*(TCy-Ty) + 2*s*(Wy-TCy);
    const dl = Math.sqrt(dx*dx + dy*dy) || 1;
    _outlinePx(set, bx, by, -dy/dl, dx/dl, _widthAt(t));
  }

  for (let i = 0; i <= BODY_STEPS; i++) {
    const s = i / BODY_STEPS, t = WAIST_FRAC + s * (1 - WAIST_FRAC);
    const bx = (1-s)*(1-s)*Wx + 2*(1-s)*s*BCx + s*s*Hx;
    const by = (1-s)*(1-s)*Wy + 2*(1-s)*s*BCy + s*s*Hy;
    const dx = 2*(1-s)*(BCx-Wx) + 2*s*(Hx-BCx);
    const dy = 2*(1-s)*(BCy-Wy) + 2*s*(Hy-BCy);
    const dl = Math.sqrt(dx*dx + dy*dy) || 1;
    _outlinePx(set, bx, by, -dy/dl, dx/dl, _widthAt(t));
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
  static WANDER_WEIGHT     = 0.5;
  static EDGE_WEIGHT       = 2.2;

  /** Max steering force (logical px/ms²), interpolated by size: small fish are
   *  nimbler (higher force → tighter turns), large fish turn lazily. Low relative
   *  to SPEED_MAX → smooth, fish-like arcs rather than snappy banking. */
  static MAX_FORCE_MAX = 0.00028;   // smallest fish of this type
  static MAX_FORCE_MIN = 0.00012;   // largest fish of this type

  constructor(grid) {
    const cls = this.constructor;
    const { logicalW, logicalH } = grid;

    this.length = _sampleSize(cls.SIZE_MIN, cls.SIZE_MAX, cls.SIZE_CURVE);
    this.half   = this.length / 2;

    // Size fraction 0 (smallest) → 1 (largest), used to scale agility.
    const sizeFrac = Math.max(0, Math.min(1,
      (this.length - cls.SIZE_MIN) / Math.max(1, cls.SIZE_MAX - cls.SIZE_MIN)
    ));
    // Per-fish steering caps: small fish turn harder; slight speed variation so the
    // school never moves as a rigid block.
    this.maxForce = cls.MAX_FORCE_MAX - sizeFrac * (cls.MAX_FORCE_MAX - cls.MAX_FORCE_MIN);
    this.maxSpeed = cls.SPEED_MAX * (0.85 + Math.random() * 0.3);

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
    const weights = STATES[this.state].behaviors(this);
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
    const swimOsc = Math.sin(this.swimPhase);
    const pixels  = _renderSpline(this.heading, this.steeringBend, swimOsc, this.length);
    const ox = Math.round(this.x), oy = Math.round(this.y);
    const { r, g, b } = this.color;
    for (const { x, y } of pixels) grid.drawPixel(ox + x, oy + y, r, g, b);
  }
}
