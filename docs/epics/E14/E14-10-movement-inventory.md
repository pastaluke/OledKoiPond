# E14-10 — Movement feel: inventory & option space

**Status:** design-first. Decisions 2 and 3 are MADE (see §9); Decision 1 has a
concrete proposal awaiting user sign-off (§11). §1–§8 are the original inventory
and option space, kept for the record. New cross-cutting requirements the user
added (age snapshots, nibble feeding, body-plan generality) are in §10 — they
constrain everything designed here.

Source of truth for the code facts: `src/entities/fish-base.js` (physics),
`src/movement/tuning.js` + `src/species/species-registry.js` (params/defaults),
`src/ui/menu.js` (where each control lives), `src/movement/move-styles.js` (gaits).

---

## 1. How steering works — the two-regime model

Every fish runs **two steering regimes every frame**, blended by speed
(`fish-base.js:686–747`):

- **Cruise** (fast) — steers like a boat. Force → velocity, then the heading
  rotation is **capped** per frame so it can't spin. The body **bends** into the turn.
- **Maneuver / "omni"** (slow, E14-4) — steers like a spacecraft with thrusters.
  It can yaw in place and push sideways/backward; the body stays **straight** and
  the fins do the work.

The blend factor is `w = smoothstep(omni.lo, omni.hi, speed / maxSpeed)` —
`w = 1` is pure cruise, `w = 0` is pure maneuver. **This split is the root of the
confusion:** some knobs only bite in cruise, some only in maneuver, and they're
scattered across two menu sections in three different unit systems.

---

## 2. Control inventory

7 exposed controls + 1 hidden + a whole regime with no UI.

| # | Control | Menu | Metric | Default (range) | Regime | What it does |
|---|---------|------|--------|-----------------|--------|--------------|
| 1 | **Turn rate** | Movement | rad/s | 2.4 (0.5–5, ceil 12) | cruise | Heading-rotation cap **for the smallest fish** |
| 2 | *turnRateMin* | **hidden** | rad/s | 0.8 | cruise | Cap for the **largest** fish. Actual cap = size-interpolated between #1 and #2. No slider. |
| 3 | **Bend drives turn** | Movement | toggle | off | cruise | ON ⇒ turn cap = `maxBend / 0.8`, **overriding #1/#2**. Turn rate slider goes dead. |
| 4 | **Turn bend** (`maxBend`) | Shape | unitless | 1.2 (0.1–2.5) | cruise | Clamp on body curvature in a turn. *Also* sets the real turn rate when #3 is on. |
| 5 | **Pivot** (`pivotT`) | Shape | 0–1 | 0.173 (0.1–0.999) | both | *Where* the body flexes (rigid front vs flexing tail). Also the wag waist. |
| 6 | **Waist bend** (`bendWaist`) | Shape | unitless | 0.097 (0–0.5) | cruise | How far the waist point bows sideways in a turn |
| 7 | **Body bend** (`bendBody`) | Shape | unitless | 0.297 (0–0.5) | cruise | How far the mid-body bows in a turn |
| — | **finTurnRate** | **no UI** | rad/s | 6.0 | maneuver | In-place yaw rate while maneuvering |
| — | **omni.lo / hi** | **no UI** | fraction | 0.05 / 0.18 | blend | Speed band over which cruise↔maneuver crossfade |
| — | **finThrust fwd/rev/lat** | **no UI** | fraction | 1.0 / 0.35 / 0.55 | maneuver | Forward/back/side push authority when maneuvering |

---

## 3. Findings

