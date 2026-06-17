// src/fluid/fluid-sim.js
// 2-D wave simulation for water ripples. Driven by fish V-wakes and pointer taps.
// Two independent output paths:
//   • drawTint(grid)  — Canvas2D blue overlay on the pond canvas (tinted crests)
//   • getBuffer()     — Float32Array for GPU upload by Compositor (refraction/specular)

function _edgeCell(next, curr, prev, x, y, w, h, d, em, pc) {
  const i = y * w + x;
  if (em === 'absorb') { next[i] = 0; return; }
  // Mirror-symmetric neighbours at the boundary
  const N  = y > 0   ? curr[(y-1)*w+x]   : curr[(y+1)*w+x];
  const S  = y < h-1 ? curr[(y+1)*w+x]   : curr[(y-1)*w+x];
  const E  = x < w-1 ? curr[y*w+(x+1)]   : curr[y*w+(x-1)];
  const Wc = x > 0   ? curr[y*w+(x-1)]   : curr[y*w+(x+1)];
  const lap = N + S + E + Wc - 4 * curr[i];
  const reflected = d * (2 * curr[i] - prev[i] + 0.5 * lap);
  next[i] = Math.max(-1, Math.min(1, em === 'reflect' ? reflected : reflected * pc));
}

export class FluidSim {
  /** @param {import('../grid.js').Grid} grid */
  constructor(grid) {
    this.grid = grid;

    // Wave dynamics
    this.damping      = 0.97;
    this.edgeMode     = 'partial';  // 'reflect' | 'absorb' | 'partial'
    this.partialCoeff = 0.10;

    // Grid resolution (relative to world units)
    this.resolution = 'world';   // 'world' | 'half' | 'quarter'

    // Injection
    this.tapStrength   = 0.9;
    this.wakeStrength  = 0.4;
    this.wakeAngleDeg  = 19.5;
    this.wakePoints    = 4;
    this.wakeLengthMul = 2.0;

    // Canvas2D tint overlay
    this.tintEnabled   = true;
    this.tintR         = 180;
    this.tintG         = 210;
    this.tintB         = 255;
    this.tintMaxAlpha  = 5;      // opacity at amplitude = 1 (out of 255)
    this.tintThreshold = 0.02;   // minimum amplitude to paint

    // GPU refraction (Compositor E7-4)
    this.refrEnabled  = false;
    this.refrStrength = 0.006;
    this.specStrength = 0.0;

    // Triple-buffer wave state: curr ← computed, prev ← last curr, next ← write target
    this._w    = 0;
    this._h    = 0;
    this._bufs = [null, null, null];
    this._ci   = 0;  // current
    this._pi   = 1;  // previous
    this._ni   = 2;  // next (write)

    this._allocate();
  }

  _factor() {
    return this.resolution === 'quarter' ? 0.25
         : this.resolution === 'half'    ? 0.5
         : 1.0;
  }

  _allocate() {
    const f = this._factor();
    const w = Math.max(4, Math.round(this.grid.logicalW * f));
    const h = Math.max(4, Math.round(this.grid.logicalH * f));
    if (w !== this._w || h !== this._h) {
      this._w = w; this._h = h;
      this._bufs[0] = new Float32Array(w * h);
      this._bufs[1] = new Float32Array(w * h);
      this._bufs[2] = new Float32Array(w * h);
      this._ci = 0; this._pi = 1; this._ni = 2;
    }
  }

  /** Call after grid.resize() to recompute wave-grid dimensions. */
  resize() { this._allocate(); }

