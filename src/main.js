/**
 * @file main.js
 * Entry point: wires up the Grid, Simulation, spawns Koi, drives animation loop.
 */

import { Grid         } from './grid.js';
import { Simulation   } from './simulation.js';
import { Koi          } from './entities/koi.js';
import { DebugOverlay } from './debug-overlay.js';
import { initMenu     } from './ui/menu.js';

/** Number of koi to spawn. */
const KOI_COUNT = 5;

/** Display cells per world unit — render fidelity. 1 = original chunky grid, 2 = 2× finer. */
const DISPLAY_DENSITY = 2;

document.addEventListener('DOMContentLoaded', () => {
  const canvas      = /** @type {HTMLCanvasElement} */ (document.getElementById('pond'));
  const debugCanvas = /** @type {HTMLCanvasElement} */ (document.getElementById('debug'));

  const grid    = new Grid(canvas, { density: DISPLAY_DENSITY });
  const sim     = new Simulation(grid);
  const overlay = new DebugOverlay(debugCanvas, grid);

  // ── Spawn koi ────────────────────────────────────────────────────────────
  for (let i = 0; i < KOI_COUNT; i++) sim.add(new Koi(grid));

  // ── Reposition entities proportionally when the grid is resized ──────────
  // Registered BEFORE the menu so menu-driven display-knob changes (world size /
  // density, which dispatch 'gridresize') reposition fish through the same path.
  let prevW = grid.logicalW;
  let prevH = grid.logicalH;

  canvas.addEventListener('gridresize', () => {
    const scaleX = grid.logicalW / prevW;
    const scaleY = grid.logicalH / prevH;
    for (const entity of sim.entities) {
      entity.x *= scaleX;
      entity.y *= scaleY;
    }
    overlay.sync();
    prevW = grid.logicalW;
    prevH = grid.logicalH;
  });

  // Menu wires up movement-tuning + display sliders (and may restore persisted state).
  initMenu({ overlay, sim, grid, FishClass: Koi });

  // ── Animation loop ────────────────────────────────────────────────────────
  let lastTime = performance.now();

  function frame(now) {
    const deltaMs = Math.min(now - lastTime, 100);
    lastTime = now;

    grid.clear();
    sim.update(deltaMs);
    sim.draw();
    overlay.draw(sim.entities);

    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
});
