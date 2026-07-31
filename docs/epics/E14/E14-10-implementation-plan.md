# E14-10 — Implementation plan (movement-feel unify + Pets menu regroup)

**Ticket:** E14-10 · **Design doc:** `E14-10-movement-inventory.md` (§9–§11 = decisions
+ proposal; §11.7 = Agility math). This is the BUILD plan — the design is settled.

**User sign-off (2026-07-27):** coupling model ✔ · names as proposed ✔ · **full
Pets/Motion/Social menu regroup** ✔ · Flex point and the wag pivot stay **separate**
(user will test the ramifications) ✔ · Agility implemented as specced (user accepts
the seconds readout for now, wants to feel it in play before re-litigating the unit).

---

## 1. Scope

Retire the 3-way turning knob soup + the hidden size interpolation, surface the
omni regime as "Hovering" (Decision 3A), collapse the bend-look pair into one
shape knob, split the wag pivot from the bend hinge, and regroup the menu into
Pets ▸ {Body, Motion ▸ {Speed & gait, Turning, Hovering}, Social}.

**Out of scope** (future tickets, noted in the design doc): age snapshots (§10.1),
nibble feeding (§10.2), the richer in-menu creature preview the user described
(animated multi-creature / moving grid backdrop — see §7 Future).

---

## 2. Canonical data model changes