1. **Three controls are one axis, fighting each other.** Turn rate (#1, rad/s),
   Turn bend (#4, unitless), and the Bend-drives-turn toggle (#3) are all "how the
   fish turns." The toggle exists *only because #1 and #4 can disagree* — it's a
   patch. The `0.8` constant is the exchange rate gluing a rad/s knob to a unitless one.
2. **Two turning controls are unreachable.** turnRateMin (#2) has no slider, so
   "Turn rate" only moves one end of a size range you can't see. The entire
   maneuver regime has no UI at all.
3. **Why the omni regime looks invisible** (the ticket's open bug): the maneuver
   branch runs for every fish, but only shows below `omni.hi = 0.18 × maxSpeed`.
   The default coast throttle is **0.19** (`species-registry.js:90`) — so a coasting
   fish sits *just above* the band and never drops in. It only engages during
   feed/inspect "hold" phases (throttle → 0). And **body bend is zeroed in the
   maneuver regime by design** (`targetBend × w`, line 765), so even when it
   engages there's no spine curve — just a subtle heading rotation + fin flick.
   Two compounding reasons it reads as "nothing happening."
4. **Mixed metrics for one felt thing.** Three rad/s knobs (two invisible), four
   unitless coefficients, one 0–1 position — all for what a player experiences as
   a single question: "how does my fish turn?"

---

## 4. Decision 1 — the turning model

**The question:** Turn rate, Turn bend, and the Bend-drives-turn toggle all touch
"turning." How many controls should that be, and in what units?

| Option | What it is | Controls after | Units |
|--------|-----------|----------------|-------|
| **1A — Unify (always coupled)** | One "Turn" control sets the rate; body bend auto-saturates to match. Retire the toggle; Turn bend becomes purely cosmetic. | 1 turning knob + 1 cosmetic bend | intuitive scale |
| **1B — Two, explicitly independent** | Split cleanly: "Turn speed" = how fast heading swings; "Turn curve" = how curvy the body looks doing it. No toggle; they never drive each other. | 2 knobs, orthogonal | intuitive scale |
| **1C — Relabel only** | Keep all three as-is mechanically; just rename, convert rad/s to a friendly scale, add help text. | 3 (unchanged) | intuitive scale |
| **1D — Preset + advanced** | A single "Turn feel" preset (Lazy / Natural / Snappy) that sets rate+bend together, with the raw knobs tucked behind an "advanced" reveal. | 1 preset (+ raw optional) | named presets |

**Tradeoffs.** *1A* is the cleanest for a casual player — one knob, and the body
always looks like it's turning as hard as it actually is (no more "bends like an
eel but turns like a barge" mismatch). The cost is you lose the ability to make a
stiff-bodied fish that still turns tight (a valid stylistic look). *1B* keeps that
expressive freedom — rate and curve are honestly separate dials — at the cost of
the player needing to understand they're two things. *1C* is the least work and
least risk but leaves the underlying confusion intact (the toggle still silently
disables a slider). *1D* is the most beginner-friendly and the most work, and it
hides authoring depth that power users (you) may want up front.

**Observable behavior of the knobs involved:**

- **Turn speed / rate — high:** fish snap around corners, whip into tight U-turns,
  come about almost on the spot; schooling looks darty and reactive. **Low:** fish
  sweep wide lazy arcs, take a long time to reverse, and drift toward walls before
  they can peel away (can hug edges or overshoot at speed).
- **Turn curve / bend — high:** the body visibly flexes into a deep C through a
  turn — expressive, eel-like, alive. **Low:** the body stays nearly rigid even
  mid-turn — stiff, plank-like, robotic. *(Only in a coupled model — 1A — does high
  bend also mean faster/tighter turns; in 1B/1C decoupled it's purely how it looks.)*

---

## 5. Decision 2 — size-based turn scaling (turnRateMin)

**The question:** today a fish's real turn cap interpolates from Turn rate (small
fish) down to the hidden turnRateMin (large fish) by its size. Keep that, expose
it, or drop it?

| Option | What it is | Result |
|--------|-----------|--------|
| **2A — Expose both ends** | A two-handled range (or two sliders): "Turn rate — small fish / large fish." | Size-based feel stays; both ends reachable |
| **2B — Drop scaling** | One turn rate for every fish; remove turnRateMin. | Simpler; size no longer affects turning |
| **2C — Single "size affects turning" knob** | One 0–1 slider = how much slower big fish turn (0 = off ⇒ same as 2B). | Keeps the effect, one knob instead of two |

**Tradeoffs.** This only matters if your pond actually has a **spread of sizes** —
with uniform fish, all three look identical in play. *2A* gives the most control
and makes big-vs-small legible, but it's two more rad/s numbers to reason about.
*2B* is the simplest and removes a hidden variable, at the cost of every fish
turning identically regardless of bulk (a big koi won't "feel heavy"). *2C* is the
middle path: preserves the heavy-big-fish feel with a single intuitive dial and
folds cleanly into whatever Decision 1 picks.

**Observable behavior:**

- **Scaling strong (turnRateMin ≪ Turn rate, or 2C high):** with mixed sizes, big
  fish visibly lumber through wide arcs while small fish dart and cut — a
  size-legible, "weighty" pond. **Scaling weak (turnRateMin ≈ Turn rate, or 2C low
  / 2B):** every fish turns at the same rate; a whale and a minnow corner
  identically — more uniform, less physical-mass illusion.

---

## 6. Decision 3 — the omni / maneuver regime

**The question:** the in-place-pivot / hover / sidestep regime exists but is
effectively invisible in normal play (Finding #3). Surface it, leave it as a
showcase, or retire it?

| Option | What it is | Player sees |
|--------|-----------|-------------|
| **3A — Make it a visible default** | Lower coast throttle below `omni.hi` (or raise the band) so coasting fish dip into maneuver; add one "Maneuverability" knob (finTurnRate + authority). | Fish hover, pivot to face things, sidle up to and back off food |
| **3B — Feed/inspect showcase (leave)** | No default change; it stays visible only during hold phases. Optionally expose finTurnRate for tinkerers. | In-place turning only near food / slow neighbors |
| **3C — Retire the second regime** | Drop maneuver entirely; pure cruise model. | Everything is swimming arcs; the "invisible knob" confusion disappears |

**Tradeoffs.** *3A* delivers the payoff E14-4 was built for — lively,
thruster-like close-quarters behavior — but changes the pond's default feel
(more "hovering," less constant gliding) and adds tuning surface. *3B* is
zero-risk and keeps the current look, but the whole regime stays a hidden curiosity
most players never trigger. *3C* is the biggest simplification — one regime, one
mental model, no dead knobs — but permanently gives up in-place maneuvering (and
throws away working E14-4 code). This one is more about **intent** than tuning:
do you want fish that can stop and pivot, or fish that always swim in arcs?

**Observable behavior of the maneuver knobs (relevant to 3A / 3B):**

- **Band (omni.hi high) / coast throttle low:** fish routinely slow enough to
  pivot in place, hover, and thruster around — lively and insect/hover-like near
  food and walls, but less "swimmy" overall. **Band low / coast throttle high
  (today):** fish almost never enter maneuver; the pond reads as continuous gliding.
- **finTurnRate — high:** while maneuvering they snap-rotate to face a target
  almost instantly (turret-like). **Low:** they rotate slowly toward it even at a
  standstill.
- **finThrust lateral / reverse — high:** they sidestep and back away readily
  (crab-like repositioning). **Low:** they must arc forward to reposition (fish-like).

---

## 7. Menu restructure (the "Pets folder" idea)

Today **Movement / Fish / Shape** are three sibling top-level sections. The species
selector already lives in Fish and already rebinds all three to the selected
creature (shipped E14-9) — so "one selector governs the sub-editors" is already the
real behavior, just not visually grouped. Proposed nesting makes it explicit:

```
Pets  (folder)
  ├─ Creature selector + Duplicate / Rename / Delete + Filled / Feed
  ├─ Movement   (boids weights + the unified Turning controls)
  └─ Shape      (silhouette + the cosmetic bend-shape controls)
```

The turning knobs that today straddle Movement and Shape would consolidate:
steering/rate under **Movement**, cosmetic bend-shape under **Shape**. Whichever way
Decision 1 lands sets exactly which knob goes where. Nested `<details>` needs a
little indent CSS but is straightforward and pairs naturally with this ticket since
we're already moving where settings live.

*(Open sub-question: does "Pets" also eventually hold Behavior/Styles? Out of scope
for E14-10 but the folder leaves room.)*

---

## 8. Full observable-behavior reference (all bend/turn knobs)

For quick reference while deciding — what each existing knob does at its extremes.

| Knob | Low value | High value |
|------|-----------|-----------|
| **Turn rate** | Wide lazy arcs; slow to come about; edge-hugging | Snappy tight turns; quick reversals; darty schools |
| **turnRateMin** (large-fish end) | Big fish turn dramatically slower than small | Size barely changes turning |
| **Turn bend** (`maxBend`) | Rigid, plank-like body even mid-turn | Deep expressive C-curve through turns (and tighter turns if coupled) |
| **Pivot** (`pivotT`) | Flex point far back — only the tail-tip whips; stiff front 3/4 | Flex point forward — whole-body undulation, more snake-like |
| **Waist bend** (`bendWaist`) | Waist stays straight; C-curve starts further back | Waist bows early; rounder, tighter-looking turn arc |
| **Body bend** (`bendBody`) | Mid-body stays straight; shallow curve | Mid-body bows hard; pronounced full-body C |
| **finTurnRate** | Slow rotate-to-face when maneuvering | Instant turret-like snap-to-face |
| **omni.hi / band** | Maneuver almost never triggers (today) | Fish frequently hover/pivot at low speed |
| **finThrust lat/rev** | Must arc forward to reposition (fish-like) | Sidesteps and backs up freely (crab-like) |

---

## 9. Decisions made (user, 2026-07-27)

**Decision 2 — RESOLVED, superseded by age snapshots.** Size-based turn scaling
via a hidden min/max interpolation pair is retired ("too arbitrary"). At most,
size effects are ONE knob. But the real direction replaces it entirely: **age
snapshots** (§10.1). Scale becomes an explicit shape-scale setting on the
creature; the user saves full-settings snapshots at named ages, and the sim lerps
between snapshots as a creature ages. A newborn that turns fast and an adult that
turns slow is authored *directly*, not inferred from size. `turnRateMin` dies.
(The per-fish size-jitter → age-spread mapping is an implementation question.)

**Decision 3 — RESOLVED: 3A.** Make the omni/maneuver regime a visible default
(at least to try it). Motivating behavior: **nibble feeding** (§10.2) — a tiny
tetra meeting a big pellet should bite, back off a little while still tracking
the pellet, then push back in for another bite. That's impossible without the
maneuver regime (reverse thrust + face-lock), so omni must be surfaced AND
tunable per species (and per age, via snapshots).

**Decision 1 — proposal in §11**, built to the §10 requirements. Awaiting user
review; nothing implemented.

---

## 10. New requirements (user feedback, 2026-07-27)

### 10.1 Age snapshots (future system; constrains E14-10 now)

- **Scale** becomes a first-class creature setting: a shape-scale multiplier that
  sets the final drawn size. (Today size is a per-fish jitter; it becomes an
  authored value per age.)
- Per species, the user can **"save current settings as an age snapshot"** —
  capturing the full tunable state (scale, agility, bend, hover, gait, …) at a
  named age (newborn / adolescent / grown / …).
- Over a creature's lifetime the sim **lerps between adjacent snapshots'
  settings** — so a species isn't one tuning, it's a *timeline* of tunings.
- **Design constraint on E14-10:** every knob we design must be a plain,
  independently-lerpable number. Structural choices (e.g. which turn style a
  species uses) are per-species, not per-age. No toggles that flip behavior
  discontinuously mid-life. This is a reason to avoid modal controls like the
  old Bend-drives-turn toggle.

### 10.2 Nibble feeding (future behavior; built on 3A)

Sketch: pellets get a size / bites-remaining budget (ties into the queued E12-2
food rework). The feed style gains a loop: **approach → bite (mouth contact) →
retreat** (reverse thrust, heading face-locked on the pellet even as it drifts)
**→ hold → re-approach**. Small creature + big pellet = many nibble cycles; big
creature + small pellet = one gulp. Per-species knobs (bite interval, retreat
distance) and per-age via snapshots. Not designed further here — it's the payoff
that justifies the Hovering knob set in §11.

### 10.3 Body-plan generality

The scheme must make sense authoring **fish, turtles, snails, dragons, birds,
ball-shaped fairies with wings** — not just easy fish shapes:

- **Not all creatures bend.** Bend must be optional per species, and its absence
  must not leave dead sliders lying around.
- Settings must be **instantly understandable** — no rad/s, no "arbitrary points
  of reference for when something is supposed to happen."
- The **UI structure itself should teach** the split between a creature's
  turning *ability* and its turning *look/style*.

---

## 11. Decision 1 proposal — "physics owns truth, the body follows"

### 11.1 The core principle

Split turning into two layers that can never contradict each other:

1. **Ability (physics)** — how the creature's heading actually changes. One knob
   per regime. This is what trajectories obey.
2. **Expression (look)** — how the body *shows* the turn it is actually making.
   Style-dependent (bend for fish/dragons; nothing for snails/fairies; bank for
   birds someday). Purely cosmetic — it can exaggerate or hide a turn, never
   cause one.

Coupling is **structural, not a toggle**: the shown bend is driven by the *actual*
turn as a fraction of the creature's own max —
`bendShown = BendDepth × (currentTurnRate / agilityRate)`, saturating at full
depth exactly when the creature turns its hardest. This is self-normalizing:
any Agility setting shows full expression at its own hardest turn, so the `0.8`
exchange-rate constant and the Bend-drives-turn toggle both disappear — while a
stiff-bodied tight-turner (Bend depth 0, Agility high) stays possible. It keeps
option 1A's honesty with option 1B's expressive freedom.

### 11.2 Regimes get plain names

- **Swimming** (was cruise) — moving; turns are arcs.
- **Hovering** (was omni/maneuver) — stopped or slow; can pivot in place,
  sidestep, back up. Per 3A this becomes visible by default.

### 11.3 The proposed knob set

**Turning (while swimming)**
- **Agility** — the ONLY physics turn knob. Readout in felt units: **seconds to
  make a U-turn** (internally rad/s; `t180 = π/rate`; today's 2.4 rad/s ⇒
  "1.3 s"). High = darts around corners; low = barge arcs.

**Turn look** (only shown for styles that use them — same extras pattern as the
Caustics pattern selector)
- **Turn style** — per-species selector: **None / Bend** (extensible: Bank for
  birds, etc. — each style declares its own extra knobs).
- **Bend depth** (Bend style) — 0–1, was `maxBend`. 0 = rigid plank even in a
  hard turn; 1 = deepest C-curve. Purely cosmetic now.
- **Flex point** (Bend style) — was Pivot/`pivotT`. WHERE the body hinges.
  Anatomy — shared with the swim wag, and labeled as such.
- **Flex spread** (Bend style) — ONE knob replacing Waist bend + Body bend
  (they're two control points of the same C-curve). 0 = only the front kinks at
  the hinge; 1 = the whole body bows in one smooth C. Internally maps to
  (bendWaist, bendBody) along a curve that preserves today's default mid-scale.
  (The raw pair stays reachable via Copy/Paste JSON for power users.)

**Hovering (stopped & slow)** — surfacing the omni regime, per 3A
- **Hover threshold** — was `omni.lo/hi`. The speed fraction below which the
  creature switches from swimming to hovering (band width derived). **0 = this
  creature never hovers** — so retiring the regime is a per-creature slider
  value, not a code decision: a snail can live here, a bird can never hover.
- **Pivot speed** — was `finTurnRate`. How fast it rotates in place, same
  U-turn-seconds readout as Agility.
- **Scoot** — was `finThrust.reverse/lateral`, ONE knob (fixed internal ratio).
  0 = must arc forward to reposition (fish-like); 1 = backs up and sidesteps
  freely (crab/hummingbird-like). This is the knob nibble feeding rides on.

### 11.4 Old → new mapping

| Old control | Fate |
|---|---|
| Turn rate (rad/s) | → **Agility** (U-turn seconds readout) |
| turnRateMin (hidden) | **retired** (age snapshots supersede size scaling) |
| Bend drives turn (toggle) | **retired** (coupling now structural, §11.1) |
| Turn bend (`maxBend`) | → **Bend depth** (0–1, pure look) |
| Waist bend + Body bend | → **Flex spread** (one knob) |
| Pivot (`pivotT`) | → **Flex point** (relabeled; shared-with-wag noted) |
| finTurnRate | → **Pivot speed** (Hovering) |
| omni.lo / hi | → **Hover threshold** (one knob, band derived) |
| finThrust fwd/rev/lat | → **Scoot** (one knob) |

Net: 10 raw params → **7 knobs + 1 style selector**, and a non-bending creature
sees only 4 (Agility, Hover threshold, Pivot speed, Scoot). Every knob is a
lerpable number (§10.1 ✓); the style selector is per-species structural.

### 11.5 Menu structure (the UI teaches the model)

```
Pets (folder)
 ├─ Creature selector + Duplicate/Rename/Delete + Filled/Feed
 ├─ Body     (today's Shape editor: silhouette, points, fins)
 ├─ Motion
 │   ├─ Speed & gait   (Max speed, burst/coast, drag, wag)
 │   ├─ Turning        (Agility · Turn style · Bend depth · Flex point · Flex spread)
 │   └─ Hovering       (Hover threshold · Pivot speed · Scoot)
 └─ Social   (separation, alignment, cohesion, wander, school, edges)
```

- The **section split IS the explanation**: "Turning = while swimming, arcs";
  "Hovering = stopped, pivots" — one header line of copy under each.
- Turn-style extra knobs swap with the style selection (the shipped Caustics
  extras mechanic, reused).
- A **live mini-preview** in Turning (reusing the move-style preview pattern): a
  creature running a figure-eight with the current Agility/Bend settings, so
  ability + look are visible without touching the pond.
- Scoping question (user to decide): move ONLY the turning/hovering knobs now and
  leave gait/boids where they are, or do the full Pets/Motion/Social regrouping
  in one pass?

### 11.6 Implementation notes & migrations (for the eventual build ticket)

- **3A default fix:** coast throttle default (0.19) sits just above the hover
  band (0.18) — Finding #3. With Hover threshold exposed, default it so a
  coasting fish actually dips into hovering (e.g. threshold ≈ 0.22–0.25 or
  lower the default coast), then tune by eye.
- **Persisted-blob migrations:** `turnRateMax` → agility; drop `turnRateMin`;
  if a blob had `bendDrivesTurn: true`, derive Agility from `maxBend / 0.8` so
  those users' felt turn radius is preserved; map (bendWaist, bendBody) → the
  nearest Flex spread value; merge finThrust rev/lat → Scoot.
- **Hovering visibility beyond physics:** in the maneuver regime the spine stays
  straight by design — fins are the only tell. Surfacing 3A likely also wants a
  slightly stronger fin read (existing FIN_REV/LAT_DEG channels) so hovering
  looks intentional, not stalled.
- Bend-depth normalization changes what saved `maxBend` MEANS (clamp → 0–1
  depth); normalize on load (`maxBend / 2.5` against the old slider ceiling).

### 11.7 Agility — the math (deep-dive, 2026-07-27)

**Today's chain** (`fish-base.js`): the 3 knobs resolve in the `maxTurnRate`
getter (:513 — toggle branch, else size-interpolated rad/s). The cruise branch
(:711–721) computes the heading the steering forces want, wraps the difference,
and clamps it to `maxTurnRate/1000 × dt` — rotating the velocity vector to the
clamped heading with **speed preserved** (the cap redirects, it never brakes —
why low rate reads as a barge arc, not a slowdown). Bend (:762–766) measures the
ACTUAL realized rotation and maps it through the glue constant:
`targetBend = clamp(measuredω × 0.8, ±maxBend) × gTurn × w`.

**Felt-unit conversions:** `t_uturn = π/ω` (2.4 rad/s → 1.31 s; the hidden
big-fish 0.8 → 3.93 s). Turn radius `r = v/ω`: koi full speed 51 px/s → r ≈ 21
logical px; coasting ≈ 4 px — rate-based turning gives "slower = tighter corner"
for free (physically right; why we spec rate, not radius). Per-frame the clamp is
dt-scaled (≈2.3°/frame at 60 fps) so it's framerate-independent.

**The bug the 0.8 constant hides:** a large koi (ω = 0.8) can show at most
0.8 × 0.8 = 0.64 bend against its authored maxBend 1.2 — **53% of its own curve,
unreachable forever**. The clamp only saturates for fish whose ω×0.8 ≥ maxBend,
so "Turn bend" silently means different things per size.

**Agility replacement:**
- Store `tuning.agilitySec` — seconds per U-turn, THE felt unit, on the species.
- `get maxTurnRate() { return Math.PI / this.species.tuning.agilitySec; }` —
  cruise clamp consumes it unchanged; toggle branch + size interpolation deleted.
- Bend goes self-normalizing:
  `frac = min(1, |measuredω| / maxTurnRate)`;
  `targetBend = maxBend × frac × sign(ω) × gTurn × w`.
  frac = 1 exactly at THIS creature's hardest turn → every creature reaches its
  full authored curve; the 0.8 constant, clamp mismatch, and big-fish bend
  starvation vanish in one line.
- Slider ≈ 0.4 s (darting) → 6 s (barge), default 1.3 s (today's koi feel).
  UI note: seconds run backwards from intuition — draw the slider
  right-equals-snappier; readout "U-turn: 1.3 s".
- **Lerp space:** snapshots lerp the stored seconds (period space): midpoint of
  1 s and 3 s = 2 s — perceptually honest. Lerping rad/s would bias snappy
  (→ 1.5 s). This is WHY agilitySec, not rad/s, is canonical.
- **Migrations:** `agilitySec = π/turnRateMax`; if a blob had
  `bendDrivesTurn:true` → `agilitySec = 0.8π/maxBend` (preserves those users'
  felt radius); `turnRateMin` dropped.
- **Ceiling, not drive:** fish only turn at max rate when steering demands it
  (wall / attract / food). Agility = capability; how often hard turns are
  demanded stays with the Social weights (wander, edges) = temperament.

---

## Open for user review (Decision 1)

1. Does the **physics-owns-truth / body-follows** coupling (§11.1) match your
   intent — turn look can exaggerate or underplay but never cause a turn?
2. **Naming** — react to: Agility, Hover threshold, Pivot speed, Scoot, Bend
   depth, Flex point, Flex spread, Turning/Hovering, Pets/Body/Motion/Social.
3. **Menu scope** — minimal move (turning/hovering knobs only) vs the full
   Pets/Motion/Social regroup in one pass?
4. **Flex point placement** — it's shared anatomy with the tail wag; keep it in
   Turning (with a "affects wag too" note) or in Body?
