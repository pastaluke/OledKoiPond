// src/species/species-registry.js
// Species-as-data registry (E14-1, implements E13-9's locked decision): a species
// is a plain serializable record, NOT a JS subclass. FishBase stays the single
// engine class; every movement/size/body attribute that used to be a class static
// lives on the species record and is read live each frame, so menu edits to the
// record apply to living fish instantly (same semantics the statics had).
//
// Modeled on palette-manager.js: builtin records + customs, CRUD, lookup by id.
// Persistence rides inside the existing `koipond.tuning` blob for now (menu.js
// saves `species: [...]`); the full PondConfig migration is E14 Phase 7b.
//
// Schema (v1) — see docs/epics/E14/architecture.md §3.1:
//   { schemaVersion, id, name, builtin,
//     body:   CreatureDef (CREATURE v5 — spline/motion/appendages/patterns),
//     tuning: { ...movement numbers, all live-read },
//     sizes:  { min, max, curve } }
// The omni / styles / render blocks from the architecture land in later phases
// (P3+); records without them stay valid.

import { upgradeCreature } from '../entities/fish-base.js';

// ─── Builtin koi ──────────────────────────────────────────────────────────────
// Assembled from the retired `Koi` class statics + `FishBase` defaults +
// `FishBase.CREATURE` (E13-4's authored koi shape, upgraded to CREATURE v5).

// Authored in the in-app Shape editor (Copy values → baked here). Body + a centered
// caudal fan, a mirrored pectoral pair, and a mirrored head pair.
const KOI_BODY = {
  schemaVersion: 5,
  spline: {
    headFrac:  0.7,
    tailFrac:  0.624,
    pivotT:    0.173,   // normalized tail-tip(0)→nose(1); ≈ old 0.229 length-units
    maxBend:   1.2,     // max front steering-bend magnitude (was the global ±1.2 clamp)
    bendWaist: 0.097,
    bendBody:  0.297,
    points: [   // [t, halfWidth] breakpoints (monotone-cubic interpolated)
      [0.00, 0.44],
      [0.16, 1.83],
      [0.49, 2.90],
      [0.66, 3.63],
      [0.95, 1.71],
      [1.00, 0.10],
    ],
  },
  motion: { wagAmp: 0.16, wagRate: 1, wagCurve: 1.4, wagPeaks: 1, wagFreqMul: 1 },
  appendages: [
    { kind: 'fin', anchor: 0.08, side: 0, mirror: false, angle: 0, length: 4,
      swayOnTurn: 0.05, flapOnAccel: { amp: 39 },
      profile: [[0, 0], [0.21, 0.97], [0.5, 1.71], [1, 3.02]] },
    { kind: 'fin', anchor: 0.7, side: 1, mirror: true, angle: 72, length: 5,
      swayOnTurn: 0.25, flapOnAccel: { amp: 12 },
      profile: [[0, 0.21], [0.5, 1.1], [1, 0.5]] },
    { kind: 'fin', anchor: 1, side: 1, mirror: true, angle: 30, length: 7.5,
      swayOnTurn: 0, flapOnAccel: { amp: 0 },
      profile: [[0, 0.14], [0.19, 0.37], [1, 0]] },
  ],
  patterns: { spawnMode: 'mix', active: null, variations: [] },
};

const KOI_TUNING = {
  // ── Speed / turning ──
  speedMax:    0.051,     // logical px/ms — top swimming speed cap
  turnRateMax: 2.4,       // rad/s — fastest turn (smallest fish)
  turnRateMin: 0.8,       // rad/s — slowest turn (largest fish)
  forceMax:    0.00003,   // logical px/ms² — max steering force (fixed; low → smooth arcs)

  // ── Perception / spacing ──
  perceptionRadius: 42,   // px — boids neighborhood radius (used by Simulation)
  separationDist:   20,   // px — desired minimum gap between fish

  // ── Steering-behavior weights (per-frame force composition) ──
  separation: 0.40,
  alignment:  0.35,       // effective weight = this × school
  cohesion:   0.65,       // effective weight = this × school
  wander:     0.40,
  edge:       0.80,
  edgeYield:  0.45,       // fade wander+align+cohesion inside the wall band (0..1)
  school:     0.14,       // 0 = solitary, 1 = strong schooler (scales align + cohesion)
  attract:    3.0,        // hold-to-attract seek weight

  // ── The medium (E14-1) ──
  // Per-second velocity retention, ALWAYS ON (not throttle-gated — this replaced
  // the old pond-wide GLIDE_DRAG). 1.0 = frictionless (today's exact behavior);
  // 0.9–1.0 is the useful range.
  drag: 1.0,

  // ── Burst-and-coast gait (single style until P3 turns these into gait records) ──
  coastMin:       0.0,    // coast throttle floor (fraction of maxSpeed)
  coastThrottle:  0.19,   // coast throttle ceiling — re-sampled per coast ("Coast throttle")
  burstMin:       0.85,   // burst throttle ∈ [this, 1.0] — re-sampled per burst
  glideMsMin:     700,    // coast duration range, ms
  glideMsMax:     3900,
  burstMsMin:     250,    // burst duration range, ms
  burstMsMax:     2600,
  throttleEaseMs: 300,    // smoothing time-constant easing throttle toward target
  swimBeatRate:   0.012,  // tail-beat rate (rad/ms) at full speed
};

