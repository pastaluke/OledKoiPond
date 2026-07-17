// src/pond/layer-stack.js
// Depth layers (E14-6). A pond has N ordered depth planes; index 0 = deepest
// (pond floor, drawn FIRST so shallower entities paint over it), last = surface.
//
// Each layer carries a DEPTH FILTER (tint color + opacity) that is composited
// into an entity's color at draw time — this is free, because entities are
// flat-color cell art, so `drawColor = mix(color, tint.rgb, tint.a)` is one
// scalar mix per entity per frame (no extra canvas work). An entity mid-dive
// between layers lerps the tint, which is why sinking food / diving creatures
// darken smoothly. Each layer also carries a dormant `caustics` block — the
// stable interface the E7-8..12 caustics/shadow/light work lands against.
//
// Layer count is user-defined (Depth menu). Default = 1 layer at alpha 0, which
// is a no-op: the single-layer pond is pixel-identical to the pre-E14-6 look.
//
// Module singleton (mirrors palette-manager / cartridges): the whole app shares
// one stack. E14-8 (pond config) will fold this into a saved PondConfig.

export const MAX_LAYERS = 8;
const MAX_FLOOR_ALPHA = 0.62;   // depth filter strength at the deepest layer

function _name(i, n) {
  if (n === 1) return 'Water';
  if (i === 0) return 'Floor';
  if (i === n - 1) return 'Surface';
  return `Mid ${i}`;
}

/** Generate N layers: black depth filters, alpha stepped linearly from
 *  MAX_FLOOR_ALPHA at the floor (index 0) to 0 at the surface. N=1 → alpha 0. */
export function defaultStack(n) {
  n = Math.max(1, Math.min(MAX_LAYERS, Math.round(n || 1)));
  const out = [];
  for (let i = 0; i < n; i++) {
    const depth = n === 1 ? 0 : (n - 1 - i) / (n - 1);   // 1 at floor → 0 at surface
    out.push({
      id: `layer-${i}`, name: _name(i, n), order: i,
      tint: { r: 0, g: 0, b: 0, a: +(MAX_FLOOR_ALPHA * depth).toFixed(3) },
      caustics: { opacity: 1.0, exclusive: false },   // inert until E7-8..12
    });
  }
  return out;
}

let _layers = defaultStack(1);

export function getLayers()  { return _layers; }
export function layerCount() { return _layers.length; }

export function setLayerCount(n) { _layers = defaultStack(n); return _layers; }

function _clampIdx(i) { return Math.max(0, Math.min(_layers.length - 1, i | 0)); }

/** The mixed depth-filter tint for an entity (accounting for an in-progress
 *  layer lerp). Returns {r,g,b,a}, or null when there's nothing to apply. */
export function entityTint(entity) {
  if (_layers.length <= 1 || !entity.layer) return null;
  const a = _layers[_clampIdx(entity.layer.from)].tint;
  const t = entity.layer.t || 0;
  if (t <= 0) return a.a > 0 ? a : null;
  const b = _layers[_clampIdx(entity.layer.to)].tint;
  return {
    r: a.r + (b.r - a.r) * t,
    g: a.g + (b.g - a.g) * t,
    b: a.b + (b.b - a.b) * t,
    a: a.a + (b.a - a.a) * t,
  };
}

/** Which layer index an entity DRAWS in — it switches buckets at the lerp
 *  midpoint so a diving entity crosses cleanly. */
export function drawLayerIdx(entity) {
  if (!entity.layer) return _layers.length - 1;   // no layer → surface
  const l = entity.layer;
  return _clampIdx((l.t ?? 0) < 0.5 ? l.from : l.to);
}

/** Assign an entity's spawn layer in place: the species' locked layer if it pins
 *  one (`species.render.layerLock`, an index or layer id), else random across the
 *  stack so a multi-layer pond shows depth striation immediately. */
export function assignSpawnLayer(entity) {
  const n = _layers.length;
  const lock = entity.species?.render?.layerLock;
  let idx;
  if (typeof lock === 'number') idx = _clampIdx(lock);
  else if (typeof lock === 'string') {
    const j = _layers.findIndex((l) => l.id === lock);
    idx = j >= 0 ? j : (Math.random() * n | 0);
  } else idx = Math.random() * n | 0;
  entity.layer = { from: idx, to: idx, t: 0, dur: 0 };
  return entity;
}

/** Begin lerping an entity toward layer `idx` over `ms` (food sinking, diving). */
export function moveToLayer(entity, idx, ms) {
  if (!entity.layer) entity.layer = { from: idx, to: idx, t: 0, dur: 0 };
  const l = entity.layer;
  if (l.t > 0) l.from = drawLayerIdx(entity);   // commit any in-progress lerp
  l.to = _clampIdx(idx); l.t = 0; l.dur = Math.max(1, ms);
  if (l.from === l.to) l.dur = 0;
}

/** Advance an entity's layer lerp; call once per frame with dt (ms). */
export function advanceLayer(entity, dt) {
  const l = entity.layer;
  if (!l || l.dur <= 0) return;
  l.t += dt / l.dur;
  if (l.t >= 1) { l.from = l.to; l.t = 0; l.dur = 0; }
}

/** Re-roll spawn layers for a set of entities (after a layer-count change) so a
 *  multi-layer pond shows striation without a respawn. */
export function redistribute(entities) {
  for (const e of entities) if (e.species) assignSpawnLayer(e);
}

// ── Persistence — { count, layers:[{tint, caustics}] } ────────────────────────
export function serializeLayers() {
  return {
    count: _layers.length,
    layers: _layers.map((l) => ({ tint: { ...l.tint }, caustics: { ...l.caustics } })),
  };
}
export function restoreLayers(blob) {
  if (!blob || typeof blob !== 'object') return;
  const n = Number.isFinite(blob.count) ? blob.count
          : (Array.isArray(blob.layers) ? blob.layers.length : 1);
  _layers = defaultStack(n);
  if (Array.isArray(blob.layers)) {
    for (let i = 0; i < _layers.length && i < blob.layers.length; i++) {
      const src = blob.layers[i]; if (!src) continue;
      if (src.tint) {
        const t = _layers[i].tint;
        if (Number.isFinite(src.tint.r)) t.r = Math.max(0, Math.min(255, src.tint.r));
        if (Number.isFinite(src.tint.g)) t.g = Math.max(0, Math.min(255, src.tint.g));
        if (Number.isFinite(src.tint.b)) t.b = Math.max(0, Math.min(255, src.tint.b));
        if (Number.isFinite(src.tint.a)) t.a = Math.max(0, Math.min(1, src.tint.a));
      }
      if (src.caustics) {
        if (Number.isFinite(src.caustics.opacity)) _layers[i].caustics.opacity = src.caustics.opacity;
        if (typeof src.caustics.exclusive === 'boolean') _layers[i].caustics.exclusive = src.caustics.exclusive;
      }
    }
  }
}
