// src/movement/move-styles.js
// Move styles + the style arbiter (E14-3). Replaces the single hard-coded `swim`
// state (states.js, retired) with data-defined locomotion styles, each owning a
// GAIT LOOP (an N-phase generalization of the old burst-and-coast throttle) plus
// wag curves and steering-weight multipliers. A per-species PRIORITY LIST of
// styles + triggers decides which style a fish is in each frame.
//
// A style is (mostly) data so species can be authored/imported without code:
//   - gait.phases[i].throttle / .ms are LITERAL numbers OR tuning-key strings
//     (e.g. 'burstMin') resolved against species.tuning — so the 'burst' style's
//     numbers stay wired to the Movement-panel sliders while 'flow' uses its own.
//   - steering multipliers scale the base per-species behavior weights.
// See docs/epics/E14/architecture.md §3.2, §4.3.

import { EDGE_MARGIN } from './behaviors.js';

// Resolve a literal-or-tuning-key gait value.
const res = (v, tuning) => (typeof v === 'string' ? tuning[v] : v);

// ─── Triggers ─────────────────────────────────────────────────────────────────
// (fish, ctx, params) → bool. Referenced by id from species.styles entries.
export const TRIGGERS = {
  always:        () => true,
  attract:       (fish, ctx) => !!ctx.attractPoint,
  neighborCount: (fish, ctx, p) => (fish._neighborCount ?? 0) >= (p?.min ?? 3),
  // Feed etiquette (E14-5): a pellet is perceived AND fewer than 2 neighbors are
  // hungrier (smaller eat-cooldown). fish._foodInfo is precomputed each frame by
  // FishBase._perceiveFood — 0 hungrier rivals → this fish eats, 1 → it face-only
  // defers, ≥2 → the trigger fails so the arbiter routes it to a normal swim style
  // (it "ignores" the food). See architecture §4.4.
  foodReady:     (fish) => { const fi = fish._foodInfo; return !!fi && fi.smaller < 2; },
  // Inspect (E14-5): a near-stationary neighbor is within perception — approach + face.
  slowEntityNearby: (fish, ctx, p) => {
    const maxFrac = p?.maxFrac ?? 0.12;
    const ns = ctx.neighbors;
    for (let i = 0; i < ns.length; i++) {
      const o = ns[i];
      if (o === fish) continue;
      if (Math.hypot(o.vx || 0, o.vy || 0) < maxFrac * (o.maxSpeed || 1)) return true;
    }
    return false;
  },
};

// ─── Builtin styles ─────────────────────────────────────────────────────────
export const MOVE_STYLES = {
  // Today's burst-and-coast, expressed as data. Its gait numbers read from
  // species.tuning, so the Movement sliders (Coast throttle / Burst time /
  // Glide time / Max speed) still drive it exactly as before.
  burst: {
    id: 'burst', name: 'Burst',
    gait: {
      easeMs: 'throttleEaseMs',
      phases: [
        { name: 'burst', throttle: ['burstMin', 1.0],               ms: ['burstMsMin', 'burstMsMax'] },
        { name: 'coast', throttle: ['coastMin', 'coastThrottle'],   ms: ['glideMsMin', 'glideMsMax'] },
      ],
    },
    // Floors 0 → wag frequency/amplitude ride the throttle exactly (old behavior).
    wag: { freqFloor: 0.0, ampFloor: 0.0 },
    steering: null,
    minMs: 0,
  },
  // A gentler default: the fish keeps moving within a mid speed band with low,
  // lazy tail-beats, never fully stopping. Its wag floors keep a coasting fish
  // visibly alive (the raw-notes "flowing" observation).
  flow: {
    id: 'flow', name: 'Flowing',
    gait: {
      easeMs: 450,
      phases: [
        { name: 'press', throttle: [0.34, 0.58], ms: [1000, 2400] },
        { name: 'coast', throttle: [0.14, 0.30], ms: [1400, 3800] },
      ],
    },
    wag: { freqFloor: 0.42, ampFloor: 0.22 },
    steering: { wander: 1.15 },   // a touch more idle roam
    minMs: 1200,                  // hold flow ≥1.2s before falling back to it (anti-flap)
  },
  // Feeding (E14-5): approach a perceived pellet and eat it, or (if exactly one
  // hungrier rival is present) hold and face it (the omni face-only showcase). The
  // approach seek + eat + face-only intent live in FishBase._actuateFeed; this
  // record supplies the gait/wag/weights. Social weights are muted so a feeding
  // fish commits to the food, not the school.
  feed: {
    id: 'feed', name: 'Feeding',
    gait: {
      easeMs: 250,
      phases: [
        { name: 'approach', throttle: [0.40, 0.70], ms: [400, 1200] },
        { name: 'hold',     throttle: [0.0,  0.20], ms: [500, 1500] },
      ],
    },
    wag: { freqFloor: 0.30, ampFloor: 0.20 },
    steering: { separation: 1.2, alignment: 0, cohesion: 0, wander: 0 },
    minMs: 400,
  },
  // Inspecting (E14-5): approach a near-stationary neighbor to a standoff, then
  // face it (shared maneuvering base with feed). Present in koi's list but DISABLED
  // by default — a showcase style the user can enable. Logic: _actuateInspect.
  inspect: {
    id: 'inspect', name: 'Inspecting',
    gait: {
      easeMs: 250,
      phases: [
        { name: 'approach', throttle: [0.30, 0.50], ms: [500, 1200] },
        { name: 'hold',     throttle: [0.0,  0.15], ms: [600, 1600] },
      ],
    },
    wag: { freqFloor: 0.30, ampFloor: 0.20 },
    steering: { alignment: 0, cohesion: 0, wander: 0 },
    minMs: 900,
  },
  // Schooling (E14-5): the dense-shoal gait — heavy alignment + cohesion so a crowd
  // coheres. The multipliers are large because koi are weak schoolers by species
  // tuning (school 0.14); the style is where a tight shoal comes from. Tuned to
  // stay coherent at n = 100+ without chugging (E14-2 perf).
  school: {
    id: 'school', name: 'Schooling',
    gait: {
      easeMs: 300,
      phases: [
        { name: 'press', throttle: [0.40, 0.65], ms: [1000, 2400] },
        { name: 'coast', throttle: [0.15, 0.30], ms: [1000, 3000] },
      ],
    },
    wag: { freqFloor: 0.40, ampFloor: 0.20 },
    steering: { separation: 1.0, alignment: 5.0, cohesion: 3.5, wander: 0.3 },
    minMs: 1800,
  },
};