  /**
   * Inject a disturbance at logical (world-unit) coordinates.
   * Spreads across a 3×3 neighbourhood with falloff.
   * @param {number} lx
   * @param {number} ly
   * @param {number} strength  — signed amplitude (positive = up)
   */
  inject(lx, ly, strength) {
    const f = this._factor();
    const cx = Math.round(lx * f);
    const cy = Math.round(ly * f);
    const { _w: w, _h: h } = this;
    const curr = this._bufs[this._ci];
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = cx + dx, ny = cy + dy;
        if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
          const falloff = 1 - (Math.abs(dx) + Math.abs(dy)) * 0.25;
          curr[ny * w + nx] = Math.max(-1, Math.min(1,
            curr[ny * w + nx] + strength * falloff));
        }
      }
    }
  }

  _injectVWake(fish) {
    const spd = Math.sqrt(fish.vx * fish.vx + fish.vy * fish.vy);
    if (spd < 5e-5) return;
    const angle      = Math.atan2(fish.vy, fish.vx);
    const wakeRad    = this.wakeAngleDeg * Math.PI / 180;
    const wakeLen    = fish.length * this.wakeLengthMul;
    const speedNorm  = Math.min(1, spd / 0.03);

    for (let i = 1; i <= this.wakePoints; i++) {
      const t    = i / this.wakePoints;
      const dist = wakeLen * t;
      const fade = (1 - t * 0.6) * speedNorm;
      for (const side of [-1, 1]) {
        const armAngle = angle + Math.PI + side * wakeRad;
        this.inject(
          fish.x + Math.cos(armAngle) * dist,
          fish.y + Math.sin(armAngle) * dist,
          this.wakeStrength * fade,
        );
      }
    }
  }

  /**
   * Advance wave simulation one step and inject fish V-wakes.
   * @param {number}   deltaMs
   * @param {object[]} entities — fish list from Simulation
   */
  update(deltaMs, entities) {
    this._allocate();
    const { _w: w, _h: h } = this;
    const curr = this._bufs[this._ci];
    const prev = this._bufs[this._pi];
    const next = this._bufs[this._ni];
    const d  = this.damping;
    const em = this.edgeMode;
    const pc = this.partialCoeff;

    for (const fish of entities) this._injectVWake(fish);

    // Interior cells — classic wave equation
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i   = y * w + x;
        const lap = curr[(y-1)*w+x] + curr[(y+1)*w+x]
                  + curr[y*w+(x-1)] + curr[y*w+(x+1)]
                  - 4 * curr[i];
        next[i] = Math.max(-1, Math.min(1, d * (2 * curr[i] - prev[i] + 0.5 * lap)));
      }
    }

    // Boundary cells
    for (let x = 0; x < w; x++) {
      _edgeCell(next, curr, prev, x,     0, w, h, d, em, pc);
      _edgeCell(next, curr, prev, x, h - 1, w, h, d, em, pc);
    }
    for (let y = 1; y < h - 1; y++) {
      _edgeCell(next, curr, prev,     0, y, w, h, d, em, pc);
      _edgeCell(next, curr, prev, w - 1, y, w, h, d, em, pc);
    }

    // Rotate buffers: old prev → write target, curr → prev, next → curr
    const tmp = this._pi;
    this._pi  = this._ci;
    this._ci  = this._ni;
    this._ni  = tmp;
  }

  /**
   * Draw the wave amplitude as a semi-transparent tint on the Grid's Canvas2D context.
   * Called after sim.draw() so the tint overlays the fish.
   * @param {import('../grid.js').Grid} grid
   */
  drawTint(grid) {
    if (!this.tintEnabled) return;
    const { _w: w, _h: h } = this;
    const curr = this._bufs[this._ci];
    const { ctx, logicalW, logicalH, scale } = grid;
    const cellW = (logicalW / w) * scale;
    const cellH = (logicalH / h) * scale;
    const cw = Math.ceil(cellW), ch = Math.ceil(cellH);
    const { tintR: r, tintG: g, tintB: b, tintMaxAlpha: ma, tintThreshold: thr } = this;

    ctx.save();
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const val = curr[y * w + x];
        if (Math.abs(val) < thr) continue;
        const alpha = (Math.abs(val) * ma) / 255;
        ctx.fillStyle = `rgba(${r},${g},${b},${alpha})`;
        ctx.fillRect(Math.round(x * cellW), Math.round(y * cellH), cw, ch);
      }
    }
    ctx.restore();
  }

  /** Returns the current wave amplitude buffer (Float32Array, values in [-1, 1]). */
  getBuffer() { return this._bufs[this._ci]; }

  /** Returns the pixel dimensions of the wave grid. */
  getDimensions() { return { w: this._w, h: this._h }; }
}
