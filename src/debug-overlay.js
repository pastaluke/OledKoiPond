// src/debug-overlay.js
// Debug overlay: draws each fish's raw bezier spline as a smooth canvas line.
// NOT part of the OLED pixel render — uses the native Canvas 2D API directly.
// Layers on top of the main canvas via a second absolutely-positioned canvas.

import { EDGE_MARGIN } from './movement/behaviors.js';

const WAIST_FRAC = 0.28;

// ─── Per-visualization colours (distinct so multiple layers stay separable) ────
const C_PERCEPTION = 'rgba(120, 200, 255, 0.35)';  // light blue — perception radius
const C_SEPARATION = 'rgba(255, 90, 90, 0.45)';    // red        — separation radius
const C_EDGE       = 'rgba(255, 160, 40, 0.55)';   // orange     — edge / wall margin
const C_NEIGHBOR   = 'rgba(90, 255, 160, 0.45)';   // green      — neighbor links
const C_VELOCITY   = 'rgba(255, 0, 200, 0.85)';    // magenta    — velocity vector
const C_WANDER     = 'rgba(200, 120, 255, 0.75)';  // purple     — wander target

// Stat display colours
const C_MIN   = 'rgba(100,160,255,0.95)';   // blue  — minimum value
const C_CUR   = 'rgba(80,255,120,0.95)';    // green — current value
const C_MAX   = 'rgba(255,100,100,0.95)';   // red   — maximum value
const C_LABEL = 'rgba(200,200,200,0.80)';   // dim white — label text

const STATE_COLOR = {
  swim:      'rgba(100,210,255,0.95)',  // cyan  — baseline ambient swimming
  socialize: 'rgba(255,210,60,0.95)',   // amber — (future triggered state)
};

// Burst-and-coast throttle phase colours (orthogonal to STATE above).
const PHASE_COLOR = {
  burst: 'rgba(255,140,40,0.95)',   // orange — propelling
  glide: 'rgba(120,200,255,0.95)',  // blue   — coasting
};

// Recompute all spline control points for a fish.
// Returns { T, TC, W, BC, H } — all in physical canvas pixels.
function _splinePoints(fish, scale) {
  const { x, y, heading, steeringBend, swimPhase, length } = fish;
  const swimOsc = Math.sin(swimPhase);

  const cosH = Math.cos(heading), sinH = Math.sin(heading);
  const cosP = -sinH, sinP = cosH;   // right-perpendicular

  const headDist  = length * 0.42;
  const tailDist  = length * 0.58;
  const waistDist = tailDist - length * WAIST_FRAC;

  const Hx =  cosH * headDist,    Hy =  sinH * headDist;
  const Tx = -cosH * tailDist,    Ty = -sinH * tailDist;
  const Wx = -cosH * waistDist - cosP * steeringBend * length * 0.12;
  const Wy = -sinH * waistDist - sinP * steeringBend * length * 0.12;
  const tailWigPx = length * 0.156;
  const TCx = Tx + (Wx - Tx) * 0.5 + cosP * swimOsc * tailWigPx;
  const TCy = Ty + (Wy - Ty) * 0.5 + sinP * swimOsc * tailWigPx;
  const BCx = (Wx + Hx) * 0.5 - cosP * steeringBend * length * 0.22;
  const BCy = (Wy + Hy) * 0.5 - sinP * steeringBend * length * 0.22;

  // Convert fish-local logical coords → physical canvas pixels
  const p = (lx, ly) => ({ px: (x + lx) * scale, py: (y + ly) * scale });

  return {
    T:  p(Tx,  Ty),
    TC: p(TCx, TCy),
    W:  p(Wx,  Wy),
    BC: p(BCx, BCy),
    H:  p(Hx,  Hy),
    // heading unit vector for the arrow
    cosH, sinH,
    scale,
  };
}

export class DebugOverlay {
  /**
   * @param {HTMLCanvasElement} overlayCanvas - The second <canvas id="debug"> element
   * @param {import('./grid.js').Grid} grid
   */
  constructor(overlayCanvas, grid) {
    this.canvas = overlayCanvas;
    this.ctx    = overlayCanvas.getContext('2d');
    this.grid         = grid;
    this.splineEnabled = false;
    this.statsEnabled  = false;
    // New per-visualization toggles (all default OFF).
    this.perceptionEnabled = false;  // PERCEPTION_RADIUS circle
    this.separationEnabled = false;  // SEPARATION_DIST circle
    this.edgeEnabled       = false;  // wall-avoidance margin zone
    this.neighborsEnabled  = false;  // links to perceived neighbors
    this.velocityEnabled   = false;  // velocity vector arrow
    this.wanderEnabled     = false;  // projected wander circle + target
    /** Optional GlassShapes instance — faint grab-handle rings drawn when set. */
    this.glassShapes       = null;
    /** Active attract point in logical coords, or null. Set by main.js. */
    this.attractPoint      = null;
    this.sync();
  }

