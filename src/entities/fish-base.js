// src/entities/fish-base.js
// Base class for all fish entities.
// Handles: physics, look-ahead wall avoidance, boids interface (stub), spline rendering.

// ─── Shared physics constants ─────────────────────────────────────────────────
const LERP_RATE  = 0.003;    // direction smoothing factor per ms — must stay above step-6b turn
                             // caps so that the size-scaled clamp is the actual limiter, not this
const EDGE_FORCE = 0.003;    // emergency wall backstop push (logical px/ms²)

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

  // Schooling (boids) — SCHOOL_WEIGHT 0=solitary, 1=strong schooler
  static SCHOOL_WEIGHT     = 0.5;
  static PERCEPTION_RADIUS = 20;   // px — boids neighborhood radius
  static SEPARATION_DIST   = 8;    // px — desired minimum gap between fish

  static MIN_WANDER_INTERVAL = 4000;    // ms
  static MAX_WANDER_INTERVAL = 12000;

  /** Turn rate bounds (rad/s). Actual rate is linearly interpolated by fish size. */
  static TURN_RATE_MAX = 2.4;   // fastest turn (smallest fish of this type)
  static TURN_RATE_MIN = 0.8;   // slowest turn (largest fish of this type)

  /** Max speed increase per ms (logical px/ms²). Controls thrust — not braking. */
  static ACCEL_RATE = 0.00006;

  constructor(grid) {
    const cls = this.constructor;
    const { logicalW, logicalH } = grid;

    this.length = _sampleSize(cls.SIZE_MIN, cls.SIZE_MAX, cls.SIZE_CURVE);
    this.half   = this.length / 2;

    // Turn rate inversely scaled by size: small fish turn faster
    const sizeFrac = Math.max(0, Math.min(1,
      (this.length - cls.SIZE_MIN) / Math.max(1, cls.SIZE_MAX - cls.SIZE_MIN)
    ));
    this._maxTurnRate = cls.TURN_RATE_MAX - sizeFrac * (cls.TURN_RATE_MAX - cls.TURN_RATE_MIN);

    // Spawn within safe margins (center-based position)
    this.x = this.half + 5 + Math.random() * (logicalW - this.length - 10);
    this.y = this.half + 5 + Math.random() * (logicalH - this.length - 10);

    const initSpeed = cls.SPEED_MAX * (0.3 + Math.random() * 0.7);
    const initAngle = Math.random() * Math.PI * 2;
    this.vx = Math.cos(initAngle) * initSpeed;
    this.vy = Math.sin(initAngle) * initSpeed;

    this.heading      = initAngle;
    this.steeringBend = 0;
    this.swimPhase    = Math.random() * Math.PI * 2;   // stagger fish

    // Speed and direction are tracked separately so acceleration can be ramped
    // without coupling to the direction LERP (see step 4 of update()).
    this._speed        = initSpeed;
    this._targetSpeed  = initSpeed;
    this._targetAngle  = initAngle;
    this._wanderCooldown = cls.MIN_WANDER_INTERVAL +
      Math.random() * (cls.MAX_WANDER_INTERVAL - cls.MIN_WANDER_INTERVAL);
    /** When > 0, wall avoidance has set the target and wander must not override it. */
    this._avoidCooldown  = 0;

    this.color = cls.COLORS[Math.floor(Math.random() * cls.COLORS.length)];
  }

  /**
   * Update physics for one frame.
   * @param {number}    deltaMs   - frame time (ms)
   * @param {object}    grid      - Grid instance with logicalW / logicalH
   * @param {FishBase[]} neighbors - fish within PERCEPTION_RADIUS (from Simulation)
   */
  update(deltaMs, grid, neighbors) {
    const cls = this.constructor;
    const { logicalW, logicalH } = grid;
    const maxSpeed = cls.SPEED_MAX;

    // ── 1. Wander AI ────────────────────────────────────────────────────────
    this._wanderCooldown -= deltaMs;
    if (this._wanderCooldown <= 0 && this._avoidCooldown <= 0) {
      this._targetSpeed = maxSpeed * (0.3 + Math.random() * 0.7);
      this._targetAngle = Math.random() * Math.PI * 2;
      this._wanderCooldown = cls.MIN_WANDER_INTERVAL +
        Math.random() * (cls.MAX_WANDER_INTERVAL - cls.MIN_WANDER_INTERVAL);
    }

    // ── 2. Look-ahead wall avoidance ─────────────────────────────────────────
    // Project the look-ahead point along the fish's *expected* future heading
    // (accounting for current rotation via steeringBend), then bias the escape
    // direction to continue the fish's existing turn rather than forcing a U-turn.
    this._avoidCooldown -= deltaMs;
    const speed = Math.sqrt(this.vx * this.vx + this.vy * this.vy);
    if (speed > 0.0005) {
      const hx = this.vx / speed, hy = this.vy / speed;
      const lookDist = Math.max(this.length * 1.5, 14);
      const margin   = this.half + 3;

      // Estimate how much the heading will have rotated by the time the fish
      // reaches the look-ahead distance.  steeringBend ≈ turnRate(rad/s) * 0.8
      // lookMs is capped so slow-moving fish don't project the heading wildly
      // (at 0.003 px/ms a 14px look costs 4700ms → 3+ rad of spin at steeringBend=0.5).
      const estTurnRate = this.steeringBend / 0.8;          // rad/s
      const lookMs      = Math.min(lookDist / speed, 500);  // ms, capped at 500
      const projH       = this.heading + (estTurnRate / 1000) * lookMs;
      const phx = Math.cos(projH), phy = Math.sin(projH);

      const px = this.x + phx * lookDist;
      const py = this.y + phy * lookDist;

      let escapeX = 0, escapeY = 0;

      const hitsH = px < margin || px > logicalW - margin;
      const hitsV = py < margin || py > logicalH - margin;

      // Bias toward the fish's current turning direction so it completes the arc
      // rather than chopping across.  right-perp of (hx,hy) = (-hy, hx).
      const BIAS_THRESHOLD = 0.12;
      const hasBias  = Math.abs(this.steeringBend) > BIAS_THRESHOLD;
      const biasSign = Math.sign(this.steeringBend);
      const perpX    = -hy * biasSign;   // right-perp X if biasSign=+1, left-perp if -1
      const perpY    =  hx * biasSign;   // right-perp Y

      if (hitsH && !hitsV) {
        // Approaching left or right wall — turn north or south
        escapeY = (hasBias && Math.abs(perpY) > 0.1) ? perpY
                  : (this.y > logicalH / 2) ? -1 : 1;
        escapeX = hx * 0.2;   // slight forward carry so the turn is an arc not 90°
      } else if (hitsV && !hitsH) {
        // Approaching top or bottom wall — turn east or west
        escapeX = (hasBias && Math.abs(perpX) > 0.1) ? perpX
                  : (this.x > logicalW / 2) ? -1 : 1;
        escapeY = hy * 0.2;
      } else if (hitsH && hitsV) {
        // Corner: escape toward the center of the pond
        escapeX = (logicalW / 2 - this.x);
        escapeY = (logicalH / 2 - this.y);
      }

      if (escapeX !== 0 || escapeY !== 0) {
        // ── Speed regulation: slow down if turning radius won't fit clearance ──
        // Turning radius at current speed = speed(px/ms) * 1000 / turnRate(rad/s).
        // The fish needs that much room to complete a 90° arc without hitting the wall.
        let clearance = lookDist;   // fallback: well away from wall
        if (hitsH) {
          clearance = Math.min(clearance,
            px < margin ? Math.max(0, this.x - margin)
                        : Math.max(0, logicalW - margin - this.x)
          );
        }
        if (hitsV) {
          clearance = Math.min(clearance,
            py < margin ? Math.max(0, this.y - margin)
                        : Math.max(0, logicalH - margin - this.y)
          );
        }
        clearance = Math.max(clearance, 0.5);

        const turnRadius = speed * 1000 / this._maxTurnRate;
        let avoidSpeed;
        let cooldown;
        if (turnRadius > clearance) {
          // Too fast to turn in time — slow to the speed where radius just fits.
          // 0.75 safety margin; floor at 15% maxSpeed so the fish never stalls.
          const safeSpeed = Math.max(
            (clearance * this._maxTurnRate / 1000) * 0.75,
            maxSpeed * 0.15
          );
          avoidSpeed = Math.min(speed, safeSpeed);  // only ever slow, never thrust
          cooldown   = 2500;                         // hold avoidance longer after braking
        } else {
          avoidSpeed = speed;   // enough clearance — just redirect, don't change speed
          cooldown   = 1500;
        }

        this._targetAngle = Math.atan2(escapeY, escapeX);
        this._targetSpeed = avoidSpeed;
        this._avoidCooldown = cooldown;
      }
    }

    // ── 3. Boids (stub — separation / alignment / cohesion) ──────────────────
    if (cls.SCHOOL_WEIGHT > 0 && neighbors.length > 0) {
      this._applyBoids(deltaMs, neighbors, maxSpeed);
    }

    // ── 4. Speed ramp + direction lerp ───────────────────────────────────────
    // Sync _speed to actual velocity — captures backstop/cap effects from last frame.
    this._speed = Math.sqrt(this.vx * this.vx + this.vy * this.vy);

    // Ramp toward target: acceleration is capped, deceleration is free.
    // This prevents thrust from snapping to a new wander speed in one frame
    // while still allowing the fish to brake immediately when avoiding walls.
    const accelCap = cls.ACCEL_RATE * deltaMs;
    const ds       = this._targetSpeed - this._speed;
    this._speed   += ds > accelCap ? accelCap : ds;

    // Rescale velocity to the ramped speed, then nudge direction toward target.
    // Direction and speed are fully independent: speed changes via the ramp above,
    // direction changes via LERP here + the hard turn-rate clamp in step 6b.
    if (this._speed > 0.0001) {
      const curMag = Math.sqrt(this.vx * this.vx + this.vy * this.vy);
      const dirX   = curMag > 0.0001 ? this.vx / curMag : Math.cos(this._targetAngle);
      const dirY   = curMag > 0.0001 ? this.vy / curMag : Math.sin(this._targetAngle);
      // Lerp the unit direction toward target, then renormalize to avoid magnitude drift
      const lf   = LERP_RATE * deltaMs;
      const tdx  = Math.cos(this._targetAngle);
      const tdy  = Math.sin(this._targetAngle);
      const bx   = dirX + (tdx - dirX) * lf;
      const by   = dirY + (tdy - dirY) * lf;
      const bLen = Math.sqrt(bx * bx + by * by) || 1;
      this.vx = (bx / bLen) * this._speed;
      this.vy = (by / bLen) * this._speed;
    } else {
      // Nearly stopped — decay any residual velocity
      const decay = Math.pow(0.9, deltaMs / 16);
      this.vx    *= decay;
      this.vy    *= decay;
    }

    // ── 5. Emergency wall backstop (last resort if fish already too close) ───
    const eMargin = this.half + 1;
    if (this.x < eMargin)             this.vx += EDGE_FORCE * deltaMs;
    if (this.x > logicalW - eMargin)  this.vx -= EDGE_FORCE * deltaMs;
    if (this.y < eMargin)             this.vy += EDGE_FORCE * deltaMs;
    if (this.y > logicalH - eMargin)  this.vy -= EDGE_FORCE * deltaMs;

    // ── 6. Speed cap ─────────────────────────────────────────────────────────
    const newSpeed = Math.sqrt(this.vx * this.vx + this.vy * this.vy);
    if (newSpeed > maxSpeed) {
      this.vx = (this.vx / newSpeed) * maxSpeed;
      this.vy = (this.vy / newSpeed) * maxSpeed;
    }

    // ── 6b. Max turn rate — larger fish turn more slowly ─────────────────────
    // Clamp how far the velocity direction can deviate from the current heading
    // in a single frame, based on _maxTurnRate (rad/s) computed at spawn time.
    {
      const s6 = newSpeed > maxSpeed ? maxSpeed : newSpeed;
      if (s6 > 0.0001) {
        const prospH   = Math.atan2(this.vy, this.vx);
        const delta    = _angleDiff(prospH, this.heading);
        const maxDelta = this._maxTurnRate / 1000 * deltaMs;
        if (Math.abs(delta) > maxDelta) {
          const clampedH = this.heading + Math.sign(delta) * maxDelta;
          this.vx = Math.cos(clampedH) * s6;
          this.vy = Math.sin(clampedH) * s6;
        }
      }
    }

    // ── 7. Heading + steering bend ───────────────────────────────────────────
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

    // ── 8. Swim oscillation ──────────────────────────────────────────────────
    this.swimPhase += 0.006 * deltaMs;
    if (this.swimPhase > Math.PI * 2) this.swimPhase -= Math.PI * 2;

    // ── 9. Move + hard boundary clamp ────────────────────────────────────────
    this.x += this.vx * deltaMs;
    this.y += this.vy * deltaMs;
    this.x = Math.max(this.half, Math.min(logicalW - this.half, this.x));
    this.y = Math.max(this.half, Math.min(logicalH - this.half, this.y));
  }

  /**
   * Boids behavior — to be fully implemented in a later session.
   * Subclasses may override; base implementation is a no-op stub.
   * Implementations should write to this._targetSpeed (scalar) and
   * this._targetAngle (radians) rather than setting vx/vy directly.
   * @param {number}     _deltaMs
   * @param {FishBase[]} _neighbors
   * @param {number}     _maxSpeed
   */
  _applyBoids(_deltaMs, _neighbors, _maxSpeed) {
    // TODO: separation, alignment, cohesion — weighted by this.constructor.SCHOOL_WEIGHT
  }

  draw(grid) {
    const swimOsc = Math.sin(this.swimPhase);
    const pixels  = _renderSpline(this.heading, this.steeringBend, swimOsc, this.length);
    const ox = Math.round(this.x), oy = Math.round(this.y);
    const { r, g, b } = this.color;
    for (const { x, y } of pixels) grid.drawPixel(ox + x, oy + y, r, g, b);
  }
}
