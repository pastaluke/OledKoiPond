# E13-4 Slice 1 — Spline muscle-sim (geometry core)

> Build spec derived from the locked decisions in `entity-customization-plan.md`
> Phase 4 (design LOCKED 2026-06-25). This is the geometry-core slice; movement-model
> and editor-polish work is deferred to Slice 2+ (see bottom).

## Scope
**In:** `pivotT` schema + migration; tangent-continuous inherited back curve; additive
traveling wag in `at()`; throttle-driven wag in `update()`; rename the editor's Waist slider.

**Deferred to Slice 2+:** explicit front-turn speed gate + min/max front-bend +
Arc-slider retirement; dedicated draggable pivot handle; canoe-paddle fins;
glide-depth/collision tuning. Slice 1 reuses the existing `steeringBend` for the
inherited curve — it already decays at standstill, so momentum gating is implicit for now.

## Orientation reminder (don't get this backwards)
In `buildCenterline`, **`t=0` is the tail tip, `t=1` is the snout.** So:
- **Front (steering) = body segment `[pivotT, 1]`** → control `BC`, bent by
  `steeringBend·bendBody`. *Unchanged.*
- **Back (wag) = tail segment `[0, pivotT]`** → control `TC`. *This is what we rework.*

## 1. Schema (`fish-base.js`)
- `FishBase.CREATURE.spline`: rename `waistFrac: 0.229` → `pivotT: 0.229`.
  Bump `schemaVersion: 1` → `2`.
- `motion`: replace `{ swishAmp, swishRate, swishCurve }` with
  `{ wagAmp, wagRate, wagCurve, wagPeaks }`. Koi defaults:
  `wagAmp: 0.16, wagRate: 1.0, wagCurve: 1.4, wagPeaks: 1`.
- Check `src/entities/koi.js` (and any subclass) for a `CREATURE`/`waistFrac`/`motion`
  override; migrate the same way.

## 2. `upgradeCreature(raw)` (`fish-base.js`)
- Drop the dead legacy flat-`SHAPE` branch; keep a thin clone + version-route + validate
  boundary.
- Add a **v1→v2 migration**: if `schemaVersion < 2`:
  - `spline.pivotT = spline.waistFrac ?? 0.229; delete spline.waistFrac;`
  - `wagAmp = swishAmp ?? 0; wagRate = swishRate ?? 1; wagCurve = swishCurve ?? 1;
    wagPeaks = 1;` then drop the swish keys.
  - set `schemaVersion = 2`.
- Mirror the defaulting in `menu.js` (`up.motion ??=` line) to the new field names.

## 3. `buildCenterline` rewrite (`fish-base.js`)
**Signature:** opts gains `swimPhase` (the wag needs the raw phase). Keep `swimOsc`/
`swimAmp` in opts — fins still use them.

```
const { headFrac, tailFrac, pivotT, bendWaist, bendBody } = spline;
// Anchors T (t=0), W (t=pivotT), H (t=1) — unchanged math, waistFrac→pivotT.
// waistDist = tailDist - length * pivotT;   (axial position of W)

// FRONT control (body seg, unchanged):
//   BC = midpoint(W,H) - perp · steeringBend · length · bendBody

// BACK rest control — NEW: place TC so the back tangent at W is colinear with the
// front tangent (BC→W direction), giving C¹ continuity = "inherited curve":
//   frontDir = normalize(W - BC)        // tangent pointing tail-ward through W
//   handle   = 0.5 * dist(T, W)         // ~half the back chord (tune visually)
//   TCx = Wx + frontDir.x * handle;  TCy = Wy + frontDir.y * handle
//   (no swim wobble baked into TC anymore)
```

**`at(t)` — add the wag as a per-t lateral offset on the back only:**
```
// ... compute base bx,by + tangent dx,dy from the two béziers as today (TC = TC_rest) ...
const dl = Math.hypot(dx,dy) || 1;
let nx = -dy/dl, ny = dx/dl;
if (t < pivotT && pivotT > 1e-6) {
  const d   = (pivotT - t) / pivotT;          // 0 at pivot → 1 at tail tip
  const env = Math.pow(d, motion.wagCurve);   // 0 at pivot (guarantees continuity)
  const k   = Math.PI * motion.wagPeaks;      // π = one traveling hump
  const wag = motion.wagAmp * length * swimAmp * env * Math.sin(swimPhase - k * d);
  bx += nx * wag; by += ny * wag;
}
return { x: bx, y: by, nx, ny };
```
- **Accepted approximation:** width is offset along the *bézier* normal (`nx,ny`), not the
  displaced curve's true normal. Fine at koi amplitudes; if it visibly skews at high wag,
  recompute the normal via finite-difference of two nearby `at()` samples.
- `buildCenterline` returns `{ at, pivotT }` (rename the returned `waistFrac`). Update
  consumers: `buildBodyOutline` (`spine.waistFrac`→`spine.pivotT`) and the `menu.js`
  editor frame.

## 4. `update()` drive (`fish-base.js`)
Replace speed-driven swim with throttle-driven wag (no floor):
```
this.swimPhase += c.SWIM_BEAT_RATE * creature.motion.wagRate * this._throttle * deltaMs;
if (this.swimPhase > Math.PI*2) this.swimPhase -= Math.PI*2;
this.swimAmp = this._throttle;          // drop SWIM_AMP_FLOOR; coasting → quiet tail
```
- Retire `SWIM_AMP_FLOOR`. `speedFrac` may still be used elsewhere — leave it if so.
- `draw()`: pass `swimPhase: this.swimPhase` into opts (keep `swimOsc` for fins).

## 5. Editor (`menu.js`) — minimal
- Slider list: change `key: 'waistFrac'` → `'pivotT'`, label `'Waist'` → `'Pivot'`,
  widen range to `min 0.10, max 0.60`.
- Tail-wiggle slider (`motion.swishAmp`) → `motion.wagAmp`.
- `restOpts()`: add `swimPhase: 0` so the editor draws the un-wagged rest pose.

## 6. Files touched
`src/entities/fish-base.js` (core), `src/entities/koi.js` (if it overrides),
`src/ui/menu.js` (slider keys + rest opts). No new files.

## 7. Verification (visual)
1. Koi swims: back half visibly **flexes and the bend travels tailward**, strong on
   burst, near-still on glide.
2. Slide the **Pivot** slider: flex region moves from peduncle (~0.2) toward mid-body
   (~0.5) — eel-like at high values.
3. No kink at the pivot (C¹), no width pinch/knot at rest.
4. Old saved creatures load without error (v1→v2 migration) and look unchanged at rest.

## 8. Deferred follow-ups (Slice 2+)
Explicit `gTurn` speed gate + per-creature min/max front-bend + retire Arc sliders
(`MAX_FORCE_MAX/MIN`); draggable pivot handle in the editor; canoe-paddle fin
asymmetry; glide-depth→1 + turn-away collisions.

## Suggested checkpoints
1. **After §1–2 + the renames (`menu.js`)** — pure refactor; the app should render the
   koi **identically** and old saves should load. Isolates migration/rename bugs from
   kinematics bugs. Push here for a first eyeball.
2. **After §3–4** — the visible feature (flex/wag/pivot-slide). Push and tune.
