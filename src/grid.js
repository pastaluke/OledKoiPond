/**
 * @file grid.js
 * Manages the logical pixel grid that maps to the physical canvas.
 * The grid maintains a consistent logical resolution (~120px short edge)
 * regardless of device pixel density or window size.
 */

export class Grid {
  /**
   * Creates a Grid and begins listening for window resize events.
   * @param {HTMLCanvasElement} canvas
   * @param {number} [targetShortEdge=120] - Desired logical size of the shorter screen axis.
   */
  constructor(canvas, targetShortEdge = 120) {
    this.canvas = canvas;
    this.targetShortEdge = targetShortEdge;

    /** @type {CanvasRenderingContext2D} */
    this.ctx = canvas.getContext('2d');

    this.logicalW = 0;
    this.logicalH = 0;
    this.scale = 1;

    this.resize();

    window.addEventListener('resize', () => {
      this.resize();
      canvas.dispatchEvent(new CustomEvent('gridresize'));
    });
  }

  /**
   * Recomputes logical and physical dimensions from the current CSS layout size,
   * then updates canvas.width/height to match physical pixels.
   */
  resize() {
    const cssW = this.canvas.clientWidth;
    const cssH = this.canvas.clientHeight;

    const shortEdge = Math.min(cssW, cssH);
    const longEdge  = Math.max(cssW, cssH);

    // scale = physical short edge / targetShortEdge
    this.scale = shortEdge / this.targetShortEdge;

    const logicalShort = this.targetShortEdge;
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
   * Draws a single logical pixel at (lx, ly) with the given RGB color.
   * The drawn rectangle is Math.ceil(scale) × Math.ceil(scale) physical pixels.
   * @param {number} lx - Logical x coordinate.
   * @param {number} ly - Logical y coordinate.
   * @param {number} r - Red channel (0–255).
   * @param {number} g - Green channel (0–255).
   * @param {number} b - Blue channel (0–255).
   */
  drawPixel(lx, ly, r, g, b) {
    const { px, py } = this.toPhysical(lx, ly);
    const size = Math.ceil(this.scale);
    this.ctx.fillStyle = `rgb(${r},${g},${b})`;
    this.ctx.fillRect(Math.round(px), Math.round(py), size, size);
  }

  /**
   * Converts a logical coordinate to physical canvas pixels.
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
