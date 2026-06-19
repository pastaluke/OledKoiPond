// src/fluid/ripple-field.js
// Dead-simple water ripples: the classic two-buffer height-field algorithm
// (Hugo Elias, ~1998). A disturbance written into one cell propagates outward
// as damped concentric rings. Cost is one tight loop + one scaled blit per
// frame, independent of fish count.
//
//   dst[i] = ((src left + right + up + down) / 2 - dst[i]) * damping
//   swap(src, dst)
//
// The `- dst[i]` term is this cell's value two frames ago — that memory is what
// turns a static bump into an outward-travelling wave. Damping bleeds energy so
// rings fade instead of ringing forever. Border cells are left at zero, so waves
// are simply absorbed at the edges.

export class RippleField {
  /** @param {import('../grid.js').Grid} grid */
  constructor(grid) {
    this.grid = grid;

    this.enabled  = true;
    this.damping  = 0.96;   // 0..1 — higher = rings travel farther before fading
    this.speed    = 0.5;    // wave-speed coefficient C, stable for 0 < C ≤ 0.5
    this.strength = 1.0;    // amplitude injected by a tap
    this.tapRadius = 2.5;   // injection blob radius in cells (0 = single point)
    this.gain     = 220;    // amplitude → alpha mapping for the render
    this.smooth   = true;   // smooth (soft) vs. crisp (blocky) upscaling
    this.color    = [200, 225, 255];  // ring tint (light blue)

    // Coarse simulation grid — capped long edge keeps the cost flat regardless
    // of how large the pond canvas gets.
    this.maxDim = 220;

    this._cols = 0;
    this._rows = 0;
    this._a = null;   // buffer A
    this._b = null;   // buffer B
    this._src = null; // current source (read as neighbours)
    this._dst = null; // current dest   (write target)

    // Offscreen canvas sized to the sim grid; we putImageData here then let the
    // main ctx.drawImage scale it up in one call.
    this._off    = document.createElement('canvas');
    this._offCtx = this._off.getContext('2d');
    this._img    = null;

    this.resize();
  }

  /** Recompute the coarse grid from the pond's current aspect ratio. */
  resize() {
    const aspect = this.grid.logicalW / this.grid.logicalH;
    let cols, rows;
    if (aspect >= 1) { cols = this.maxDim; rows = Math.max(4, Math.round(this.maxDim / aspect)); }
    else             { rows = this.maxDim; cols = Math.max(4, Math.round(this.maxDim * aspect)); }

    if (cols === this._cols && rows === this._rows) return;
    this._cols = cols;
    this._rows = rows;
    this._a = new Float32Array(cols * rows);
    this._b = new Float32Array(cols * rows);
    this._src = this._a;
    this._dst = this._b;

    this._off.width  = cols;
    this._off.height = rows;
    this._img = this._offCtx.createImageData(cols, rows);
  }

  /**
   * Drop a disturbance at logical (world-unit) coordinates.
   * @param {number} lx
   * @param {number} ly
   * @param {number} [strength]  signed amplitude (defaults to this.strength)
   */
  inject(lx, ly, strength = this.strength) {
    const cx = Math.round((lx / this.grid.logicalW) * (this._cols - 1));
    const cy = Math.round((ly / this.grid.logicalH) * (this._rows - 1));
    // Spread the tap over a small Gaussian blob. A single-cell impulse excites
    // the Nyquist (checkerboard) mode, which barely propagates and leaves a
    // visible grid; a smooth blob injects only low frequencies. Peak weight is
    // 1.0 at the centre, so tapRadius changes splash size, not peak amplitude.
    const R = Math.ceil(this.tapRadius);
    const sigma = Math.max(0.5, this.tapRadius * 0.5);
    const s2 = 2 * sigma * sigma;
    for (let dy = -R; dy <= R; dy++) {
      for (let dx = -R; dx <= R; dx++) {
        const nx = cx + dx, ny = cy + dy;
        if (nx < 1 || nx >= this._cols - 1 || ny < 1 || ny >= this._rows - 1) continue;
        const w = Math.exp(-(dx * dx + dy * dy) / s2);
        this._src[ny * this._cols + nx] += strength * w;
      }
    }
  }

  /** Advance the wave one step. */
  update() {
    if (!this.enabled) return;
    const cols = this._cols, rows = this._rows;
    const src = this._src, dst = this._dst, d = this.damping;
    // Leapfrog wave step: next = 2·curr − prev + c·laplacian.
    // dst[i] holds this cell's value two frames ago (prev). c = wave speed.
    // The laplacian uses the isotropic 9-point stencil (1/6)[1 4 1; 4 -20 4; 1 4 1]
    // — folding in the diagonal neighbours cancels the square-grid directional
    // bias, so expanding rings stay circular instead of becoming rounded squares.
    const c = this.speed;

    for (let y = 1; y < rows - 1; y++) {
      const row = y * cols;
      for (let x = 1; x < cols - 1; x++) {
        const i = row + x;
        const orth = src[i - 1] + src[i + 1] + src[i - cols] + src[i + cols];
        const diag = src[i - cols - 1] + src[i - cols + 1]
                   + src[i + cols - 1] + src[i + cols + 1];
        const lap = (4 * orth + diag - 20 * src[i]) / 6;
        const val = 2 * src[i] - dst[i] + c * lap;
        dst[i] = val * d;
      }
    }

    // Swap source/dest for the next step.
    this._src = dst;
    this._dst = src;
  }

  /**
   * Blit the current wave field onto the pond's Canvas2D context.
   * @param {import('../grid.js').Grid} grid
   */
  draw(grid) {
    if (!this.enabled) return;
    const cols = this._cols, rows = this._rows;
    const buf  = this._src;            // most recently computed field
    const data = this._img.data;
    const [r, g, b] = this.color;
    const gain = this.gain;

    for (let i = 0; i < buf.length; i++) {
      const a = Math.min(255, Math.abs(buf[i]) * gain);
      const j = i * 4;
      data[j]     = r;
      data[j + 1] = g;
      data[j + 2] = b;
      data[j + 3] = a;
    }
    this._offCtx.putImageData(this._img, 0, 0);

    const { ctx, logicalW, logicalH, scale } = grid;
    ctx.save();
    ctx.imageSmoothingEnabled = this.smooth;
    ctx.drawImage(this._off, 0, 0, logicalW * scale, logicalH * scale);
    ctx.restore();
  }
}
