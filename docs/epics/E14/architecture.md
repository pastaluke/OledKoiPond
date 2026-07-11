# E14 — Entity / Creature / Pond Architecture

> **Doc of record** for the creature-class-as-data pivot. Derived from the feature
> list in `raw-notes-2026-07-11.md` (method: features first, structure second).
> Running summary: `design-brief.md`. Execution: `implementation-plan.md`.
> Grounded in a full code audit (2026-07-11); all file:line references verified.

---

## 0. Method — features force structure

Each feature the notes demand, and the structural decision it forces:

| # | Feature | Structural consequence |
|---|---------|------------------------|
| F1 | Movement settings become creature-specific; pond-wide "water resistance" removed | **Species record** owns all movement tuning; class statics migrate into data |
| F2 | Multiple move styles per creature; coast is a sub-state loop inside a style | **MoveStyle records** with a generalized **gait loop** (today's burst-and-coast throttle is one instance) |
| F3 | Low-speed omnidirectional fin movement; body-bend steering only at speed | **Two-regime actuator** (maneuver vs cruise) with heading decoupled from velocity at low speed |
| F4 | Feeding etiquette via eat-timers | Per-individual `eatCooldownMs` + O(neighbors) trigger predicate |
| F5 | Flow / inspect / greet / school styles | **Style arbiter** (priority stack with hysteresis) replacing the single `swim` state |
| F6 | Schools bigger than ~40 without chug | **Spatial hash** (kills the O(n²) scan) + allocation hygiene + raster fix |
| F7 | User-defined depth layers with color+opacity filters, per-layer caustic mapping | **LayerStack** in pond config; filters as **color-space tints** (free, given flat-color cell rendering) |
| F8 | Layer lock (snail) and layer-lerp transitions (food sinking, creatures diving) | Entity carries `{from, to, t}` layer state; tint = mix of adjacent layer tints |
| F9 | Per-creature/individual shaders, cheap | **Shader batches** (entities grouped by shader → shared mask), capped like glass shapes |
| F10 | Scene shader cartridges (terminal, GBC, N64, Aero, paper water) | Compositor grows a **two-stage pass graph** (cartridge FBO → existing post) + **cartridge registry** |
| F11 | Pond = saveable/shareable config | **PondConfig** schema; `koipond.tuning` migrates into it |
| F12 | Species authorable/importable without code | **SpeciesRegistry** (implements E13-9's locked "species are data" decision) |
| F13 | Wag frequency user multiplier + style-transition preview | Wag freq decoupled from throttle via per-style curves + `wagFreqMul`; preview reuses the live-pane infra |
| F14 | Food pellets sink through layers | Food = entity with layer-lerp; etiquette consumes it (coordinates E12) |

**Scope-down levers** (pre-agreed cuts if the list proves too big — the architecture
survives all of them): greet style; N64/Aero cartridges (keep terminal+GBC);
per-individual (vs per-species) shaders; sim LOD; named multi-pond saves (keep
single export/import).

---

## 1. Vocabulary

See `design-brief.md` for the definitions table (Entity, Creature, Species,
Individual, Move style, Layer, Shader cartridge, Pond). Those definitions are v1
and intentionally allowed to drift.

---

## 2. Current-state facts the design builds on

*(from the 2026-07-11 audit; details matter for migration)*

1. **Everything movement is a class static** (`FishBase` defaults, `Koi` overrides
   a few: `SPEED_MAX`, `SCHOOL_WEIGHT`, `PERCEPTION_RADIUS`, `SEPARATION_DIST`,
   sizes — `koi.js`). Menu sliders mutate statics live (`menu.js:537`); live
   getters (`maxSpeed`/`maxForce`/`maxTurnRate`/`cruiseSpeed`,
   `fish-base.js:491-515`) read them fresh each frame. → Species records are a
   *relocation*, not a rewrite.
2. **"Glide depth" = `CRUISE_GLIDE_MAX`** (`fish-base.js:431`): the throttle-target
   ceiling re-sampled at each glide phase (`fish-base.js:531`) — the speed the fish
   *intends to hold while coasting*. **"Water resistance" = `GLIDE_DRAG`**
   (`fish-base.js:438`, default **1.00 = no drag at all**), and it's gated by
   throttle (`fish-base.js:581-584`) so it only acts during glides. The two are
   entangled inside burst's throttle system — exactly the confusion the notes call
   out.
3. **Wag frequency rides the throttle**: `swimPhase += SWIM_BEAT_RATE(0.012) *
   motion.wagRate * _throttle * dt` (`fish-base.js:637`); amplitude = `_throttle`
   too. One gait ⇒ one visible frequency; only amplitude is meaningfully tunable.
4. **Neighbor query is O(n²)** (`simulation.js:40-52`); `src/grid.js` is the
   *display* grid, not a spatial partition. The comment targets n<30; menu caps 40.
5. **Steering bend is already speed-gated**: `gTurn = smoothstep(0, 0.15,
   speed/maxSpeed)` (`fish-base.js:625`) — a near-stopped fish holds its body
   straight. The omni regime slots into this exact gate.
6. **Render**: one Canvas2D (`#pond`) → full `texImage2D` upload → one monolithic
   fragment shader → `#webgl` (`compositor.js:368-376`). No FBOs, no
   `globalCompositeOperation` anywhere, draw order = array order. Fish are
   **flat-colored cell art** (`grid.drawCell` fillRects, one `rgb()` per part).
7. **Dormant GPU water path**: `compositor.uploadWave()` / `setWater()` and the
   `uWaveTex` refraction branch exist (`compositor.js:116-123, 386-402`) but are
   never called. RippleField's `_src` Float32 height field is exactly the expected
   input.
8. **Biggest frame costs**: (a) the O(n²) scan, (b) polygon rebuild + scanline
   rasterization into **string-keyed Sets** (`"cx,cy"`, `fish-base.js:229-280`)
   every frame per fish, (c) full-canvas GPU upload. `makeWidthFn` rebuilt per part
   per frame instead of cached.
9. **Persistence**: kitchen-sink blob `koipond.tuning` (`menu.js:345-357`) +
   `koipond.palettes`. `upgradeCreature` (`fish-base.js:284-314`) is the
   established migration pattern (schemaVersion routing).
10. **Simulation is type-agnostic already** (`simulation.js` flat `entities[]`,
    polymorphic `update`/`draw`; only coupling is `constructor.PERCEPTION_RADIUS`).
11. **E13-9 locked decision** (entity-customization-plan): species and individuals
    are DATA, not JS subclasses; `FishBase` stays the single engine class.
12. **Paper Shaders**: `@paper-design/shaders` (vanilla) — **Apache 2.0**. Catalog
    includes `water`, `dithering`, `image-dithering`, `god-rays`, `fluted-glass`,
    `liquid-metal`, `metaballs`, `voronoi`, `waves`.

---

## 3. Data model

Three registries + instances + one config. All records are plain serializable
JSON; registries follow the palette-manager pattern (`palette-manager.js`:
builtin array + customs merged from storage, CRUD, active id).

### 3.1 Species (SpeciesRegistry)

```js
Species = {
  schemaVersion: 1,
  id: 'koi', name: 'Koi', builtin: true,

  body: CREATURE,               // existing schema (v4 → v5, see below), unchanged shape:
                                // { spline, motion, appendages, patterns }

  tuning: {                     // ← migrated from class statics (MOVEMENT_PARAMS keys)
    speedMax: 0.051, turnRateMax: 2.4, forceMax: 0.00003,
    perceptionRadius: 42, separationDist: 20,
    separation: 0.40, alignment: 0.35, cohesion: 0.65, wander: 0.40,
    edge: 0.80, edgeYield: 0.45, school: 0.14,
    drag: 1.0,                  // per-second velocity retention (0.9–1.0 useful range).
                                // ALWAYS ON (not throttle-gated). Replaces pond-wide
                                // "water resistance"/GLIDE_DRAG semantics. UI label:
                                // "Water drag" with a real explanation.
  },

  omni: {                       // F3 — low-speed maneuvering regime
    lo: 0.05, hi: 0.18,         // speedFrac blend band (generalizes the gTurn 0..0.15 gate)
    finTurnRate: 6.0,           // rad/s heading rotation when maneuvering (no body bend)
    finThrust: { forward: 1.0, reverse: 0.35, lateral: 0.55 },  // × forceMax, body-frame
  },

  styles: [                     // ordered style assignments (arbiter walks top-down)
    { styleId: 'feed',   params: {} },
    { styleId: 'flow',   params: {} },
    { styleId: 'burst',  params: {} },   // last = default fallback
  ],

  render: {
    shaderId: 'vanilla',        // per-species shader (F9/E11): 'vanilla' | 'glass' | …
    layerLock: null,            // e.g. 'floor' for a snail (F8)
    paletteId: null,            // null = pond's active palette
  },

  sizes: { min: 10, max: 18, curve: 'normal' },   // + E13-8 keyframes when built
}
```

- **CREATURE v5** = v4 + `motion.wagFreqMul: 1.0` (F13) — one `upgradeCreature`
  step. Points stay `[t, halfWidth]` tuples; `pivotT` stays scalar (as shipped).
- **Individual** (FishBase instance) keeps per-instance rolls only: `speciesId`,
  `length/_sizeFrac`, `_speedJitter`, `color`, phase seeds, `eatCooldownMs: 0`,
  `layer: { from, to, t }`, gait state, arbiter state.
- **Engine migration**: `FishBase` constructor takes `(grid, species)`; every
  `this.constructor.X` read becomes `this.species.tuning.X` (same live-read
  semantics — menu edits to the record apply instantly). `Koi` class dissolves
  into the builtin `koi` species record. `Simulation`'s one coupling
  (`constructor.PERCEPTION_RADIUS`) becomes `entity.species.tuning.perceptionRadius`
  with a fallback for non-creature entities.

### 3.2 MoveStyle (MoveStyleRegistry)

```js
MoveStyle = {
  id: 'flow', name: 'Flowing', builtin: true,

  speed: { min: 0.15, max: 0.55 },       // × species speedMax — the style's envelope

  gait: {                                // generalized burst-and-coast (F2)
    phases: [                            // cycled in order; each entry re-samples
      { name: 'press', throttle: [0.35, 0.6], ms: [900, 2200] },
      { name: 'coast', throttle: [0.10, 0.25], ms: [1200, 3600] },  // ← coast is a
    ],                                   //    sub-state, per the notes. "Glide depth"
    easeMs: 300,                         //    becomes this phase's throttle ceiling.
  },

  wag: {                                 // F13 — frequency decoupled from throttle
    freqFloor: 0.35,                     // fraction of full beat rate at throttle 0
    ampFloor: 0.15,                      //   (coasting fish still wags, slowly — organic)
  },                                     // final freq = SWIM_BEAT_RATE · wagRate ·
                                         //   wagFreqMul · lerp(freqFloor, 1, throttle)

  steering: {                            // behavior weights this style applies
    separation: 1.0, alignment: 0.4, cohesion: 0.4, wander: 1.2, edges: 1.0,
  },                                     // (multipliers over species.tuning weights)

  trigger: { id: 'always' },             // TriggerRegistry predicate + params
  minMs: 1500, cooldownMs: 0,            // hysteresis so the arbiter doesn't flap
}
```

**Builtin styles v1**: `burst` (today's exact behavior expressed as data:
press `[0.85,1.0]` / coast `[0, 0.19]` with today's ms ranges), `flow` (above),
`inspect` (approach + face a slow/stationary target, shared maneuvering base),
`feed` (inspect + etiquette + eat), `school` (alignment/cohesion-heavy, tuned at
scale), `greet` (brief mutual inspect between creatures — scope-down lever).

**Triggers** are named predicates in code (`TriggerRegistry`), referenced by id
with params from data — data-driven without eval. v1 triggers: `always`,
`foodPerceived`, `attractPoint`, `slowEntityNearby`, `neighborCount≥k`,
`creatureEncounter`.

**Arbiter**: walks `species.styles` top-down each tick; first style whose trigger
passes and whose hysteresis allows wins. Replaces `states.js`'s single `swim`
(which becomes the degenerate case: one style, `always`).

### 3.3 Layers (in PondConfig)

```js
Layer = {
  id: 'floor', name: 'Pond floor', order: 0,        // 0 = deepest, drawn first
  tint: { r: 0, g: 0, b: 0, a: 0.55 },              // the depth filter (F7)
  caustics: { opacity: 1.0, exclusive: false },      // interface for E7-8..12
}
```

- **Default stack generator**: N layers → black tints with alpha stepped
  linearly top→bottom (the notes' "single linear step, very high opacity black"),
  N user-editable, default N=1 (a=0 — today's look, zero visual change).
- **Tint application is color-space, not compositing**: fish are flat-colored
  cell art, so the depth filter is
  `drawColor = mix(entityColor, tint.rgb, tint.a)` — computed **once per entity
  per frame**, zero extra canvas work. This is the cheapest possible correct
  implementation of the notes' filter and it makes layer-lerp free:
  `tint = mix(layers[from].tint, layers[to].tint, t)`.
- **Draw order**: per-layer bucket arrays (entities move buckets on layer change;
  no per-frame sort). RippleField overlay stays above all (it's the surface).
- **Caustics** are *not built here*; the layer record carries the fields
  (`opacity`, `exclusive`) and E14 stamps the per-layer mask hook points so
  E7-8..12 can land against a stable interface.
- **Collision/avoidance ignores layers** (locked decision v1).

### 3.4 Shader cartridges (ShaderCartridgeRegistry)

```js
ShaderCartridge = {
  id: 'terminal', name: 'Retro terminal', builtin: true,
  frag: `…GLSL…`,                        // uniform conventions: uTex, uRes, uTime,
  wantsWave: false,                      //   uWaveTex (if wantsWave), + params below
  params: {                              // → menu rows auto-built via makeRow
    phosphor: { label: 'Phosphor', min: 0, max: 2, default: 1, step: 1 },  // green/red/amber
    scanline: { label: 'Scanlines', min: 0, max: 1, default: 0.35 },
    glow:     { label: 'Glow', min: 0, max: 1, default: 0.4 },
  },
}
```

**Pipeline**: the compositor grows from one program to a **two-stage graph**:

```
pond canvas ──upload──▶ sceneTex ──[cartridge frag]──▶ FBO_A ─┐
                                   (skipped if none)          ├─▶ [post frag: water refr,
rippleField._src ──uploadWave──▶ waveTex ─────────────────────┘    border glass, shapes,
                                                                   chroma-key] ──▶ screen
```

- One FBO, two programs. If no cartridge is active, stage A is skipped and the
  post stage samples sceneTex directly — **today's path, unchanged cost**.
- **Lights up the dormant water path**: `rippleField._src → uploadWave()` runs
  when `cartridge.wantsWave || water refraction enabled` (tiny upload: ≤260-wide
  luminance grid).
- **First cartridges** (pure post, cheapest, ship first): `terminal`
  (mono phosphor ramp + scanlines + cheap glow), `gbc` (4-tone quantize +
  Bayer/ordered dithering + LCD grid). These **absorb E7-6** (its
  none/lcd/gbc/game-watch presets become cartridges).
- **Paper Shaders adapter** (Apache 2.0): thin wrapper mapping their uniform
  conventions to ours; port `water` first (as an alternative water look and to
  learn from it), then `dithering`/`image-dithering` to power `gbc`. Attribution:
  add `docs/THIRD-PARTY-LICENSES.md` (Apache 2.0 requires license + notice
  propagation for adapted code).
- **N64 / Frutiger Aero** are *composite* looks needing layer masks and baked-light
  textures — explicitly later cartridges, after the caustics/mask work (E7-8..12).
- **Per-species shaders (F9 / E11)**: `species.render.shaderId`; entities sharing
  a GPU shader are stamped to a shared **batch mask canvas** (like E11-4's
  fish-mask design), batches capped (4, mirroring MAX_SHAPES). E14 builds the
  batching/mask infrastructure; E11 stories provide the actual glass fish pass.

### 3.5 PondConfig

```js
PondConfig = {
  schemaVersion: 1, name: 'My pond', savedAt: '…',
  display: { density, worldShortEdge },
  layers: [Layer, …],
  cartridge: { id, params } | null,
  water: {…}, rain: {…}, border: {…}, glassShapes: […],
  paletteId: 'koi-classic',
  species: [Species, …],                 // customs inline; builtins as {id, overrides}
  roster: [ { speciesId: 'koi', count: 5 }, … ],
}
```

- **Storage**: `koipond.pond` (active) + `koipond.ponds` (named saves, F11).
  One-time migration folds `koipond.tuning` → PondConfig v1 (statics →
  `species[koi].tuning`, `creature` → `species[koi].body`), using the
  `upgradeCreature` version-routing pattern. `koipond.palettes` stays separate;
  export embeds referenced customs.
- **Share** = JSON export/import (clipboard/file). This *is* E6-6's preset bundle
  concretized; the E6-7 browser UI stays future.

---

## 4. Simulation stepping

Fixed phase order per tick (replaces the current inline flow in
`simulation.js`/`fish-base.js:545-640`; keeps clamped variable dt):

```
1. INDEX    build spatial hash                              O(n), zero-alloc
2. PERCEIVE per-entity neighbor query into a shared         O(n·k)
            scratch array (consumed immediately)
3. DECIDE   arbiter picks style; gait advances phase;       O(n)
            style + behaviors produce an INTENT
4. ACTUATE  intent → forces via the two-regime actuator     O(n)
5. INTEGRATE thrust + drag + clamps + position + layer.t    O(n)
6. ANIMATE  wag phase/amp, steering bend, fin channels      O(n)
7. DRAW     per-layer buckets → tinted cell rasterization   (see §5)
```

### 4.1 Spatial hash (F6)

Uniform grid, `cellSize = max(species.tuning.perceptionRadius)` (recomputed when
the roster changes). Flat Int32Array head/next linked lists (`heads[cells]`,
`next[n]`) rebuilt each tick — **zero allocations** after warm-up. Query = 3×3
cells. Replaces the O(n²) scan; at n=150 this is ~150·k checks instead of 22 350.

### 4.2 Intent → two-regime actuator (F3)

Style + behaviors produce:

```js
intent = { moveDir, targetSpeed, faceDir, throttle }   // scratch object, reused
```

Actuation blends by `w = smoothstep(omni.lo, omni.hi, |v|/speedMax)`:

- **Cruise regime (w→1)** — today's model, unchanged: heading slaved to velocity;
  Reynolds steering forces; hard turn-rate clamp (`fish-base.js:598-608`);
  steering bend drives body curve; tail wag = thrust animation.
- **Maneuver regime (w→0)** — the RCS model from the notes: heading decouples
  from velocity and rotates toward `faceDir` at `omni.finTurnRate` (body stays
  straight — the existing gTurn gate already guarantees bend ≈ 0 here);
  desired force decomposed into **body frame** and clamped per axis by
  `omni.finThrust.{forward, reverse, lateral} × forceMax` — sideways/backward
  translation possible but weaker than forward, exactly the fin-thruster feel.
- Renderer orients the body by `heading` (today it derives from velocity;
  in cruise they converge, so no visual change above the band).
- **Fin animation**: body-frame thrust components drive fin flap channels
  (lateral thrust → outer-side fin flaps, reverse → forward-sweep), layered on
  the existing `swayOnTurn`/`flapOnAccel` channels in `finSpineFrame`
  (`fish-base.js:182-198`). Tuned visually during implementation; the data hook
  is the thrust vector, already computed.

### 4.3 Gait + wag (F2, F13)

`_updateThrottle` (`fish-base.js:521-537`) generalizes verbatim to N phases from
`style.gait.phases` (same re-sample-on-phase-entry + exponential ease).
`CRUISE_GLIDE_MAX` ("glide depth") dies as a global — it becomes the coast
phase's throttle ceiling, per style, labeled honestly ("Coast throttle").
Drag becomes always-on per species (§3.1). Wag frequency:

```js
swimPhase += SWIM_BEAT_RATE * motion.wagRate * motion.wagFreqMul
           * lerp(style.wag.freqFloor, 1, throttle) * dt;
swimAmp    = lerp(style.wag.ampFloor, 1, throttle);
```

### 4.4 Etiquette (F4)

`eatCooldownMs` decays in INTEGRATE. The `feed` trigger, per fish, scans its
(already-fetched) neighbor list: rival = neighbor with smaller cooldown; 1 rival
→ face-only intent (`faceDir = food`, `moveDir = null` — an omni-regime showcase);
≥2 rivals → ignore. O(k), no new queries.

### 4.5 Allocation hygiene

Behaviors rewrite from Vec2-returning to scalar accumulation into a reused
`(fx, fy)` out-param (kills ~5–6 Vec2 allocs/fish/frame, `behaviors.js:31-69`);
shared neighbor scratch array; reused intent/ctx objects. The **raster fix**
(§5.1) is the single biggest win and has no visual effect.

### 4.6 Budget & levers

Targets: **150 creatures @60fps desktop, 80 @60fps mid-range Android** (from ~40
chugging). A perf HUD (frame-phase ms, p50/p95) ships with E14-2 (ties E1-5).
Held-back lever: staggered steering (DECIDE at half rate beyond N entities,
ANIMATE always per-frame) — documented, not built v1.

---

## 5. Rendering

### 5.1 Rasterization fix (perf, no visual change)

Replace the per-part `Set` of `"cx,cy"` **string** keys (`fish-base.js:229-280`)
with integer keys (`cy * STRIDE + cx`) in a reused set/typed scratch, and cache
`makeWidthFn` per creature revision (dirty-flag on editor mutation) instead of
rebuilding per part per frame. Fill path can emit row spans directly.

### 5.2 Layer tint pipeline (F7, F8)

Per entity per frame: `effTint = mix(layers[from].tint, layers[to].tint, layer.t)`;
`drawColor = mix(color, effTint.rgb, effTint.a)` → existing `grid.drawCell` path
untouched. Buckets drawn floor-first. Food "sinking" = `layer.t` tween + fade on
the floor timer (E12 consumes this hook). `species.render.layerLock` pins
spawn/transition targets.

### 5.3 Compositor pass graph + cartridges (F9, F10)

As §3.4. Implementation notes: FBO sized to canvas; `preserveDrawingBuffer` stays;
cartridge params map to uniforms by name; menu section auto-generated from
`params` via the existing `makeRow` factory (`menu.js:438-522`). Batch masks for
per-species shaders are small Canvas2D canvases stamped from the (already
computed) per-entity cell sets — only allocated while a batch shader is active.

---

## 6. Persistence & migration

- `PondConfig` v1 (§3.5); `loadPersisted` gains version routing:
  no `schemaVersion` → legacy `koipond.tuning` → migrate → save as `koipond.pond`.
- Section Resets keep working per-section (they reset slices of the active pond).
- Export = pretty JSON of PondConfig (+ embedded custom palettes/species);
  import = paste → validate (`upgradePond`) → apply → save.

---

## 7. What stays vs what changes

**Stays (proven, reused):** behavior registry & Reynolds steering math
(`behaviors.js`); CREATURE schema + editors + `upgradeCreature`; RippleField;
compositor post effects (border glass, shapes, chroma-key); `grid.drawCell`
renderer; `makeRow` menu factory; palette system; hold-to-attract; rain.

**Changes:** class statics → species records (engine reads `this.species`);
`states.js` → MoveStyle records + arbiter + TriggerRegistry; `simulation.js`
gains spatial hash + phase order + layer buckets; `fish-base.js` integrator
gains the two-regime actuator + always-on drag + N-phase gait; compositor
gains FBO + cartridge stage; persistence gains PondConfig.

---

## 8. Risks / open questions

1. **Feel-tuning the omni regime** — the math is simple; making it *read* as fins
   (not sliding) is animation tuning. Mitigation: dedicated preview (F13) and the
   fin-channel hooks; iterate visually.
2. **Style arbiter oscillation** — mitigated by minMs/cooldownMs hysteresis;
   keep triggers coarse in v1.
3. **Migration safety** — kitchen-sink blob → PondConfig touches every persisted
   user. Mitigation: version routing + keep legacy key as backup
   (`koipond.tuning.bak`) for one release.
4. **Cartridge shader portability** (paper GLSL ES conventions vs ours) — adapter
   layer isolates this; port one shader end-to-end before committing the adapter
   shape.
5. **Scope** — use the levers in §0; phases are independently shippable.

---

## 9. Coordination map

| Existing ticket | Relationship |
|---|---|
| E13-9 Creature class registry | **Implemented by** E14-1 (this doc §3.1 is its concrete spec) |
| E13-4 Muscle sim / bend-drives-turn | Cruise-regime body animation; omni regime slots under its speed gate |
| E13-8 Size & growth | `sizes` keyframes live on the Species record |
| E13-5 Menu class browser | Consumes SpeciesRegistry; unchanged scope, lands after E14-1 |
| E4-5 Entity config file | Satisfied by Species/registry + PondConfig |
| E4-8 Boids reference | Steering core retained; spatial hash fulfills its scaling notes |
| E1-5 Performance profiling | Perf HUD + budget lands in E14-2 |
| E7-6 Display filter shaders | **Absorbed** into cartridges (E14-7) |
| E7-8..12 Caustics / layers / sun | Layer record carries their interface; masks hook in E14-6 |
| E11 Fish shaders | Per-species `render.shaderId` + batch masks = E11-1/E11-4 infra |
| E12 Food | Pellet = entity with layer-lerp (E14-6 hook); etiquette (E14-5) consumes it |
| E6-6 Preset bundle format | **Concretized** as PondConfig export (E14-8) |
| E2-8 Rain | Untouched; wave texture reused by cartridges (`wantsWave`) |
