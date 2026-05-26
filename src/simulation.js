// src/simulation.js
// Manages all pond entities and drives per-frame updates with boids neighbors.

function _distSq(a, b) {
  const dx = a.x - b.x, dy = a.y - b.y;
  return dx * dx + dy * dy;
}

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
    const { entities, grid } = this;
    const n = entities.length;

    for (let i = 0; i < n; i++) {
      const fish = entities[i];
      const rSq  = (fish.constructor.PERCEPTION_RADIUS ?? 0) ** 2;

      // O(n²) neighborhood query — fine for small ponds (n < ~30)
      const neighbors = [];
      if (rSq > 0) {
        for (let j = 0; j < n; j++) {
          if (j !== i && _distSq(fish, entities[j]) <= rSq) {
            neighbors.push(entities[j]);
          }
        }
      }

      fish.update(deltaMs, grid, neighbors);
    }
  }

  /** Draw all entities to the grid. */
  draw() {
    for (const entity of this.entities) entity.draw(this.grid);
  }
}
