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
