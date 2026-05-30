// src/movement/tuning.js
// Live-tunable movement parameters, surfaced as menu sliders. Each descriptor maps
// to a static field on the spawned fish class. Because the movement code reads those
// statics fresh each frame (and maxForce/maxSpeed via getters), mutating them updates
// every fish instantly. Use the menu's "Copy values" button to bake a tuned set back
// into the class defaults in fish-base.js / koi.js.

export const MOVEMENT_PARAMS = [
  { key: 'SEPARATION_WEIGHT', label: 'Separation', min: 0,       max: 4,      step: 0.05,    decimals: 2 },
  { key: 'ALIGNMENT_WEIGHT',  label: 'Alignment',  min: 0,       max: 4,      step: 0.05,    decimals: 2 },
  { key: 'COHESION_WEIGHT',   label: 'Cohesion',   min: 0,       max: 4,      step: 0.05,    decimals: 2 },
  { key: 'WANDER_WEIGHT',     label: 'Wander',     min: 0,       max: 4,      step: 0.05,    decimals: 2 },
  { key: 'EDGE_WEIGHT',       label: 'Edges',      min: 0,       max: 6,      step: 0.05,    decimals: 2 },
  { key: 'SCHOOL_WEIGHT',     label: 'School',     min: 0,       max: 1,      step: 0.02,    decimals: 2 },
  { key: 'MAX_FORCE_MAX',     label: 'Force (sm)', min: 0.00002, max: 0.0008, step: 0.00001, decimals: 5 },
  { key: 'MAX_FORCE_MIN',     label: 'Force (lg)', min: 0.00002, max: 0.0008, step: 0.00001, decimals: 5 },
  { key: 'SPEED_MAX',         label: 'Max speed',  min: 0.005,   max: 0.08,   step: 0.001,   decimals: 3 },
  { key: 'SEPARATION_DIST',   label: 'Sep dist',   min: 0,       max: 40,     step: 1,       decimals: 0 },
  { key: 'PERCEPTION_RADIUS', label: 'Perception', min: 0,       max: 80,     step: 1,       decimals: 0 },
];

const LS_KEY = 'koipond.tuning';

/** Snapshot current values for all params from a class (resolves inherited statics). */
export function snapshot(cls) {
  const out = {};
  for (const p of MOVEMENT_PARAMS) out[p.key] = cls[p.key];
  return out;
}

/** Apply a values object (key→number) onto the class as own static properties. */
export function applyValues(cls, values) {
  if (!values) return;
  for (const p of MOVEMENT_PARAMS) {
    if (Number.isFinite(values[p.key])) cls[p.key] = values[p.key];
  }
}

/** Load persisted tuning ({ params, fishCount }) from localStorage, or null. */
export function loadPersisted() {
  try { return JSON.parse(localStorage.getItem(LS_KEY)) || null; }
  catch { return null; }
}

/** Persist tuning state ({ params, fishCount }). */
export function savePersisted(state) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(state)); } catch { /* ignore */ }
}

/** Build a paste-ready `static FIELD = value;` snippet from current class values. */
export function toCodeSnippet(cls) {
  const pad = Math.max(...MOVEMENT_PARAMS.map(p => p.key.length));
  return MOVEMENT_PARAMS
    .map(p => `static ${p.key.padEnd(pad)} = ${Number(cls[p.key]).toFixed(p.decimals)};`)
    .join('\n');
}