### `tuning` (species-registry `KOI_TUNING`)
| Was | Becomes | Default |
|---|---|---|
| `turnRateMax: 2.4` (rad/s) | **`agilitySec`** — seconds per U-turn | `1.309` (= π/2.4, today's feel) |
| `turnRateMin: 0.8` | *deleted* | — |

### `body` (CreatureDef, schemaVersion **5 → 6**)
| Was | Becomes | Default (koi) |
|---|---|---|
| `spline.maxBend: 1.2` | **`spline.bendDepth`** 0..1 | `0.48` (= 1.2/2.5) |
| `spline.bendWaist: 0.097` + `spline.bendBody: 0.297` | **`spline.flexSpread`** 0..1 | `0.5` (round-trips to the exact old pair) |
| — | **`turnStyle`**: `'none' \| 'bend'` | `'bend'` |
| — | **`motion.wagPivotT`** — wag origin, split from `spline.pivotT` | `0.173` (same as pivotT ⇒ no visual change) |

`spline.pivotT` survives unchanged as the **bend hinge** (UI label: *Flex point*).

### `omni`
| Was | Becomes | Default |
|---|---|---|
| `lo: 0.05`, `hi: 0.18` | **`hoverThreshold`** (band top; `lo = 0.28 × hi`) | **`0.32`** ⬅ set from a measured sweep, see §7 |
| `finTurnRate: 6.0` (rad/s) | **`pivotSec`** — seconds per in-place U-turn | `0.524` (= π/6) |
| `finThrust {forward, reverse, lateral}` | **`scoot`** 0..1 (`reverse = 0.7s`, `lateral = 1.1s`; forward stays 1.0) | `0.5` (round-trips to 0.35 / 0.55) |

`hoverThreshold = 0` ⇒ `w` pinned to 1 ⇒ **this creature never hovers** (retiring the
regime becomes a per-creature slider value, not a code decision).

### Retired globals
`FishBase.BEND_DRIVES_TURN` + the `#toggle-bend-turn` row + `fish.bendDrivesTurn`
in the save blob.

---

## 3. Math (see design doc §11.7 for derivation)

```js
// fish-base.js
export const BEND_DEPTH_SCALE = 2.5;          // bendDepth 0..1 → legacy maxBend units

get maxTurnRate() { return Math.PI / this.species.tuning.agilitySec; }   // rad/s, internal

// STEERING BOW (revised — see §9). ONE signed lateral profile along the body:
// zero at both tips, one smooth peak ahead of the flex point. Both bezier control
// points are sampled from it, so the spine is a single C by construction.
const peak = pivotT + (1 - pivotT) * (0.85 - 0.60 * spread);   // spread slides the apex
const amp  = steeringBend * length * BEND_BOW_GAIN;            // 0.198, calibrated
const bowAt = (p) => {
  const u = p <= peak ? p / peak : (1 - p) / (1 - peak);       // 0 at tips → 1 at apex
  return amp * Math.sin(Math.PI * 0.5 * clamp01(u));           // smooth through the apex
};
const TC = 2*bow(pivotT*0.5)     - 0.5*T - 0.5*W;              // each segment passes
const BC = 2*bow((pivotT+1)*0.5) - 0.5*W - 0.5*H;              // through the bow's midpoint

// Self-normalizing bend — replaces the `× 0.8` glue constant. frac = 1 exactly at
// THIS creature's hardest turn, so every creature reaches its full authored curve.
const frac = Math.min(1, Math.abs(turnRate) / this.maxTurnRate);
const targetBend = maxBend * frac * Math.sign(turnRate) * gTurn * w;   // maxBend = bendDepth × 2.5
// turnStyle 'none' ⇒ targetBend = 0 (creature shows no bend at all)

// Hovering, derived from the single threshold
const hi = omni.hoverThreshold, lo = hi * 0.28;
const w  = hi <= 0 ? 1 : _smoothstep(lo, hi, preSpeed / maxSpeed);
const maxYaw = (Math.PI / omni.pivotSec) / 1000 * deltaMs;
const revCap = 0.7 * omni.scoot, latCap = 1.1 * omni.scoot;
```

**Wag / bend-hinge split** (`buildCenterline`): geometry keeps `pivotT`; the wag
envelope switches to `wp = motion.wagPivotT ?? pivotT`:
```js
if (wagBase !== 0 && t < wp && wp > 1e-6) { const d = (wp - t) / wp; … }
```
⚠ Known ramification (user accepted, wants to test): the wag envelope zeroes at
`wagPivotT`, so when it ≠ `pivotT` the wag no longer vanishes exactly at the
geometric hinge — C¹ continuity there is only guaranteed when they coincide. If
`wagPivotT > pivotT` the front segment picks up some wag. Defaults are equal, so
nothing changes until the user moves one.

---

## 4. Migrations (load-time; nobody's pond changes feel)

| Source | Rule |
|---|---|
| `tuning.turnRateMax` | `agilitySec = π / turnRateMax` |
| `tuning.turnRateMin` | dropped |
| `spline.maxBend` | `bendDepth = clamp(maxBend / 2.5, 0, 1)` |
| `spline.bendWaist/bendBody` | `total = w+b; wFrac = w/total; flexSpread = clamp((wFrac − 0.246)/0.49 + 0.5, 0, 1)` |
| `spline.pivotT` | `motion.wagPivotT = pivotT` (keeps today's single-pivot look) |
| `omni.hi` | `hoverThreshold = hi` … **then** bumped to the new 0.26 default for existing users? **No** — preserve the user's value; only fresh/default records get 0.26. |
| `omni.finTurnRate` | `pivotSec = π / finTurnRate` |
| `omni.finThrust` | `scoot = clamp(lateral / 1.1, 0, 1)` (lateral is the more expressive of the pair) |
| legacy `TURN_RATE_MAX` blob key | special-cased in `applyLegacyValues` → `agilitySec = π / value` |
| `fish.bendDrivesTurn === true` in the save blob | for every species: `agilitySec = 0.8π / (bendDepth × 2.5)` — preserves that user's felt turn radius |

Old keys are **deleted** after conversion so Copy-values JSON stays clean.

---

## 5. Menu structure

```
Pets
 ├─ Creature ▾  · Duplicate / Rename / Delete
 ├─ Filled in · Feed on tap · Food bag ▾ (+ palette editor)
 ├─ Body            ← today's Shape editor, unchanged content
 ├─ Motion
 │   ├─ Speed & gait   Max speed · Water drag · Coast throttle · Burst time · Glide time
 │   │                 + the move-style preview canvas
 │   ├─ Turning        Agility · Turn style ▾ · Bend depth · Flex point · Flex spread
 │   └─ Hovering       Hover threshold · Pivot speed · Scoot
 │   └─ [Copy values] [Reset]   (whole tuning block — Motion + Social)
 └─ Social          Separation · Alignment · Cohesion · Wander · Edges · Edge yield
                    · School · Sep dist · Perception
```

- `MOVEMENT_PARAMS` gains a **`group`** field (`'gait' | 'turning' | 'social'`); the
  menu builds one host per group instead of one flat list. Range-button/persistence
  plumbing is untouched.
- **Turn-style extras**: Bend depth / Flex point / Flex spread show only when
  `turnStyle === 'bend'` — reuse the shipped Caustics `extras` show/hide mechanic.
- Section subtitles do the teaching: *"Turning — while swimming; turns are arcs"* /
  *"Hovering — stopped or slow; pivots in place"*.
- Nested `<details>`: existing `#menu-panel details > summary` CSS already matches
  nested ones; add a small indent + dimmer sub-summary rule.
- Non-tuning knobs (bend look on `body`, hover on `omni`) are built with direct
  get/set closures (the Shape editor's `mkSpine` pattern), not via `MOVEMENT_PARAMS`.

---

## 6. File-by-file

1. **`src/species/species-registry.js`** — KOI_BODY (`turnStyle`, `bendDepth`,
   `flexSpread`, `motion.wagPivotT`; drop maxBend/bendWaist/bendBody),
   KOI_TUNING (`agilitySec`; drop turnRate{Max,Min}), KOI_OMNI
   (`hoverThreshold`/`pivotSec`/`scoot`), `schemaVersion: 6` + the v5→v6 upgrade,
   `_mergeOmni` for the new shape, tuning migration.
2. **`src/entities/fish-base.js`** — `BEND_DEPTH_SCALE` + `BEND_BOW_GAIN` exports;
   `maxTurnRate` from `agilitySec`; `buildCenterline` uses the steering bow +
   `wagPivotT`; self-normalizing bend + `turnStyle 'none'`; omni derivations;
   delete `BEND_DRIVES_TURN`.
3. **`src/movement/tuning.js`** — `agilitySec` param (replaces `turnRateMax`),
   `group` on every param, legacy `TURN_RATE_MAX` special-case.
4. **`src/ui/menu.js`** — panel HTML regroup, per-group slider hosts, Turning +
   Hovering sections, turn-style extras, remove the bend-turn toggle + its
   persistence, `bendDrivesTurn` migration hook.
5. **`index.html`** — nested-details indent CSS.

---

## 7. Verification

- Parse-check all touched modules; load the pond headless with **no console errors**.
- **Feel-preservation**: with a fresh profile, fish trajectories should be
  indistinguishable from pre-change except for the intentional 3A hover change.
  Assert numerically: `π/agilitySec === 2.4`, every sampled spine offset shares one
  sign (single C, never an S),
  scoot 0.5 → (0.35, 0.55), pivotSec 0.524 → 6.0 rad/s.
- **3A visible**: log the mean `_maneuver` (= 1−w) across fish over ~10 s; it must be
  clearly > 0 in normal play (it is ≈0 today). Screenshot fish hovering/pivoting.

### Measured: picking the hover threshold (2026-07-27)

The plan originally guessed 0.26 by comparing against the **burst** style's coast
throttle (0.19). That was the wrong comparison — koi idle on the **flow** style,
whose coast phase runs 0.14–0.30. Measured the real distribution instead (1000
samples, live pond): speed/maxSpeed **p10 = 0.171, p50 = 0.291, p90 = 0.409**.

Sweep of mean hover blend (`_maneuver`, 150 frames × all fish):

| threshold | mean blend | frames > 25% hover | verdict |
|---|---|---|---|
| 0.18 *(old default)* | **0.020** | 2.9% | invisible — confirms Finding #3 empirically |
| 0.26 *(planned)* | 0.093 | 13.1% | present but occasional |
| **0.32 (shipped)** | **0.179** | **26.3%** | clearly visible; ¾ of the time still ordinary swimming |
| 0.38 | 0.317 | 49.3% | hovering starts to dominate the pond's feel |
| 0.45 | — | — | (not sampled; trend continues) |

0.32 was chosen as the default: ~9× the old mean, unmistakable in play, without
turning the pond into hovercraft. It is one slider — dial to taste, 0 = never hover.
- **Migration**: load a pre-change persisted blob (synthesized) and confirm the
  derived values match the table in §4.
- **Menu**: every section opens; turn-style extras show/hide; `turnStyle: 'none'`
  hides all three bend rows and the fish visibly stops bending; Hover threshold 0
  pins the creature to pure swimming.
- Screenshot the regrouped panel.

---

## 8. Future (captured, not built here)

- **Age snapshots** (design doc §10.1) — every knob added here is a plain lerpable
  number specifically so snapshots can interpolate them. `agilitySec` is stored in
  *period space* because that is the perceptually honest lerp space (§11.7).
- **Nibble feeding** (§10.2) — rides on `scoot` (reverse thrust) + face-lock.
- **Better creature preview in the menu** (user, 2026-07-27): the two existing
  previews (Shape editor pane, move-style pane) are useful but inconsistent with
  each other and share little code. Idea: unify them; animate several creatures at
  once demonstrating specific movements; put a scrolling grid behind them so
  translation reads while the viewport tracks the creature. Would give Turning and
  Hovering immediate visual feedback. → own ticket.


---

## 9. Follow-up fix — the flex/S-bend bug (2026-07-27)

**Reported:** with `pivotT 0.5`, `flexSpread 0`, the spine drew an **S**; at
`flexSpread 1` the back half barely moved.

**Root cause (pre-existing, exposed and worsened by E14-10).** The tail's bezier
control was derived purely from the front's tangent:
`TC = W + normalize(W − BC) × handle`. That guarantees C¹ smoothness but leaves
the tail's **side** unconstrained — a hard front bulge tips that tangent back
across the body axis, so the tail swings the other way. It had gone unnoticed
because koi's default `pivotT` of 0.173 makes the tail segment so short its
bulge is ≈0. Measured, pre-fix:

| pivotT | spread | tail bulge | front bulge | shape |
|---|---|---|---|---|
| 0.173 | 0.0 | +0.067 | −0.394 | **S** |
| 0.173 | 0.5 | +0.003 | −0.297 | tail straight (default — why it looked fine) |
| 0.173 | 1.0 | −0.069 | −0.201 | C |
| 0.500 | 0.0 | +0.253 | −0.394 | **S** |
| 0.500 | 0.5 | +0.152 | −0.297 | **S** |
| 0.500 | 1.0 | +0.007 | −0.201 | **S** |

Note the middle row: at `pivotT 0.5` even the *default* spread was an S. And
`flexSpread 0` set the waist gain to zero, which pins the hinge on the axis and
makes an S unavoidable at any pivot.

**Fix.** Replaced the two independent control-point gains with a single **steering
bow** — one signed lateral profile along the whole body (zero at both tips, one
smooth peak ahead of the flex point), with both control points *sampled* from it.
Because the profile never changes sign, the tail cannot disagree with the front:
an S is now unrepresentable. Verified C at pivotT ∈ {0.173, 0.35, 0.5, 0.75} ×
spread ∈ {0, 0.5, 1}, and a runtime assertion that all sampled offsets share one
sign.

**Default preserved:** koi's mid-body swing is **0.1969** vs **0.1970** before —
`BEND_BOW_GAIN = 0.198` was calibrated for exactly this.

**Semantics changed** (slider copy rewritten to match):
- **Flex point** — the hinge; how far back the bending part reaches. The curve
  always tapers to nothing behind it. Does not affect the resting shape.
- **Flex spread** — where along the body the curve is **deepest**: 0 = up near the
  head (front turns, rest trails straighter), 1 = back toward the flex point (the
  whole body swings through the turn). Depth is `Bend depth`; this only moves it.
