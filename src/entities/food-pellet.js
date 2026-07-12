// src/entities/food-pellet.js
// Minimal food pellet (E14-5). A colored dot dropped on tap that sinks slowly and
// despawns after a TTL; the `feed` style perceives it, approaches, and eats it
// (which flips `alive = false` so the Simulation reaps it). Deliberately tiny —
// it's the etiquette showcase's prop, not the full food system (E12-1): no layers
// yet (P6 adds the layer-lerp sink hook), no nutrition, no flavor.
//
// Kept OUT of the boids entity list (Simulation.food, not Simulation.entities) so
// it never pollutes fish neighbor queries — fish reach it only via ctx.food.

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
  }

  /** Advance TTL + slow sink. Bounds-clamped so it rests on the floor, not past it. */
  update(deltaMs, grid) {
    this._ttl -= deltaMs;
    if (this._ttl <= 0) { this.alive = false; return; }
    this.y += this._sink * deltaMs;
    if (grid) this.y = Math.min(grid.logicalH - 1, this.y);
    // Fade the pellet's final second so despawn isn't a hard pop.
    this._fade = Math.max(0, Math.min(1, this._ttl / 1000));
  }

  /** Draw a small filled disc in display cells (batched, like fish parts). */
  draw(grid) {
    const D = grid.density;
    const cx = Math.round(this.x * D), cy = Math.round(this.y * D);
    const r = Math.max(1, Math.round(this.radius * D));
    const f = this._fade ?? 1;
    grid.beginCells(Math.round(this.color.r * f), Math.round(this.color.g * f), Math.round(this.color.b * f));
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy <= r * r) grid.drawCellFast(cx + dx, cy + dy);
      }
    }
  }
}
