# Boids Tuning Recommendation — OledKoiPond Fish Schooling

> Companion to [`boids-movement-reference.md`](./boids-movement-reference.md). The
> recommended values below were **baked into the code defaults** (`src/entities/fish-base.js`
> and `src/entities/koi.js`) on 2026-05-30. Because the in-app sliders persist tuning to
> localStorage, persisted values override these defaults on load — hit **Reset** in the menu
> to load the baked defaults.

A plug-in-ready parameter recommendation for the delta-time steering system in
`src/movement/behaviors.js`, `src/movement/states.js`, and `src/entities/fish-base.js`.
All values are in our units: **logical px**, **px/ms** (speed), **px/ms²** (force).
Fish lengths ~10–22 px.

## How our system actually composes forces (verified against code)

This matters because it changes what the "right" numbers are versus textbook boids:

- Each behavior returns a force already **clamped to `maxForce`** (`steer()` in `behaviors.js`).
- `alignment` and `cohesion` operate on **all neighbors pre-filtered to `PERCEPTION_RADIUS`**
  by the Simulation — they do **not** have their own larger radii (unlike Shiffman, where
  align/cohesion radius = 2× separation). So in our system, perception radius is the *single*
  social radius and separation distance is a sub-radius inside it.
- Forces are **weighted-summed into acceleration with NO renormalization and NO
  total-acceleration clamp**. The summed acceleration can therefore exceed any single
  `maxForce` — e.g. edges(2.6) + separation(1.6) + wander(0.45) can stack to ~4× maxForce
  when they happen to align.
- `velocity += accel*dt`, then velocity is clamped to `SPEED_MAX`.
- A **hard position clamp** at the pond edge is the final safety net.
- `maxForce` is interpolated by size: **small fish = MAX_FORCE_MAX (nimble), large fish =
  MAX_FORCE_MIN (lazy)**. `maxSpeed = SPEED_MAX × per-fish jitter(0.85–1.15)`.

The single most important consequence: **because each behavior is individually clamped to
`maxForce`, the edge behavior alone can never produce more than `EDGE_WEIGHT × maxForce` of
turning authority.** If `maxForce` is too small relative to `SPEED_MAX`, no `EDGE_WEIGHT`
value can save a fish that's already pointed at a near wall — see diagnostics.

## Reference anchors from the literature

| Source | maxSpeed | maxForce | force:speed | separation | perception (align/coh) | sep:align:coh |
|---|---|---|---|---|---|---|
| Shiffman, *Nature of Code* flocking (`Boid.pde`) | 3 | 0.05 | **0.0167** | 25 | 50 | **1.5 : 1.0 : 1.0** |
| Shiffman combined-steering example | 8 | 0.2 | 0.025 | r×2 | — | sep 1.5 / seek 0.5 |
| Reynolds GDC'99 | — | — | low force ÷ speed ⇒ wide lazy turns | small | larger | separation prioritized |
| Boid-weights analysis (BIO Web Conf. 2024) | — | — | — | — | — | ↑alignment ⇒ unified flock; ↑cohesion/↓alignment ⇒ 2–3-fish subgroups |

**Fish-specific deltas from bird-flock defaults** (from Reynolds, the fish three-zone model,
and our own reference doc §8): lower maxSpeed, **lower force:speed ratio than Shiffman**
(lazier turns), looser cohesion so schools split/re-merge, moderate alignment, slightly
larger perception with gentle weights, plus low-weight wander always on.

The *previous* defaults had `maxForce/SPEED_MAX` = 0.004–0.0093 — **2–4× lazier than
Shiffman's already-smooth 0.0167**, which sat right at the edge of "physically can't turn in
time" (the wall-ramming failure mode).

## 1. Recommended starting values (with rationale)

