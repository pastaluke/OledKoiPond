/**
 * @file grid.js
 * The display layer. Owns the mapping from the simulation's coordinate space to
 * the physical canvas, via two independent knobs:
 *
 *   world units ──(worldShortEdge)──▶ screen ──(density)──▶ display cells ──▶ physical px
 *
 *   • worldShortEdge — how many WORLD UNITS span the shorter screen axis. This is the
 *     simulation scale / "zoom": the world is a fixed-size space (short edge = this many
 *     units) that the canvas stretches to fill, so entities stay the same apparent size
 *     across any window/device. Raising it shows more world (everything appears smaller
 *     and slower) while leaving every per-entity constant untouched.
 *   • density — how many DISPLAY CELLS each world unit is rasterized into. This is render
 *     fidelity: raising it draws the same scene with smaller blocks (sharper art) without
 *     changing apparent size, spacing, or speed.
 *
 * Derived: scale = physical px per world unit; cellScale = physical px per display cell
 * (= scale / density). On-screen block size is physicalShortEdge / (worldShortEdge × density).
 *
 * The simulation reads logicalW/logicalH (world units) and is unaware of density.
 */

export class Grid {
  /**
   * Creates a Grid and begins listening for window resize events.
   * @param {HTMLCanvasElement} canvas
   * @param {object} [opts]
   * @param {number} [opts.worldShortEdge=120] - World units across the shorter screen axis (sim scale / zoom).
   * @param {number} [opts.density=1] - Display cells per world unit (render fidelity).
   */
  constructor(canvas, { worldShortEdge = 120, density = 1 } = {}) {
    this.canvas = canvas;
    this.worldShortEdge = worldShortEdge;
    this.density = density;

    /** @type {CanvasRenderingContext2D} */
    this.ctx = canvas.getContext('2d');

    this.logicalW = 0;     // world units (wide axis)
    this.logicalH = 0;     // world units (tall axis)
    this.scale = 1;        // physical px per world unit
    this.cellScale = 1;    // physical px per display cell (= scale / density)

    /** Border drawn over the pond after each frame. Width is in world units. */
    this.border = { enabled: false, width: 1, opacity: 0.5 };

    this.resize();

    window.addEventListener('resize', () => {
      this.resize();
      canvas.dispatchEvent(new CustomEvent('gridresize'));
    });
  }

  /**
   * Recomputes logical (world-unit) and physical dimensions from the current CSS layout
   * size, then updates canvas.width/height to match physical pixels.
   */
  resize() {
    const cssW = this.canvas.clientWidth;
    const cssH = this.canvas.clientHeight;

    const shortEdge = Math.min(cssW, cssH);
    const longEdge  = Math.max(cssW, cssH);

    // scale = physical short edge / worldShortEdge  (physical px per world unit)
    this.scale = shortEdge / this.worldShortEdge;
    // Each world unit is subdivided into `density` display cells.
    this.cellScale = this.scale / this.density;

    const logicalShort = this.worldShortEdge;
    const logicalLong  = Math.round(longEdge / this.scale);

    if (cssW <= cssH) {
      // portrait: short edge is width
      this.logicalW = logicalShort;
      this.logicalH = logicalLong;
    } else {
      // landscape: short edge is height
      this.logicalW = logicalLong;
      this.logicalH = logicalShort;
    }

    // Set physical canvas resolution
    this.canvas.width  = Math.round(this.logicalW * this.scale);
    this.canvas.height = Math.round(this.logicalH * this.scale);
  }

  /**
   * Fills the entire canvas with pure black.
   */
  clear() {
    this.ctx.fillStyle = '#000000';
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
  }

  /**
   * Draws a single display cell at (cx, cy) with the given RGB color. Display cells are
   * the finest render grid: there are `density` cells per world unit. The drawn rectangle
   * is Math.ceil(cellScale) × Math.ceil(cellScale) physical pixels.
   * @param {number} cx - Display-cell x coordinate.
   * @param {number} cy - Display-cell y coordinate.
   * @param {number} r - Red channel (0–255).
   * @param {number} g - Green channel (0–255).
   * @param {number} b - Blue channel (0–255).
   */
  drawCell(cx, cy, r, g, b) {
    const size = Math.ceil(this.cellScale);
    this.ctx.fillStyle = `rgb(${r},${g},${b})`;
    this.ctx.fillRect(Math.round(cx * this.cellScale), Math.round(cy * this.cellScale), size, size);
  }

  /**
   * Draws a single WORLD-UNIT pixel at (lx, ly). Convenience wrapper over drawCell for
   * callers that think in world units; the cell it lands on depends on density.
   * @param {number} lx - Logical (world-unit) x coordinate.
   * @param {number} ly - Logical (world-unit) y coordinate.
   * @param {number} r - Red channel (0–255).
   * @param {number} g - Green channel (0–255).
   * @param {number} b - Blue channel (0–255).
   */
  drawPixel(lx, ly, r, g, b) {
    this.drawCell(lx * this.density, ly * this.density, r, g, b);
  }

  /**
   * Draws the pond border (if enabled) directly on the canvas after sim.draw().
   * Width and position are in world units so the border scales with the grid.
   */
  drawBorder() {
    if (!this.border.enabled) return;
    const lw = this.border.width * this.scale;
    const { ctx, canvas } = this;
    ctx.save();
    ctx.strokeStyle = `rgba(255,255,255,${this.border.opacity})`;
    ctx.lineWidth = lw;
    ctx.strokeRect(lw / 2, lw / 2, canvas.width - lw, canvas.height - lw);
    ctx.restore();
  }

  /**
   * Converts a world-unit coordinate to physical canvas pixels.
   * @param {number} lx
   * @param {number} ly
   * @returns {{ px: number, py: number }}
   */
  toPhysical(lx, ly) {
    return {
      px: lx * this.scale,
      py: ly * this.scale,
    };
  }
}
