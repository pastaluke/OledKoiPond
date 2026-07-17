# E7-8..11 — Water caustics, layered light, creature shadows, light angle

**Shipped 2026-07-17** on `claude/koi-pond-sim-78hVO`. One module
(`src/fluid/caustics.js`), a draw-path extension in `src/simulation.js`, a
cell-capture hook in `src/entities/fish-base.js`, wiring in `src/main.js`, and a
Caustics menu section in `src/ui/menu.js`.

## What shipped

| Ticket | Deliverable |
|--------|-------------|
| E7-8 | Animated caustic web on the pond floor, warped + brightened by live RippleField data |
| E7-9 | The same web stamped onto each depth layer's creatures (and pellets), per-layer light shift, honoring the E14-6 `layer.caustics.opacity` interface |
| E7-10 | Creatures cast solid soft shadows onto the floor that mask the web beneath them |
| E7-11 | One directional light (azimuth + per-layer-gap offset) drives consistent planar offsets for floor web, per-layer stamps, and shadows |

## The caustic pattern (E7-8's open question, answered)

*How to derive a cheap caustic pattern from the ripple height/normal data?*

Real caustic simulation (ray-bundle area compression) is far too heavy for a
per-frame CPU pass, and the ripple field alone is silent when the water is calm
— but the pond is a screensaver, so the idle look matters. The shipped answer is
a **hybrid**: an analytic base pattern that always shimmers, with the ripple
field warping and brightening it exactly where the water actually moves.

1. **Analytic filament web** — four drifting sine waves (fixed irrational-ish
   direction/frequency/phase-speed table) are summed per cell of a coarse grid
   (`maxDim` 150 long-edge, same scheme as RippleField). Brightness peaks where
   the sum crosses **zero** — `pow(1 − |s|/4, sharpness)` via a 1024-entry LUT —
   which traces thin *connected strands* (the caustic look) instead of blobs at
   the interference peaks. Phase drift makes the web morph in place.
2. **Refraction (normals)** — the ripple height gradient displaces each cell's
   sample point (`p' = p + ∇h · refract`), so passing rings visibly bend and
   smear the strands. This is the surface-normal tilt of a real refracting
   surface, applied in 2D.
3. **Glint (curvature)** — a wave crest is a converging lens; `max(0, −∇²h) ·
   glint` adds brightness, so expanding rings carry a moving bright band.

Per-frame cost is one tight loop over ~15k cells (4 `Math.sin` + LUT each; RGB
prefilled, only alpha written) + one `putImageData` — ~1.8 ms in a
software-rendered container, flat in fish count and canvas size.

## Light model (E7-11)

Single directional source, infinitely far: pure planar offset math, no shading
or bounce (per the ticket). Depth planes sit 1 "layer gap" apart with the pond
floor `FLOOR_GAP = 1` below the deepest fish plane. A surface feature at point
`p` projects to `p + dir(azimuth) · lightOffset · d` at depth `d` gaps:

- fish plane `i` of `N` gets its caustic stamp shifted by `d = N−1−i`;
- the floor web is shifted by `d = N−1+FLOOR_GAP`;
- a fish at layer `i` casts its shadow at `+dir · lightOffset · (i+FLOOR_GAP)` —
  exactly the continuation of the ray from its plane to the floor, so shadows,
  fish light, and floor light all agree. `lightOffset = 0` is noon.

The `FLOOR_GAP` matters for the default 1-layer pond: without it every shadow
would sit at zero offset, hidden under its own fish.

Blit geometry: one pattern canvas rendered per frame in surface space; each
plane blit stretches it over the canvas plus a shared overscan pad (max shift
across planes), offset by its own shift — so relative offsets are exact and no
plane's blit ever exposes an uncovered edge.

## Render pipeline (inside `Simulation.draw`)

```
caustics OFF → the original draw paths, byte-identical
caustics ON:
  1. floor web blit                      (E7-8)
  2. shadow pass                         (E7-10)
     – each fish's cells from LAST frame's draw (1-frame lag, invisible),
       re-filled OPAQUE black into a scratch canvas at its light offset,
       composited ONCE at shadowStrength (opaque-then-fade: overlapping
       rects/fish can't double-darken into moiré)
  3. per-layer buckets, floor-first      (E7-9)
     – occupied layers with fishIntensity>0 draw into the scratch
       (grid.ctx swap), web stamped 'source-atop' (that layer's pixels
       only) at that layer's shift, composited back
```

All scratch work (clear / stamp / composite) is clipped to the bucket's or
shadow set's **bounding rect** — computed in one zero-alloc pass — so the extra
canvas cost tracks where fish actually are (measured 31→14 ms software-rendered
for the full draw; the remaining cost is composite ops that are GPU-trivial on
real hardware; baseline reference: E14-2 accepted ~30 ms software at n=150).

Shadow-cell capture is gated by `FishBase.CAPTURE_SHADOW_CELLS` (set per frame
from the caustics state); on an off→on transition stale silhouettes are wiped so
a shadow can't flash at a fish's long-gone position.

## Knobs (Caustics menu section; persisted under `caustics` in `koipond.tuning`)

`enabled`, `intensity` (floor), `fishIntensity`, `scale`, `speed`, `refract`
(ripple warp), `glint`, `sharpness`, `maxDim` (resolution), `color` (picker),
`shadows` + `shadowStrength`, `lightAngleDeg`, `lightOffset` — all clamped in
`applyCausticsSettings` (untrusted-paste-safe), with Reset / Copy / Paste
matching the Water/Rain sections. `CAUSTICS_DEFAULTS` is the frozen first-run
set; defaults ship **enabled** (headline visual; single kill-switch).

## Interfaces consumed / prepared

- **Consumed**: RippleField `_src/_cols/_rows` (same private-read precedent as
  the compositor's `uploadWave`); E14-6's `layer.caustics.opacity` field is now
  live (`exclusive` still inert); layer draw-order buckets.
- **Prepared**: E7-12 (compass/region → diegetic sun) only needs to drive
  `lightAngleDeg`/`lightOffset` from sensor data — the offset math is already
  centralized in `CausticsField.lightDir()` + `_blit()`.

## Verification

Headless Chromium (Playwright) against a local static server: pattern alpha
present and rising under taps; per-layer stamps and shadow offsets correct at 4
layers with steep light; persistence roundtrips through reload via the real
slider UI; disabling caustics restores the plain path; no console errors.
Screenshots reviewed for the filament look, fish light bands, and clean solid
shadows.

## Notes / follow-ups

- Fish are outline-drawn by default, so fish-layer caustics read subtly until
  "Filled in" is on — tuning candidate after playtest.
- The web is uniform across the pond; a future refinement could fade it with
  the E14-11 water-model murkiness so deep ponds go dimmer.
- `layer.caustics.exclusive` remains reserved (E14 stamped it; semantics TBD).