| Parameter | Old | Recommended | One-line rationale |
|---|---|---|---|
| `SEPARATION_WEIGHT` | 1.6 | **1.6** | Keep highest; matches Shiffman's 1.5 anchor and our unscaled "always avoid bumping" intent. |
| `ALIGNMENT_WEIGHT` | 1.0 | **1.0** | Canonical mid weight; gets scaled by SCHOOL_WEIGHT, so leave the base at the reference value. |
| `COHESION_WEIGHT` | 0.8 | **0.8** | Below alignment ⇒ fish schools that split/re-merge rather than clump (fish, not starlings). |
| `WANDER_WEIGHT` | 0.5 | **0.45** | Slightly down; 0.5 fights alignment a bit too hard in a loose school. Keep it organic but sub-cohesion. |
| `EDGE_WEIGHT` | 2.2 | **2.6** | Bump up — must dominate the social trio near walls. Cheaper/safer fix than raising maxForce alone. |
| `SCHOOL_WEIGHT` (koi) | 0.4 | **0.45** | Koi are loose schoolers; 0.45 gives visible alignment/cohesion without lockstep. Effective align=0.45, coh=0.36. |
| `MAX_FORCE_MAX` (small) | 0.00028 | **0.00045** | Raise turn authority. 0.00045/0.03 ≈ 0.015, near Shiffman's 0.0167 — smooth but able to evade walls. |
| `MAX_FORCE_MIN` (large) | 0.00012 | **0.00022** | Large fish were dangerously lazy (0.004 ratio, ~250 ms to reverse). 0.00022/0.03≈0.0073 keeps them lazy but wall-safe. |
| `SPEED_MAX` | 0.03 | **0.03** | Koi cruise; fine. Don't raise without raising maxForce in lockstep (see diagnostics). |
| `SEPARATION_DIST` | 10 | **12** | ≈ 0.75× mean body length (16 px) — fish keep ~one body-radius gap. |
| `PERCEPTION_RADIUS` | 24 | **30** | ≈ 2× mean body length and ≈ 2.5× separation — matches Shiffman's 1:2 sep:perception. |

The biggest change is **raising both maxForce statics ~1.6×** — the root cause of sluggish
wall response in the previous set; every other knob is fine-tuning around it.

## 2. The ratios that matter (scale-invariant — port these, not the absolutes)

- **maxForce : maxSpeed ≈ 0.010–0.015** (maxForce ≈ 1.0–1.5% of SPEED_MAX). Below ~0.007 fish
  can't turn away from walls in time; above ~0.025 turns get bird-snappy.
- **separation : alignment : cohesion ≈ 1.6 : 1.0 : 0.8** (≈ 2 : 1.25 : 1). Separation always
  wins; cohesion always loosest. The fish-school signature (vs. birds ~1.5:1:1).
- **PERCEPTION_RADIUS ≈ 2× body length** and **≈ 2.5× SEPARATION_DIST** (Shiffman 1:2).
- **SEPARATION_DIST ≈ 0.7–0.8× body length** (~one body radius of clear water).
- **EDGE_WEIGHT ≥ 1.5× SEPARATION_WEIGHT** so containment out-pulls the social trio inside the margin.
- **EDGE_MARGIN ≥ braking distance:** margin should exceed `SPEED_MAX² / (2 × EDGE_WEIGHT × maxForce)`.

## 3. Suggested slider min/max ranges

(Centered so the recommended value sits mid-range, with headroom to find failure modes.)

| Parameter | Slider min | Slider max | Step |
|---|---|---|---|
| `SEPARATION_WEIGHT` | 0.0 | 4.0 | 0.1 |
| `ALIGNMENT_WEIGHT` | 0.0 | 3.0 | 0.1 |
| `COHESION_WEIGHT` | 0.0 | 3.0 | 0.1 |
| `WANDER_WEIGHT` | 0.0 | 2.0 | 0.05 |
| `EDGE_WEIGHT` | 0.0 | 6.0 | 0.1 |
| `SCHOOL_WEIGHT` | 0.0 | 1.0 | 0.05 |
| `MAX_FORCE_MAX` | 0.00010 | 0.00090 | 0.00001 |
| `MAX_FORCE_MIN` | 0.00006 | 0.00060 | 0.00001 |
| `SPEED_MAX` | 0.005 | 0.060 | 0.001 |
| `SEPARATION_DIST` | 4 | 30 | 1 |
| `PERCEPTION_RADIUS` | 10 | 60 | 1 |

Keep `MAX_FORCE_MIN ≤ MAX_FORCE_MAX` and `SEPARATION_DIST < PERCEPTION_RADIUS` as UI invariants if you can.

## 4. Diagnostics — "why fish ram into walls / spin out"

**Fish ram into walls (nose into wall, then slide along the hard clamp):**
- **maxForce too low** is the #1 cause and it's a *hard physical* limit, not a weighting
  issue. Time to cancel an inbound velocity component ≈ `SPEED_MAX / (EDGE_WEIGHT × maxForce)`.
  With the *old* large-fish value (0.00012) and EDGE_WEIGHT 2.2: 0.03/(2.2×0.00012) ≈
  **114 ms of full-authority turning**, during which the fish still travels inward. Because the
  edge force is *individually clamped to maxForce* before weighting, **no EDGE_WEIGHT can
  exceed `EDGE_WEIGHT × maxForce`** — if maxForce is the bottleneck, raising EDGE_WEIGHT helps
  only linearly and saturates. **Check `MAX_FORCE_MIN`/`MAX_FORCE_MAX` first.**
