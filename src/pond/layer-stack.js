// src/pond/layer-stack.js
// Depth layers (E14-6) + parametric water model & vertical drift (E14-11).
//
// A pond has N ordered depth planes; index 0 = deepest (pond floor, drawn FIRST
// so shallower entities paint over it), last = surface. Each layer carries a
// DEPTH FILTER (tint colour + opacity) mixed into an entity's colour at draw
// time — free, since entities are flat-colour cell art (drawColor = mix(colour,
// tint.rgb, tint.a)) — plus a dormant `caustics` block (the stable interface the
// E7-8..12 work lands against).
//
// PARAMETRIC MODEL (E14-11): rather than authoring N independent tints, the whole
// stack is DERIVED from a few knobs — one water colour, layer count, murkiness
// (how far the colour darkens toward black with depth), and surface/floor opacity.
// So changing the count re-samples the same gradient (no wiping edits) and the
// pond reads as one coherent body. `_layers` stays the internal runtime form the
// renderer/draw-order code consumes, so nothing downstream changed.
//
// Defaults: opacitySurface 0 → the single-layer pond (and the surface plane of any
// pond) is untinted, i.e. pixel-identical to the pre-E14-6 look.

export const MAX_LAYERS = 8;

function defaultParams() {
  return {
    waterColor: { r: 12, g: 22, b: 34 },   // dark blue-teal; only shows as it darkens with depth
    count: 1,
    murkiness: 0.7,        // 0..1 — colour value drop from surface (1) → floor (1-murk)
    opacitySurface: 0.0,   // depth-filter alpha at the top (0 → surface untouched, identical)
    opacityFloor: 0.6,     // depth-filter alpha at the bottom
  };
}

let _params = defaultParams();
let _layers = deriveLayers(_params);

function _name(i, n) {
  if (n === 1) return 'Water';
  if (i === 0) return 'Floor';
  if (i === n - 1) return 'Surface';
  return `Mid ${i}`;
}

/** Build the runtime `_layers` array from the parametric knobs. */
function deriveLayers(p) {
  const n = Math.max(1, Math.min(MAX_LAYERS, Math.round(p.count || 1)));
  const { waterColor: wc, murkiness: m, opacitySurface: aS, opacityFloor: aF } = p;
  const out = [];
  for (let i = 0; i < n; i++) {
    const depth = n === 1 ? 0 : (n - 1 - i) / (n - 1);   // 1 at floor → 0 at surface
    const value = 1 - m * depth;                          // darken toward the floor
    out.push({
      id: `layer-${i}`, name: _name(i, n), order: i,
      tint: {
        r: Math.round(wc.r * value),
        g: Math.round(wc.g * value),
        b: Math.round(wc.b * value),
        a: +(aS + (aF - aS) * depth).toFixed(3),
      },
      caustics: { opacity: 1.0, exclusive: false },       // inert until E7-8..12
    });
  }
  return out;
}

// ── Parametric knob API (Depth menu binds to these) ──────────────────────────
export function getWaterParams() { return _params; }
export function getLayers()  { return _layers; }
export function layerCount() { return _layers.length; }

function _rederive() { _layers = deriveLayers(_params); }
export function setWaterColor(r, g, b) { _params.waterColor = { r, g, b }; _rederive(); }
export function setLayerCount(n) { _params.count = Math.max(1, Math.min(MAX_LAYERS, Math.round(n))); _rederive(); return _layers; }
export function setMurkiness(m) { _params.murkiness = Math.max(0, Math.min(1, m)); _rederive(); }
export function setOpacitySurface(a) { _params.opacitySurface = Math.max(0, Math.min(1, a)); _rederive(); }
export function setOpacityFloor(a) { _params.opacityFloor = Math.max(0, Math.min(1, a)); _rederive(); }

function _clampIdx(i) { return Math.max(0, Math.min(_layers.length - 1, i | 0)); }

/** The mixed depth-filter tint for an entity (accounting for a layer lerp), or null. */
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

/** Which layer index an entity DRAWS in (switches at the lerp midpoint). */
export function drawLayerIdx(entity) {
  if (!entity.layer) return _layers.length - 1;
  const l = entity.layer;
  return _clampIdx((l.t ?? 0) < 0.5 ? l.from : l.to);
}

/** Assign an entity's spawn layer in place (species layerLock, else random). */
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

/** Begin lerping an entity toward layer `idx` over `ms` (food sink, drift, feed). */
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

// ── Vertical drift (E14-11) ──────────────────────────────────────────────────
// A fish occasionally drifts to a nearby layer so depth feels alive. Rate comes
// from the species' `render.verticalRoam` (0 = pinned). Suppressed while the fish
// is already lerping (a feed/food layer move) or its species is layer-locked.
function _driftInterval(roam) {
  // Higher roam → more frequent. ~3–7 s at the default (0.35), faster as roam→1.
  return (3000 + Math.random() * 4000) * (1.25 - Math.max(0, Math.min(1, roam)));
}
export function maybeDrift(fish, dt) {
  const n = _layers.length;
  if (n <= 1) return;
  const roam = fish.species?.render?.verticalRoam ?? 0;
  if (roam <= 0 || fish.species?.render?.layerLock != null) return;
  const l = fish.layer;
  if (!l || l.dur > 0) return;                 // busy (drift or feed lerp)
  fish._driftMs = (fish._driftMs ?? _driftInterval(roam)) - dt;
  if (fish._driftMs > 0) return;
  const cur = l.from;
  let step = (Math.random() < 0.2 ? 2 : 1) * (Math.random() < 0.5 ? -1 : 1);
  let target = _clampIdx(cur + step);
  if (target === cur) target = _clampIdx(cur - Math.sign(step || 1));
  if (target !== cur) moveToLayer(fish, target, 1500 + Math.random() * 1200);
  fish._driftMs = _driftInterval(roam);
}

/** Re-roll spawn layers for a set of entities (after a count change). */
export function redistribute(entities) {
  for (const e of entities) if (e.species) assignSpawnLayer(e);
}

// ── Persistence — the parametric params (E14-11) ──────────────────────────────
export function serializeLayers() {
  return {
    waterColor: { ..._params.waterColor },
    count: _params.count,
    murkiness: _params.murkiness,
    opacitySurface: _params.opacitySurface,
    opacityFloor: _params.opacityFloor,
  };
}
export function restoreLayers(blob) {
  if (!blob || typeof blob !== 'object') return;
  const p = defaultParams();
  // E14-11 param blob.
  if (blob.waterColor && Number.isFinite(blob.waterColor.r)) p.waterColor = {
    r: blob.waterColor.r | 0, g: blob.waterColor.g | 0, b: blob.waterColor.b | 0,
  };
  if (Number.isFinite(blob.count)) p.count = blob.count;
  if (Number.isFinite(blob.murkiness)) p.murkiness = Math.max(0, Math.min(1, blob.murkiness));
  if (Number.isFinite(blob.opacitySurface)) p.opacitySurface = Math.max(0, Math.min(1, blob.opacitySurface));
  if (Number.isFinite(blob.opacityFloor)) p.opacityFloor = Math.max(0, Math.min(1, blob.opacityFloor));
  // Legacy E14-6 blob: only the layer count is meaningful; per-layer tints are dropped.
  else if (Array.isArray(blob.layers)) p.count = blob.layers.length;
  _params = p;
  _rederive();
}
