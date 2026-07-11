// src/movement/tuning.js
// Live-tunable movement parameters, surfaced as menu sliders. Each descriptor maps
// to a key on the selected SPECIES record's `tuning` block (species-registry.js).
// Because the movement code reads species.tuning fresh each frame (and
// maxForce/maxSpeed via getters), mutating the record updates every fish of that
// species instantly. Use the menu's "Copy values" button to export the species
// record as JSON (paste-able back via a future import, or baked into the builtin).

// Each param: min/max = the slider's INITIAL (and adjustable) visible range;
// floor/ceil = hard limits the range buttons can never cross; step = fine value
// nudge (− / + knob buttons) and slider step; coarse = how far the [ / ] range
// buttons move a bound per click.
export const MOVEMENT_PARAMS = [
  { key: 'separation',       label: 'Separation', min: 0,       max: 4,      floor: 0,       ceil: 10,    step: 0.05,    coarse: 0.25,    decimals: 2,
    desc: 'How hard fish steer away from crowding neighbors. Higher = more personal space, less clumping/overlap.' },
  { key: 'alignment',        label: 'Alignment',  min: 0,       max: 4,      floor: 0,       ceil: 10,    step: 0.05,    coarse: 0.25,    decimals: 2,
    desc: 'How strongly fish match the heading of nearby fish. Higher = the school swims in unison; lower = everyone points their own way.' },
  { key: 'cohesion',         label: 'Cohesion',   min: 0,       max: 4,      floor: 0,       ceil: 10,    step: 0.05,    coarse: 0.25,    decimals: 2,
    desc: 'How strongly fish steer toward the center of nearby fish. Higher = the school bunches into a tight group; lower = it spreads out.' },
  { key: 'wander',           label: 'Wander',     min: 0,       max: 4,      floor: 0,       ceil: 10,    step: 0.05,    coarse: 0.25,    decimals: 2,
    desc: 'Strength of each fish’s idle meandering (random walk). Higher = restless roaming (esp. lone fish); too high = jittery.' },
  { key: 'edge',             label: 'Edges',      min: 0,       max: 6,      floor: 0,       ceil: 12,    step: 0.05,    coarse: 0.25,    decimals: 2,
    desc: 'How hard fish turn away from the pond walls. Higher = they peel off sooner and never hug the edges.' },
  { key: 'edgeYield',        label: 'Edge yield', min: 0,       max: 1,      floor: 0,       ceil: 1,     step: 0.05,    coarse: 0.1,     decimals: 2,
    desc: 'When a fish enters the wall-avoidance band, how much to fade wander + alignment + cohesion so edge steering wins. 0 = no change; 1 = those fully off at the wall.' },
  { key: 'school',           label: 'School',     min: 0,       max: 1,      floor: 0,       ceil: 1,     step: 0.02,    coarse: 0.1,     decimals: 2,
    desc: 'Overall schooling tendency — scales Alignment + Cohesion together. 0 = solitary loners, 1 = strong schoolers.' },
  { key: 'turnRateMax',      label: 'Turn rate',  min: 0.5,     max: 5,      floor: 0.1,     ceil: 12,    step: 0.1,     coarse: 0.5,     decimals: 1,
    desc: 'Max rotation speed (rad/s) for the smallest fish; large fish scale down to ~1/3 of this. Hard ceiling — prevents the spin cycle at low speed. Higher = snappier turns.' },
  // Turn arc is a per-creature shape attribute (spline.maxBend, Shape editor) —
  // the global Arc (sm)/(lg) sliders were retired in E13-4. maxForce remains a
  // fixed internal constant (tuning.forceMax) capping all steering behaviors.
  { key: 'speedMax',         label: 'Max speed',  min: 0.005,   max: 0.08,   floor: 0.002,   ceil: 0.2,   step: 0.001,   coarse: 0.005,   decimals: 3,
    desc: 'Top swimming speed cap (logical px/ms). Higher = faster fish overall.' },
  { key: 'separationDist',   label: 'Sep dist',   min: 0,       max: 40,     floor: 0,       ceil: 120,   step: 1,       coarse: 5,       decimals: 0,
    desc: 'Distance (px) at which fish start pushing apart. Larger = more spacing held between fish.' },
  { key: 'perceptionRadius', label: 'Perception', min: 0,       max: 80,     floor: 0,       ceil: 200,   step: 1,       coarse: 5,       decimals: 0,
    desc: 'How far (px) a fish senses others for alignment/cohesion. Larger = bigger, looser schools that react over distance.' },

  // ── The medium ───────────────────────────────────────────────────────────────
  { key: 'drag',             label: 'Water drag', min: 0.9,     max: 1,      floor: 0.5,     ceil: 1,     step: 0.005,   coarse: 0.02,    decimals: 3,
    desc: 'The water itself: how much of its speed this species keeps per second of pure coasting. Always on — bursting or coasting alike. 1.0 = frictionless water (default); lower = momentum bleeds off faster, so coasts die out sooner and swimming feels heavier.' },

  // ── Burst-and-coast (cruise throttle) ────────────────────────────────────────
  { key: 'coastThrottle',    label: 'Coast throttle', min: 0,   max: 0.5,    floor: 0,       ceil: 1,     step: 0.01,    coarse: 0.05,    decimals: 2,
    desc: 'The speed a fish tries to hold while coasting between bursts, as a fraction of top speed (each coast re-rolls a target up to this). 0 = it stops propelling entirely and slows to a drift; higher = it keeps gently swimming through every coast.' },
  { key: 'glideMsMax',       label: 'Glide time', min: 500,     max: 5000,   floor: 100,     ceil: 12000, step: 100,     coarse: 250,     decimals: 0,
    desc: 'Longest a coast/glide lasts (ms); each glide is a random draw up to this. Higher = longer, lazier drifts between bursts.' },
  { key: 'burstMsMax',       label: 'Burst time', min: 200,     max: 3000,   floor: 50,      ceil: 4000,  step: 50,      coarse: 100,     decimals: 0,
    desc: 'Longest a propulsion burst lasts (ms); each burst is a random draw up to this. Higher = stronger, longer accelerations.' },
];

