// src/simulation.js
// Manages all pond entities and drives per-frame updates with boids neighbors.

import { SpatialHash } from './sim/spatial-hash.js';
import { getLayers, drawLayerIdx, advanceLayer, maybeDrift } from './pond/layer-stack.js';

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
    // Food pellets (E14-5) live in their OWN list — never in `entities`, so they
    // never enter fish neighbor queries. Fish reach them through ctx.food. `alive`
    // pellets are reaped each frame; the tap-to-drop UI is gated by foodEnabled.
    this.food        = [];
    this.foodEnabled = false;
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

  /** Drop a food pellet into the pond (E14-5). Returns it for chaining. */
  addFood(pellet) {
    this.food.push(pellet);
    return pellet;
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

    const food = this.food.length ? this.food : null;
    for (let i = 0; i < n; i++) {
      const fish = entities[i];
      const r = fish.species?.tuning.perceptionRadius ?? 0;
      const neighbors = (maxR > 0 && r > 0)
        ? _hash.query(entities, fish.x, fish.y, r, i, _scratch)
        : (_scratch.length = 0, _scratch);
      fish.update(deltaMs, grid, neighbors, this.attractPoint, food);
      maybeDrift(fish, deltaMs);     // occasional vertical drift (E14-11)
      advanceLayer(fish, deltaMs);   // depth-layer lerp (E14-6)
    }

    // Advance + reap food pellets (E14-5): TTL expiry and eaten pellets (alive=false).
    if (this.food.length) {
      for (const p of this.food) p.update(deltaMs, grid);
      if (this.food.some((p) => !p.alive)) this.food = this.food.filter((p) => p.alive);
    }
  }

  /** Draw all entities to the grid, floor-first when depth layers are active so
   *  shallower entities paint over deeper ones (E14-6). Single-layer pond takes
   *  the original flat path — byte-identical. */
  draw() {
    const layers = getLayers();
    if (layers.length <= 1) {
      for (const entity of this.entities) entity.draw(this.grid);
      for (const pellet of this.food) pellet.draw(this.grid);
      return;
    }
    // O(layers × entities): a few layers, so cheaper than a per-frame sort/alloc.
    for (let li = 0; li < layers.length; li++) {
      for (const entity of this.entities) if (drawLayerIdx(entity) === li) entity.draw(this.grid);
      for (const pellet of this.food)     if (drawLayerIdx(pellet) === li) pellet.draw(this.grid);
    }
  }
}
