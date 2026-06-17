/**
 * @file main.js
 * Entry point: wires up the Grid, Simulation, spawns Koi, drives animation loop.
 */

import { Grid         } from './grid.js';
import { Simulation   } from './simulation.js';
import { Koi          } from './entities/koi.js';
import { DebugOverlay } from './debug-overlay.js';
import { initMenu     } from './ui/menu.js';
import { rollColor, getActivePalette, getSpecialPalette } from './palettes/index.js';
import { Compositor } from './renderer/compositor.js';
import { GlassShapes } from './renderer/glass-shapes.js';
import { KeyNavManager } from './ui/key-nav.js';
import { FluidSim   } from './fluid/fluid-sim.js';

/** Number of koi to spawn. */
const KOI_COUNT = 5;

/** Display cells per world unit — render fidelity. 1 = original chunky grid, 2 = 2× finer. */
const DISPLAY_DENSITY = 2;

document.addEventListener('DOMContentLoaded', () => {
  const canvas      = /** @type {HTMLCanvasElement} */ (document.getElementById('pond'));
  const glCanvas    = /** @type {HTMLCanvasElement} */ (document.getElementById('webgl'));
  const debugCanvas = /** @type {HTMLCanvasElement} */ (document.getElementById('debug'));

  const grid    = new Grid(canvas, { density: DISPLAY_DENSITY });
  grid.setWebglCanvas(glCanvas);
  const compositor  = new Compositor(canvas, glCanvas);
  const glassShapes = new GlassShapes(compositor);
  const fluidSim    = new FluidSim(grid);
  const sim     = new Simulation(grid);
  const overlay = new DebugOverlay(debugCanvas, grid);
  overlay.glassShapes = glassShapes;

  const keyNav = new KeyNavManager({
    glassShapes,
    overlay,
    sim,
    recolorFn: () => rollColor(getActivePalette(), getSpecialPalette()),
  });
  overlay.keyNav = keyNav;
  const ariaLive = document.getElementById('aria-live');
  if (ariaLive) keyNav.setAriaLive(ariaLive);

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
    fluidSim.resize();
    overlay.sync();
    prevW = grid.logicalW;
    prevH = grid.logicalH;
  });

  // Pointer handling on the visible WebGL canvas (canvas#pond is hidden):
  //   • drag a glass shape if the press lands on one, else
  //   • hold 200ms → fish swim toward pointer and orbit; quick tap → recolor nearest fish.
  let dragShape = -1, dragOffX = 0, dragOffY = 0;
  let attractHoldTimer = null;
  const _attractPos = { x: 0, y: 0 };

  function _clearAttract() {
    if (attractHoldTimer !== null) { clearTimeout(attractHoldTimer); attractHoldTimer = null; }
    sim.attractPoint     = null;
    overlay.attractPoint = null;
  }

  function _recolorNearest(lx, ly) {
    let nearest = null, minD2 = Infinity;
    for (const fish of sim.entities) {
      const d2 = (fish.x - lx) ** 2 + (fish.y - ly) ** 2;
      if (d2 < minD2) { minD2 = d2; nearest = fish; }
    }
    if (nearest) nearest.color = rollColor(getActivePalette(), getSpecialPalette());
  }

  glCanvas.addEventListener('pointerdown', (e) => {
    const rect = glCanvas.getBoundingClientRect();
    const u  = (e.clientX - rect.left) / rect.width;
    const v  = (e.clientY - rect.top)  / rect.height;
    const lx = (e.clientX - rect.left) / grid.scale;
    const ly = (e.clientY - rect.top)  / grid.scale;

    // Glass shapes take priority — grab the topmost one under the pointer.
    const hit = glassShapes.hitTest(u, v);
    if (hit >= 0) {
      glassShapes.select(hit);
      dragShape = hit;
      const s = glassShapes.list[hit];
      dragOffX = s.cx - u;
      dragOffY = s.cy - v;
      glCanvas.setPointerCapture(e.pointerId);
      return;
    }

    // Tap injects a water disturbance at the touch point.
    fluidSim.inject(lx, ly, fluidSim.tapStrength);

    // Hold-to-attract: capture pointer and start 200ms timer.
    _attractPos.x = lx;
    _attractPos.y = ly;
    glCanvas.setPointerCapture(e.pointerId);
    attractHoldTimer = setTimeout(() => {
      attractHoldTimer = null;
      sim.attractPoint     = _attractPos;
      overlay.attractPoint = _attractPos;
    }, 200);
  });

  glCanvas.addEventListener('pointermove', (e) => {
    glassShapes.touchActivity();

    if (dragShape >= 0) {
      const s = glassShapes.list[dragShape];
      if (!s) { dragShape = -1; return; }
      const rect = glCanvas.getBoundingClientRect();
      const u = (e.clientX - rect.left) / rect.width;
      const v = (e.clientY - rect.top)  / rect.height;
      s.cx = Math.max(0, Math.min(1, u + dragOffX));
      s.cy = Math.max(0, Math.min(1, v + dragOffY));
      glassShapes.sync();
      return;
    }

    // Track pointer for attract (active or pending timer).
    const rect = glCanvas.getBoundingClientRect();
    _attractPos.x = (e.clientX - rect.left) / grid.scale;
    _attractPos.y = (e.clientY - rect.top)  / grid.scale;
  });

  glCanvas.addEventListener('pointerup', () => {
    if (dragShape >= 0) {
      dragShape = -1;
      glassShapes.requestSave();
      return;
    }
    if (attractHoldTimer !== null) {
      // Quick tap: cancel hold timer, recolor nearest fish.
      clearTimeout(attractHoldTimer);
      attractHoldTimer = null;
      _recolorNearest(_attractPos.x, _attractPos.y);
    } else {
      _clearAttract();
    }
  });

  glCanvas.addEventListener('pointercancel', () => {
    if (dragShape >= 0) { dragShape = -1; glassShapes.requestSave(); return; }
    _clearAttract();
  });

  // Menu wires up movement-tuning + display sliders (and may restore persisted state).
  initMenu({ overlay, sim, grid, FishClass: Koi, compositor, glassShapes, keyNav, fluidSim });

  // ── Animation loop ────────────────────────────────────────────────────────
  let lastTime = performance.now();

  function frame(now) {
    const deltaMs = Math.min(now - lastTime, 100);
    lastTime = now;

    grid.clear();
    sim.update(deltaMs);
    fluidSim.update(deltaMs, sim.entities);
    sim.draw();
    fluidSim.drawTint(grid);
    grid.drawBorder();
    keyNav.frame(deltaMs / 1000);
    overlay.draw(sim.entities);
    glassShapes.update(deltaMs, compositor.aspect);
    if (fluidSim.refrEnabled) {
      const { w, h } = fluidSim.getDimensions();
      compositor.uploadWave(fluidSim.getBuffer(), w, h);
    }
    compositor.frame(grid.border.enabled ? grid.border.width * grid.scale : 0);

    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
});
