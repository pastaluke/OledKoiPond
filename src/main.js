/**
 * @file main.js
 * Entry point: wires up the Grid, spawns Koi, and drives the animation loop.
 */

import { Grid } from './grid.js';
import { Koi  } from './entities/koi.js';

/** Number of koi to spawn. */
const KOI_COUNT = 5;

document.addEventListener('DOMContentLoaded', () => {
  const canvas = /** @type {HTMLCanvasElement} */ (document.getElementById('pond'));
  const grid   = new Grid(canvas);

  // ── Spawn koi at random positions within the logical grid ───────────────
  /** @type {Koi[]} */
  const kois = Array.from({ length: KOI_COUNT }, () => new Koi(grid));

  // ── Reposition koi proportionally when the grid is resized ──────────────
  /** Snapshot of logical dimensions before the most recent resize. */
  let prevW = grid.logicalW;
  let prevH = grid.logicalH;

  canvas.addEventListener('gridresize', () => {
    const scaleX = grid.logicalW / prevW;
    const scaleY = grid.logicalH / prevH;
    for (const koi of kois) {
      koi.x *= scaleX;
      koi.y *= scaleY;
    }
    prevW = grid.logicalW;
    prevH = grid.logicalH;
  });

  // ── Animation loop ───────────────────────────────────────────────────────
  let lastTime = performance.now();

  function frame(now) {
    // Cap deltaMs to avoid spiral-of-death when the tab was hidden.
    const deltaMs = Math.min(now - lastTime, 100);
    lastTime = now;

    grid.clear();

    for (const koi of kois) {
      koi.update(deltaMs, grid);
      koi.draw(grid);
    }

    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
});
