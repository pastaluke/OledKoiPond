# E14 — Implementation session prompts

> Paste-ready prompts for fresh sessions, one per wave. Sequencing rationale:
> **Wave 1 must be one sequential session** (P1 and P2 rewrite the same files —
> fish-base.js, simulation.js, menu.js). **Wave 2 fans out** into two parallel
> sessions with disjoint file ownership (movement chain vs renderer). **Wave 3**
> closes out (layers touch files both prior waves edited, so it runs after).
>
> Run a wave only after the previous wave is merged to `main`.

---

## Wave 1 — Foundation (single session, P1 → P2 in sequence)

```
Execution mode: implement E14 Phases 1 and 2 for OledKoiPond.

Setup: repo pastaluke/OledKoiPond, work on branch claude/koi-pond-sim-78hVO —
pull it before starting. Follow CLAUDE.md (merge dev → main and push when done)
and .claude/skills/sprintboard-usage/SKILL.md for board updates.

Read first, in order:
1. docs/epics/E14/design-brief.md            (the decisions, 2 pages)
2. docs/epics/E14/architecture.md            (§2 current-state facts, §3.1 Species schema, §4 sim stepping, §5.1 raster fix)
3. docs/epics/E14/implementation-plan.md     (Phase 1 and Phase 2 — your exact briefs, with file:line pointers, acceptance criteria, and verification steps)

Then implement, strictly in order (they share files — do NOT parallelize):

PHASE 1 (ticket E14-1) — Species registry + honest movement settings.
Per implementation-plan.md Phase 1: species-as-data registry (builtin koi record
assembled from today's Koi/FishBase statics); FishBase reads species.tuning with
the same live-read semantics; Koi class dissolves; menu Movement/Shape sections
bind to the selected species record; per-species always-on drag replaces the
throttle-gated GLIDE_DRAG (keep drag default 1.0 = zero behavior change);
"glide depth" relabeled Coast throttle with an honest description; CREATURE v5
adds motion.wagFreqMul (upgradeCreature step) with a slider.
Gate: pond is behavior-identical at defaults; sliders live-update fish;
localStorage round-trips; a legacy koipond.tuning fixture still loads.
Commit Phase 1 before starting Phase 2.

PHASE 2 (ticket E14-2) — Sim perf: spatial hash + zero-alloc + raster fix.
Per implementation-plan.md Phase 2: uniform spatial hash (Int32 heads/next,
zero steady-state allocation) replaces the O(n²) scan in simulation.js;
behaviors rewritten to scalar accumulation (no per-call Vec2s, identical math);
integer raster keys replace the "cx,cy" string Sets; cache makeWidthFn per
creature revision; per-phase perf HUD in the Debug menu section (off by
default); raise FISH_MAX to 150.
Gate: visuals identical; record before/after HUD numbers at n=40/80/150 in the
E14-2 ticket detail fields; no steady-state GC churn.

Verification (both phases): drive the real app headlessly (Chromium is
preinstalled; PLAYWRIGHT_BROWSERS_PATH is configured) — screenshots, console
clean, behavior spot-checks per the plan's Verify sections. Do not claim done
on typecheck alone.

Board: move E14-1/E14-2 through implementation → testing → live as they land,
per the skill. Do NOT start Phase 3+ — later phases run as separate sessions
(see docs/epics/E14/session-prompts.md).

Finish: merge dev branch → main and push (CLAUDE.md workflow).
```

---

## Wave 2 — run these TWO sessions in parallel (after Wave 1 is on main)

File ownership is disjoint: Session A owns `src/movement/*` + fish-base
update/animate + menu movement/preview sections; Session B owns
`src/renderer/*` + a new menu cartridge section. Neither touches the other's
region; conflicts should be nil-to-trivial.

### Session A — Movement chain (P3 → P4 → P5, sequential within the session)

