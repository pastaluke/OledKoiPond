// src/simulation.js
// Manages all pond entities and drives per-frame updates with boids neighbors.

import { SpatialHash } from './sim/spatial-hash.js';
import { getLayers, drawLayerIdx, advanceLayer, maybeDrift } from './pond/layer-stack.js';
import { FishBase, CELL_OFF, CELL_SHIFT, CELL_MASK } from './entities/fish-base.js';
import { FLOOR_GAP } from './fluid/caustics.js';

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
    /** Caustics + light model (E7-8..11), set by main.js. Null = feature absent. */
    this.caustics = null;
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
   *  shallower entities paint over deeper ones (E14-6). With caustics enabled
   *  (E7-8..11) the pass grows: floor web → creature shadows → per-layer buckets,
   *  each stamped with its own light-shifted web. Caustics off → the original
   *  paths, byte-identical. */
  draw() {
    const layers = getLayers();
    const ca = this.caustics;
    const on = !!(ca && ca.enabled);
    const shadowsOn = on && ca.shadows && ca.shadowStrength > 0;
    if (shadowsOn && !FishBase.CAPTURE_SHADOW_CELLS) {
      // Capture is (re)starting: drop stale silhouettes so a shadow can't flash
      // at a fish's long-gone position on the first frame back.
      for (const e of this.entities) if (e._shadowCells) e._shadowCells.length = 0;
    }
    FishBase.CAPTURE_SHADOW_CELLS = shadowsOn;

    if (!on) {
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
      return;
    }

    const n = layers.length;
    ca.drawFloor(n);                       // caustic web on the pond floor (E7-8)
    if (shadowsOn) this._drawShadows(ca);  // silhouettes mask the web (E7-10)

    // Per-layer world-unit bounds in one pass, so each stamp pass only touches
    // its bucket's bounding box instead of the full canvas (zero-alloc: flat
    // [minX,minY,maxX,maxY] × layer scratch reused across frames).
    const lb = this._layerBounds ?? (this._layerBounds = []);
    lb.length = n * 4;
    for (let li = 0; li < n; li++) { const b = li * 4; lb[b] = Infinity; lb[b + 1] = Infinity; lb[b + 2] = -Infinity; lb[b + 3] = -Infinity; }
    for (const e of this.entities) this._accBounds(lb, e);
    for (const p of this.food)     this._accBounds(lb, p);

    // Per-layer buckets; occupied layers detour through the caustics scratch so
    // the web lands on that layer's pixels only, at that layer's light shift (E7-9).
    const { canvas, scale } = this.grid;
    for (let li = 0; li < n; li++) {
      const b = li * 4;
      if (lb[b] === Infinity) continue;   // unoccupied plane
      const opacity = layers[li].caustics?.opacity ?? 1;
      let rect = null;
      if (ca.fishIntensity > 0 && opacity > 0) {
        const x = Math.max(0, Math.floor(lb[b] * scale)), y = Math.max(0, Math.floor(lb[b + 1] * scale));
        const w = Math.min(canvas.width, Math.ceil(lb[b + 2] * scale)) - x;
        const h = Math.min(canvas.height, Math.ceil(lb[b + 3] * scale)) - y;
        if (w > 0 && h > 0) rect = { x, y, w, h };
      }
      if (rect) ca.beginFishLayer(rect);
      for (const entity of this.entities) if (drawLayerIdx(entity) === li) entity.draw(this.grid);
      for (const pellet of this.food)     if (drawLayerIdx(pellet) === li) pellet.draw(this.grid);
      if (rect) ca.endFishLayer(li, n, opacity);
    }
  }

  /** Fold an entity's draw envelope into its layer's [minX,minY,maxX,maxY] slot. */
  _accBounds(lb, o) {
    const b = drawLayerIdx(o) * 4;
    const r = o.length ?? (o.radius ? o.radius * 2 : 4);   // generous body + fin envelope
    if (o.x - r < lb[b])     lb[b]     = o.x - r;
    if (o.y - r < lb[b + 1]) lb[b + 1] = o.y - r;
    if (o.x + r > lb[b + 2]) lb[b + 2] = o.x + r;
    if (o.y + r > lb[b + 3]) lb[b + 3] = o.y + r;
  }

  /** Cast each creature's silhouette onto the floor (E7-10), offset along the
   *  light direction by its height above the floor (E7-11). Uses the cells the
   *  fish rasterized LAST frame — a one-frame lag that's invisible in motion.
   *  Silhouettes go into the caustics scratch OPAQUE, then composite once at
   *  the shadow alpha, so overlapping rects/fish don't double-darken. */
  _drawShadows(ca) {
    const grid = this.grid;
    const dir = ca.lightDir();
    // Offset per layer gap, in display cells (lightOffset is world units).
    const k = ca.lightOffset * grid.density;
    // CONTINUOUS depth (E7-8..11 polish): interpolate the fish's layer during a
    // drift lerp so its shadow SLIDES between planes instead of snapping at the
    // midpoint. Falls back to the discrete draw layer for entities without lerp.
    const contDepth = (e) => (e.layer ? e.layer.from + (e.layer.to - e.layer.from) * (e.layer.t || 0) : drawLayerIdx(e));
    const { cellScale, canvas } = grid;
    const size = Math.ceil(cellScale);

    // Bounding box of every silhouette (origin ± body envelope + light shift),
    // so the pass's scratch work stays off the rest of the canvas.
    let mx0 = Infinity, my0 = Infinity, mx1 = -Infinity, my1 = -Infinity;
    for (const e of this.entities) {
      if (!e._shadowCells || e._shadowCells.length === 0) continue;
      const shift = k * (contDepth(e) + FLOOR_GAP);
      const r = (e.length ?? 4) * grid.density + Math.abs(shift) + 1;
      if (e._shadowOx - r < mx0) mx0 = e._shadowOx - r;
      if (e._shadowOy - r < my0) my0 = e._shadowOy - r;
      if (e._shadowOx + r > mx1) mx1 = e._shadowOx + r;
      if (e._shadowOy + r > my1) my1 = e._shadowOy + r;
    }
    if (mx0 === Infinity) return;
    const rx = Math.max(0, Math.floor(mx0 * cellScale)), ry = Math.max(0, Math.floor(my0 * cellScale));
    const rw = Math.min(canvas.width, Math.ceil(mx1 * cellScale) + size) - rx;
    const rh = Math.min(canvas.height, Math.ceil(my1 * cellScale) + size) - ry;
    if (rw <= 0 || rh <= 0) return;

    ca.beginFishLayer({ x: rx, y: ry, w: rw, h: rh });   // reroute grid.ctx into the scratch
    const ctx = grid.ctx;
    ctx.fillStyle = '#000';
    for (const e of this.entities) {
      const sc = e._shadowCells;
      if (!sc || sc.length === 0) continue;
      const gaps = contDepth(e) + FLOOR_GAP;   // continuous height above the floor plane
      const ox = e._shadowOx + dir.x * k * gaps;
      const oy = e._shadowOy + dir.y * k * gaps;
      for (let m = 0; m < sc.length; m++) {
        const key = sc[m];
        const cx = (key & CELL_MASK) - CELL_OFF + ox;
        const cy = (key >>> CELL_SHIFT) - CELL_OFF + oy;
        ctx.fillRect(Math.round(cx * cellScale), Math.round(cy * cellScale), size, size);
      }
    }
    ca.endShadowPass(ca.shadowStrength);
  }
}
