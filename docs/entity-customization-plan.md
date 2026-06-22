# Entity Customization — Architecture & Roadmap

> Status: **planning** (2026-06-20). No implementation yet. This is the design
> doc of record for the fish/entity customization overhaul. The task-board home
> is **E13 · Entity Customization** in `TASKS.md`; this file holds the detail.
> Related epics: **E4** (entity ecosystem / data-driven config), **E6** (Creator
> Workshop — sharing north star), **E11** (shaders + palette), **E12** (food).

---

## Summary

The current fish body is a single per-class `SHAPE` object — six spine scalars
plus a fixed 9-point half-width `profile` — rasterized to a flat set of cells and
scanline-filled. It works, but it is rigid (fixed point count, named points),
forces top/bottom symmetry, fakes fins as width bumps, and has several render
artifacts that all trace back to "plot rounded points + fill rows that happen to
contain an outline pixel".

This plan replaces that with **one generic creature schema** (fish first), built
from **decoupled modules** that compose at render time:

- **Spline** — dynamic-count t-points (`{t, w}`, min 3), editable including the
  ends; one point flagged as the **tail pivot**.
- **Motion** — tail swishes from the pivot point (rigid-ish), tip wags most;
  replaces the single-t-point wobble.
- **Appendages** — generic "stick-on" objects anchored to a t-point and mirrored
  across the spine (fins now; whiskers / tentacles / limbs later).
- **Patterns** — **vector** color regions anchored in local body space, each
  drawing from a palette color **slot** (secondary / tertiary). Multiple named
  variations per class, spawnable by weighted percentage.

It ships in small, independently useful phases (see Roadmap). Phase 1 is the
t-point editor overhaul the user wants first; it is forward-compatible with
everything after it.

**Phase list at a glance**

| Phase | Deliverable | Depends on |
|------|-------------|-----------|
| 1 | Dynamic t-point editor (click-select, add/remove, move ends, drag, arrows) | — |
| 2 | Generic `CreatureDef` schema + parts-based renderer (fixes fill bugs) | 1 |
| 3 | Appendages (fins) anchored to t-points, mirrored, with motion params | 2 |
| 4 | Tail-pivot swish motion (flagged t-point) | 2 |
| 5 | Menu reorg — Fish class browser + Food gets its own home | 2 |
| 6 | Patterns (vector regions) + palette color triplet | 2, 5 |
| 7 | Extend appendages → whiskers / tentacles / limbs (octopus, squid, turtle) | 3 |

---

## Goals & non-goals

