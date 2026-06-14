// src/movement/states.js
// Fish movement state machine. A state is a named bundle of:
//   - behaviors(fish, ctx) → { behaviorName: weight }   (which forces are active, how strong)
//   - update(fish, ctx) → nextStateName | null           (transition logic; null = stay)
// The fish's update() composer sums weight * BEHAVIORS[name](fish, ctx) for the
// active state. This is the reborn _moveState machine: adding a state (socialize,
// feed, orbit, regard…) means registering one here + its behaviors — no changes to
// the core loop. See docs/boids-movement-reference.md §10 for the backlog mapping.
//
// Currently only the baseline `swim` state exists (the 5 ambient behaviors). The
// machine is fully first-class so triggered states slot in later.

import { EDGE_MARGIN } from './behaviors.js';

// Edge arbitration helper: 0 when the fish is outside the wall-avoidance band,
// ramping smoothly to 1 at the wall. Uses the SAME band the `edges` behavior and
// the debug "Edge margin" overlay use, so it triggers exactly when the visible
// edge line is crossed.
function edgeFactor(fish, bounds) {
  const m = Math.max(EDGE_MARGIN, fish.half + 2);
  const d = Math.min(fish.x, bounds.width - fish.x, fish.y, bounds.height - fish.y);
  if (d >= m) return 0;
  return Math.min(1, (m - d) / m);
}

export const STATES = {
  swim: {
    name: 'swim',
    // SCHOOL_WEIGHT scales the social trio (alignment/cohesion) so a solitary fish
    // (SCHOOL_WEIGHT 0) still avoids collisions and wanders, but never flocks.
    // Separation is left unscaled — fish always avoid bumping.
    behaviors(fish, ctx) {
      const c = fish.constructor;
      const school = c.SCHOOL_WEIGHT;

      // Edge yielding: once inside the wall band, fade the behaviors that fight
      // containment (wander + the social trio) so edge steering can turn the fish
      // cleanly without competition. Ramps with depth into the band → organic, and
      // avoids raising EDGE_WEIGHT globally (which looks jarring away from walls).
      // Separation + edges keep full authority.
      const ef    = (ctx && ctx.bounds) ? edgeFactor(fish, ctx.bounds) : 0;
      const yield_ = 1 - ef * c.EDGE_YIELD;
      const attractW = ctx.attractPoint ? (c.ATTRACT_WEIGHT ?? 3.0) : 0;

      return {
        separation: c.SEPARATION_WEIGHT,
        alignment:  c.ALIGNMENT_WEIGHT * school * yield_,
        cohesion:   c.COHESION_WEIGHT  * school * yield_,
        // Suppress wander while attracted — attract replaces it as the directional goal.
        wander:     attractW ? 0 : c.WANDER_WEIGHT * yield_,
        edges:      c.EDGE_WEIGHT,
        attract:    attractW,
      };
    },
    update() { return null; },   // baseline never transitions (scaffolding for future states)
  },
};

// Step the machine: returns the (possibly new) state name for this fish.
export function nextState(fish, ctx) {
  const state = STATES[fish.state] ?? STATES.swim;
  const next = state.update(fish, ctx);
  return next && STATES[next] ? next : (STATES[fish.state] ? fish.state : 'swim');
}