  /** Match overlay canvas physical dimensions to the main grid canvas. */
  sync() {
    this.canvas.width  = this.grid.canvas.width;
    this.canvas.height = this.grid.canvas.height;
  }

  /**
   * Draw debug visuals. Call each frame after sim.draw().
   * @param {import('./entities/fish-base.js').FishBase[]} entities
   */
  draw(entities) {
    const { ctx } = this;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    // Pond-wide wall-avoidance band (drawn once, not per fish).
    if (this.edgeEnabled) this._drawEdgeZone();

    // Neighbor links drawn first so per-fish circles/arrows sit on top.
    if (this.neighborsEnabled) this._drawNeighborLinks(entities);

    for (const fish of entities) {
      if (this.perceptionEnabled) this._drawPerception(fish);
      if (this.separationEnabled) this._drawSeparation(fish);
      if (this.edgeEnabled)       this._drawFishMargin(fish);
      if (this.wanderEnabled)     this._drawWander(fish);
      if (this.velocityEnabled)   this._drawVelocity(fish);
      if (this.splineEnabled)     this._drawSpline(fish);
      if (this.statsEnabled)      this._drawFishStats(fish);
    }

    // Glass-shape grab handles — always on when shapes exist, since a glass lens
    // over pure-black water is otherwise invisible and impossible to grab.
    if (this.glassShapes) this._drawGlassShapes();

    if (this.attractPoint) this._drawAttractPoint();
  }