**Goals**
- Make body shape feel like direct manipulation ("move this point", "add a point
  here", "stick a fin on that point"), not editing a fixed parameter list.
- Decouple body / fins / patterns / motion so each can change without touching
  the others, and so non-fish creatures reuse the same primitives.
- Kill the standing render artifacts (see "Known issues").
- Keep every phase small and shippable; no multi-week monoliths.

**Non-goals (for this plan)**
- Building the Food system itself (that is E12; we only reserve its menu home and
  define the color-triplet it must carry).
- Sandboxing untrusted creator code (that is E6).
- Per-fish individual editing — we edit **classes**; individuals inherit the
  class shape and roll a pattern variation + colors at spawn.

---

## Decisions locked (2026-06-20)

1. **Patterns are vector regions**, not a raster mask. Resolution-independent,
   cheap to mirror/animate, and they deform with the body.
2. **Shape editing and pattern editing are separate modes**, both reached by
   clicking a fish class. The pattern editor pulls its silhouette from the
   *current* shape (always up to date).
3. **Pattern blobs reference palette color slots.** Each food/palette color entry
   carries **primary + secondary + tertiary**; the body uses primary, blobs use
   secondary/tertiary. Palette variety therefore drives pattern variety for free.
4. **Tail pivot = a flagged t-point** (not a separate scalar, not auto-detected).
   Moving that point moves the pivot.
5. **One generic schema now, fish as first consumer.** Schema-level genericity is
   cheap; we only *implement* fish, but octopus/turtle/food drop in later without
   a data-model rewrite.
6. **Movable endpoints renormalize the span.** Dragging an end point remaps the
   profile's t-range so the body always spans tail-tip→snout — "move this point"
   never leaves an empty stub or negative-width glitch.
7. **Pattern spawn is a per-class mode toggle.** Each class is either *random
   weighted mix* (every fish rolls a variation by weight) **or** *locked* to one
   chosen variation. Both modes supported; the class picks which.
8. **Bodies are always mirrored top/bottom — asymmetry is out of scope.** No
   `wTop/wBottom`; one half-width per point, mirrored across the spine.

---

## How the current system works (recap)

- `FishBase.SHAPE` (`src/entities/fish-base.js`): `{ headFrac, tailFrac,
  waistFrac, wiggleFrac, bendWaist, bendBody, profile: [[t, halfWidth], …] }`.
- `_renderSpline()` builds 3 anchors (Head / Waist / Tail) along the heading,
  bows the waist/body control points by `steeringBend`, wiggles a tail control
  point by `swimOsc`, samples two quadratic béziers, and at each sample offsets
  ±`_widthAt(t)` along the curve normal. Points are rounded to display cells and
  deduped into a `Set`.
- `draw()`: outline = plot each cell; **FILLED** = for each y-row, fill from the
  leftmost to the rightmost outline cell in that row.
- Editor (`src/ui/menu.js`, "Shape" section): a preview canvas, a point
  `<select>` with hardcoded `PT_LABELS`, t / half-width sliders for the selected
  point, six spine sliders, Copy / Reset. `liveShape` is the working copy.

---

## Known issues this plan resolves

1. **Faceted silhouette** — `_widthAt` is piecewise-linear, so every breakpoint
   is a hard kink. → Phase 2 (smooth width interpolation).
2. **Outline gaps / stipple** — outline cells are independent rounded samples
   with no line drawn between them. → Phase 2 (connected edges).
3. **Fill bridges concavities** — FILLED fills min→max x per row, so a turning
   (C-curve) body or a split tail gets filled across the notch. → Phase 2
   (polygon interior fill).
4. **Offset self-intersection** — ±normal offset of a high-curvature curve pinches
   and knots near the tail during hard wiggle. → Phase 2 + Phase 4 (pivot motion).
5. **Symmetry** — profile is mirrored about the spine. **By design** (asymmetry
   was considered and dropped from scope); kept symmetric, one half-width/point.
6. **Fixed 9-point topology + named points** — can't add / remove / reorder; the
   labels imply the count is fixed. → Phase 1.
7. **Preview ≠ render** — preview is a smooth, filled, rest-pose silhouette; the
   live fish is cell-rasterized, wiggling, maybe outline-only. → Phase 2
   (preview renders through the real pipeline).
8. **"See-through dark line" bug** (filled fish swimming W↔E shows a hollow line
   down its length). **Root cause, confirmed by reading the code:** FILLED only
   fills rows that *contain an outline pixel*. For an axis-aligned body the top
   outline sits at y<0 and the bottom at y>0; they only meet at the centerline
   at the tips, and *only* if the tip half-width is small enough to collapse to a
   single center cell (`_outlinePx` uses `w < 0.35`). When you widen the head/tail
   tips into a "fork" (split-fin look), the tips no longer collapse, the exact
   center row gets **no** outline pixel, so that row is skipped by the fill →
   a 1-cell transparent line for the whole length. → Fixed by Phase 2 (fill the
   polygon interior, not "rows with samples") **and** Phase 3 (the tail fork
   becomes a fin appendage, so the body itself is never forked).

---

## Target architecture

### The generic `CreatureDef` schema

One schema, consumed by fish first. All fields are plain JSON (serializable,
shareable — feeds E6 preset bundles and E4-5 entity config).

```js
CreatureDef = {
  id:   'koi',          // class key
  name: 'Koi',          // display name

  // ── Geometry (the spline) ────────────────────────────────────────────────
  spline: {
    // Dynamic-count control points along the body, tail→head. Min 3.
    // t is the position along the body; w is the half-width at that point
    // (always mirrored top/bottom — bodies are symmetric by design).
    points: [
      { t: 0.0, w: 0.0 },          // tail end
      { t: 0.5, w: 2.2, pivot: true }, // a point can be flagged the tail pivot
      { t: 1.0, w: 0.1 },          // head end
    ],
    // Spine proportions (carried over from today's SHAPE).
    headFrac, tailFrac, waistFrac, bendWaist, bendBody,
  },

  // ── Motion (kinematics) ──────────────────────────────────────────────────
  motion: {
    // Tail swishes about the pivot-flagged point; tip wags most.
    swishAmp:   0.156,   // replaces wiggleFrac
    swishRate:  1.0,     // beats relative to swim speed
    swishCurve: 1.0,     // how wag scales from pivot (0) to tail tip (1)
  },

  // ── Appendages (stick-on parts) ──────────────────────────────────────────
  // Anchored to a spline point, mirrored across the spine by default.
  appendages: [
    {
      kind: 'fin',              // 'fin' | 'whisker' | 'tentacle' | 'limb' (later)
      anchor: <point index or t>,
      mirror: true,            // draw on both sides
      restAngle: 35,           // degrees relative to local spine tangent
      length: 4.0,             // world units
      shape: <small profile / param set>,
      swayOnTurn: 0.5,         // how much it deflects when the fish turns
      flapOnAccel: { rate, amp }, // flap when accelerating (0 = static)
    },
  ],

  // ── Patterns (vector color regions) ──────────────────────────────────────
  patterns: {
    spawnMode: 'mix' | 'locked', // 'mix' = roll by weight; 'locked' = always `active`
    active: 'kohaku',            // used when spawnMode === 'locked'
    variations: [
      {
        name: 'kohaku',
        weight: 0.5,           // spawn probability share (used in 'mix' mode)
        regions: [             // each region anchored in LOCAL body space
          { type: 'blob', t: 0.6, wFrac: 0.3, size: 0.4, slot: 'secondary' },
          { type: 'band', t0: 0.2, t1: 0.4, slot: 'tertiary' },
        ],
      },
    ],
  },
}
```

### Decoupling principle

Each module above is independently editable and independently rendered:

- Changing the **spline** never touches appendages/patterns (they re-anchor by
  `t`, which is stable across point edits).
- **Appendages** are their own closed shapes; they don't perturb the body
  outline (this is what finally removes the fork bug).
- **Patterns** are clipped to whatever the current body polygon is; editing them
  reads the live silhouette, writes nothing back to the spline.
- **Motion** reads the pivot flag and animates a transform; it doesn't change the
  stored geometry.

### Render pipeline (parts-based)

Replace "one Set of cells + scanline fill" with composed, closed parts:

1. **Body** → build the closed outline polygon (top edge tail→head, bottom edge
   head→tail) from a **monotone-cubic** width function (Fritsch–Carlson — no
   overshoot at the peduncle pinch). Fill by polygon interior test with the
   **nonzero-winding** rule (so a self-overlapping tail stays filled, no holes),
   not "rows with an outline sample". Outline mode = draw the closed edge with
   connected segments.
2. **Appendages** → each is its own closed polygon, transformed by its anchor +
   motion, mirrored, filled independently.
3. **Patterns** → each region rasterized and **clipped to the body polygon**,
   filled with its rolled slot color.
4. Compose in cell space, then hand to the existing grid/compositor layers
   unchanged.

The **editor preview renders through this same pipeline** so it is WYSIWYG.

### Color model

- Palette / food color entries become `{ primary, secondary, tertiary }`.
- `rollColor()` returns the triplet; body uses `primary`, pattern regions use the
  `slot` they reference.
- This is a change to the palette format + `rollColor` and overlaps **E11**
  (shader/palette) and **E12** (food carries the triplet). Coordinate the format
  bump once, in Phase 6, and migrate existing palettes (missing slots fall back
  to `primary`).

### Persistence & migration

- The renderer already tolerates an arbitrary-length `profile`, so **old saved
  shapes load unchanged** through Phase 1.
- Phase 2 introduces a versioned `CreatureDef`; provide a one-way upgrader from
  the legacy `{headFrac…, profile}` blob → `spline.points` + `motion`. Keep a
  `schemaVersion` field.
- Palette triplet (Phase 6): old entries upgrade by setting
  `secondary = tertiary = primary` until edited.

---

## Phase roadmap

Each phase is independently shippable and should fit in a single focused session.

### Phase 1 — Dynamic t-point editor  *(do first)*

Pure editor work in `menu.js`; renderer untouched (still consumes the `profile`
array, which is already variable-length).

- **Click a point in the preview** to select it (hit-test the dots).
- **Dynamic count, min 3.** Drop `PT_LABELS`; points are positional (`Point N,
  t=…`).
- **Movable endpoints.** First/last t become editable. **Decided:** the profile's
  t-range is **renormalized** so the body always spans tail-tip→snout regardless
  of endpoint t — i.e. "move this point left/right" stays inside [0,1] and never
  produces an empty stub or negative-width extrapolation.
- **Add buttons `+pt ⇐` / `+pt ⇒`.** Insert a point halfway in **both t and
  half-width** between the selected point and its left / right neighbor. New point
  takes the array slot between them. No other points are averaged. Left button
  disabled on the first point, right button disabled on the last.
- **Remove point** (respecting the min-3 floor).
- **Drag points** in the preview (pointer drag = set t + half-width).
- **Arrow nudge buttons** `←  →  ↑  ↓` for t / half-width, alongside the existing
  sliders (intentional redundancy — we'll see what feels best).

*Done when:* you can build a 3-point and a 12-point fish entirely by
clicking/dragging/adding, ends included, and it persists & renders correctly.

### Phase 2 — Generic schema + parts-based renderer

**Locked decisions (2026-06-21):** monotone-cubic (Fritsch–Carlson) width;
nonzero-winding fill; rename `FishBase.SHAPE` → `FishBase.CREATURE` and the
persisted `shape` key → `creature` (legacy upgrader reads the old key/format).
**Scope note:** `spline.points` stay `[t,w]` tuples in this phase to keep the
E13-1 editor intact; they become `{t,w,pivot}` objects in **E13-4** when the
pivot flag is actually needed. Motion behavior is unchanged here
(`motion.swishAmp` == old `wiggleFrac`; `swishRate`/`swishCurve` carried but
unused until E13-4).

**Preview rework (2026-06-22):** the first preview attempt drew the static pane
as a *width-vs-t graph* stretched to the box — wildly inaccurate vs the real fish.
Replaced with **two always-on panes** (the toggle is gone): an **editor pane**
(accurate resting silhouette + draggable dots) and a **live pane** (the real fish
swimming a gentle S-weave so tail wiggle *and* both bends are visible). Both panes
render the real `buildBodyOutline`, fit aspect-preserving (no fish-stretch, no
dynamic box resize), oriented E–W head-right. To place dots on the true outline
and invert drags, the centerline was extracted into a shared **`buildCenterline`**
primitive (`at(t) → {x,y,nx,ny}`) — the same skeleton **E13-3 appendages** hang
off, so this front-loads E13-3. Endpoints are **pinned to t=0/1** (movable
endpoints + renormalization dropped). Slider grouping: Head/Tail offset + Waist
under the editor pane; Tail wiggle / Waist bend / Body bend under the live pane.
`(i)` tooltips added to all of them. **Editor zoom/pan (2026-06-22):** points were
too small to grab, so the editor pane is taller (130px) and zoomable — wheel zooms
toward the cursor, drag-empty-space pans when zoomed, double-click / Fit resets,
plus Zoom −/Fit/+ buttons. The transform is `applyView(baseFit)` layering
zoom-about-center + pan; drag/pick invert through it.

- Define `CreatureDef`; refactor `FishBase.SHAPE` into `spline` + `motion`
  (fish-first), with the legacy upgrader.
- Rebuild the renderer into composed closed parts (body now; appendage &
  pattern layers are the obvious next entries in the parts loop). Monotone-cubic
  width; nonzero-winding polygon fill; connected-segment outline.
- Extract `buildCenterline`; both the renderer and the editor panes consume it.

*Done when:* fish render identically-or-better with no faceting, no outline gaps,
the **see-through line bug is gone**, and the **editor pane matches the live fish**.

### Phase 3 — Appendages (fins)

**Locked decisions (2026-06-22):**
- **Geometry = reuse the profile machinery.** A fin is a *mini-outline*: its own
  `[t,w]` width profile run through the same `makeWidthFn` + `fillOutlineCells` /
  `strokeOutlineCells` as the body, on a short local spine rooted at the anchor.
  Fan tail = profile widest at the tip; forked tail = two mirrored leaves or a
  notched profile. (Max reuse; same authoring feel as the body.)
- **Anchor via `centerline.at(t)`** (settled in E13-2) — fins auto-follow the
  body's bend/wiggle. Mirrored across the spine by default.
- **Top-down view ⇒ pectoral + caudal only.** We look down into the pond, so
  pectorals (stick out the sides) and the caudal (tail, in-plane) read; **dorsal**
  (points up at the camera → edge-on ridge) and pelvic/anal (point away) do not.
  No dorsal/anal this phase.
- **Default koi loadout:** clean-taper body + a **stock caudal fin** in the schema
  (so the default is never tail-less); the user authors pectorals in the editor and
  **Copy**-bakes their `CreatureDef`.
- **Scope = all-in-one:** primitive + render in the fish **and both preview panes**
  (required now the preview is accurate) + fin editor + koi migration, one phase.
- **Fin editor reuses the dot-editor:** selecting a fin retargets the existing
  draggable-dot + zoom editor to that fin's profile, plus fin sliders (anchor t,
  rest angle, length, mirror, swayOnTurn, flapOnAccel).
- **Draw order is moot** until E13-6 — all parts share the fish color, so body/fin
  overlap is a seamless union.

*Done when:* the koi's tail is a caudal fin object, the body is unforked, fins
mirror + sway/flap with motion, both preview panes show fins, and a fin's shape is
editable with the same dot UI.

### Phase 4 — Tail-pivot swish motion

- Use the pivot-flagged point: everything tailward swishes about it as a unit;
  `swishCurve` makes the tip wag most. Replaces the current mid-tail wobble.
- Tunable via `motion.*`.
- **Schema bump (do here):** convert `spline.points` `[t,w]` → `{t,w,pivot}`
  objects (needed for the pivot flag) and bump `schemaVersion`. While touching it,
  **trim `upgradeCreature`**: drop the now-dead legacy flat-`SHAPE` branch (no
  precious old data, single machine), but keep a thin load boundary
  (clone + version-route + validate). Rationale: local persistence and future
  **cross-machine import** (E6 "copy entity") are the same boundary problem —
  deserializing external/old data into the one canonical `CreatureDef`. Keeping a
  single boundary + a real `schemaVersion` makes import a localized extension (a
  versioned migration *chain* + defensive validation of untrusted input) rather
  than a refactor. Keep `CreatureDef` strictly JSON-serializable so export is just
  `JSON.stringify`.

*Done when:* the tail "swishes" believably and the old wobble is gone.

### Phase 5 — Menu reorg

- **Fish** section → **class browser**: each class row = wireframe silhouette +
  name + `[−]` / `[+]` (remove/add one of that class to the pond). Clicking the
  silhouette opens the class editor (Shape / Patterns / Appendages / Motion /
  Spawn-mix sub-views).
- **Food** gets its own top-level menu section (reserved home; behavior is E12).
- Rehome the current "Filled" toggle + palette controls into the class editor.

*Done when:* fish are managed per-class from the browser; Food has its own slot;
the Phase 1–4 editors live inside the class editor.

### Phase 6 — Patterns (vector regions)

- Palette/food color triplet + `rollColor` returning `{primary, secondary,
  tertiary}` (coordinate with E11/E12 format bump + migration).
- Pattern editor: click the silhouette to add blobs/bands; each references a slot;
  regions clipped to the body.
- Pattern **variations** per class with a **spawn-mode toggle**: *random weighted
  mix* (per-variation % that normalize to 100%, rolled at spawn) **or** *locked*
  to a single chosen variation.

*Done when:* a class can define ≥2 variations, both spawn modes work, and blobs
recolor automatically from palette variety.

### Phase 7 — Appendages beyond fins

- Reuse the appendage primitive for **whiskers** (koi), then **tentacles** /
  **limbs** with their own rest/sway/flap behaviors → octopus, squid, turtle.

*Done when:* a non-fish creature (e.g. a simple octopus) is authorable with no
new core systems — only new appendage `kind`s.

---

## Open / deferred decisions

- **Smooth width function** (Phase 2): Catmull-Rom vs monotone cubic — pick
  whichever avoids overshoot at the peduncle pinch.
- **Pattern primitive set** (Phase 6): start with `blob` (ellipse) + `band`;
  expand from there.
- **Appendage geometry representation** (Phase 3): small reused profile vs a few
  shape params — decide when building it.
- **Spawn-mix UI** (Phase 6): per-variation % sliders that normalize to 100%.

---

## Cross-references

- **E4 · Entity Ecosystem** — the `CreatureDef` schema is the concrete form of
  E4-5 ("entity config file — register new entities without code changes").
- **E6 · Creator Workshop** — `CreatureDef` + pattern variations + appendages are
  exactly the shareable units E6 wraps; keep everything JSON-serializable.
- **E11 · Fish Shader System** — the palette color-triplet bump (Phase 6) shares
  the palette format with E11; sequence the format change once.
- **E12 · Fish Food System** — food entries carry the `{primary, secondary,
  tertiary}` colors that patterns consume.
