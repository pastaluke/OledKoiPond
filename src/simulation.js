// src/simulation.js
// Manages all pond entities and drives per-frame updates with boids neighbors.

import { SpatialHash } from './sim/spatial-hash.js';

/**
 * Simulation owns the entity list and feeds each fish its neighborhood
 * every frame so boids-style behaviors work without fish needing global state.
 */
export class Simulation {
  /** @param {import('./grid.js').Grid} grid */
  constructor(grid) {
    this.grid     = grid;
    /** @type {import('./entities/fish-base.js').FishBase[]} */
    this.entities = [];
    /** Active attraction point in logical coords, or null. Set by main.js on hold. */
    this.attractPoint = null;
    // Neighbor query acceleration (E14-2). The scratch array is shared across all
    // fish in one update pass — safe because each fish consumes its neighbor list
    // synchronously inside fish.update() and nothing retains it.
    this._hash     = new SpatialHash();
    this._scratch  = [];
  }

  /** Add an entity to the simulation. Returns the entity for chaining. */
  add(entity) {
    this.entities.push(entity);
    return entity;
  }

  /** Remove an entity from the simulation. */
  remove(entity) {
    const i = this.entities.indexOf(entity);
    if (i >= 0) this.entities.splice(i, 1);
  }

  /** Run one frame of physics for all entities. */
  update(deltaMs) {
    const { entities, grid, _hash, _scratch } = this;
    const n = entities.length;
    if (n === 0) return;

    // Cell size must cover the largest perception radius present this frame so a
    // 3×3-cell query can't miss a neighbor. One O(n) pass; species are few, but
    // per-entity keeps this correct if mixed rosters ever tune radii apart.
    let maxR = 0;
    for (let i = 0; i < n; i++) {
      const r = entities[i].species?.tuning.perceptionRadius ?? 0;
      if (r > maxR) maxR = r;
    }

    if (maxR > 0) _hash.rebuild(entities, maxR, grid.logicalW, grid.logicalH);

    for (let i = 0; i < n; i++) {
      const fish = entities[i];
      const r = fish.species?.tuning.perceptionRadius ?? 0;
      const neighbors = (maxR > 0 && r > 0)
        ? _hash.query(entities, fish.x, fish.y, r, i, _scratch)
        : (_scratch.length = 0, _scratch);
      fish.update(deltaMs, grid, neighbors, this.attractPoint);
    }
  }

  /** Draw all entities to the grid. */
  draw() {
    for (const entity of this.entities) entity.draw(this.grid);
  }
}
