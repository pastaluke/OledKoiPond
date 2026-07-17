// src/entities/food-pellet.js
// Minimal food pellet (E14-5). A colored dot dropped on tap that sinks slowly and
// despawns after a TTL; the `feed` style perceives it, approaches, and eats it
// (which flips `alive = false` so the Simulation reaps it). Deliberately tiny —
// it's the etiquette showcase's prop, not the full food system (E12-1): no layers
// yet (P6 adds the layer-lerp sink hook), no nutrition, no flavor.
//
// Kept OUT of the boids entity list (Simulation.food, not Simulation.entities) so
// it never pollutes fish neighbor queries — fish reach it only via ctx.food.

import { layerCount, moveToLayer, advanceLayer, entityTint, getLayers } from '../pond/layer-stack.js';

export class FoodPellet {
  /** @param {number} x @param {number} y @param {object} [opts] */
  constructor(x, y, { ttlMs = 12000, sink = 0.0015, radius = 1.2 } = {}) {
    this.x = x; this.y = y;
    this.vx = 0; this.vy = 0;              // present so any generic reader is safe
    this.alive = true;
    this._ttl = ttlMs;
    this._sink = sink;                     // world units/ms downward drift
    this.radius = radius;                  // world units (perception + draw)
    this.color = { r: 220, g: 180, b: 70 };

    // Depth (E14-6): a dropped pellet starts at the surface and sinks toward the
    // floor over most of its life — the layer lerp darkens it through the depth
    // filters as it goes (the "food translates through layers" idea).
    const top = Math.max(0, layerCount() - 1);
    this.layer = { from: top, to: top, t: 0, dur: 0 };
    moveToLayer(this, 0, ttlMs * 0.7);
  }

  /** Advance TTL + slow sink. Bounds-clamped so it rests on the floor, not past it. */
  update(deltaMs, grid) {
    this._ttl -= deltaMs;
    if (this._ttl <= 0) { this.alive = false; return; }
    this.y += this._sink * deltaMs;
    if (grid) this.y = Math.min(grid.logicalH - 1, this.y);
    advanceLayer(this, deltaMs);   // depth-layer sink lerp (E14-6)
    // Fade the pellet's final second so despawn isn't a hard pop.
    this._fade = Math.max(0, Math.min(1, this._ttl / 1000));
  }

  /** Draw a small filled disc in display cells (batched, like fish parts). */
  draw(grid) {
    const D = grid.density;
    const cx = Math.round(this.x * D), cy = Math.round(this.y * D);
    const r = Math.max(1, Math.round(this.radius * D));
    const f = this._fade ?? 1;
    // Depth filter mixes into the pellet color like a fish part.
    const tint = getLayers().length > 1 ? entityTint(this) : null;
    const ta = tint ? tint.a : 0, ia = 1 - ta;
    const cr = ta > 0 ? (this.color.r * f * ia + tint.r * ta) | 0 : Math.round(this.color.r * f);
    const cg = ta > 0 ? (this.color.g * f * ia + tint.g * ta) | 0 : Math.round(this.color.g * f);
    const cb = ta > 0 ? (this.color.b * f * ia + tint.b * ta) | 0 : Math.round(this.color.b * f);
    grid.beginCells(cr, cg, cb);
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy <= r * r) grid.drawCellFast(cx + dx, cy + dy);
      }
    }
  }
}