// Move-style priority list (E14-3): the arbiter walks this top-down; the first
// entry whose trigger passes is the active style, and the LAST entry is the idle
// default. Koi burst toward a held attract point, otherwise flow.
const KOI_STYLES = [
  { styleId: 'burst',  trigger: 'attract' },                        // burst toward a held pointer
  { styleId: 'feed',   trigger: 'foodReady' },                      // eat-cooldown etiquette (E14-5)
  { styleId: 'school', trigger: 'neighborCount', params: { min: 4 } }, // dense shoal (E14-5)
  { styleId: 'flow',   trigger: 'always' },                         // idle default
];
// `inspect` (E14-5) exists in the MOVE_STYLES registry but is intentionally NOT in
// koi's default list — it's a showcase style a pond can add without destabilizing
// the calm default. Add { styleId:'inspect', trigger:'slowEntityNearby' } to enable.

// Omni low-speed maneuvering regime (E14-4, architecture §3.1/§4.2). Below the
// speed band [lo, hi] (fraction of speedMax) the fish decouples heading from
// velocity and thrusts in its body frame like an RCS — rotate in place, sidestep,
// back up — instead of steering like a boat. finTurnRate is the in-place yaw rate;
// finThrust caps body-frame authority (reverse/lateral weaker than forward).
const KOI_OMNI = {
  lo: 0.05, hi: 0.18,
  finTurnRate: 6.0,
  finThrust: { forward: 1.0, reverse: 0.35, lateral: 0.55 },
};

const BUILTIN_SPECIES = [
  {
    schemaVersion: 1,
    id: 'koi', name: 'Koi', builtin: true,
    body:   KOI_BODY,
    tuning: KOI_TUNING,
    omni:   KOI_OMNI,
    styles: KOI_STYLES,
    sizes:  { min: 12, max: 22, curve: 'normal' },   // most koi mid-sized; extremes rare
    // Render prefs (E14-9, data only for now): which shader this species draws
    // with. 'vanilla' = the flat-color cell renderer; E11-1/E11-4 add consumers
    // (per-species GPU shader via the compositor batch-mask path).
    render: { shaderId: 'vanilla' },
  },
];

// ─── Registry ─────────────────────────────────────────────────────────────────
// Live records: deep clones of the builtins (menu/persistence mutate them freely;
// the pristine literals above stay untouched for Reset).

const _clone = (o) => JSON.parse(JSON.stringify(o));

let _registry = BUILTIN_SPECIES.map(_clone);
const _builtinIds = new Set(BUILTIN_SPECIES.map((s) => s.id));

export function isBuiltinSpecies(id) { return _builtinIds.has(id); }
export function getAllSpecies() { return [..._registry]; }

/** The live record for `id` (the same object every caller shares — mutations are
 *  visible to every living fish immediately). */
export function getSpecies(id) {
  return _registry.find((s) => s.id === id) ?? _registry[0];
}

/** Pristine deep clone of a builtin's code defaults (for Reset buttons). */
export function getSpeciesDefaults(id) {
  const s = BUILTIN_SPECIES.find((b) => b.id === id);
  return s ? _clone(s) : null;
}

export function addCustomSpecies(record) {
  _registry = [..._registry.filter((s) => s.id !== record.id), record];
}

export function deleteCustomSpecies(id) {
  if (isBuiltinSpecies(id)) return;
  _registry = _registry.filter((s) => s.id !== id);
}

/** Unique registry id from a display name ('Golden Carp' → 'golden-carp', '-2'…). */
function _slugId(name) {
  const base = String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'creature';
  let id = base, n = 2;
  while (_registry.some((s) => s.id === id)) id = `${base}-${n++}`;
  return id;
}

