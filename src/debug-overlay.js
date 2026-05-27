// src/debug-overlay.js
// Debug overlay: draws each fish's raw bezier spline as a smooth canvas line.
// NOT part of the OLED pixel render — uses the native Canvas 2D API directly.
// Layers on top of the main canvas via a second absolutely-positioned canvas.

const WAIST_FRAC = 0.28;

// Stat display colours
const C_MIN   = 'rgba(100,160,255,0.95)';   // blue  — minimum value
const C_CUR   = 'rgba(80,255,120,0.95)';    // green — current value
const C_MAX   = 'rgba(255,100,100,0.95)';   // red   — maximum value
const C_LABEL = 'rgba(200,200,200,0.80)';   // dim white — label text

const STATE_COLOR = {
  wander: 'rgba(255,210,60,0.95)',   // amber
  avoid:  'rgba(255,90,90,0.95)',    // red
  coast:  'rgba(100,210,255,0.95)',  // cyan
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
    this.splineEnabled = true;
    this.statsEnabled  = false;
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

    for (const fish of entities) {
      if (this.splineEnabled) this._drawSpline(fish);
      if (this.statsEnabled)  this._drawFishStats(fish);
    }
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

    const cls        = fish.constructor;
    const state      = fish._moveState ?? 'coast';
    const stateColor = STATE_COLOR[state] ?? STATE_COLOR.coast;

    // Speed values in logical-px/s (multiply px/ms by 1000)
    const spdMin = 0;
    const spdCur = (fish._speed        ?? 0)            * 1000;
    const spdMax = (cls.SPEED_MAX      ?? 0)            * 1000;

    // Rotation values in rad/s
    const rotMax = fish._maxTurnRate   ?? 0;
    const rotMin = -rotMax;
    const rotCur = (fish.steeringBend  ?? 0) / 0.8;    // estimate from bend

    // Font size: at least 8px physical, scales with canvas resolution
    const fontSize = Math.max(8, Math.floor(scale * 2));
    ctx.font = `${fontSize}px monospace`;
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'bottom';

    // Three lines of text
    const line1 = state.toUpperCase();
    const line2_label = 'spd ';
    const line2_min   = spdMin.toFixed(1);
    const line2_sep1  = ' / ';
    const line2_cur   = spdCur.toFixed(1);
    const line2_sep2  = ' / ';
    const line2_max   = spdMax.toFixed(1);
    const line3_label = 'rot ';
    const line3_min   = rotMin.toFixed(2);
    const line3_sep1  = ' / ';
    const line3_cur   = rotCur.toFixed(2);
    const line3_sep2  = ' / ';
    const line3_max   = rotMax.toFixed(2);

    // Measure widths for background box
    const fullLine2 = line2_label + line2_min + line2_sep1 + line2_cur + line2_sep2 + line2_max;
    const fullLine3 = line3_label + line3_min + line3_sep1 + line3_cur + line3_sep2 + line3_max;
    const maxWidth  = Math.max(
      ctx.measureText(line1).width,
      ctx.measureText(fullLine2).width,
      ctx.measureText(fullLine3).width,
    );

    const lineH   = fontSize + 2;
    const pad     = 4;
    const boxW    = maxWidth + pad * 2;
    const boxH    = lineH * 3 + pad * 2;

    // Position: centered above the fish's topmost extent
    const topY  = (fish.y - fish.half) * scale;
    const boxX  = fish.x * scale - boxW / 2;
    const boxY  = topY - boxH - 6;   // 6px gap above fish

    // ── Background + border ──────────────────────────────────────────────────
    ctx.save();
    ctx.fillStyle   = 'rgba(0,0,0,0.65)';
    ctx.strokeStyle = stateColor;
    ctx.lineWidth   = 1.5;
    ctx.beginPath();
    ctx.roundRect(boxX, boxY, boxW, boxH, 3);
    ctx.fill();
    ctx.stroke();

    // ── Line 1: state label ──────────────────────────────────────────────────
    const cx = fish.x * scale;   // horizontal centre
    let lineY = boxY + pad + lineH;

    ctx.fillStyle = stateColor;
    ctx.fillText(line1, cx, lineY);
    lineY += lineH;

    // ── Line 2: speed (multi-color) ──────────────────────────────────────────
    _drawColorSegments(ctx, cx, lineY, fontSize, [
      { text: line2_label, color: C_LABEL },
      { text: line2_min,   color: C_MIN   },
      { text: line2_sep1,  color: C_LABEL },
      { text: line2_cur,   color: C_CUR   },
      { text: line2_sep2,  color: C_LABEL },
      { text: line2_max,   color: C_MAX   },
    ]);
    lineY += lineH;

    // ── Line 3: rotation (multi-color) ──────────────────────────────────────
    _drawColorSegments(ctx, cx, lineY, fontSize, [
      { text: line3_label, color: C_LABEL },
      { text: line3_min,   color: C_MIN   },
      { text: line3_sep1,  color: C_LABEL },
      { text: line3_cur,   color: C_CUR   },
      { text: line3_sep2,  color: C_LABEL },
      { text: line3_max,   color: C_MAX   },
    ]);

    ctx.restore();
  }
}

/**
 * Draw a series of text segments with individual colours, centred on cx.
 * All segments are measured first to compute total width, then drawn left→right.
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} cx   - horizontal centre (physical px)
 * @param {number} y    - baseline y (physical px)
 * @param {number} fontSize
 * @param {{ text: string, color: string }[]} segments
 */
function _drawColorSegments(ctx, cx, y, fontSize, segments) {
  ctx.font = `${fontSize}px monospace`;
  ctx.textBaseline = 'bottom';

  const totalW = segments.reduce((s, seg) => s + ctx.measureText(seg.text).width, 0);
  let drawX = cx - totalW / 2;

  for (const { text, color } of segments) {
    const w = ctx.measureText(text).width;
    ctx.fillStyle   = color;
    ctx.textAlign   = 'left';
    ctx.fillText(text, drawX, y);
    drawX += w;
  }
}
