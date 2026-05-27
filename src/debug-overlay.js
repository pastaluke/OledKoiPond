// src/debug-overlay.js
// Debug overlay: draws each fish's raw bezier spline as a smooth canvas line.
// NOT part of the OLED pixel render — uses the native Canvas 2D API directly.
// Layers on top of the main canvas via a second absolutely-positioned canvas.
//
// Toggle visibility: set DebugOverlay.ENABLED = true/false at any time.

const WAIST_FRAC = 0.28;

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
    this.grid    = grid;
    this.enabled = true;
    this.sync();
  }

  /** Match overlay canvas physical dimensions to the main grid canvas. */
  sync() {
    this.canvas.width  = this.grid.canvas.width;
    this.canvas.height = this.grid.canvas.height;
  }

  /**
   * Draw all fish splines. Call each frame after sim.draw().
   * @param {import('./entities/fish-base.js').FishBase[]} entities
   */
  draw(entities) {
    if (!this.enabled) return;
    const { ctx } = this;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    for (const fish of entities) {
      this._drawFish(fish);
    }
  }

  _drawFish(fish) {
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
}
