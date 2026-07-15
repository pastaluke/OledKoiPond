# E14 — Design Brief (running summary)

> **Purpose:** compact context-survival document. If a session dies, read this
> first, then `architecture.md` (full design), `implementation-plan.md`
> (execution phases), `raw-notes-2026-07-11.md` (founding notes).
>
> **Status:** DESIGN COMPLETE (2026-07-11). Ready for phased implementation.

## The pivot, in one paragraph

Creature-class-as-data is make-or-break. Instead of designing the architecture
top-down, we derived it from a concrete feature list (movement styles, per-creature
settings, depth layers, shader cartridges, pond-as-config). E14 is the
architecture of record for **Entity / Creature / Pond**; it implements E13-9,
absorbs E7-6, concretizes E6-6/E4-5, and provides the interfaces E7-8..12 (caustics),
E11 (fish shaders), and E12 (food) land against.

## Up-front definitions (v1 — okay to change later)

| Term | Definition |
|---|---|
| **Entity** | Anything simulated and drawn: creature, food pellet, bubble, snail. |
| **Creature** | A self-propelled entity: Species ref, motion state, move styles, animation. |
| **Species** | A **data record** in a registry (not a JS subclass): body (CREATURE), tuning (incl. per-creature drag), omni block, style list, render prefs, sizes. |
| **Individual** | Instance = species ref + per-instance rolls (size, color, jitter, seeds, eat-cooldown, layer state). |
| **Move style** | Per-creature locomotion cartridge: speed envelope, **gait loop** (press ↔ coast phases), wag curves, steering multipliers, trigger + hysteresis. |
| **Layer** | Depth plane: order (= draw order), **tint filter** (color+opacity), caustics interface fields. |
| **Shader cartridge** | Swappable scene render style (terminal, GBC, paper water, later N64/Aero) + per-species shader batches. |
| **Pond** | Saveable/shareable config: layers, cartridge+params, water/rain/border/shapes, species registry content, roster. |

## Locked decisions

1. **Paper Shaders licensing CLEARED** — `@paper-design/shaders`, **Apache 2.0**;
   adapt with attribution (`docs/THIRD-PARTY-LICENSES.md`). Catalog: `water`,
   `dithering`, `image-dithering`, `god-rays`, `fluted-glass`, `liquid-metal`.
2. **Drag is the medium, gait is the intent.** Per-species always-on drag replaces
   the throttle-gated global `GLIDE_DRAG` (which defaults to 1.00 = no drag today).
   "Glide depth" (`CRUISE_GLIDE_MAX` — the throttle ceiling re-sampled each glide,
   i.e. the speed a fish tries to hold while coasting) is renamed **Coast
   throttle** and becomes a per-style gait field.
3. **Coast is a gait sub-state**, not a style. Gait loop = N phases of
   `{throttle range, duration range}`; today's burst-and-coast is one style record.
4. **Two-regime actuator**: below a per-species speed band, heading decouples from
   velocity and fin thrust is body-frame clamped (forward/reverse/lateral) — the
   RCS model; above the band, today's Reynolds steering + turn clamp + body-bend.
   Blend band generalizes the existing `gTurn = smoothstep(0, 0.15, …)` gate.
5. **Wag frequency decoupled**: `SWIM_BEAT_RATE · wagRate · wagFreqMul ·
   lerp(freqFloor, 1, throttle)`; `wagFreqMul` is the new user knob (CREATURE v5);
   per-style freq/amp floors keep coasting fish subtly alive.
6. **Depth filters are color-space tints**, not canvas compositing — fish are
   flat-colored cell art, so `drawColor = mix(color, tint.rgb, tint.a)` is free
   and **layer-lerp = tint mix** (food sinking, creature diving). Draw order =
   per-layer buckets, floor first. Default 1 layer, alpha 0 → pixel-identical.
7. **Layers don't affect collision** (v1).
8. **Compositor grows a two-stage pass graph** (cartridge FBO → existing post);
   no cartridge = today's exact path. First cartridges: terminal, GBC (absorbing
   E7-6), paper water (`wantsWave` lights up the **dormant** `uploadWave` path
   that already exists in compositor.js but is never called).
9. **Per-species shaders via capped batch masks** (like MAX_SHAPES=4) — E11's
   infra lands here.
10. **Spatial hash kills the O(n²) neighbor scan** (`grid.js` is display-only —
    no partition exists today). Targets: 150 @60fps desktop, 80 mid-Android.
    Raster fix: integer keys replace `"cx,cy"` string Sets; cache `makeWidthFn`.
11. **Etiquette**: per-individual `eatCooldownMs`; 1 rival with smaller timer →
    face-only (omni showcase); ≥2 → ignore.
12. **PondConfig v1** replaces the `koipond.tuning` kitchen-sink blob (version-
    routed migration, `.bak` kept); named saves + JSON export/import = E6-6.

## Phases (see implementation-plan.md)

P1 species registry + drag/glide/wag fixes → P2 perf (hash, allocs, raster, HUD,
cap 150) → P3 styles/gaits/arbiter/preview → P4 omni locomotion → P5 inspect/
feed-etiquette/greet/school → P6 layers → P7a cartridges → P7b pond config.
P6/P7a can run parallel to P3–P5 after P2. Scope-down levers: greet, N64/Aero,
per-individual shaders, sim LOD, multi-pond saves.

## Status

- [x] Raw notes captured; license verified (Apache 2.0)
- [x] Codebase audit (movement/sim, render, schema/persistence) — findings in architecture.md §2
- [x] `architecture.md` + `implementation-plan.md` written
- [x] SprintBoard: E14 epic + tickets E14-1..8, cross-links updated
- [x] Paste-ready session prompts for all 3 implementation waves: `session-prompts.md`
- [x] **Wave 1 SHIPPED 2026-07-11** (E14-1 species registry + honest settings; E14-2 perf:
      hash exact vs brute force, draw −37..40%, update O(n·k), HUD, cap 150). Measured
      numbers in the E14-2 board ticket. Remaining draw lever: ImageData cell blit
      (fold into P6, which touches the draw path).
- [x] **Wave 2 SHIPPED 2026-07-11** — E14-3 (move styles/gaits/arbiter/preview),
      E14-4 (omni locomotion), E14-5 (feed etiquette/inspect/school), E14-7
      (shader cartridges v1: terminal/GBC/paper-water, wave feed, licenses).
- [!] **2026-07-15 playtest feedback**: cartridge v1 reads as guesses at the intent;
      direction under reconsideration toward in-fiction customization
      (`docs/idea-pond/customization-through-fiction.md`). Missing user-facing piece
      called out: saving multiple creature configs + mixed-species ponds → new
      **E14-9 (Phase L)**, now QUEUE #1.
- [ ] **EXECUTION QUEUE** (see implementation-plan.md, mirrored on the board's UP NEXT
      strip): 1 E14-9 creature library/roster → 2 E14-6 layers → 3-6 E7-8..11
      caustics/shadows/light → 7 E14-8 pond config. Single-session workflow only
      (parallel sessions retired after the 2026-07 collision).
