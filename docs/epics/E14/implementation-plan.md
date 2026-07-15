# E14 — Implementation Plan

> Execution companion to `architecture.md` (read it first — §3 data model, §4 sim
> stepping, §5 rendering). Phases are **independently shippable** and ordered by
> dependency. Each story is written to be handed to an implementation agent
> (Opus) as a self-contained brief: context pointers, files, steps, acceptance
> criteria, verification. Board tickets: E14-1 … E14-9.
>
> House rules for every story: work on `claude/koi-pond-sim-78hVO`; verify in a
> real browser (headless Chromium is fine) before commit; merge to `main` when
> done (CLAUDE.md workflow); update the SprintBoard per
> `.claude/skills/sprintboard-usage/SKILL.md`. **One session at a time** — no
> parallel sessions/agents on this repo (CLAUDE.md execution model).

---

## EXECUTION QUEUE (revised 2026-07-15 — the board's UP NEXT strip mirrors this)

Shipped: P1 (E14-1), P2 (E14-2), P3 (E14-3), P4 (E14-4), P5 (E14-5), P7a (E14-7).

Reprioritized after user playtest: front-load user-visible payoff, and add the
missing piece the user called out — the species-as-data backend exists but you
still can't *keep* multiple creatures or mix species in the pond.

| # | Ticket | Work | Outcome the user sees |
|---|--------|------|----------------------|
| 1 | **E14-9** | Creature library + mixed roster (Phase L below) | Save/name multiple creature configs; spawn any mix of them into the pond at once; pick which one you're editing |
| 2 | **E14-6** | Depth layers (Phase 6) | Real sense of depth: deeper fish dimmer/tinted; snail-style floor-locked entities; food can sink |
| 3 | **E7-8** | Caustics on the floor from ripple data | The water visibly *lights* the pond floor, driven by real ripples |
| 4 | **E7-9** | Caustics on the fish layer | Depth planes read differently under the same light |
| 5 | **E7-10** | Creature shadows mask floor caustics | Fish cast shadows that punch holes in the caustics — the big depth illusion |
| 6 | **E7-11** | Variable light angle (layer offsets) | Choose where the "sun" is; shadows/caustics shift coherently |
| 7 | **E14-8** | Pond config save/share (Phase 7b) | Named ponds; export/import the whole setup as JSON |

Not queued (still idea-pond): E7-12 compass-sun, E2 fluid chain, cartridge
successor work — the cartridge direction is under reconsideration toward
in-fiction customization (see `docs/idea-pond/customization-through-fiction.md`).

---

## Phase L — Creature library & mixed-species roster  *(ticket E14-9 — QUEUE #1)*

**Goal:** the user-facing payoff of species-as-data: really save creature
configs, keep several, and spawn them **non-exclusively** — multiple species
swimming together — plus choose which one the editors target.

**Context:** the backend already shipped in E14-1/E14-3: `species-registry.js`
has `addCustomSpecies/deleteCustomSpecies/getAllSpecies/upgradeSpecies`;
individuals hold a `species` reference; `Simulation` is type-agnostic; the save
blob already persists a `species: []` array. What's missing is purely the
user-facing layer: today the menu hard-binds to the single `koi` record
(`menu.js` `KOI_ID`) and `setFishCount` spawns only koi.

**Steps:**
1. **Species selector**: dropdown at the top of the Fish (or a new Creatures)
   section listing registry records; Movement sliders, Shape/Fin editors, Copy
   values, and both Reset buttons rebind to the SELECTED species (replace the
   `KOI_ID` constant with selection state; the binding closures already read
   through one `species` variable — swap it on selection + re-sync rows/preview).
2. **Library actions**: Save-as (clone current record → new id/name via
   `addCustomSpecies`), Rename, Duplicate, Delete (builtin-protected). Paste
   values accepts a whole species record (Copy already exports one).
3. **Mixed roster**: replace the single "Fish count" row with a per-species
   count row (− N +) for every registry record; `setFishCount` becomes
   per-species (`sim` add/remove filtered by `entity.species.id`). Species
   coexist — nothing is exclusive.