/** Clone the live `sourceId` record into a NEW custom species named `name`
 *  (fresh id, builtin:false), register it, and return the live record.
 *  This is the menu's Duplicate/Save-as action (E14-9). */
export function createSpeciesFrom(sourceId, name) {
  const src = getSpecies(sourceId);
  const rec = _clone(src);
  rec.id = _slugId(name);
  rec.name = String(name);
  rec.builtin = false;
  addCustomSpecies(rec);
  return getSpecies(rec.id);
}

// ─── Load boundary ────────────────────────────────────────────────────────────
/** Validate + upgrade a stored species record (clone; never mutates the caller's
 *  blob). Unknown/missing fields are backfilled from the builtin of the same id
 *  (or koi), so partial blobs load safely. Returns null if unrecognizable. */
export function upgradeSpecies(raw) {
  if (!raw || typeof raw !== 'object' || typeof raw.id !== 'string') return null;
  const base = getSpeciesDefaults(raw.id) ?? getSpeciesDefaults('koi');
  const c = _clone(raw);
  const body = upgradeCreature(c.body);
  return {
    schemaVersion: 1,
    id: c.id,
    name: typeof c.name === 'string' ? c.name : base.name,
    builtin: isBuiltinSpecies(c.id),
    body: body ?? base.body,
    tuning: { ...base.tuning, ...(typeof c.tuning === 'object' && c.tuning !== null ? _numericOnly(c.tuning) : {}) },
    // Omni maneuvering block (E14-4): deep-merge numeric fields over the builtin
    // defaults so blobs predating omni (or with partial blocks) load intact.
    omni: _mergeOmni(base.omni, c.omni),
    // Move-style priority list (E14-3). Keep a valid stored list, else the builtin's.
    styles: (Array.isArray(c.styles) && c.styles.every((s) => s && typeof s.styleId === 'string'))
      ? c.styles : _clone(base.styles),
    sizes: {
      min:   Number.isFinite(c.sizes?.min) ? c.sizes.min : base.sizes.min,
      max:   Number.isFinite(c.sizes?.max) ? c.sizes.max : base.sizes.max,
      curve: c.sizes?.curve ?? base.sizes.curve,
    },
    // Render prefs (E14-9): shaderId slot, backfilled for pre-E14-9 blobs.
    render: {
      shaderId: typeof c.render?.shaderId === 'string' ? c.render.shaderId
              : (base.render?.shaderId ?? 'vanilla'),
    },
  };
}

function _numericOnly(obj) {
  const out = {};
  for (const k in obj) if (Number.isFinite(obj[k])) out[k] = obj[k];
  return out;
}

/** Deep-merge a persisted omni block over the builtin defaults (numeric-only). */
function _mergeOmni(base, raw) {
  const b = base ?? { lo: 0.05, hi: 0.18, finTurnRate: 6.0, finThrust: { forward: 1.0, reverse: 0.35, lateral: 0.55 } };
  const o = _clone(b);
  if (raw && typeof raw === 'object') {
    if (Number.isFinite(raw.lo)) o.lo = raw.lo;
    if (Number.isFinite(raw.hi)) o.hi = raw.hi;
    if (Number.isFinite(raw.finTurnRate)) o.finTurnRate = raw.finTurnRate;
    if (raw.finThrust && typeof raw.finThrust === 'object') {
      for (const k of ['forward', 'reverse', 'lateral']) {
        if (Number.isFinite(raw.finThrust[k])) o.finThrust[k] = raw.finThrust[k];
      }
    }
  }
  return o;
}

/** Replace the live record's contents for `upgraded.id` in place (same object
 *  identity, so fish/menu references stay valid), or REGISTER it if the id is
 *  unknown — persisted custom species must not fall through getSpecies()'s
 *  koi fallback and clobber the builtin (E14-9 fix). Returns the live record. */
export function applySpeciesRecord(upgraded) {
  const existing = _registry.find((s) => s.id === upgraded.id);
  if (!existing) {
    addCustomSpecies(upgraded);
    return getSpecies(upgraded.id);
  }
  existing.body   = upgraded.body;
  existing.tuning = upgraded.tuning;
  existing.omni   = upgraded.omni;
  existing.styles = upgraded.styles;
  existing.sizes  = upgraded.sizes;
  existing.name   = upgraded.name;
  existing.render = upgraded.render;
  return existing;
}
