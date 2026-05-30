// src/movement/tuning.js
// Live-tunable movement parameters, surfaced as menu sliders. Each descriptor maps
// to a static field on the spawned fish class. Because the movement code reads those
// statics fresh each frame (and maxForce/maxSpeed via getters), mutating them updates
// every fish instantly. Use the menu's "Copy values" button to bake a tuned set back
// into the class defaults in fish-base.js / koi.js.

// Each param: min/max = the slider's INITIAL (and adjustable) visible range;
// floor/ceil = hard limits the range buttons can never cross; step = fine value
// nudge (− / + knob buttons) and slider step; coarse = how far the [ / ] range
// buttons move a bound per click.
export const MOVEMENT_PARAMS = [
  { key: 'SEPARATION_WEIGHT', label: 'Separation', min: 0,       max: 4,      floor: 0,       ceil: 10,    step: 0.05,    coarse: 0.25,    decimals: 2,
    desc: 'How hard fish steer away from crowding neighbors. Higher = more personal space, less clumping/overlap.' },
  { key: 'ALIGNMENT_WEIGHT',  label: 'Alignment',  min: 0,       max: 4,      floor: 0,       ceil: 10,    step: 0.05,    coarse: 0.25,    decimals: 2,
    desc: 'How strongly fish match the heading of nearby fish. Higher = the school swims in unison; lower = everyone points their own way.' },
  { key: 'COHESION_WEIGHT',   label: 'Cohesion',   min: 0,       max: 4,      floor: 0,       ceil: 10,    step: 0.05,    coarse: 0.25,    decimals: 2,
    desc: 'How strongly fish steer toward the center of nearby fish. Higher = the school bunches into a tight group; lower = it spreads out.' },
  { key: 'WANDER_WEIGHT',     label: 'Wander',     min: 0,       max: 4,      floor: 0,       ceil: 10,    step: 0.05,    coarse: 0.25,    decimals: 2,
    desc: 'Strength of each fish’s idle meandering (random walk). Higher = restless roaming (esp. lone fish); too high = jittery.' },
  { key: 'EDGE_WEIGHT',       label: 'Edges',      min: 0,       max: 6,      floor: 0,       ceil: 12,    step: 0.05,    coarse: 0.25,    decimals: 2,
    desc: 'How hard fish turn away from the pond walls. Higher = they peel off sooner and never hug the edges.' },
  { key: 'SCHOOL_WEIGHT',     label: 'School',     min: 0,       max: 1,      floor: 0,       ceil: 1,     step: 0.02,    coarse: 0.1,     decimals: 2,
    desc: 'Overall schooling tendency — scales Alignment + Cohesion together. 0 = solitary loners, 1 = strong schoolers.' },
  { key: 'MAX_FORCE_MAX',     label: 'Force (sm)', min: 0.00002, max: 0.0008, floor: 0.00001, ceil: 0.002, step: 0.00001, coarse: 0.00005, decimals: 5,
    desc: 'Turn agility of the SMALLEST fish. Higher = small fish bank sharply; lower = wide, lazy arcs.' },
  { key: 'MAX_FORCE_MIN',     label: 'Force (lg)', min: 0.00002, max: 0.0008, floor: 0.00001, ceil: 0.002, step: 0.00001, coarse: 0.00005, decimals: 5,
    desc: 'Turn agility of the LARGEST fish. Higher = big fish turn tighter; lower = slow, sweeping turns.' },
  { key: 'SPEED_MAX',         label: 'Max speed',  min: 0.005,   max: 0.08,   floor: 0.002,   ceil: 0.2,   step: 0.001,   coarse: 0.005,   decimals: 3,
    desc: 'Top swimming speed cap (logical px/ms). Higher = faster fish overall.' },
  { key: 'SEPARATION_DIST',   label: 'Sep dist',   min: 0,       max: 40,     floor: 0,       ceil: 120,   step: 1,       coarse: 5,       decimals: 0,
    desc: 'Distance (px) at which fish start pushing apart. Larger = more spacing held between fish.' },
  { key: 'PERCEPTION_RADIUS', label: 'Perception', min: 0,       max: 80,     floor: 0,       ceil: 200,   step: 1,       coarse: 5,       decimals: 0,
    desc: 'How far (px) a fish senses others for alignment/cohesion. Larger = bigger, looser schools that react over distance.' },
];

/** Fresh { key: {min, max} } map of each param's default (initial) slider range. */
export function defaultRanges() {
  const r = {};
  for (const p of MOVEMENT_PARAMS) r[p.key] = { min: p.min, max: p.max };
  return r;
}

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