export function getStyle(id) { return MOVE_STYLES[id] ?? MOVE_STYLES.flow; }

/** The default (lowest-priority) style id from a species' priority list. */
export function defaultStyleId(species) {
  const list = species.styles;
  return (Array.isArray(list) && list.length) ? list[list.length - 1].styleId : 'flow';
}

// ─── Arbiter ──────────────────────────────────────────────────────────────────
// Walk the species' style list top-down; the first entry whose trigger passes is
// the desired style. Switching is asymmetric: a HIGHER-priority style (earlier in
// the list — e.g. attract/feed) preempts immediately, but FALLING BACK to a
// lower-priority style waits out the current style's minMs so idle↔flow doesn't
// flicker. Mutates fish._styleId / _styleMs and resets the gait on a switch.
export function pickStyle(fish, ctx, deltaMs) {
  const styles = fish.species.styles;
  if (!Array.isArray(styles) || !styles.length) return getStyle('flow');

  let desiredIdx = styles.length - 1;
  for (let i = 0; i < styles.length; i++) {
    const trig = TRIGGERS[styles[i].trigger] ?? TRIGGERS.always;
    if (trig(fish, ctx, styles[i].params)) { desiredIdx = i; break; }
  }
  const desiredId = styles[desiredIdx].styleId;

  fish._styleMs += deltaMs;
  if (desiredId !== fish._styleId) {
    const curIdx = styles.findIndex((s) => s.styleId === fish._styleId);
    const higherPriority = curIdx < 0 || desiredIdx < curIdx;
    const cur = getStyle(fish._styleId);
    if (higherPriority || fish._styleMs >= (cur.minMs ?? 0)) {
      fish._styleId  = desiredId;
      fish._styleMs  = 0;
      fish._phaseIdx = -1;   // force a fresh gait phase sample on entry
      fish._thrHold  = 0;
    }
  }
  return getStyle(fish._styleId);
}

// ─── Gait step ──────────────────────────────────────────────────────────────
// Advance the active style's gait loop: hold the current phase for a randomized
// duration, then cycle to the next phase and re-sample its throttle target + hold
// from the phase's ranges. The live throttle eases toward the target. Every fish
// rolls its own values, so none breathe in lockstep. Mutates fish throttle state.
export function stepGait(fish, style, deltaMs) {
  const t = fish.species.tuning;
  const phases = style.gait.phases;
  fish._thrHold -= deltaMs;
  if (fish._phaseIdx < 0 || fish._thrHold <= 0) {
    fish._phaseIdx = fish._phaseIdx < 0 ? 0 : (fish._phaseIdx + 1) % phases.length;
    const ph = phases[fish._phaseIdx];
    const lo = res(ph.throttle[0], t), hi = res(ph.throttle[1], t);
    const msLo = res(ph.ms[0], t), msHi = res(ph.ms[1], t);
    fish._thrTarget = lo + Math.random() * (hi - lo);
    fish._thrHold   = msLo + Math.random() * (msHi - msLo);
    fish._phaseName = ph.name;
  }
  const k = 1 - Math.exp(-deltaMs / Math.max(1, res(style.gait.easeMs, t)));
  fish._throttle += (fish._thrTarget - fish._throttle) * k;
}

// ─── Edge arbitration (moved from states.js) ─────────────────────────────────
// 0 outside the wall band → 1 at the wall, using the same band the `edges`
// behavior + debug overlay use.
function edgeFactor(fish, bounds) {
  const m = Math.max(EDGE_MARGIN, fish.half + 2);
  const d = Math.min(fish.x, bounds.width - fish.x, fish.y, bounds.height - fish.y);
  if (d >= m) return 0;
  return Math.min(1, (m - d) / m);
}

// ─── Steering weights ─────────────────────────────────────────────────────────
// Base per-species behavior weights, edge-yielded and school-scaled (the old
// `swim` state logic), then multiplied by the active style's `steering` map.
export function styleWeights(fish, ctx, style) {
  const t = fish.species.tuning;
  const school = t.school;
  const ef = (ctx && ctx.bounds) ? edgeFactor(fish, ctx.bounds) : 0;
  const yield_ = 1 - ef * t.edgeYield;
  const attractW = ctx.attractPoint ? (t.attract ?? 3.0) : 0;
  const m = style.steering || {};
  return {
    separation: t.separation * (m.separation ?? 1),
    alignment:  t.alignment * school * yield_ * (m.alignment ?? 1),
    cohesion:   t.cohesion  * school * yield_ * (m.cohesion ?? 1),
    // Suppress wander while attracted — attract replaces it as the directional goal.
    wander:     attractW ? 0 : t.wander * yield_ * (m.wander ?? 1),
    edges:      t.edge * (m.edges ?? 1),
    attract:    attractW,
  };
}