- **SPEED_MAX too high relative to maxForce:** the fish covers EDGE_MARGIN faster than it can
  turn → overshoot/ram. The ratio, not either absolute, is what matters.
- **EDGE_MARGIN too small:** `EDGE_MARGIN` (14, floored to `half+2`) must exceed the braking
  distance above. Large fast fish need a bigger margin.
- **High cohesion/alignment + large PERCEPTION_RADIUS overpowering edges:** a dense clump near
  a wall can drag fish in. Symptom: ramming only happens when the school crowds a corner.
  **Check `COHESION_WEIGHT`, `SCHOOL_WEIGHT`, `PERCEPTION_RADIUS`.**

**Fish spin out / jitter / vibrate:**
- **maxForce too high** (snappy/twitchy) — the opposite failure. Pull `MAX_FORCE_MAX` down.
- **Stacked unrenormalized forces:** no total-accel clamp means edges + separation + wander
  momentarily summing in-phase produces several× maxForce, snapping velocity to the SPEED_MAX
  clamp, then yanking it back. Symptom: high-frequency flips near walls/corners (two edges fire
  at once). Mitigate by keeping EDGE_WEIGHT/SEPARATION_WEIGHT moderate, or (code change) clamp
  total acceleration.
- **SEPARATION too strong** relative to PERCEPTION: fish shove each other → boiling/jitter.
  Keep `SEPARATION_DIST` ≲ 0.5× `PERCEPTION_RADIUS`.
- **WANDER too high** fighting alignment: nervous wobble. Lower `WANDER_WEIGHT`.

**Quick triage when fish hit walls:** ① raise `MAX_FORCE_MIN`/`MAX_FORCE_MAX`; ② raise
`EDGE_WEIGHT`; ③ raise `EDGE_MARGIN` (code const); ④ lower `SPEED_MAX` or
`PERCEPTION_RADIUS`/`COHESION_WEIGHT`.
**When fish jitter/spin:** ① lower `MAX_FORCE_MAX`; ② lower `SEPARATION_WEIGHT`/`SEPARATION_DIST`;
③ lower `WANDER_WEIGHT`/`EDGE_WEIGHT`.

## Baked-in recommended set

```js
// fish-base.js (shared defaults)
static SEPARATION_WEIGHT  = 1.6;
static ALIGNMENT_WEIGHT   = 1.0;      // ×SCHOOL_WEIGHT
static COHESION_WEIGHT    = 0.8;      // ×SCHOOL_WEIGHT
static WANDER_WEIGHT      = 0.45;
static EDGE_WEIGHT        = 2.6;      // ≥1.5× separation so containment dominates near walls
static MAX_FORCE_MAX      = 0.00045;  // smallest fish — nimble; /SPEED_MAX ≈ 0.015 (≈ Shiffman)
static MAX_FORCE_MIN      = 0.00022;  // largest fish  — lazy but wall-safe; /SPEED_MAX ≈ 0.0073

// koi.js (koi overrides)
static SPEED_MAX          = 0.03;     // px/ms — koi cruise
static SCHOOL_WEIGHT      = 0.45;     // loose schooler (scales alignment + cohesion)
static PERCEPTION_RADIUS  = 30;       // px — ≈2× body length, ≈2.5× separation
static SEPARATION_DIST    = 12;       // px — ≈0.75× body length
```

## Sources
- [Reynolds — Flocks, Herds, and Schools (SIGGRAPH '87)](https://www.red3d.com/cwr/boids/) and [Steering Behaviors for Autonomous Characters (GDC '99)](https://www.red3d.com/cwr/steer/gdc99/index.html)
- [Shiffman — The Nature of Code, Ch. 5 Autonomous Agents](https://natureofcode.com/autonomous-agents/)
- [Shiffman flocking `Boid.pde`](https://github.com/nature-of-code/noc-examples-processing/blob/master/chp06_agents/NOC_6_09_Flocking/Boid.pde) — canonical values: maxspeed 3, maxforce 0.05, desiredSeparation 25, neighbordist 50, weights 1.5/1.0/1.0
- [Analysis of Boid Algorithm Weights using Alignment Clustering Index (BIO Web Conf., 2024)](https://www.bio-conferences.org/articles/bioconf/pdf/2024/11/bioconf_icmmbt2023_01016.pdf)
- [libGDX gdx-ai — Steering Behaviors wiki](https://github.com/libgdx/gdx-ai/wiki/Steering-Behaviors)
- [Processing.org Flocking example](https://processing.org/examples/flocking.html)
- Internal: `docs/boids-movement-reference.md`, `src/movement/behaviors.js`, `src/movement/states.js`, `src/entities/fish-base.js`
