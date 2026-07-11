// src/movement/behaviors.js
// Steering-behavior registry. Every behavior is a pure-ish function
//   (fish, ctx) => {x, y}   returning a steering FORCE (logical px/ms²).
// Behaviors never touch fish.vx/vy directly — they only return forces, which the
// fish's update() composer sums (weighted) into acceleration. Add new catalog or
// custom behaviors here; states.js decides which are active and at what weight.
//
// ZERO-ALLOC CONTRACT (E14-2): every behavior returns the same shared scratch
// object `F`, valid only until the next behavior call. The composer in
// fish.update() reads f.x/f.y immediately, so nothing may retain the result.
//
// ctx = { neighbors: FishBase[], bounds: {width, height}, dt: ms }
// Each fish exposes: x, y, vx, vy, heading, maxSpeed, maxForce, length,
//                    _wanderTheta, and its live species record (fish.species).
//
// See docs/boids-movement-reference.md for the math and the full catalog.

// How quickly the wander rotation rate can accelerate (fraction of maxOmega per ms).
// Smaller → smoother direction changes; larger → more twitchy. ~0.004 gives ~1-2s meanders.
const WANDER_ACCEL = 0.004;
// Exported so the debug overlay can draw the wall-avoidance zone accurately.
export const EDGE_MARGIN = 14;      // logical px from a wall where steer-away kicks in

// The shared force scratch — see ZERO-ALLOC CONTRACT above.
const F = { x: 0, y: 0 };
function zero() { F.x = 0; F.y = 0; return F; }

// ─── Shared steering primitives ───────────────────────────────────────────────

// Steer the fish so its velocity heads in (dirX, dirY): desired = dir*targetSpeed,
// force = desired - velocity, truncated to maxForce. The basis of every behavior.
// targetSpeed defaults to full maxSpeed; the propulsive (cruise) behaviors pass the
// throttled fish.cruiseSpeed instead, so at low throttle `desired - velocity` becomes a
// decelerating force (Reynolds "Arrive") and the fish coasts down. Safety behaviors
// (separation/edges) keep the full-maxSpeed default. Writes into F.
function steer(fish, dirX, dirY, targetSpeed = fish.maxSpeed) {
  const mag = Math.sqrt(dirX * dirX + dirY * dirY);
  if (mag < 1e-9) return zero();
  const s = targetSpeed / mag;
  let fx = dirX * s - fish.vx;
  let fy = dirY * s - fish.vy;
  const fmag = Math.sqrt(fx * fx + fy * fy);
  const maxF = fish.maxForce;
  if (fmag > maxF) { const k = maxF / fmag; fx *= k; fy *= k; }
  F.x = fx; F.y = fy;
  return F;
}

// Steer toward a point (Reynolds "seek").
function seek(fish, tx, ty, targetSpeed) { return steer(fish, tx - fish.x, ty - fish.y, targetSpeed); }

// ─── The behavior registry ────────────────────────────────────────────────────

