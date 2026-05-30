# Boids / Flocking Movement — Reference & Knowledge Base

A consolidated reference for building a robust, extensible boid (flocking) movement
system to model natural fish movement in OledKoiPond. Compiled from the canonical
literature and reputable open-source implementations. This document is the knowledge
base behind the planned replacement of the hand-rolled movement system in
`src/entities/fish-base.js`.

> **Why this exists:** the original movement system (wander + look-ahead wall
> avoidance + speed-ramp/LERP/turn-clamp) was built from scratch and proved hard to
> extend. Boids is the well-documented, emergent model purpose-built for schooling
> behaviour, and every behaviour reduces to "return a steering force," which makes it
> trivially extensible. See the [GDD](./GDD.md) backlog for follow-on behaviours.

---

## 1. Golden Sources

### A. Craig Reynolds — "Flocks, Herds, and Schools" (SIGGRAPH 1987)
The original boids paper. Defines flocking as three local steering rules producing
emergent group motion. Reynolds explicitly framed it as applying to **schools of fish**
as well as bird flocks, and introduced the **local neighbourhood** (a distance + a
viewing angle).
- Landing: https://www.red3d.com/cwr/boids/
- PDF: https://www.red3d.com/cwr/papers/1987/SIGGRAPH87.pdf
- License: academic paper (cite, don't copy code).

### B. Craig Reynolds — "Steering Behaviors For Autonomous Characters" (GDC 1999)
The canonical source for the **steering-force model**: `steering = desired − velocity`,
force/speed truncation, the simple-vehicle integration loop, and a catalogue of
composable behaviours (seek, flee, arrive, pursue, wander, separation, alignment,
cohesion). **This is the architecture we follow.**
- URL: https://www.red3d.com/cwr/steer/gdc99/index.html
- Index: https://www.red3d.com/cwr/steer/

### C. Daniel Shiffman — *The Nature of Code*, Ch. 5 "Autonomous Agents"
Cleanest, best-explained code reference. Builds from a single `Vehicle`
(`position`/`velocity`/`acceleration`, `applyForce`, `update`), through `seek`, to a
full `separate`/`align`/`cohesion` flock with weighted force composition and edge
handling. p5.js, but trivially framework-agnostic.
- URL: https://natureofcode.com/autonomous-agents/
- License: text CC BY-NC; code examples MIT.

### D. Open-source implementations
| Repo | Notes | License |
|------|-------|---------|
| [hughsk/boids](https://github.com/hughsk/boids) | Lightweight vanilla-JS flock (~1000 boids @ 60fps), config distances + weights, attractors/repulsors | **MIT** |
| [richardhallett/fishyboids](https://github.com/richardhallett/fishyboids) | TS + Three.js, modeled on Reynolds; structural reference for a typed impl | Not declared — reference only, do not copy |
| [ercang/boids-js](https://github.com/ercang/boids-js) | 3D boids with spatial-grid partitioning + WebWorkers; reference for scaling neighbour queries | — |

Background: [Boids — Wikipedia](https://en.wikipedia.org/wiki/Boids).
Fish-specific perception model (zones of repulsion / orientation / attraction):
[Modeling Collective Behavior for Fish School](https://www.researchgate.net/publication/369631425_Modeling_collective_behavior_for_fish_school_with_Deep_Q-Networks).

---

## 2. The Steering-Behavior Model (the core idea)

Every behaviour produces a **steering force** the same way — this uniformity is why the
model is so extensible:

```
desired_velocity = (direction toward goal) normalized * max_speed
steering         = desired_velocity - velocity        // the correction needed
steering         = truncate(steering, max_force)       // clamp how hard we can turn
```

Integration each frame (the "simple vehicle" physics):

```
acceleration = steering_force / mass        // mass usually = 1, so accel = force
velocity     = truncate(velocity + acceleration, max_speed)
position     = position + velocity
acceleration = 0                            // forces reset every frame
```

**Key knobs:**
- `max_speed` limits how *fast* a fish moves.
- `max_force` limits how *sharply* it can turn.
- **Low `max_force` relative to `max_speed` → wide, smooth, lazy turns** (fish). High
  force → snappy banking (birds).

> **OledKoiPond note:** our engine is **delta-time based** (`px/ms`, `deltaMs`
> everywhere). The reference code above assumes a fixed per-frame step. When porting,
> scale the force application / integration by `deltaMs` so motion stays frame-rate
> independent. (Decision recorded: keep delta-time; go pure boids — drop the old
> ramp/LERP/turn-clamp smoothing layer and rely on `maxForce` for smoothness.)

---

## 3. The Three Core Rules (precise vector math)

For each boid, gather neighbours within a perception radius (optionally within a
field-of-view angle), then:

**Separation** — steer away from crowding. Sum vectors pointing *away* from each close
neighbour, weighted by `1/distance` (closer = stronger):
```
for each neighbor within separationRadius:
    diff = normalize(self.position - neighbor.position) / distance
    sum += diff
desired = normalize(sum) * max_speed
force   = truncate(desired - velocity, max_force)
```

**Alignment** — match average heading. Average neighbour velocities, steer toward it:
```
sum = average(neighbor.velocity for neighbors within alignmentRadius)
desired = normalize(sum) * max_speed
force   = truncate(desired - velocity, max_force)
```

**Cohesion** — move toward the group centre. Average neighbour positions, then `seek()`:
```
center = average(neighbor.position for neighbors within cohesionRadius)
force  = seek(center)
```

The three forces are **weighted and summed** (separation usually weighted highest) and
applied to acceleration.

---

## 4. Perception, Field of View, Neighbour Queries, Weighting

- **Perception radius** — each rule may use its own radius. Separation radius is small
  (just avoid touching); alignment/cohesion radii larger. In *Nature of Code*,
  separation ≈ `2 * bodyRadius`, align/cohesion ≈ `25` px — tune to sprite scale.
- **Field of view** — Reynolds defines the neighbourhood by distance *and* angle from
  heading; a boid ignores what's behind it. Implement with a dot product:
  `dot(normalize(toNeighbor), normalize(velocity)) > cos(fovHalfAngle)`. For fish, a wide
  FOV (~270°, narrow rear blind spot) reads naturally. Can be skipped for simplicity.
- **Neighbour queries** — naive O(n²) is fine for a koi pond (tens of fish; our
  `Simulation.update()` already does this). For large scale, use a spatial hash / uniform
  grid (see ercang/boids-js).
- **Weighting** — multiply each behaviour's force by a weight before applying
  (e.g. separation 1.5, alignment 1.0, cohesion 0.8). Weights are the primary tuning knob.

---

## 5. Boundary Handling for a Bounded Pond

- **Wrap-around (toroidal)** — teleport edge-to-edge. **Wrong for a pond** (fish would
  vanish at walls).
- **Steer-away-from-edges (recommended)** — when within a margin of a wall, apply a
  steering force whose desired velocity points back inward at `max_speed`. Smooth,
  natural turning; composes as just another steering force. (Shiffman's `boundaries()`.)
- A hard bounce (negate velocity component) works but looks mechanical — prefer steering.

> Keep the existing **hard clamp** to `[half, logicalW−half] × [half, logicalH−half]` as a
> final safety net so fish can never escape even if steering is overwhelmed.

---

## 6. Wander / Random-Walk for Idle Fish

Reynolds' **wander**: project a circle a fixed distance ahead of the fish; keep a
`wanderTheta` angle nudged by a small random amount each frame; the target is the point on
that circle at `wanderTheta`. Because the angle changes only slightly per frame, the path
is smooth and meandering rather than twitchy — ideal for a lone koi. Blend wander with
low-weight cohesion so isolated fish gently rejoin the group.

---

## 7. Extensible Structure

Use a `Boid`/`Vehicle` base where **every behaviour is a method returning a force
vector**, plus an `applyForce` accumulator. New behaviours (flee cursor, seek food pellet,
avoid obstacle, follow path) are added by writing a method that returns a steering force
and adding it to the weighted sum in one place (`flock()` / `applyBehaviors()`). This
composability is the whole point — and exactly what we want for future features.

---

## 8. Tuning Notes for Fish-Like Schooling

- **Low `max_force` relative to `max_speed`** → wide, lazy, smooth turns.
- **Lower `max_speed`** overall than a bird flock — koi cruise.
- **Looser cohesion, smaller separation** → fish schools are less tightly synchronised
  than starling murmurations; keep alignment moderate so the school can split and re-merge.
- **Larger perception radii but gentle weights** → respond to the group over distance,
  but slowly.
- **Per-fish variation** in `max_speed`/`max_force` so the school isn't a rigid block.
  (OledKoiPond already varies turn rate by size — fold that into per-fish `maxForce`.)
- **Blend in wander** at low weight even while schooling, for organic wobble.
- Optional realism: the three-zone fish model (repulsion → orientation → attraction by
  distance band) maps directly onto separation/alignment/cohesion with priority to
  repulsion.

---

## 9. Reference Code (framework-agnostic TypeScript)

> Reference only — the OledKoiPond codebase is plain ESM JavaScript and delta-time based.
> Adapt: convert to JS, fold behaviours into `FishBase`, and scale by `deltaMs`. Keep float
> math internally and pixel-snap only at draw time (already how rendering works).

### Vector2 helper

```ts
// A tiny 2D vector. Methods return `this` for chaining; statics return new vectors.
export class Vec2 {
  constructor(public x = 0, public y = 0) {}

  static sub(a: Vec2, b: Vec2): Vec2 { return new Vec2(a.x - b.x, a.y - b.y); }
  static add(a: Vec2, b: Vec2): Vec2 { return new Vec2(a.x + b.x, a.y + b.y); }

  add(v: Vec2): this { this.x += v.x; this.y += v.y; return this; }
  sub(v: Vec2): this { this.x -= v.x; this.y -= v.y; return this; }
  mult(s: number): this { this.x *= s; this.y *= s; return this; }
  div(s: number): this { if (s !== 0) { this.x /= s; this.y /= s; } return this; }

  mag(): number { return Math.hypot(this.x, this.y); }

  normalize(): this { const m = this.mag(); if (m > 0) this.div(m); return this; }
  setMag(m: number): this { return this.normalize().mult(m); }   // normalize then * speed
  limit(max: number): this { if (this.mag() > max) this.setMag(max); return this; }  // truncate

  static dist(a: Vec2, b: Vec2): number { return Math.hypot(a.x - b.x, a.y - b.y); }
  static dot(a: Vec2, b: Vec2): number { return a.x * b.x + a.y * b.y; }
  copy(): Vec2 { return new Vec2(this.x, this.y); }
}
```

### Boid / Vehicle class

```ts
export interface PondBounds { width: number; height: number; }

// Tunable parameters — the knobs for "fish vs bird".
export interface BoidConfig {
  maxSpeed: number;         // cruising speed cap (fish: low)
  maxForce: number;         // turn strength cap (fish: low → smooth turns)
  separationRadius: number;
  alignmentRadius: number;
  cohesionRadius: number;
  separationWeight: number; // typically highest, e.g. 1.5
  alignmentWeight: number;  // e.g. 1.0
  cohesionWeight: number;   // e.g. 0.8 (looser for fish)
  wanderWeight: number;     // e.g. 0.3
  edgeWeight: number;       // e.g. 2.0 (strong, so fish never leave pond)
  edgeMargin: number;       // distance from wall where steer-away kicks in
  fovCos: number;           // cos(halfAngle); use -1 to disable FOV (360°)
}

export class Boid {
  position: Vec2;
  velocity: Vec2;
  acceleration: Vec2 = new Vec2(0, 0);
  private wanderTheta = 0;

  constructor(x: number, y: number, public cfg: BoidConfig) {
    this.position = new Vec2(x, y);
    const a = Math.random() * Math.PI * 2;
    this.velocity = new Vec2(Math.cos(a), Math.sin(a)).mult(cfg.maxSpeed);
  }

  applyForce(f: Vec2): void { this.acceleration.add(f); }

  private inNeighborhood(other: Boid, radius: number, d: number): boolean {
    if (d <= 0 || d >= radius) return false;
    if (this.cfg.fovCos <= -1) return true;
    const toOther = Vec2.sub(other.position, this.position).normalize();
    const heading = this.velocity.copy().normalize();
    return Vec2.dot(heading, toOther) >= this.cfg.fovCos;
  }

  private steerTo(desired: Vec2): Vec2 {
    desired.setMag(this.cfg.maxSpeed);
    return desired.sub(this.velocity).limit(this.cfg.maxForce);
  }

  seek(target: Vec2): Vec2 { return this.steerTo(Vec2.sub(target, this.position)); }

  separation(boids: Boid[]): Vec2 {
    const sum = new Vec2(0, 0); let count = 0;
    for (const o of boids) {
      const d = Vec2.dist(this.position, o.position);
      if (this.inNeighborhood(o, this.cfg.separationRadius, d)) {
        sum.add(Vec2.sub(this.position, o.position).normalize().div(d)); // inverse-distance
        count++;
      }
    }
    if (count === 0) return new Vec2(0, 0);
    return this.steerTo(sum);
  }

  alignment(boids: Boid[]): Vec2 {
    const sum = new Vec2(0, 0); let count = 0;
    for (const o of boids) {
      const d = Vec2.dist(this.position, o.position);
      if (this.inNeighborhood(o, this.cfg.alignmentRadius, d)) { sum.add(o.velocity); count++; }
    }
    if (count === 0) return new Vec2(0, 0);
    sum.div(count);
    return this.steerTo(sum);
  }

  cohesion(boids: Boid[]): Vec2 {
    const sum = new Vec2(0, 0); let count = 0;
    for (const o of boids) {
      const d = Vec2.dist(this.position, o.position);
      if (this.inNeighborhood(o, this.cfg.cohesionRadius, d)) { sum.add(o.position); count++; }
    }
    if (count === 0) return new Vec2(0, 0);
    sum.div(count);
    return this.seek(sum);
  }

  wander(): Vec2 {
    const wanderRadius = 8, wanderDistance = 20, change = 0.3;
    this.wanderTheta += (Math.random() * 2 - 1) * change;
    const ahead = this.velocity.copy().setMag(wanderDistance).add(this.position);
    const heading = Math.atan2(this.velocity.y, this.velocity.x);
    const offset = new Vec2(
      wanderRadius * Math.cos(this.wanderTheta + heading),
      wanderRadius * Math.sin(this.wanderTheta + heading)
    );
    return this.seek(ahead.add(offset));
  }

  edges(bounds: PondBounds): Vec2 {
    const m = this.cfg.edgeMargin;
    let desired: Vec2 | null = null;
    if (this.position.x < m)                      desired = new Vec2(this.cfg.maxSpeed, this.velocity.y);
    else if (this.position.x > bounds.width - m)  desired = new Vec2(-this.cfg.maxSpeed, this.velocity.y);
    if (this.position.y < m)                      desired = new Vec2(this.velocity.x, this.cfg.maxSpeed);
    else if (this.position.y > bounds.height - m) desired = new Vec2(this.velocity.x, -this.cfg.maxSpeed);
    if (!desired) return new Vec2(0, 0);
    return this.steerTo(desired);
  }

  // Compose all behaviours with weights — add new behaviours here.
  flock(boids: Boid[], bounds: PondBounds): void {
    this.applyForce(this.separation(boids).mult(this.cfg.separationWeight));
    this.applyForce(this.alignment(boids).mult(this.cfg.alignmentWeight));
    this.applyForce(this.cohesion(boids).mult(this.cfg.cohesionWeight));
    this.applyForce(this.wander().mult(this.cfg.wanderWeight));
    this.applyForce(this.edges(bounds).mult(this.cfg.edgeWeight));
  }

  update(): void {
    this.velocity.add(this.acceleration).limit(this.cfg.maxSpeed);
    this.position.add(this.velocity);
    this.acceleration.mult(0); // reset each frame
  }

  get heading(): number { return Math.atan2(this.velocity.y, this.velocity.x); }
}
```

### Simulation loop (two-pass: compute all forces, then integrate)

```ts
function tick() {
  for (const b of school) b.flock(school, bounds); // read same frame's state
  for (const b of school) b.update();              // then integrate
  // render: draw each fish at b.position, rotated to b.heading (pixel-snap at draw time)
  requestAnimationFrame(tick);
}
```

Two-pass `flock()` then `update()` ensures all boids read the same frame's state
(no order bias). Suggested fish-ish starting config: `maxSpeed ≈ 1.6`, `maxForce ≈ 0.03`,
`separationRadius ≈ 24`, `alignmentRadius ≈ 50`, `cohesionRadius ≈ 60`, weights
`sep 1.6 / align 1.0 / cohesion 0.7 / wander 0.25 / edge 2.0`, `edgeMargin ≈ 40`,
`fovCos = cos(135°)` (~270° FOV). **These are in reference units — re-scale to our
`px/ms` speeds (`SPEED_MAX = 0.03`) and logical-pixel pond size when porting.**

---

## 10. Custom Behaviors & Backlog Mapping

The whole point of the steering model is extensibility: **every behavior is a function
returning a force `{fx, fy}`**, and a fish's motion is a weighted sum of active behaviors.
This replaces the old hand-rolled `_moveState` machine — we keep the state-machine *idea*
but each state now maps to a *weighting over composable force functions* instead of bespoke
position math.

### Two tiers of behavior

- **Ambient / always-on** — summed every frame with fixed weights; the fish's baseline
  "personality": `separation + alignment + cohesion + wander + edges`.
- **Triggered / state-driven** — a fish enters a state that swaps in or reweights extra
  behaviors for a while, then exits. This is the reborn `_moveState`: adding a state =
  writing one force function + a trigger, not a new branch of geometry.

### Architecture: behavior registry + state machine (first-class from day one)

- **Behavior registry** — a map of `name → (fish, ctx) => {fx, fy}` pure-ish force
  functions, where `ctx` carries `{ neighbors, bounds, dt, target, ... }`. Behaviors never
  touch `vx/vy` directly; they only return forces.
- **State machine** — each fish has a current state; a state is a `{ behaviorName: weight }`
  map plus optional enter/exit/trigger logic. The composer sums
  `weight * behavior(fish, ctx)` for the active state into acceleration, integrates
  (delta-time scaled, clamped to `SPEED_MAX`), then applies the hard boundary clamp.
- Baseline state `swim` = the five ambient behaviors. New states (`socialize`, `feed`,
  `orbit`, `regard`) register their own behaviors and weights without modifying the core.

### The Reynolds 1999 catalog (behaviors we can draw from)

**Individual:** Seek · Flee · Arrive (seek + decelerate to stop) · Pursue (seek a moving
target's predicted position) · Evade · Wander · Path Following · Wall Following ·
Containment (our `edges`) · Obstacle Avoidance · Flow Field Following.

**Group:** Separation · Alignment · Cohesion · Unaligned Collision Avoidance ·
Leader Following.

**From Mat Buckland's *Programming Game AI by Example*** (a popular extension of the same
model — note the different attribution): Interpose · Hide · Offset Pursuit (formation
swimming) · Queuing.

### Mapping OledKoiPond backlog → behaviors

| GDD feature | Decomposition |
|---|---|
| **Fish socializing** (showcase triggered state) | State machine: *approach* = **Arrive** on partner (cohesion weight dropped so it peels off); *target notices* = custom **`face`/regard** (orient heading toward approacher, little translation); *follow* outcomes = **Offset Pursuit / Leader Following**; *nose kiss* = both **Arrive** at an offset point ahead of each other's nose, matched headings, hold a beat, exit to `swim`. Forces target-selection + `face` + leader-following — all reusable. |
| **Tap-to-feed** / **long-press attract** | **Seek**/**Arrive** toward a transient attractor point, weighted by distance, decaying over time. |
| **5.5-second breathing circle** | Custom **`orbit`**: seek the tangent of a circle around the ring center (`center + perpendicular`). Weight ramps up while the ring is active. A cousin of Path Following on a circular path. |
| **Ambient clock** | **Arrive** (decelerate to near-stop) + the **`face`** behavior reused from socializing, gated by a low-probability trigger. |
| **Gyroscope / tilt** | **Flow Field Following**: device tilt defines one global flow vector (water sloshing); every fish samples it. One field, whole-pond effect. |

`face` and target-selection are the genuinely new primitives; everything else is catalog
behaviors composed at different weights. Socializing is the first real exercise of the
triggered-state path and unlocks `face` + leader-following for the clock and beyond.

---

## Sources
- [Boids — Flocks, Herds, and Schools (Reynolds 1987)](https://www.red3d.com/cwr/boids/) · [SIGGRAPH '87 PDF](https://www.red3d.com/cwr/papers/1987/SIGGRAPH87.pdf)
- [Steering Behaviors For Autonomous Characters (Reynolds, GDC '99)](https://www.red3d.com/cwr/steer/gdc99/index.html) · [index](https://www.red3d.com/cwr/steer/)
- [The Nature of Code — Ch. 5 Autonomous Agents (Shiffman)](https://natureofcode.com/autonomous-agents/)
- [hughsk/boids (MIT)](https://github.com/hughsk/boids) · [richardhallett/fishyboids](https://github.com/richardhallett/fishyboids) · [ercang/boids-js](https://github.com/ercang/boids-js)
- [Boids — Wikipedia](https://en.wikipedia.org/wiki/Boids) · [Modeling Collective Behavior for Fish School](https://www.researchgate.net/publication/369631425_Modeling_collective_behavior_for_fish_school_with_Deep_Q-Networks)
