// src/movement/behaviors.js
// Steering-behavior registry. Every behavior is a pure-ish function
//   (fish, ctx) => Vec2   returning a steering FORCE (logical px/ms²).
// Behaviors never touch fish.vx/vy directly — they only return forces, which the
// fish's update() composer sums (weighted) into acceleration. Add new catalog or
// custom behaviors here; states.js decides which are active and at what weight.
//
// ctx = { neighbors: FishBase[], bounds: {width, height}, dt: ms }
// Each fish exposes: x, y, vx, vy, heading, maxSpeed, maxForce, length,
//                    _wanderTheta, and constructor statics.
//
// See docs/boids-movement-reference.md for the math and the full catalog.

import { Vec2 } from './vec2.js';

const WANDER_RATE = 0.018;   // rad per ms — how fast the wander angle drifts
// Exported so the debug overlay can draw the wall-avoidance zone accurately.
export const EDGE_MARGIN = 14;      // logical px from a wall where steer-away kicks in

// ─── Shared steering primitives ───────────────────────────────────────────────

// Steer the fish so its velocity heads in (dirX, dirY): desired = dir*maxSpeed,
// force = desired - velocity, truncated to maxForce. The basis of every behavior.
function steer(fish, dirX, dirY) {
  const v = new Vec2(dirX, dirY);
  if (v.mag() < 1e-9) return new Vec2(0, 0);
  v.setMag(fish.maxSpeed);
  v.x -= fish.vx;
  v.y -= fish.vy;
  return v.limit(fish.maxForce);
}

// Steer toward a point (Reynolds "seek").
function seek(fish, tx, ty) { return steer(fish, tx - fish.x, ty - fish.y); }

// ─── The behavior registry ────────────────────────────────────────────────────

export const BEHAVIORS = {
  // Steer away from crowding. Inverse-distance weighted so closer neighbors push
  // harder. Uses the small SEPARATION_DIST radius (neighbors come pre-filtered to
  // PERCEPTION_RADIUS by the Simulation).
  separation(fish, ctx) {
    const sepDist = fish.constructor.SEPARATION_DIST;
    let sx = 0, sy = 0, count = 0;
    for (const o of ctx.neighbors) {
      const dx = fish.x - o.x, dy = fish.y - o.y;
      const d = Math.hypot(dx, dy);
      if (d > 0 && d < sepDist) {
        sx += (dx / d) / d;   // unit away vector, weighted by 1/distance
        sy += (dy / d) / d;
        count++;
      }
    }
    if (count === 0) return new Vec2(0, 0);
    return steer(fish, sx, sy);
  },

  // Match the average heading of neighbors (within perception radius).
  alignment(fish, ctx) {
    let vx = 0, vy = 0, count = 0;
    for (const o of ctx.neighbors) { vx += o.vx; vy += o.vy; count++; }
    if (count === 0) return new Vec2(0, 0);
    return steer(fish, vx, vy);   // steer toward the averaged velocity direction
  },

  // Steer toward the average position (center of mass) of neighbors.
  cohesion(fish, ctx) {
    let cx = 0, cy = 0, count = 0;
    for (const o of ctx.neighbors) { cx += o.x; cy += o.y; count++; }
    if (count === 0) return new Vec2(0, 0);
    return seek(fish, cx / count, cy / count);
  },

  // Smooth random walk: a target on a circle projected ahead of the fish, whose
  // angle drifts only slightly each frame → meandering, not twitchy. Keeps lone
  // fish (no neighbors) in natural motion. Mutates fish._wanderTheta.
  wander(fish, ctx) {
    fish._wanderTheta += (Math.random() * 2 - 1) * WANDER_RATE * ctx.dt;

    const sp = Math.hypot(fish.vx, fish.vy);
    const hx = sp > 1e-6 ? fish.vx / sp : Math.cos(fish.heading);
    const hy = sp > 1e-6 ? fish.vy / sp : Math.sin(fish.heading);

    const dist   = fish.length * 1.2;   // circle center this far ahead
    const radius = fish.length * 0.6;   // wander circle radius
    const cx = fish.x + hx * dist;
    const cy = fish.y + hy * dist;

    const heading = Math.atan2(hy, hx);
    const tx = cx + Math.cos(fish._wanderTheta + heading) * radius;
    const ty = cy + Math.sin(fish._wanderTheta + heading) * radius;
    return seek(fish, tx, ty);
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
    if (!hit) return new Vec2(0, 0);
    // Preserve the un-breached axis' current motion so the turn is an arc, not a stop.
    return steer(fish, dx !== 0 ? dx : fish.vx, dy !== 0 ? dy : fish.vy);
  },
};