export const BEHAVIORS = {
  // Steer away from crowding. Inverse-distance weighted so closer neighbors push
  // harder. Uses the small separationDist radius (neighbors come pre-filtered to
  // perceptionRadius by the Simulation).
  separation(fish, ctx) {
    const sepDist = fish.species.tuning.separationDist;
    let sx = 0, sy = 0, count = 0;
    const neighbors = ctx.neighbors;
    for (let i = 0; i < neighbors.length; i++) {
      const o = neighbors[i];
      const dx = fish.x - o.x, dy = fish.y - o.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d > 0 && d < sepDist) {
        sx += (dx / d) / d;   // unit away vector, weighted by 1/distance
        sy += (dy / d) / d;
        count++;
      }
    }
    if (count === 0) return zero();
    return steer(fish, sx, sy);
  },

  // Match the average heading of neighbors (within perception radius).
  // Uses max(cruiseSpeed, currentSpeed) so alignment never brakes — only redirects.
  alignment(fish, ctx) {
    let vx = 0, vy = 0, count = 0;
    const neighbors = ctx.neighbors;
    for (let i = 0; i < neighbors.length; i++) { vx += neighbors[i].vx; vy += neighbors[i].vy; count++; }
    if (count === 0) return zero();
    const sp = Math.sqrt(fish.vx * fish.vx + fish.vy * fish.vy);
    return steer(fish, vx, vy, Math.max(fish.cruiseSpeed, sp));
  },

  // Steer toward the average position (center of mass) of neighbors.
  // Uses max(cruiseSpeed, currentSpeed) so cohesion never brakes — only redirects.
  cohesion(fish, ctx) {
    let cx = 0, cy = 0, count = 0;
    const neighbors = ctx.neighbors;
    for (let i = 0; i < neighbors.length; i++) { cx += neighbors[i].x; cy += neighbors[i].y; count++; }
    if (count === 0) return zero();
    const sp = Math.sqrt(fish.vx * fish.vx + fish.vy * fish.vy);
    return seek(fish, cx / count, cy / count, Math.max(fish.cruiseSpeed, sp));
  },

  // Smooth random walk: a target on a circle projected ahead of the fish. The
  // rotation rate (_wanderOmega) evolves gradually — bounded by the fish's actual
  // turn geometry — so the target meanders rather than jumping each frame.
  // Never brakes: targetSpeed = max(cruiseSpeed, currentSpeed).
  wander(fish, ctx) {
    const dist   = fish.length * 1.2;
    const radius = fish.length * 0.6;
    // Max rotation rate the fish can actually follow given circle geometry + turn rate.
    const maxOmega = (fish.maxTurnRate / 1000) * (dist / radius);
    // Small random acceleration each frame; clamped so omega evolves smoothly.
    const nudge = (Math.random() * 2 - 1) * maxOmega * WANDER_ACCEL * ctx.dt;
    fish._wanderOmega = Math.max(-maxOmega, Math.min(maxOmega, fish._wanderOmega + nudge));
    fish._wanderTheta += fish._wanderOmega * ctx.dt;

    const sp = Math.sqrt(fish.vx * fish.vx + fish.vy * fish.vy);
    const hx = sp > 1e-6 ? fish.vx / sp : Math.cos(fish.heading);
    const hy = sp > 1e-6 ? fish.vy / sp : Math.sin(fish.heading);

    const cx = fish.x + hx * dist;
    const cy = fish.y + hy * dist;
    const heading = Math.atan2(hy, hx);
    const tx = cx + Math.cos(fish._wanderTheta + heading) * radius;
    const ty = cy + Math.sin(fish._wanderTheta + heading) * radius;
    return seek(fish, tx, ty, Math.max(fish.cruiseSpeed, sp));
  },

  // Draw fish toward a held pointer and orbit it when they arrive.
  // Two phases based on distance to ctx.attractPoint:
  //   Approach: quadratic-falloff seek force; chirality reset to 0 so next visit re-randomises.
  //   Orbit:    pick chirality ±1 once on entry, steer toward a point ~30° ahead on the circle.
  attract(fish, ctx) {
    const ap = ctx.attractPoint;
    if (!ap) return zero();
    const dx = ap.x - fish.x, dy = ap.y - fish.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const orbitRadius = fish.length * 3;

    if (dist > orbitRadius) {
      // Approach: reset chirality so next orbit entry picks a fresh direction.
      fish._orbitChirality = 0;
      // Quadratic falloff over the pond's larger dimension so distant fish feel a gentle pull.
      const falloffDist = Math.max(ctx.bounds.width, ctx.bounds.height);
      const t = Math.max(0, 1 - dist / falloffDist);
      const sp = Math.sqrt(fish.vx * fish.vx + fish.vy * fish.vy);
      const f = seek(fish, ap.x, ap.y, Math.max(fish.cruiseSpeed * 1.5, sp));
      f.x *= t * t;
      f.y *= t * t;
      return f;
    }

    // Orbit: assign chirality on first entry; steer to a lookahead point on the circle.
    if (!fish._orbitChirality) fish._orbitChirality = Math.random() < 0.5 ? 1 : -1;
    const a = Math.atan2(fish.y - ap.y, fish.x - ap.x);
    const ahead = 0.5 * fish._orbitChirality;   // ~30° ahead in chirality direction
    const tx = ap.x + Math.cos(a + ahead) * orbitRadius;
    const ty = ap.y + Math.sin(a + ahead) * orbitRadius;
    const sp = Math.sqrt(fish.vx * fish.vx + fish.vy * fish.vy);
    return seek(fish, tx, ty, Math.max(fish.cruiseSpeed, sp));
  },

  // Steer back inward when near a pond wall (Reynolds "containment"). Smooth,
  // unlike the hard position clamp that backs it up in update().
  edges(fish, ctx) {
    const m = Math.max(EDGE_MARGIN, fish.half + 2);
    const { width, height } = ctx.bounds;
    let dx = 0, dy = 0, hit = false;
    if (fish.x < m)              { dx =  fish.maxSpeed; hit = true; }
    else if (fish.x > width - m) { dx = -fish.maxSpeed; hit = true; }
    if (fish.y < m)              { dy =  fish.maxSpeed; hit = true; }
    else if (fish.y > height - m) { dy = -fish.maxSpeed; hit = true; }
    if (!hit) return zero();
    // Preserve the un-breached axis' current motion so the turn is an arc, not a stop.
    return steer(fish, dx !== 0 ? dx : fish.vx, dy !== 0 ? dy : fish.vy);
  },
};