// Legacy `koipond.tuning` blobs (pre-E14-1) stored these as class-static names.
// Load-time mapping: old key → species.tuning key. GLIDE_DRAG maps onto the
// always-on drag — same number, honest semantics (it now applies during bursts
// too; it defaulted to 1.0 = no drag, so almost every persisted user is unchanged).
export const LEGACY_PARAM_KEYS = {
  separation:       'SEPARATION_WEIGHT',
  alignment:        'ALIGNMENT_WEIGHT',
  cohesion:         'COHESION_WEIGHT',
  wander:           'WANDER_WEIGHT',
  edge:             'EDGE_WEIGHT',
  edgeYield:        'EDGE_YIELD',
  school:           'SCHOOL_WEIGHT',
  turnRateMax:      'TURN_RATE_MAX',
  speedMax:         'SPEED_MAX',
  separationDist:   'SEPARATION_DIST',
  perceptionRadius: 'PERCEPTION_RADIUS',
  drag:             'GLIDE_DRAG',
  coastThrottle:    'CRUISE_GLIDE_MAX',
  glideMsMax:       'GLIDE_MS_MAX',
  burstMsMax:       'BURST_MS_MAX',
};

/** Fresh { key: {min, max} } map of each param's default (initial) slider range. */
export function defaultRanges() {
  const r = {};
  for (const p of MOVEMENT_PARAMS) r[p.key] = { min: p.min, max: p.max };
  return r;
}

const LS_KEY = 'koipond.tuning';

/** Snapshot current slider-exposed values from a species record's tuning block. */
export function snapshot(species) {
  const out = {};
  for (const p of MOVEMENT_PARAMS) out[p.key] = species.tuning[p.key];
  return out;
}

/** Apply a values object (key→number) onto a species record's tuning block. */
export function applyValues(species, values) {
  if (!values) return;
  for (const p of MOVEMENT_PARAMS) {
    if (Number.isFinite(values[p.key])) species.tuning[p.key] = values[p.key];
  }
}

/** Apply a LEGACY params blob (class-static names) onto a species record. */
export function applyLegacyValues(species, params) {
  if (!params) return;
  for (const p of MOVEMENT_PARAMS) {
    const legacy = params[LEGACY_PARAM_KEYS[p.key]];
    if (Number.isFinite(legacy)) species.tuning[p.key] = legacy;
  }
}

/** Load persisted tuning blob from localStorage, or null. */
export function loadPersisted() {
  try { return JSON.parse(localStorage.getItem(LS_KEY)) || null; }
  catch { return null; }
}

/** Persist tuning state. */
export function savePersisted(state) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(state)); } catch { /* ignore */ }
}
