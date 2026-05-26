// src/entities/koi.js
// Procedural spline-based koi renderer.
// Fish body = two connected quadratic beziers (tail + body sections).
// Pixels computed each frame — no sprite sheets.

const MAX_SPEED = 0.03;           // logical px/ms
const LERP_RATE = 0.0006;         // velocity smoothing per ms
const TURN_FORCE = 0.0008;        // edge avoidance push per ms
const EDGE_MARGIN = 6;            // logical px from edge to start turning away
const MIN_WANDER_INTERVAL = 4000; // ms
const MAX_WANDER_INTERVAL = 12000;

const FISH_LENGTH = 16;           // nose-to-tail length in logical pixels
const FISH_HALF = FISH_LENGTH / 2;
const WAIST_FRAC = 0.28;          // tail bezier spans t=0..WAIST_FRAC

// Body bend dynamics
const BEND_SENSITIVITY = 0.8;    // (rad of bend) per (rad/s of turn rate)
const BEND_MAX = 1.2;             // clamp
const BEND_LERP = 0.005;          // lerp rate toward target bend (per ms)

// Swim oscillation (tail wiggle)
const SWIM_FREQUENCY = 0.006;     // rad/ms → ~0.95 Hz (period ~1.05s)
const TAIL_WIGGLE = 2.5;          // max tail control-point offset (logical px)

const KOI_COLORS = [
  { r: 255, g: 140, b: 0   },
  { r: 255, g: 60,  b: 60  },
  { r: 255, g: 220, b: 100 },
  { r: 200, g: 255, b: 180 },
  { r: 255, g: 255, b: 220 },
];

function _randBetween(a, b) { return a + Math.random() * (b - a); }

function _randVelocity() {
  const speed = MAX_SPEED * (0.3 + Math.random() * 0.7);
  return (Math.random() < 0.5 ? 1 : -1) * speed;
}

