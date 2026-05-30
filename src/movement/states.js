// src/movement/states.js
// Fish movement state machine. A state is a named bundle of:
//   - behaviors(fish) → { behaviorName: weight }   (which forces are active, how strong)
//   - update(fish, ctx) → nextStateName | null      (transition logic; null = stay)
// The fish's update() composer sums weight * BEHAVIORS[name](fish, ctx) for the
// active state. This is the reborn _moveState machine: adding a state (socialize,
// feed, orbit, regard…) means registering one here + its behaviors — no changes to
// the core loop. See docs/boids-movement-reference.md §10 for the backlog mapping.
//
// Currently only the baseline `swim` state exists (the 5 ambient behaviors). The
// machine is fully first-class so triggered states slot in later.

export const STATES = {
  swim: {
    name: 'swim',
    // SCHOOL_WEIGHT scales the social trio (alignment/cohesion) so a solitary fish
    // (SCHOOL_WEIGHT 0) still avoids collisions and wanders, but never flocks.
    // Separation is left unscaled — fish always avoid bumping.
    behaviors(fish) {
      const c = fish.constructor;
      const school = c.SCHOOL_WEIGHT;
      return {
        separation: c.SEPARATION_WEIGHT,
        alignment:  c.ALIGNMENT_WEIGHT * school,
        cohesion:   c.COHESION_WEIGHT * school,
        wander:     c.WANDER_WEIGHT,
        edges:      c.EDGE_WEIGHT,
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