  // ─── Glass shape handles — faint outer (rim) + inner (band) rings ─────────────
  _drawGlassShapes() {
    const gs = this.glassShapes;
    if (!gs.list.length) return;

    // Fade rings after 3s inactivity; fully gone at 3.5s.
    const elapsed = performance.now() - gs.lastActivity;
    const opacity = elapsed < 3000 ? 1.0
      : elapsed < 3500 ? 1.0 - (elapsed - 3000) / 500
      : 0.0;
    if (opacity <= 0) return;

    const { ctx } = this;
    const W = this.canvas.width, H = this.canvas.height;
    ctx.save();
    gs.list.forEach((s, i) => {
      const px = s.cx * W, py = s.cy * H;
      const rOuter = s.radius * H;
      const rInner = Math.max(0, s.radius * (1 - s.bevelWidth) * H);
      const sel = i === gs.selected;
      ctx.lineWidth = sel ? 1.5 : 1;
      ctx.strokeStyle = sel
        ? `rgba(0,210,255,${0.9 * opacity})`
        : `rgba(180,210,255,${0.4 * opacity})`;
      ctx.beginPath(); ctx.arc(px, py, rOuter, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = sel
        ? `rgba(0,210,255,${0.4 * opacity})`
        : `rgba(180,210,255,${0.2 * opacity})`;
      ctx.beginPath(); ctx.arc(px, py, rInner, 0, Math.PI * 2); ctx.stroke();
    });
    ctx.restore();
  }

  // ─── Attract point — pulsing dashed ring at the held pointer ────────────────
  _drawAttractPoint() {
    const { ctx, grid } = this;
    const ap = this.attractPoint;
    if (!ap) return;
    const scale = grid.scale;
    const x = ap.x * scale;
    const y = ap.y * scale;
    const t = performance.now() * 0.003;
    const r = 10 + Math.sin(t) * 3;

    ctx.save();
    ctx.strokeStyle = 'rgba(0,210,255,0.75)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 3]);
    ctx.lineDashOffset = -(t * 8);
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = 'rgba(0,210,255,0.45)';
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.arc(x, y, 2.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // ─── Perception radius — circle within which a fish senses others ────────────
  _drawPerception(fish) {
    const { ctx, grid } = this;
    const scale = grid.scale;
    const r = (fish.constructor.PERCEPTION_RADIUS ?? 0) * scale;
    if (r <= 0) return;
    ctx.save();
    ctx.strokeStyle = C_PERCEPTION;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(fish.x * scale, fish.y * scale, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  // ─── Separation radius — smaller circle where fish push apart ────────────────
  _drawSeparation(fish) {
    const { ctx, grid } = this;
    const scale = grid.scale;
    const r = (fish.constructor.SEPARATION_DIST ?? 0) * scale;
    if (r <= 0) return;
    ctx.save();
    ctx.strokeStyle = C_SEPARATION;
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 2]);
    ctx.beginPath();
    ctx.arc(fish.x * scale, fish.y * scale, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  // ─── Edge zone — inset rectangle at the base EDGE_MARGIN from pond walls ──────
  // Inside this band the `edges` containment force engages. The effective per-fish
  // margin is max(EDGE_MARGIN, fish.half + 2) — see _drawFishMargin for that ring.
  _drawEdgeZone() {
    const { ctx, grid } = this;
    const scale = grid.scale;
    const m = EDGE_MARGIN * scale;
    const w = grid.logicalW * scale;
    const h = grid.logicalH * scale;
    ctx.save();
    ctx.strokeStyle = C_EDGE;
    ctx.lineWidth = 1;
    ctx.setLineDash([5, 4]);
    ctx.strokeRect(m, m, w - 2 * m, h - 2 * m);
    ctx.restore();
  }

  // ─── Per-fish effective edge margin — ring at max(EDGE_MARGIN, half+2) ────────
  // Highlighted brighter when the fish is actually inside the band (force active).
  _drawFishMargin(fish) {
    const { ctx, grid } = this;
    const scale = grid.scale;
    const m = Math.max(EDGE_MARGIN, fish.half + 2);
    const inZone =
      fish.x < m || fish.x > grid.logicalW - m ||
      fish.y < m || fish.y > grid.logicalH - m;
    ctx.save();
    ctx.strokeStyle = C_EDGE;
    ctx.globalAlpha = inZone ? 1 : 0.5;
    ctx.lineWidth = inZone ? 1.5 : 0.8;
    ctx.beginPath();
    ctx.arc(fish.x * scale, fish.y * scale, m * scale, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  // ─── Neighbor links — lines to fish within PERCEPTION_RADIUS ─────────────────
  // Replicates the Simulation's O(n²) query so the links match the real neighbor
  // set driving alignment/cohesion. Each unordered pair drawn once.
  _drawNeighborLinks(entities) {
    const { ctx, grid } = this;
    const scale = grid.scale;
    ctx.save();
    ctx.strokeStyle = C_NEIGHBOR;
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    for (let i = 0; i < entities.length; i++) {
      const a = entities[i];
      const rSq = (a.constructor.PERCEPTION_RADIUS ?? 0) ** 2;
      if (rSq <= 0) continue;
      for (let j = i + 1; j < entities.length; j++) {
        const b = entities[j];
        const dx = a.x - b.x, dy = a.y - b.y;
        if (dx * dx + dy * dy <= rSq) {
          ctx.moveTo(a.x * scale, a.y * scale);
          ctx.lineTo(b.x * scale, b.y * scale);
        }
      }
    }
    ctx.stroke();
    ctx.restore();
  }

  // ─── Velocity vector — arrow along velocity, length scaled to speed ──────────
  // Length is normalized against the fish's maxSpeed so a full-speed arrow is a
  // fixed visual length; shorter arrows = slower fish. Shows heading + overshoot.
  _drawVelocity(fish) {
    const { ctx, grid } = this;
    const scale = grid.scale;
    const sp = Math.hypot(fish.vx ?? 0, fish.vy ?? 0);
    if (sp < 1e-6) return;
    const maxSp = fish.maxSpeed || sp;
    const frac = Math.min(1, sp / maxSp);
    const visLen = (fish.length * 1.5) * frac * scale;   // px at full speed ≈ 1.5 body lengths
    const ux = fish.vx / sp, uy = fish.vy / sp;
    const x0 = fish.x * scale, y0 = fish.y * scale;
    const x1 = x0 + ux * visLen, y1 = y0 + uy * visLen;

    ctx.save();
    ctx.strokeStyle = C_VELOCITY;
    ctx.fillStyle = C_VELOCITY;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
    // Arrowhead
    const ang = Math.atan2(uy, ux);
    const ah = Math.max(3, visLen * 0.25);
    const aw = 0.4;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x1 - ah * Math.cos(ang - aw), y1 - ah * Math.sin(ang - aw));
    ctx.lineTo(x1 - ah * Math.cos(ang + aw), y1 - ah * Math.sin(ang + aw));
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  // ─── Wander target — projected circle + current target point ─────────────────
  // Mirrors BEHAVIORS.wander: circle of radius length*0.6 projected length*1.2
  // ahead along the current direction of travel; target rides _wanderTheta.
  _drawWander(fish) {
    const { ctx, grid } = this;
    const scale = grid.scale;

    const sp = Math.hypot(fish.vx ?? 0, fish.vy ?? 0);
    const hx = sp > 1e-6 ? fish.vx / sp : Math.cos(fish.heading);
    const hy = sp > 1e-6 ? fish.vy / sp : Math.sin(fish.heading);

    const dist   = fish.length * 1.2;
    const radius = fish.length * 0.6;
    const cx = fish.x + hx * dist;
    const cy = fish.y + hy * dist;

    const heading = Math.atan2(hy, hx);
    const theta = (fish._wanderTheta ?? 0) + heading;
    const tx = cx + Math.cos(theta) * radius;
    const ty = cy + Math.sin(theta) * radius;

    const cpx = cx * scale, cpy = cy * scale;
    const tpx = tx * scale, tpy = ty * scale;

    ctx.save();
    ctx.strokeStyle = C_WANDER;
    ctx.lineWidth = 0.8;
    // Stalk from fish to circle center
    ctx.setLineDash([2, 2]);
    ctx.beginPath();
    ctx.moveTo(fish.x * scale, fish.y * scale);
    ctx.lineTo(cpx, cpy);
    ctx.stroke();
    // Wander circle
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.arc(cpx, cpy, radius * scale, 0, Math.PI * 2);
    ctx.stroke();
    // Target point
    ctx.fillStyle = C_WANDER;
    ctx.beginPath();
    ctx.arc(tpx, tpy, 2.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  _drawSpline(fish) {
    const { ctx, grid } = this;
    const pts = _splinePoints(fish, grid.scale);
    const { T, TC, W, BC, H, cosH, sinH, scale } = pts;

    // ── Dashed lines from anchors to their control points ───────────────────
    ctx.save();
    ctx.setLineDash([2, 3]);
    ctx.lineWidth = 0.8;
    ctx.strokeStyle = 'rgba(255, 220, 0, 0.45)';
    ctx.beginPath();
    ctx.moveTo(T.px,  T.py);  ctx.lineTo(TC.px, TC.py);
    ctx.moveTo(W.px,  W.py);  ctx.lineTo(TC.px, TC.py);
    ctx.moveTo(W.px,  W.py);  ctx.lineTo(BC.px, BC.py);
    ctx.moveTo(H.px,  H.py);  ctx.lineTo(BC.px, BC.py);
    ctx.stroke();
    ctx.restore();

    // ── Main spline: two connected quadratic beziers ─────────────────────────
    ctx.beginPath();
    ctx.moveTo(T.px, T.py);
    ctx.quadraticCurveTo(TC.px, TC.py, W.px, W.py);
    ctx.quadraticCurveTo(BC.px, BC.py, H.px, H.py);
    ctx.strokeStyle = 'rgba(0, 220, 255, 0.85)';
    ctx.lineWidth   = 1.5;
    ctx.setLineDash([]);
    ctx.stroke();

    // ── Heading arrow at head ────────────────────────────────────────────────
    const arrowLen = 4 * scale;
    const ax = H.px + cosH * arrowLen;
    const ay = H.py + sinH * arrowLen;
    ctx.beginPath();
    ctx.moveTo(H.px, H.py);
    ctx.lineTo(ax, ay);
    ctx.strokeStyle = 'rgba(255, 80, 0, 0.9)';
    ctx.lineWidth   = 2;
    ctx.stroke();
    // arrowhead
    const arrAngle = Math.atan2(sinH, cosH);
    const aw = 0.45; // half-angle of arrowhead
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(ax - arrowLen*0.4 * Math.cos(arrAngle - aw),
               ay - arrowLen*0.4 * Math.sin(arrAngle - aw));
    ctx.lineTo(ax - arrowLen*0.4 * Math.cos(arrAngle + aw),
               ay - arrowLen*0.4 * Math.sin(arrAngle + aw));
    ctx.closePath();
    ctx.fillStyle = 'rgba(255, 80, 0, 0.9)';
    ctx.fill();

    // ── Anchor points (T, W, H) — red ────────────────────────────────────────
    ctx.fillStyle = 'rgba(255, 80, 80, 0.85)';
    for (const pt of [T, W, H]) {
      ctx.beginPath();
      ctx.arc(pt.px, pt.py, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }

    // ── Control points (TC, BC) — yellow ─────────────────────────────────────
    ctx.fillStyle = 'rgba(255, 220, 0, 0.85)';
    for (const pt of [TC, BC]) {
      ctx.beginPath();
      ctx.arc(pt.px, pt.py, 2, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  _drawFishStats(fish) {
    const { ctx, grid } = this;
    const scale = grid.scale;

    // ── High-level state-machine state (swim today; socialize/feed/… later) ──
    const state      = fish.state ?? 'swim';
    const stateColor = STATE_COLOR[state] ?? STATE_COLOR.swim;

    // ── Burst-and-coast throttle: phase, ms left in phase, eased throttle level ──
    const phase      = fish._phase ?? 'glide';
    const phaseColor = PHASE_COLOR[phase] ?? C_LABEL;
    const holdMs     = Math.max(0, Math.round(fish._thrHold ?? 0));
    const throttle   = fish._throttle ?? 0;
    const thrTarget  = fish._thrTarget ?? 0;

    // ── Speed in logical-px/s (px/ms × 1000) ─────────────────────────────────
    const spdCur = Math.hypot(fish.vx ?? 0, fish.vy ?? 0) * 1000;
    const spdMax = (fish.maxSpeed ?? 0)                   * 1000;

    // ── Rotation in rad/s. steeringBend clamps to ±1.2 ≈ turnRate×0.8 → ±1.5. ──
    const rotMax = 1.5, rotMin = -rotMax;
    const rotCur = (fish.steeringBend ?? 0) / 0.8;

    // Each line is an array of coloured segments; box auto-sizes to the widest.
    const sep = { text: ' / ', color: C_LABEL };
    const lines = [
      [ { text: state.toUpperCase(), color: stateColor } ],
      [ { text: phase.toUpperCase(),  color: phaseColor },
        { text: ` ${holdMs}ms`,       color: C_LABEL } ],
      [ { text: 'thr ',                 color: C_LABEL },
        { text: throttle.toFixed(2),    color: C_CUR   },
        { text: ' → ',             color: C_LABEL },
        { text: thrTarget.toFixed(2),   color: phaseColor } ],
      [ { text: 'spd ',              color: C_LABEL },
        { text: '0.0',               color: C_MIN   }, sep,
        { text: spdCur.toFixed(1),   color: C_CUR   }, sep,
        { text: spdMax.toFixed(1),   color: C_MAX   } ],
      [ { text: 'rot ',              color: C_LABEL },
        { text: rotMin.toFixed(2),   color: C_MIN   }, sep,
        { text: rotCur.toFixed(2),   color: C_CUR   }, sep,
        { text: rotMax.toFixed(2),   color: C_MAX   } ],
    ];

    // Position: centred above the fish's topmost extent, 6px gap.
    const cx   = fish.x * scale;
    const topY = (fish.y - fish.half) * scale;
    this._drawStatsBox(lines, cx, topY - 6, stateColor);
  }

  /**
   * Render a centred, dark, bordered multi-line text box whose bottom edge sits at
   * (cx, bottomY). Each line is an array of { text, color } segments laid out L→R.
   * @param {{text:string,color:string}[][]} lines
   * @param {number} cx       - horizontal centre (physical px)
   * @param {number} bottomY  - box bottom edge (physical px)
   * @param {string} borderColor
   */
  _drawStatsBox(lines, cx, bottomY, borderColor) {
    const { ctx, grid } = this;
    const fontSize = Math.max(8, Math.floor(grid.scale * 2));
    const lineH    = fontSize + 2;
    const pad      = 4;

    ctx.save();
    ctx.font = `${fontSize}px monospace`;
    ctx.textAlign    = 'left';
    ctx.textBaseline = 'bottom';

    // Measure: widest line sets box width; line count sets height.
    const lineWidths = lines.map(segs =>
      segs.reduce((w, s) => w + ctx.measureText(s.text).width, 0));
    const boxW = Math.max(...lineWidths) + pad * 2;
    const boxH = lineH * lines.length + pad * 2;
    const boxX = cx - boxW / 2;
    const boxY = bottomY - boxH;

    // Background + state-coloured border.
    ctx.fillStyle   = 'rgba(0,0,0,0.65)';
    ctx.strokeStyle = borderColor;
    ctx.lineWidth   = 1.5;
    ctx.beginPath();
    ctx.roundRect(boxX, boxY, boxW, boxH, 3);
    ctx.fill();
    ctx.stroke();

    // Each line centred horizontally; segments drawn left→right from there.
    let y = boxY + pad + lineH;
    for (let i = 0; i < lines.length; i++) {
      let drawX = cx - lineWidths[i] / 2;
      for (const { text, color } of lines[i]) {
        ctx.fillStyle = color;
        ctx.fillText(text, drawX, y);
        drawX += ctx.measureText(text).width;
      }
      y += lineH;
    }
    ctx.restore();
  }
}