4. **Spawning + persistence**: save blob gains `roster: [{speciesId, count}]`
   (load backfills legacy `fishCount` → koi count); spawn restores the mix.
5. **Spatial hash check**: `Simulation.update` already computes cell size from
   the per-frame max perception radius across entities — confirm with two
   species of different radii (unit check like E14-2's).

**Accept:** create a second species (e.g. duplicate koi, fatten it, slow it
down, rename "Carp"); pond shows 5 koi + 3 carp simultaneously, each moving per
its own tuning; edit target switches cleanly; refresh restores the mix; legacy
blobs still load (count → koi).

**Verify:** headless — duplicate/edit/spawn flow scripted; screenshot of a mixed
pond; persistence round-trip; neighbor-correctness spot check with differing
perception radii.

*(E13-5's full class-browser menu reorg remains the richer future version of
this UI; E14-9 is the minimal honest library. E13-9 is fully closed by this.)*

---

## Phase 1 — Species registry + honest movement settings  *(ticket E14-1)*

**Goal:** species-as-data foundation (implements E13-9) + the movement-panel
fixes from the raw notes (per-creature drag, retire "glide depth" naming, wag
frequency multiplier).

**Context:** architecture §3.1, §4.3. Facts: all movement params are class
statics mutated by the menu (`src/movement/tuning.js:12-48`, `menu.js:524-556`);
`Koi` overrides a few statics (`src/entities/koi.js`); `FishBase.CREATURE` is a
static (`fish-base.js:346-377`); persistence blob `koipond.tuning`
(`menu.js:345-357`); migration pattern `upgradeCreature` (`fish-base.js:284-314`).

**Steps:**
1. `src/species/species-registry.js` (new): registry modeled on
   `palette-manager.js` — builtins + customs, `getSpecies(id)`, CRUD, active id.
   Builtin `koi` record assembled from today's `Koi` statics + `FishBase`
   defaults + `FishBase.CREATURE` (architecture §3.1 schema, `schemaVersion: 1`).
2. `FishBase` takes `(grid, species)`; replace every `this.constructor.X` static
   read with `this.species.tuning.X` (keep the live-getter pattern — menu edits
   to the record must apply to living fish instantly). Delete `koi.js`; spawn
   sites (`main.js:50`, `menu.js:359-363`) use `new FishBase(grid, getSpecies('koi'))`.
   `Simulation`'s `constructor.PERCEPTION_RADIUS` read (`simulation.js:42`) →
   `entity.species?.tuning.perceptionRadius ?? 0`.
3. Menu: Movement + Shape sections bind to the **selected species record**
   (v1: single species, so binding swap is mechanical — `FishClass[p.key]` →
   `species.tuning[key]`; `liveCreature` → `species.body`). Keep `MOVEMENT_PARAMS`
   as the descriptor table, retarget its get/set.
4. **Drag rework** (architecture §2.2, §4.3): drag always-on
   (`v *= drag^(dt/1000)`, remove throttle gating at `fish-base.js:581-584`);
   move to `species.tuning.drag`; UI row "Water drag" with info text explaining
   it's the medium, per-creature. Remove the global GLIDE_DRAG row.
5. **Glide depth rename**: `CRUISE_GLIDE_MAX` becomes the coast-phase throttle
   ceiling ("Coast throttle") — still a single knob in P1 (full gait records come
   in P3); update label + info text to say what it actually does (the speed the
   fish tries to hold while coasting).
6. **Wag multiplier**: CREATURE v5 adds `motion.wagFreqMul` (default 1);
   `upgradeCreature` v4→v5 step; wag line (`fish-base.js:637`) multiplies by it;
   slider in the Shape live pane (0.25–4).
7. Persistence: species records save/load inside the existing blob for now
   (`species: [...]` key; full PondConfig migration is P7). Legacy load path maps
   old `params`+`creature` into the koi record.

**Accept:** pond behaves identically at defaults (except drag default — keep
`drag: 1.0` so zero behavior change); sliders still live-update fish; Copy
values exports a species record; refresh restores state; no console errors.

**Verify:** headless run + screenshot; slider edit → observe speed change;
localStorage round-trip; legacy-blob fixture loads.

---

## Phase 2 — Simulation performance  *(ticket E14-2)*

**Goal:** kill the O(n²) scan and the raster/allocation hot spots; raise the cap;
add a perf HUD. (F6; ties E1-5.)

**Context:** architecture §4.1, §4.5, §5.1. Facts: O(n²) at
`simulation.js:40-52`; string-keyed raster Sets at `fish-base.js:229-280`;
~5-6 Vec2 allocs/fish/frame in `behaviors.js`; `makeWidthFn` rebuilt per part
per frame; menu cap `FISH_MAX = 40` (`menu.js:17`).

**Steps:**
1. `src/sim/spatial-hash.js` (new): Int32Array heads/next, cell =
   max perception radius, `rebuild(entities)` + `query(x, y, r, out)` — zero
   steady-state allocations. Wire into `Simulation.update`, one shared scratch
   neighbor array.
2. Behaviors → scalar accumulation into a reused `(fx, fy)` out-param (drop
   per-call Vec2s; keep the math identical — this is mechanical).
3. Raster: integer cell keys (`cy * 4096 + cx`) in reused structures; cache
   `makeWidthFn` per creature revision (bump a `_rev` on every editor mutation);
   emit fill spans directly where dedup isn't needed.
4. Perf HUD in the Debug section: per-phase ms (index/perceive/decide/integrate/
   draw/upload), p50/p95, entity count. Off by default.
5. Raise `FISH_MAX` to 150; document measured results in the ticket.

**Accept:** identical visuals; 150 fish ≥ 60fps desktop / 80 ≥ 60fps mid-Android
(or best-achieved documented); HUD numbers plausible; no steady-state GC churn
(DevTools allocation sampling).

**Verify:** before/after HUD captures at n = 40/80/150 recorded in the ticket.

---

## Phase 3 — Move styles: gait loops, arbiter, wag curves, preview  *(ticket E14-3)*

**Goal:** styles-as-data (F2, F13). Burst becomes one style record; Flow ships;
the wag preview ships.

**Context:** architecture §3.2, §4.3. Facts: throttle machine
`fish-base.js:521-537`; single `swim` state `states.js:26-56`; live preview infra
`menu.js:883-908` (`#shape-live` S-weave).

**Steps:**
1. `src/movement/move-styles.js` (new): MoveStyleRegistry + builtin `burst`
   (today's numbers as data) and `flow` records; TriggerRegistry with `always`,
   `attractPoint`, `neighborCount`.
2. Generalize `_updateThrottle` to N `gait.phases`; throttle/hold re-sampling and
   ease exactly as today.
3. Arbiter (`src/movement/arbiter.js`): walk `species.styles`, first passing
   trigger wins, minMs/cooldownMs hysteresis. `states.js` collapses into it
   (style.steering multiplies species weights — same composition point,
   `fish-base.js:564-572`).
4. Wag: freq/amp from style curves + `wagFreqMul` (architecture §4.3 formula).
5. **Style preview**: menu panel (Shape live pane or new "Movement styles"
   sub-section) cycling the creature through its styles' throttle sweep
   slowest→fastest, style name overlaid — reuse the `#shape-live` rAF pattern.
6. Species editor: style list with enable/reorder (simple v1: checkboxes +
   up/down).

**Accept:** default koi (burst+flow) visibly alternates gaits; wag frequency
audibly-visibly varies with throttle *and* with the multiplier; no arbiter
flapping (log transitions in debug HUD); preview shows transitions.

**Verify:** headless screenshots at intervals; transition log sanity; slider
sweep on wagFreqMul.

---

## Phase 4 — Omni low-speed locomotion  *(ticket E14-4)*

**Goal:** the RCS/fin model (F3): heading decoupled below the speed band,
body-frame fin thrust, fin animation channels.

**Context:** architecture §4.2. Facts: gTurn gate `fish-base.js:620-633`
(smoothstep 0..0.15 — reuse as the blend band); turn clamp
`fish-base.js:598-608`; fin channels `finSpineFrame` (`fish-base.js:182-198`);
renderer derives orientation from velocity — switch to `heading`.

**Steps:**
1. `species.omni` block (lo/hi/finTurnRate/finThrust) + defaults.
2. Actuator: blend `w = smoothstep(omni.lo, omni.hi, speedFrac)`; maneuver branch
   rotates heading toward `faceDir` at finTurnRate, decomposes desired force into
   body frame, clamps per axis by finThrust; cruise branch = today's path.
3. Renderer uses `heading` for body orientation (converges with velocity in
   cruise — no visual change above the band).
4. Fin animation: map body-frame thrust to flap channels (lateral → outer-side
   flaps, reverse → forward-sweep) layered onto swayOnTurn/flapOnAccel. Iterate
   visually against the preview.
5. Showcase intent: `faceDir`-only intents (face food without approach) work —
   needed by P5 etiquette.

**Accept:** a near-stationary fish can rotate in place (no body bend), sidestep,
and back up slowly; above the band, behavior is unchanged; fins visibly work
during maneuvers.

**Verify:** scripted scenario — spawn one fish, give it face/sidestep intents via
debug hooks, record screenshots; regression-check cruise behavior.

---

## Phase 5 — Behavior styles: inspect, feed etiquette, greet, school  *(ticket E14-5)*

**Goal:** the style catalog (F4, F5) on top of P3+P4.

**Context:** architecture §3.2, §4.4. Facts: no food system exists — tap =
recolor (`main.js:85-92`); E12-1 will add pellets; this phase needs a **minimal
pellet entity** (coordinate with E12: colored dot entity, sinks via layer hook
if P6 landed, despawns) unless E12-1 has shipped first.
Neighbor lists come from P2's hash.

**Steps:**
1. Minimal `FoodPellet` entity (or consume E12-1 if present): position, layer
   lerp target, TTL; spawned by tap (behind a menu toggle so tap-recolor remains
   default until E12 decides).
2. `inspect` style: slowEntityNearby trigger; approach → hold at standoff →
   face (omni). Shared maneuvering base for feed.
3. `feed` style + etiquette: `eatCooldownMs` on individuals; rival logic (1 rival
   → face-only; ≥2 → ignore) exactly as raw-notes; eat = despawn pellet + set
   cooldown.
4. `greet` (scope-down lever — cut first if needed): creatureEncounter trigger,
   brief mutual inspect, cooldown.
5. `school` style: alignment/cohesion-heavy weights, neighborCount trigger;
   tune at n=80–150 (P2 makes this possible).

**Accept:** drop food among 3 fish with staggered cooldowns → correct etiquette
(first eats, second faces, third ignores); schooling at 100+ looks coherent;
styles hand off without flapping.

**Verify:** scripted etiquette scenario with forced cooldowns; screenshots;
transition logs.

---

## Phase 6 — Depth layers  *(ticket E14-6)*

**Goal:** LayerStack + tint filters + buckets + lock + lerp (F7, F8, F14 hooks).

**Context:** architecture §3.3, §5.2. Facts: flat-color cell rendering makes
tints free (`grid.drawCell`, one rgb per part, `fish-base.js:653`); draw order is
array order (`simulation.js:59-61`); ripple overlay draws above fish
(`main.js:208-209`) and stays topmost.

**Steps:**
1. Layer records in pond state; default stack generator (N black steps; default
   N=1, a=0 → zero visual change); menu section: layer count + per-layer tint
   color/alpha rows (+ dormant caustics opacity/exclusive fields, persisted but
   inert until E7-8..12).
2. Entity `layer {from, to, t}`; effective tint mix; drawColor mix before the
   cell loop.
3. Per-layer buckets in Simulation; draw floor-first; entities swap buckets when
   `t` crosses 0.5.
4. `species.render.layerLock`; layer-lerp API (`entity.moveToLayer(id, ms)`) —
   food sinking consumes it (wire into P5's pellet if present).
5. Stamp the caustic mask hook points (no-op functions + doc comments) per
   architecture §3.3 so E7-8..12 lands against a stable interface.

**Accept:** 3-layer demo pond shows visible depth striation; a floor-locked
entity stays put; a pellet sinks smoothly through tints; ripples still render on
top; single-layer default is pixel-identical to today.

**Verify:** screenshots at N=1 (diff vs baseline) and N=3; lerp capture.

---

## Phase 7a — Shader cartridges  *(ticket E14-7)*

**Goal:** compositor pass graph + cartridge registry + first cartridges +
paper-shaders adapter (F9, F10; absorbs E7-6; infra for E11).

**Context:** architecture §3.4, §5.3. Facts: single-program compositor, no FBOs
(`compositor.js:277-376`); dormant `uploadWave`/`setWater`
(`compositor.js:386-402`, never called); menu auto-rows via `makeRow`
(`menu.js:438-522`); Apache-2.0 `@paper-design/shaders` (adapt fragments, add
`docs/THIRD-PARTY-LICENSES.md`).

**Steps:**
1. Compositor: one FBO + second program slot; stage A (cartridge) → stage B
   (existing post). No cartridge → skip stage A (identical cost/pixels — verify
   with a diff).
2. `src/renderer/cartridges.js`: registry (architecture §3.4 record), uniform
   plumbing by param name, `wantsWave` wiring — call `uploadWave(rippleField._src …)`
   when needed (this lights up the dormant path).
3. Builtin cartridges: `terminal` (phosphor ramp green/red/amber, scanlines,
   cheap glow) and `gbc` (4-tone quantize + ordered dithering + LCD grid).
   Retire E7-6's scope note (absorbed).
4. Paper adapter: port their `water` shader through a thin uniform-mapping
   wrapper; register as a cartridge (`wantsWave: true`); add license/notice file.
5. Per-species shader batch infra: batch masks (small canvases stamped from
   existing cell sets), cap 4; a `glass` species shader proof using the border
   glass math (E11-4 alignment).
6. Menu: cartridge picker + auto-generated param rows; persist choice.

**Accept:** cartridge off = pixel-identical baseline; terminal + GBC + paper
water each render correctly and hit 60fps at default resolution; a glass-shader
species renders through a batch mask; params live-update.

**Verify:** screenshot per cartridge; baseline diff with cartridge off; fps HUD
numbers recorded.

---

## Phase 7b — Pond config  *(ticket E14-8)*

**Goal:** PondConfig schema + migration + save/export/import (F11; concretizes
E6-6).

**Context:** architecture §3.5, §6. Facts: blob shape at `menu.js:345-357`;
`upgradeCreature` migration pattern; palettes in separate key.

**Steps:**
1. `src/pond/pond-config.js`: schema v1, `upgradePond` version routing,
   legacy `koipond.tuning` → v1 migration (keep `.bak` copy one release).
2. Storage: `koipond.pond` (active) + `koipond.ponds` (named saves).
3. Menu: Pond section — name, Save/Load list, Export (clipboard JSON, embeds
   custom species/palettes), Import (paste → validate → apply).
4. Update the sprintboard-usage skill if any workflow conventions changed.

**Accept:** legacy users migrate losslessly; save/switch between two named ponds
with different cartridges/layers/rosters; export → wipe storage → import
restores exactly.

**Verify:** scripted localStorage fixtures (legacy + v1); round-trip diff.

---

## Sequencing & parallelism

```
P1 ──▶ P2 ──▶ P3 ──▶ P4 ──▶ P5
        │      └────────────┐
        └──▶ P6 ────────────┼──▶ P7b
               └──▶ P7a ────┘
```

P6 needs only P1 (records) + P2 (buckets touch the same loop). P7a needs P1;
benefits from P6 for batch/caustic interplay. P5 wants P4 (face-only intents)
and a pellet (E12-1 or its minimal stand-in). Two agents can run (P3-chain) and
(P6/P7a) in parallel after P2 — per the CLAUDE.md fan-out convention, give each
story this file + architecture.md as context.
