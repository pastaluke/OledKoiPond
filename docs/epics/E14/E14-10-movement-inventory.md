# E14-10 — Movement feel: inventory & option space

**Status:** design-first (no code, no decisions locked). This doc is the memory of
record for the E14-10 discussion — inventory of every rotation/turn/bend control,
plus a clearly-laid-out option space for the three open decisions. The user picks
(or invents) options from here; nothing below is a chosen plan.

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

## Decisions still needed (from the user)

1. **Turning model** — 1A / 1B / 1C / 1D (or your own).
2. **Size-based turn scaling** — 2A / 2B / 2C (or your own).
3. **Omni/maneuver regime** — 3A / 3B / 3C (or your own).

Consolidation design + the menu restructure wait on these three answers.