function _normalizeAngle(a) {
  while (a >  Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

function _angleDiff(a, b) { return _normalizeAngle(a - b); }

// Half-width profile: t=0 (tail tip) → t=1 (head tip)
function _widthAt(t) {
  if (t < 0.06) return (t / 0.06) * 0.4;
  if (t < 0.13) return 0.4 + ((t - 0.06) / 0.07) * 1.4;  // tail fin widens
  if (t < 0.20) return 1.8 - ((t - 0.13) / 0.07) * 1.4;  // peduncle narrows
  if (t < 0.28) return 0.4 + ((t - 0.20) / 0.08) * 0.9;  // body rises
  if (t < 0.55) return 1.3 + ((t - 0.28) / 0.27) * 0.9;  // body widens
  if (t < 0.72) return 2.2;                                // body max
  if (t < 0.88) return 2.2 - ((t - 0.72) / 0.16) * 1.4;  // taper to head
  return 0.8 - ((t - 0.88) / 0.12) * 0.7;                 // snout
}

function _outlinePx(set, bx, by, nx, ny, w) {
  if (w < 0.35) {
    set.add(`${Math.round(bx)},${Math.round(by)}`);
  } else {
    set.add(`${Math.round(bx + nx * w)},${Math.round(by + ny * w)}`);
    set.add(`${Math.round(bx - nx * w)},${Math.round(by - ny * w)}`);
  }
}

// Render fish pixels relative to fish center (0,0).
// headAngle: direction head points (radians; 0=east, π/2=south-screen)
// steeringBend: body curvature (+= right/clockwise, -= left)
// swimOsc: current swim oscillation value, range [-1, 1]
function _renderSpline(headAngle, steeringBend, swimOsc) {
  const cosH = Math.cos(headAngle), sinH = Math.sin(headAngle);
  // Right-perpendicular (90° clockwise from heading in screen coords)
  const cosP = -sinH, sinP = cosH;

  const headDist = FISH_LENGTH * 0.42;
  const tailDist = FISH_LENGTH * 0.58;
  const waistDist = tailDist - FISH_LENGTH * WAIST_FRAC;

  // Skeleton anchor points (fish-local, center = origin)
  const Hx = cosH * headDist,   Hy = sinH * headDist;   // head tip
  const Tx = -cosH * tailDist,  Ty = -sinH * tailDist;   // tail tip
  // Waist: junction, shifted slightly perpendicular by steering bend
  const Wx = -cosH * waistDist + cosP * steeringBend * FISH_LENGTH * 0.12;
  const Wy = -sinH * waistDist + sinP * steeringBend * FISH_LENGTH * 0.12;

  // Tail bezier control point — swim oscillation shifts tail from side to side
  const TCx = Tx + (Wx - Tx) * 0.5 + cosP * swimOsc * TAIL_WIGGLE;
  const TCy = Ty + (Wy - Ty) * 0.5 + sinP * swimOsc * TAIL_WIGGLE;

  // Body bezier control point — steering bend curves the main body
  const BCx = (Wx + Hx) * 0.5 + cosP * steeringBend * FISH_LENGTH * 0.22;
  const BCy = (Wy + Hy) * 0.5 + sinP * steeringBend * FISH_LENGTH * 0.22;

  const set = new Set();

  // --- Tail bezier: T → TC → W ---
  const TAIL_STEPS = 18;
  for (let i = 0; i <= TAIL_STEPS; i++) {
    const s = i / TAIL_STEPS;
    const t = s * WAIST_FRAC;
    const bx = (1-s)*(1-s)*Tx + 2*(1-s)*s*TCx + s*s*Wx;
    const by = (1-s)*(1-s)*Ty + 2*(1-s)*s*TCy + s*s*Wy;
    const dx = 2*(1-s)*(TCx-Tx) + 2*s*(Wx-TCx);
    const dy = 2*(1-s)*(TCy-Ty) + 2*s*(Wy-TCy);
    const dl = Math.sqrt(dx*dx + dy*dy) || 1;
    _outlinePx(set, bx, by, -dy/dl, dx/dl, _widthAt(t));
  }

  // --- Body bezier: W → BC → H ---
  const BODY_STEPS = 42;
  for (let i = 0; i <= BODY_STEPS; i++) {
    const s = i / BODY_STEPS;
    const t = WAIST_FRAC + s * (1 - WAIST_FRAC);
    const bx = (1-s)*(1-s)*Wx + 2*(1-s)*s*BCx + s*s*Hx;
    const by = (1-s)*(1-s)*Wy + 2*(1-s)*s*BCy + s*s*Hy;
    const dx = 2*(1-s)*(BCx-Wx) + 2*s*(Hx-BCx);
    const dy = 2*(1-s)*(BCy-Wy) + 2*s*(Hy-BCy);
    const dl = Math.sqrt(dx*dx + dy*dy) || 1;
    _outlinePx(set, bx, by, -dy/dl, dx/dl, _widthAt(t));
  }

  return [...set].map(k => {
    const [x, y] = k.split(',').map(Number);
    return { x, y };
  });
}

export class Koi {
  constructor(grid) {
    const { logicalW, logicalH } = grid;

    // Position = CENTER of fish (not top-left corner)
    this.x = _randBetween(FISH_HALF + 5, logicalW - FISH_HALF - 5);
    this.y = _randBetween(FISH_HALF + 5, logicalH - FISH_HALF - 5);

    this.vx = _randVelocity();
    this.vy = _randVelocity();

    // Heading: direction the head points (= direction of movement)
    this.heading = Math.atan2(this.vy, this.vx);

    // Body dynamics
    this.steeringBend = 0;
    this.swimPhase = Math.random() * Math.PI * 2; // stagger fish

    // Wandering AI
    this._targetVx = this.vx;
    this._targetVy = this.vy;
    this._wanderCooldown = _randBetween(MIN_WANDER_INTERVAL, MAX_WANDER_INTERVAL);

    this.color = KOI_COLORS[Math.floor(Math.random() * KOI_COLORS.length)];
  }

  update(deltaMs, grid) {
    const { logicalW, logicalH } = grid;

    // --- Wandering AI ---
    this._wanderCooldown -= deltaMs;
    if (this._wanderCooldown <= 0) {
      this._targetVx = _randVelocity();
      this._targetVy = _randVelocity();
      this._wanderCooldown = _randBetween(MIN_WANDER_INTERVAL, MAX_WANDER_INTERVAL);
    }

    // Smooth velocity toward target
    this.vx += (this._targetVx - this.vx) * LERP_RATE * deltaMs;
    this.vy += (this._targetVy - this.vy) * LERP_RATE * deltaMs;

    // Edge avoidance (center-based)
    if (this.x < FISH_HALF + EDGE_MARGIN)               this.vx += TURN_FORCE * deltaMs;
    if (this.x > logicalW - FISH_HALF - EDGE_MARGIN)    this.vx -= TURN_FORCE * deltaMs;
    if (this.y < FISH_HALF + EDGE_MARGIN)               this.vy += TURN_FORCE * deltaMs;
    if (this.y > logicalH - FISH_HALF - EDGE_MARGIN)    this.vy -= TURN_FORCE * deltaMs;

    // Speed cap
    const speed = Math.sqrt(this.vx * this.vx + this.vy * this.vy);
    if (speed > MAX_SPEED) {
      this.vx = (this.vx / speed) * MAX_SPEED;
      this.vy = (this.vy / speed) * MAX_SPEED;
    }

    // --- Heading & steering bend ---
    if (speed > 0.0001) {
      const newHeading = Math.atan2(this.vy, this.vx);
      // Turn rate in rad/s (multiply by 1000 to convert from per-ms to per-s)
      const turnRate = _angleDiff(newHeading, this.heading) / deltaMs * 1000;
      const targetBend = Math.max(-BEND_MAX, Math.min(BEND_MAX, turnRate * BEND_SENSITIVITY));
      this.steeringBend += (targetBend - this.steeringBend) * BEND_LERP * deltaMs;
      this.heading = newHeading;
    } else {
      // Stationary: relax bend back to zero
      this.steeringBend *= Math.pow(0.98, deltaMs / 16);
    }

    // --- Swim oscillation ---
    this.swimPhase += SWIM_FREQUENCY * deltaMs;
    if (this.swimPhase > Math.PI * 2) this.swimPhase -= Math.PI * 2;

    // --- Move ---
    this.x += this.vx * deltaMs;
    this.y += this.vy * deltaMs;

    // Hard boundary clamp
    this.x = Math.max(FISH_HALF, Math.min(logicalW - FISH_HALF, this.x));
    this.y = Math.max(FISH_HALF, Math.min(logicalH - FISH_HALF, this.y));
  }

  draw(grid) {
    const swimOsc = Math.sin(this.swimPhase);
    const pixels = _renderSpline(this.heading, this.steeringBend, swimOsc);
    const ox = Math.round(this.x);
    const oy = Math.round(this.y);
    const { r, g, b } = this.color;
    for (const { x, y } of pixels) {
      grid.drawPixel(ox + x, oy + y, r, g, b);
    }
  }
}