```
Execution mode: implement E14 Phases 3, 4, 5 for OledKoiPond, in order.

Setup: repo pastaluke/OledKoiPond, branch claude/koi-pond-sim-78hVO — pull
first. Follow CLAUDE.md (merge dev → main when done) and
.claude/skills/sprintboard-usage/SKILL.md. NOTE: a parallel session may be
working on src/renderer/* (shader cartridges) — do not edit files under
src/renderer/, and pull/rebase before your final merge.

Read first: docs/epics/E14/design-brief.md, then architecture.md (§3.2
MoveStyle schema, §4.2 two-regime actuator, §4.3 gait+wag, §4.4 etiquette),
then implementation-plan.md Phases 3–5 (your exact briefs with acceptance
criteria and verification steps).

PHASE 3 (ticket E14-3): MoveStyle registry + builtin burst (today's numbers as
data) and flow records; N-phase gait generalization of _updateThrottle;
trigger registry + priority arbiter with minMs/cooldownMs hysteresis replacing
states.js; wag freq/amp from style curves × wagFreqMul; style-transition
preview panel (reuse the #shape-live rAF pattern); species style list UI.
Commit before Phase 4.

PHASE 4 (ticket E14-4): the omni low-speed regime — species.omni block; blend
w = smoothstep(omni.lo, omni.hi, speedFrac); maneuver branch rotates heading
toward faceDir at finTurnRate with body-frame thrust clamped by finThrust;
renderer orients body by heading; fin flap channels driven by body-frame
thrust. Gate: a near-stationary fish rotates in place without body bend,
sidesteps, backs up; cruise behavior unchanged. Commit before Phase 5.

PHASE 5 (ticket E14-5): minimal food pellet entity (behind a menu toggle;
coordinate with E12-1 scope if it shipped); inspect style; feed style with
eat-cooldown etiquette (1 rival with smaller timer → face-only; ≥2 → ignore);
greet (cut this first if scope presses); school style tuned at n=100+.
Gate: the scripted 3-fish etiquette scenario from the plan passes.

Verify each phase headlessly in the real app (screenshots + transition logs);
move each ticket through the board as it lands; merge dev → main at the end
(pull/rebase first — Session B may have merged).
```

### Session B — Shader cartridges (P7a)

```
Execution mode: implement E14 Phase 7a (ticket E14-7) for OledKoiPond.

Setup: repo pastaluke/OledKoiPond, branch claude/koi-pond-sim-78hVO — pull
first. Follow CLAUDE.md (merge dev → main when done) and
.claude/skills/sprintboard-usage/SKILL.md. NOTE: a parallel session is working
on src/movement/* and fish-base update/animate — do not edit those regions;
your surface is src/renderer/*, a new src/renderer/cartridges.js, main.js
wiring, and a new menu section. Pull/rebase before your final merge.

Read first: docs/epics/E14/design-brief.md, then architecture.md (§3.4 cartridge
record + pipeline diagram, §5.3), then implementation-plan.md Phase 7a.

Implement: compositor two-stage pass graph (one FBO + second program; no
cartridge = skip stage A — must be pixel-identical to baseline, prove it with
an image diff); cartridge registry with params → auto-generated menu rows via
the existing makeRow factory; wantsWave wiring that finally calls the dormant
compositor.uploadWave with rippleField._src; builtin cartridges 'terminal'
(phosphor green/red/amber, scanlines, cheap glow) and 'gbc' (4-tone quantize +
ordered dithering + LCD grid); the paper-shaders adapter porting their water
shader (@paper-design/shaders is Apache 2.0 — add docs/THIRD-PARTY-LICENSES.md
with license + notice); per-species shader batch-mask infra (cap 4) with a
'glass' species proof using the border-glass math.

Gate (per the plan's acceptance): baseline diff clean with cartridge off;
terminal/GBC/paper-water each render at 60fps at default resolution; params
live-update; screenshots of every cartridge recorded. Update E7-6 on the board
(absorbed — move/annotate per the skill), move E14-7 through the board, merge
dev → main at the end (pull/rebase first — Session A may have merged).
```

---

## Wave 3 — Closeout (single session, P6 → P7b, after BOTH Wave-2 sessions are on main)

```
Execution mode: implement E14 Phases 6 and 7b for OledKoiPond, in order.

Setup: repo pastaluke/OledKoiPond, branch claude/koi-pond-sim-78hVO — pull
first. Follow CLAUDE.md (merge dev → main when done) and
.claude/skills/sprintboard-usage/SKILL.md.

Read first: docs/epics/E14/design-brief.md, then architecture.md (§3.3 Layer
schema + tint math, §3.5 PondConfig, §6 persistence), then
implementation-plan.md Phases 6 and 7b.

PHASE 6 (ticket E14-6): LayerStack in pond state with default generator
(N black linear steps; default N=1 alpha 0 → must stay pixel-identical, prove
with a diff); entity layer {from,to,t} + effective-tint mix applied to the
draw color; per-layer draw buckets floor-first; species.render.layerLock;
moveToLayer(id, ms) lerp API wired into the food pellet's sinking if present;
stamp the caustic mask hook points (inert) for E7-8..12; menu section for
layer count + per-layer tint rows. Gate: 3-layer demo shows depth striation;
floor-locked entity stays put; pellet sinks smoothly; ripples still topmost.
Commit before Phase 7b.

PHASE 7b (ticket E14-8): PondConfig v1 + upgradePond version routing; one-time
migration from koipond.tuning (keep a .bak); koipond.pond + koipond.ponds named
saves; menu Pond section with Save/Load/Export/Import (export embeds custom
species/palettes). Gate: legacy fixture migrates losslessly; two named ponds
with different cartridges/layers/rosters switch cleanly; export → wipe →
import restores exactly.

Verify headlessly in the real app per the plan; move E14-6/E14-8 through the
board; this completes E14 — update design-brief.md status checkboxes and add a
completion note per the sprintboard skill. Merge dev → main and push.
```
