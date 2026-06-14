# OledKoiPond — Task Board

> Repo-contained project management. Stories live here; decisions and design
> context live in `GDD.md`. When a story ships, mark it ✅ and add a one-line
> note. Groom the 24-Hour Sprint section at the start of each work session.

---

## Status legend

| Mark | Meaning |
|------|---------|
| ⬜ | Backlog — not yet scheduled |
| 🟦 | Ready — scoped, can be picked up |
| 🔶 | In progress |
| ✅ | Done |

---

## What is actually shipped (reality check vs. GDD)

The GDD roadmap was written pre-implementation. Actual state:

| Feature | Status |
|---------|--------|
| Responsive canvas, fills viewport | ✅ |
| Logical grid + density + world-size controls | ✅ |
| Procedural spline-based koi body | ✅ |
| Boids steering (separation / alignment / cohesion / wander / edges) | ✅ |
| Burst-and-coast throttle cycle | ✅ |
| Hard turn-rate clamp (no more spin cycle) | ✅ |
| Size-scaled agility | ✅ |
| Hamburger menu with live-tuning sliders | ✅ |
| Slider range controls + (i) info icons | ✅ |
| Per-section persistence (localStorage) | ✅ |
| Debug overlay (spline, stats, boid radii, vectors) | ✅ |
| Entity Stats box (phase / throttle / speed / rotation) | ✅ |
| Filled render mode toggle | ✅ |
| Configurable border (toggle / width / opacity) | ✅ |
| Fullscreen button (mobile) | ✅ |
| Fish section + Fish count in menu | ✅ |
| Cloudflare Pages auto-deploy from main | ✅ |
| future-feature convention + GDD backlog | ✅ |
| Colour palette system (built-in + custom, localStorage) | ✅ |
| Palette editor in menu (add/delete/CSV/rename) | ✅ |
| Community palette file + palette registry | ✅ |
| Live fish shape editor (profile points + spine params + preview canvas) | ✅ |
| Data-driven `static SHAPE` on FishBase | ✅ |
| WebGL compositor layer (Canvas2D → texture → WebGL quad) | ✅ |
| Glass edge chromatic-aberration shader (border band, R/G/B split) | ✅ |
| Hard wall toggle (`static HARD_BORDER`, decoupled from glass) | ✅ |
| Zoom slider (replaces World size, inverted semantics) | ✅ |
| Cruise behaviors no longer brake fish (max(cruiseSpeed, sp) target) | ✅ |
| Smooth wander: `_wanderOmega` evolves gradually, bounded by turn rate | ✅ |

---

## Epics

### E1 · Core Polish
Tighten and stabilize what exists before adding major systems.

| ID | Story | Status |
|----|-------|--------|
| E1-1 | PWA manifest — `manifest.json` + icons so "Add to Home Screen" shows a proper icon and name instead of a screenshot | 🟦 |
| E1-2 | `meta theme-color` and iOS `apple-mobile-web-app-capable` tags so the status bar goes black on home-screen launch | 🟦 |
| E1-3 | Fish color controls in the Fish menu — hue / saturation sliders or a color picker per species | 🟦 |
| E1-4 | Koi color palette variety — currently a fixed list; expose palette selection in menu | ⬜ |
| E1-5 | Performance profiling pass — measure frame time on mid-range Android; identify bottlenecks | ⬜ |
| E1-6 | Edge-factor debug stat in Entity Stats box (how deep the fish is in the wall-avoidance band) | ⬜ |

---

### E7 · Render Pipeline
The layered WebGL post-processing stack. Each step is an independent pass that
can be toggled without breaking others. Architecture: Canvas2D (hidden, pond
render target) → WebGL fullscreen quad (Compositor) → stacked fragment shader
uniforms. One shader program; uniforms gate each effect on/off.

| Step | Story | Status |
|------|-------|--------|
| 1 | **WebGL compositor** — Canvas2D pond as texture; fullscreen quad; chroma-key black→transparent; Y-flip in vertex shader | ✅ Done |
| 2 | **Water surface — simple mode** — CPU wave equation (2D discrete, damping ≈ 0.97); fish inject energy proportional to speed; output: per-cell brightness tint drawn over pond canvas before compositor upload | ⬜ |
| 3 | **Glass edge shader** — chromatic aberration in border band; R/G/B displaced along inward edge normal at 1.5×/1.0×/0.5×; `uBorderPx` driven by `border.width × scale` | ✅ Done |
| 4 | **Water refractive mode** — wave normals → UV displacement function in fragment shader; replaces simple tint with actual texture distortion; shares displacement math with Step 3/7 | ⬜ |
| 5 | **Boundary object + camera** — separate soft-border `Boundary` class; hard/soft toggle in menu; optional camera/viewport sub-region (pond smaller than full screen) | 🔶 Partial — hard-border toggle done; Boundary class + camera not yet |
| 6 | **Display filter shaders** — named filter presets selectable in Display menu: `none` / `lcd` (RGB subpixel grid) / `gbc` (4-shade quantised + palette) / `game-watch` (1-bit dither); each a uniform-gated branch in the frag shader | ⬜ |
| 7 | **Glass UI panel** — same `edgeSample(uv, norm, str)` function as Step 3 but applied to the menu panel region (non-zero pixels beneath → displaced glass refraction); shares displacement function with border | ⬜ |

**Shared displacement primitive** (Steps 3, 4, 7):
```glsl
vec4 glassShift(sampler2D tex, vec2 uv, vec2 norm, float str, vec2 px) {
  float r = texture2D(tex, uv + norm * str * 1.5 * px).r;
  float g = texture2D(tex, uv + norm * str * 1.0 * px).g;
  float b = texture2D(tex, uv + norm * str * 0.5 * px).b;
  return vec4(r, g, b, 1.0);
}
```

---

### E2 · Water & Interaction Layer
The fluid simulation and tap/touch feedback that make the pond feel alive.

| ID | Story | Status |
|----|-------|--------|
| E2-1 | Tap / touch → visual ripple at tap point (simple expanding ring, pixelated, no full fluid sim yet) | 🟦 |
| E2-2 | 2D wave-propagation fluid grid (CPU, discrete wave equation from GDD §8) | ⬜ |
| E2-3 | Ripple injection from fish movement (body displacement → fluid grid) | ⬜ |
| E2-4 | Ripple overlay renderer (fluid grid values → semi-transparent pixel overlay) | ⬜ |
| E2-5 | Tap → inject strong ripple into fluid grid (replaces/extends E2-1) | ⬜ |
| E2-6 | Ripple-driven pixel brightness (overlay values brighten fish outline pixels beneath) | ⬜ |
| E2-7 | Special ripple type → rainbow color pass over fish outline pixels | ⬜ |

---

### E3 · Visual System
Named render styles, color configuration, and composable shader-like passes.

| ID | Story | Status |
|----|-------|--------|
| E3-1 | `ColorConfig` struct on each entity — mode (`solid`/`rainbow`/`pulse`), base RGB, speed | ⬜ |
| E3-2 | Render style enum: `outline` (current) and `filled` (current toggle) are the first two entries | 🟦 |
| E3-3 | `gradient` render style — fill uses a per-row brightness gradient (lighter belly, darker back) | ⬜ |
| E3-4 | `glow` render style — soft halo of dim pixels around the outline (offset copies at lower opacity) | ⬜ |
| E3-5 | Directional highlight pass — given a configurable light-source angle, compute highlight/shadow side of each entity and modulate pixel brightness | ⬜ |
| E3-6 | Style + color controls integrated in Fish menu | ⬜ |
| E3-7 | Border color control (currently hardcoded white) | ⬜ |
| E3-8 | 5.5-second breathing circle (see GDD) | ⬜ |
| E3-9 | Ambient clock (see GDD) | ⬜ |

---

### E4 · Entity Ecosystem
New entity types and a data-driven entity config system.

| ID | Story | Status |
|----|-------|--------|
| E4-1 | Fish socializing state machine (approach, face, kiss / follow outcomes — see GDD) | ⬜ |
| E4-2 | `_neighborCount` used to trigger socialize: low count → seek company, high count → peel off | ⬜ |
| E4-3 | `bubble` entity — rising circle, pops at top with a ripple event | ⬜ |
| E4-4 | `lily_pad` entity — static, very slow drift | ⬜ |
| E4-5 | Entity config file — register new entities without code changes | ⬜ |
| E4-6 | Fish naming UI (tap a fish → name input) + Easter egg name triggers | ⬜ |
| E4-7 | Gyroscope / tilt — fish react to device orientation | ⬜ |

---

### E5 · Deployment & Distribution
Make it shippable and playable outside the dev loop.

| ID | Story | Status |
|----|-------|--------|
| E5-1 | PWA manifest + icons (overlaps E1-1/E1-2 — do together) | 🟦 |
| E5-2 | itch.io HTML5 export — zip `dist/` and upload; confirm it plays correctly | ⬜ |
| E5-3 | itch.io page copy and screenshots | ⬜ |
| E5-4 | Orientation-change handling — gracefully reflow when phone rotates | ⬜ |
| E5-5 | Google Play wrapper (long-term) | ⬜ |
| E5-6 | Steam / Electron wrapper (long-term) | ⬜ |

---

### E6 · Creator Workshop
A platform for sharing entity classes and visual styles. This is the
architectural north star — design every system with this composability in mind.

**Vision:** An in-app or companion-site workshop where creators can share:
- Custom entity classes (new fish species, objects, effects)
- Named render styles / shader passes
- Behavior presets (tuning bundles)
- Pond presets (combination of all of the above)

**Security model for untrusted code:**

Shader passes and entity behavior code from untrusted creators must never run
on the main thread with DOM access. Two-tier approach:

1. **Web Worker sandbox** — entity `update()` logic runs inside a Worker.
   The Worker receives a plain-object snapshot of relevant world state each
   frame via `postMessage` and returns a delta (target velocity, state change).
   It has no access to the DOM, the canvas, or `eval`. Malicious code can only
   corrupt its own fish; the main thread validates the returned delta before
   applying it.

2. **Fragment shader sandbox** (for visual passes) — GLSL or a restricted
   DSL is compiled to a WebGL fragment shader or a OffscreenCanvas 2D kernel.
   No arbitrary JS. Shader source is parsed for disallowed constructs (infinite
   loops, `#extension`, accessing textures not in the approved set) before
   compilation. WebGL's driver-level sandboxing then contains it.

3. **Static import whitelist** — any JS entity plugin may only `import` from
   an approved module list (`vec2`, `behaviors`, the entity base class). The
   import graph is checked at load time before the code runs.

| ID | Story | Status |
|----|-------|--------|
| E6-1 | Define the entity plugin API contract — what a third-party entity class is allowed to read/write | ⬜ |
| E6-2 | Worker-based entity sandbox (proof of concept with a single entity type) | ⬜ |
| E6-3 | Import whitelist static analyser | ⬜ |
| E6-4 | Fragment shader / visual pass DSL design | ⬜ |
| E6-5 | Shader sandbox (OffscreenCanvas / WebGL isolation) | ⬜ |
| E6-6 | Preset bundle format (JSON: entity config + tuning + render style) | ⬜ |
| E6-7 | In-app preset browser / importer UI | ⬜ |
| E6-8 | Companion sharing site or itch.io community page | ⬜ |

---

### E8 · Glass Layer Polish
Refinements and new behaviours for the glass shapes + border shader layer.

#### E8-1 — Guide ring fade on inactivity  ⬜
The grab-handle rings drawn by the debug overlay should fade out after 3 s of no
pointer activity and instantly reappear on hover/touch — "invisible until you need
them".

**Implementation:**
- `GlassShapes` gets a `lastActivity = performance.now()` property, reset on any
  pointer event over the canvas AND on add/remove/select.
- `main.js` adds a bare `pointermove` listener (not drag-only) that calls
  `glassShapes.touchActivity()`.
- `debug-overlay._drawGlassShapes()` computes `opacity` from
  `(now - lastActivity)`: full for first 3 000 ms, linear fade over the following
  500 ms, then 0. Multiplied into both ring `strokeStyle` alphas so the rings
  vanish smoothly without changing the hit-test logic.

---

#### E8-2 — Diegetic border glass (upgrade `borderShift`)  ⬜
The border glass edge currently uses a simple linear chromatic shift. Give it the
same liquidGL-inspired displacement model as the shapes so it reads as glass rather
than a post-process filter.

**Shader changes (`compositor.js`):**
- Rename `borderShift(uv, dir, t, strength, px)` → keep but add `refraction` and
  `bevelDepth` params.
- Inside: `dispAmt = t * refraction + pow(t, 10.0) * bevelDepth` (smooth +
  sharp-rim kick). Apply as uniform UV shift first, then layer the chromatic split
  on top at ±1.5× along norm. The `pow(t,10)` concentrates the bevel right at the
  wall, identical to how the shape rim looks.
- New uniforms: `uBorderRefr` (float), `uBorderBevel` (float), `uBorderSpecular`
  (bool). `uGlassStr` stays as the chromatic amount (rename label only in menu).

**JS/Menu changes:**
- `setGlassEdge(enabled, {chromatic, refraction, bevelDepth, specular})` — extend
  the signature; defaults keep current behaviour.
- Border section gains 3 new sliders: **Refraction** (0–0.04, step 0.001),
  **Bevel depth** (0–0.08, step 0.001), and a **Specular** checkbox. Existing
  Chromatic slider stays (was "Glass edge strength").
- Persistence: add `borderRefr`, `borderBevel`, `borderSpecular` alongside
  existing `border` blob in `save()`.

---

#### E8-3 — Glass shape autonomous wander + wall bounce  ⬜
Per-shape optional animation: the shape drifts autonomously in lazy arcs and
bounces off pond walls with physically-correct angle-of-reflection.

**Data model additions (not persisted — ephemeral):**
```js
shape._vx = 0; shape._vy = 0; // UV/s velocity, set on wander enable
shape._vOmega = 0;             // rad/s angular drift rate (smooth random walk)
```
**Persisted per shape:** `wander: bool`, `wanderSpeed: number` (UV/s, default 0.02).

**`GlassShapes.update(deltaMs, aspect)` (new method):**
1. Skip shapes where `!s.wander`.
2. Angular drift: nudge `_vOmega` by `±0.08 * maxOmega` each frame (clamped to
   `±0.5 rad/s`); rotate velocity by `_vOmega * dt` — same pattern as fish
   `_wanderOmega`.
3. Integrate: `cx += _vx * dt; cy += _vy * dt`.
4. Wall bounce — radius is in height-fraction units; x-walls need aspect correction
   (`cx_min = radius / aspect`, `cx_max = 1 - radius / aspect`):
   - Left/right breach → `_vx = ±|_vx|`, clamp cx; reset `_vOmega` to a gentle
     post-bounce value so the shape curves away rather than skimming the wall.
   - Top/bottom breach → `_vy = ±|_vy|`, clamp cy.
5. After update, call `sync()` so uniforms reflect the new position.

**`main.js`:** call `glassShapes.update(deltaMs, compositor.aspect)` each frame
before `compositor.frame()`.

**Menu:** per-shape **Wander** checkbox + **Speed** slider (0.005–0.05, step 0.005).
On enable: assign a random initial velocity at `wanderSpeed`; on disable: zero the
velocity so the shape stops where it is.

---

### E9 · TV Remote / Keyboard-Only Navigation
Full keyboard parity with mouse and touch. Every interaction reachable with Arrow
keys + Spacebar only — no mouse, no trackpad, no touch required. Designed around the
"10-foot UI" model (TV remote, game controller D-pad, set-top box) while remaining a
usability win for any keyboard-driven user.

**Research findings (2026-06-14):**
- W3C CSS Spatial Navigation Level 1 is a draft but **zero browser implementations**;
  polyfills exist (WICG) but are incomplete. We roll our own.
- Roving tabindex pattern wins over `aria-activedescendant` here because the browser
  auto-scrolls the newly-focused element into view for free.
- TV remotes (Samsung Tizen, LG webOS, Roku) all emit standard `event.key` strings:
  `"ArrowLeft"`, `"ArrowUp"`, `"ArrowRight"`, `"ArrowDown"`, `"Enter"`, `" "`.
  Using `event.key` (not numeric keycodes) gives us cross-platform TV compat for free.
- Native `<input type="range">` responds to arrow keys automatically when focused;
  we only need to intercept Up/Down to navigate away rather than changing the slider
  value, and let Left/Right change the value as expected.
- `element.scrollIntoView({ behavior:'smooth', block:'nearest', inline:'nearest' })`
  is the standard, widely-supported API for keeping a focused element in view.
- Grab-and-move on TV home screens: Enter to grab, arrows to move, Enter to drop.
  ARIA: `role="button"` + `aria-pressed="true"` while grabbed.

**Architecture — two-mode model:**
A `KeyNavManager` class owns the keyboard listener and dispatches to one of two modes:
- **CANVAS mode** (default, menu closed): arrows move a UV-space cursor drawn by the
  debug overlay; Space selects/grabs the shape under the cursor or drops food.
- **MENU mode** (menu open): arrows navigate the flat ordered list of focusable
  elements in the panel; native input behaviors still apply per element type.

Mode switches: opening the hamburger menu → MENU; closing/Escape → CANVAS.
One global `keydown` listener on `window`, `preventDefault()` only when we consume
the key (never suppress native text input inside color/name fields).

---

#### E9-1 — KeyNavManager + canvas cursor mode  ⬜

**New file: `src/ui/key-nav.js`** — exports `KeyNavManager` class.

```js
// Constructed in main.js, receives references to glassShapes and compositor.
class KeyNavManager {
  constructor({ glassShapes, compositor, overlay }) { ... }
  setMode(mode) { ... }   // 'canvas' | 'menu'
  frame(dt) { ... }       // called each animation frame; integrates cursor velocity
}
```

**Canvas cursor state:**
- `cursorX = 0.5`, `cursorY = 0.5` — UV space, 0–1
- `_vx = 0`, `_vy = 0` — current velocity (UV/s)
- `_heldKeys` — Set of currently-held arrow keys
- `_holdTimer` — timestamp of first keydown (for acceleration)

**Cursor movement:**
- On `keydown` for an Arrow key: add to `_heldKeys`; set base velocity
  (`BASE_SPEED = 0.15 UV/s`).
- After 500ms of continuous hold: ramp to `FAST_SPEED = 0.40 UV/s`.
- `frame(dt)`: integrate `cursorX += _vx * dt`, `cursorY += _vy * dt`; clamp to 0–1.
- On `keyup`: remove from `_heldKeys`; zero that axis.
- Cursor wraps at edges (same as fish wander) rather than hard-stopping.

**Grab flow:**
- Space/Enter on canvas mode → `hitIdx = glassShapes.hitTest(cursorX, cursorY)`
  - If hit and not grabbed: `glassShapes.select(hitIdx)`, enter **grab mode**
    (`_grabbed = hitIdx`); visual: overlay draws grab ring around shape.
  - If grabbed: drop — `glassShapes.requestSave()`, `_grabbed = -1`.
- Space on empty canvas (no hit, no grab): drop food at cursor UV (same as
  current mouse-click feed behavior — fire `'feed'` event with `{u, v}`).
- Escape while grabbed: drop without save; Escape in canvas mode (nothing grabbed):
  do nothing / deselect.

**Debug overlay integration:**
- `overlay.keyNav = keyNavManager` (assigned in main.js).
- `_drawKeyNavCursor()` called at end of `draw()` when `keyNav` is set and mode is
  `'canvas'`:
  - Draw a small crosshair (4 short lines ±8px) + circle (r=10px) at canvas pixel
    coords `(cursorX * W, cursorY * H)`.
  - When grabbed: additionally pulse the grabbed shape's outer ring with a brighter
    stroke (reuse `_drawGlassShapes` ring, override color to `#fff`).
  - Color: `rgba(0, 210, 255, 0.85)` (matches existing selection highlight color).

**`main.js` wiring:**
```js
import { KeyNavManager } from './ui/key-nav.js';
const keyNav = new KeyNavManager({ glassShapes, compositor, overlay });
// In animation loop, before compositor.frame():
keyNav.frame(deltaMs / 1000);
```

---

#### E9-2 — Menu roving-focus navigation  ⬜

Keyboard focus moves through all interactive elements in the panel using Up/Down
arrows. Each element scrolls into view automatically via the roving tabindex pattern.

**Focusable element types (in DOM order):**
1. `<summary>` elements (section headers) — toggle `<details>` open/closed
2. `<input type="checkbox">`
3. `<select>`
4. `<input type="range">` (one per slider row)
5. `<button>` elements (Add/Remove, Copy values, Reset, action buttons)

Excluded from arrow navigation: `<input type="text">` / `<input type="color">` —
these need full keyboard; user reaches them with Tab if needed.

**Focus list management:**
- `_buildFocusList()`: call `panel.querySelectorAll(SELECTORS)`, filter to
  `offsetParent !== null` (skips hidden elements inside collapsed `<details>`).
- Rebuild on: menu open, any `<details>` toggle event.
- `_focusIdx` — index into the current list.

**Roving tabindex:**
- All elements in list: `tabindex = -1`.
- Active element: `tabindex = 0`, call `.focus()`, call
  `.scrollIntoView({ behavior:'smooth', block:'nearest', inline:'nearest' })`.

**Key handling in MENU mode:**
| Key | On `<summary>` | On `<input type="range">` | On checkbox/select/button | General |
|-----|--------------|--------------------------|--------------------------|---------|
| ArrowDown | move to next | move to next (prevent default) | move to next | +1 in list |
| ArrowUp | move to prev | move to prev (prevent default) | move to prev | −1 in list |
| ArrowRight | expand section | +1 step (native, don't intercept) | — | — |
| ArrowLeft | collapse section | −1 step (native, don't intercept) | — | — |
| Enter / Space | toggle open/closed | — | activate (click) | — |
| Escape | close menu → CANVAS mode | — | — | — |
| Tab | hand off to browser | (native) | (native) | (native) |

Section expand/collapse via arrow:
- Right on a collapsed `<summary>` → `details.open = true`; rebuild list; move focus
  to the first control inside that section (next in list after the summary).
- Left on an open `<summary>` → `details.open = false`; rebuild list; focus stays on
  the summary (which is still in the list).
- Down from an open `<summary>` → move to first control inside (next in list).
- Down from the last control in a section → move to next section's `<summary>`.

**`menu.js` integration:**
- On menu open: `keyNav.setMode('menu')`, `keyNav.menuPanel = panel`,
  `keyNav.buildFocusList()`, focus first element.
- On menu close: `keyNav.setMode('canvas')`.
- Each `<details>` toggle listener also calls `keyNav.buildFocusList()`.

**CSS — ensure focus ring is visible on dark background (`index.html`):**
```css
.menu-panel :focus-visible {
  outline: 2px solid rgba(0, 210, 255, 0.9);
  outline-offset: 2px;
  border-radius: 3px;
}
```

---

#### E9-3 — Fish targeting via canvas cursor  ⬜

Extends canvas cursor mode (E9-1) to allow selecting and following a fish.

- When Space is pressed in canvas mode with no glass shape under the cursor:
  check for the nearest fish within `0.08` UV (aspect-corrected) of `cursorX/cursorY`.
- If a fish is within range: enter **fish-follow mode** — cursor locks to that fish
  (UV coords track the fish each frame), overlay draws a ring around the fish (color
  `rgba(255, 200, 0, 0.7)` — distinct from glass shape cyan).
- Space again: drop food at the fish's current position and exit follow mode.
- Escape: exit follow mode without feeding.
- Arrows in fish-follow mode: nudge a "feed point" offset relative to the fish (±0.05
  UV), so the user can place food slightly ahead of the fish; not required for V1.

**Debug overlay integration:**
- When `_fishTarget` is set: draw a dashed circle at the fish's screen position with
  `r = 18px`; `strokeStyle = 'rgba(255,200,0,0.7)'`.

---

#### E9-4 — TV remote key compatibility + polish  ⬜

Ensures the system works on Samsung Tizen, LG webOS, and similar TV browsers without
any additional configuration.

**Key mapping robustness:**
- Use `event.key` exclusively (string form): `"ArrowLeft"`, `"ArrowUp"`,
  `"ArrowRight"`, `"ArrowDown"`, `"Enter"`, `" "`, `"Escape"`, `"Tab"`.
- Do **not** use `event.keyCode` — deprecated and inconsistent across TV platforms.
- Samsung Tizen remote Back button = `event.key === "GoBack"` → treat as Escape.
- LG webOS Magic Remote pointer events arrive as mouse events — existing mouse/touch
  handling already covers this with no changes needed.

**Mode indicator (optional UX polish):**
- When in MENU mode, dim the canvas cursor (opacity 0.3) to visually confirm "you're
  in the menu now."
- When returning to CANVAS mode, the cursor briefly pulses bright (scale from 1.5→1
  over 300ms) to confirm "you're back on the pond."

**Accessibility:**
- Add `aria-label="Pond canvas — use arrow keys to move cursor, space to interact"`
  to the WebGL canvas element.
- Add `role="application"` to the canvas wrapper so screen readers understand it
  accepts keyboard input.
- Announce mode changes with an `aria-live="polite"` hidden element:
  `"Canvas mode — arrow keys move cursor"` / `"Menu open — arrow keys navigate"`.

**Affected files summary:**

| File | Change |
|------|--------|
| `src/ui/key-nav.js` | New — KeyNavManager class (E9-1) |
| `src/main.js` | Instantiate KeyNavManager; wire frame loop and hamburger toggle |
| `src/debug-overlay.js` | Draw canvas cursor crosshair + fish-follow ring (E9-1, E9-3) |
| `src/ui/menu.js` | Notify KeyNavManager on open/close; wrap `<details>` toggles |
| `index.html` | `:focus-visible` CSS for dark theme (E9-2) |

---

### E10 · Hold-to-Attract Fish
Click and hold anywhere on the pond (not on a glass shape) to create a temporary
attraction point. Fish are drawn toward it; when they arrive they orbit it in lazy
arcs, each fish choosing its own clockwise or counterclockwise direction.

**Interaction contract:**
- `pointerdown` on the WebGL canvas when **no glass shape is hit** → start attraction
  at UV `(u, v)`.
- `pointermove` (while held) → move the attraction point with the finger/cursor.
- `pointerup` / `pointercancel` → clear the point; fish resume normal behaviors.
- Glass shape drag takes priority — if `hitTest()` returns ≥ 0 the attraction logic
  is skipped entirely (existing priority order is unchanged).

**Behavior model — two-phase per fish:**

*Phase 1 — Approach (dist > orbitRadius):*
- New behavior `attract(fish, ctx)` in `behaviors.js` reads `ctx.attractPoint`
  (`{x, y}` in logical coords, or `null`).
- Returns a seek force toward the point weighted by a distance falloff:
  `weight = clamp(1 - dist / falloffDist, 0, 1)²` — fish very close feel full pull,
  fish beyond `falloffDist` (≈ 2× the pond's short edge) feel almost nothing.
- Blended into the per-fish force sum at a high weight (e.g., 3.0) so it
  dominates over wander/alignment/cohesion but not over separation.

*Phase 2 — Orbit (dist ≤ orbitRadius):*
- On first entry: `fish._orbitChirality = Math.random() < 0.5 ? 1 : -1` (±1, random
  per fish per approach, stays fixed for that visit).
- Each frame: compute the **tangent** to the orbit circle at the fish's current
  position — `perp = (-dy, dx) * chirality` where `(dx, dy) = normalize(fish - center)`.
  Target speed = fish's `cruiseSpeed`. Return a steer force toward
  `center + normalize(fish-center)*orbitRadius + perp*lookAhead` where
  `lookAhead = cruiseSpeed * 200ms`. This naturally keeps the fish circling without
  locking it to a rail.
- Separation still runs at full weight so fish don't stack on each other while
  orbiting.

**`orbitRadius`:** `fish.length * 3` — close enough to look purposeful, far enough
that 5 fish can orbit without crowding.

**`falloffDist`:** `grid.logicalShortEdge` (half the pond) — fish across the whole
pond notice the point, but very distantly.

**Integration points:**

| Location | Change |
|----------|--------|
| `src/movement/behaviors.js` | Add `export function attract(fish, ctx)` |
| `src/simulation.js` | Expose `attractPoint = null` on the `Simulation` instance; pass it in the per-fish `ctx` each frame |
| `src/main.js` | On `pointerdown` (no shape hit): convert client coords to logical, set `sim.attractPoint`; on `pointermove` while held: update it; on `pointerup`/`cancel`: clear to `null` |
| `src/entities/fish-base.js` | Add `_orbitChirality = 0` to constructor; reset to 0 when attraction clears (so next approach picks a fresh direction) |
| `src/debug-overlay.js` (optional) | Draw a faint pulsing ring at `sim.attractPoint` when set, to confirm the touch is registered |

**No new menu sliders needed** — orbit radius and falloff distance are derived from
fish length and world size, so they stay proportional automatically. Could add tuning
knobs later if feel needs adjusting.

**Persistence:** none — attraction point is purely ephemeral interaction state.

**Interaction with E9 (TV remote):** in canvas mode, Space-on-empty could toggle a
"hold" at the cursor position — the point stays active until Space is pressed again.
This is a natural extension but deferred to when E9 is implemented.

---

| # | Question | Notes |
|---|----------|-------|
| A1 | Fluid sim on CPU or GPU? | CPU is simpler; GPU fragment shader is faster at scale. Decide when E2-2 is picked up. |
| A2 | Entity plugin format: ES module, JSON + behavior keys, or WASM? | ES module is ergonomic; WASM is more sandbox-friendly. |
| A3 | Shader DSL vs. restricted GLSL? | Restricted GLSL reuses existing knowledge; a custom DSL is safer but a bigger build. |
| A4 | Preset distribution: self-hosted, itch.io community, GitHub Gists? | Lowest friction to start: Gist import by URL. |
| A5 | Monetisation model on itch.io? | Pay-what-you-want with a free tier is standard for ambient tools. |

---

## Bug Fixes

### B1 · iOS Fullscreen (bottom toolbar persists)

**Platform:** iPhone — all browsers (Safari, Chrome, Firefox, etc.)

**Symptoms:**
- Tapping the fullscreen button in Safari removes the top URL bar but the bottom
  navigation toolbar (Back / Share / Tabs) persists, eating ~50px of pond.
- Other iOS browsers behave identically because they all use the WebKit engine and
  Apple does not expose the Fullscreen API on iOS.
- On iPad the Fullscreen API *does* work; this is an iPhone-only restriction.

**Root cause:** Apple has never shipped `Element.requestFullscreen()` on iPhone
(as of iOS 17). All browsers on iPhone inherit the same WebKit limitation. No
JS call can dismiss the browser toolbar while running in a browser tab.

**Recommended fix — two-tier approach:**

*Tier 1 — PWA standalone mode (primary fix):*
When the user adds the site to their iPhone Home Screen, it launches in
`standalone` display mode — zero browser chrome, true edge-to-edge. The
intersection with already-planned work is large:
- **E1-1 / E5-1** — PWA manifest (`manifest.json`) with `"display": "standalone"`.
  Delivers the standalone launch behavior.
- **E1-2** — `<meta name="apple-mobile-web-app-capable" content="yes">` +
  `<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">`.
  Lets iOS know the home-screen launch should be fullscreen with a transparent
  status bar overlay.
- **B1-1 (new)** — `viewport-fit=cover` in the viewport meta + CSS
  `env(safe-area-inset-*)` padding so the pond canvas fills under the notch /
  Dynamic Island and home indicator without being obscured.

*Tier 2 — In-browser prompt:*
Users still in a browser tab can't get true fullscreen, but we can detect the
situation and offer a "Add to Home Screen" nudge. Safari in browser tab:
`window.navigator.standalone === false`; if also `iOS === true` and
`window.matchMedia('(display-mode: browser)')` — show a one-time banner:
"For the best experience, tap Share → Add to Home Screen."

**Implementation plan (pending research confirmation):**

| ID | Story | Status |
|----|-------|--------|
| B1-1 | `viewport-fit=cover` + `env(safe-area-inset-bottom)` — canvas expands under home indicator; bottom safe-area absorbed by UI chrome (menu button) | 🟦 |
| B1-2 | PWA manifest (`manifest.json`) with `display: standalone`, linked in `index.html` — overlap with E1-1/E5-1; do together | 🟦 |
| B1-3 | Apple PWA meta tags (`apple-mobile-web-app-capable`, `apple-mobile-web-app-status-bar-style: black-translucent`) — overlap with E1-2 | 🟦 |
| B1-4 | "Add to Home Screen" prompt banner — shown once to iOS-in-browser users; dismissable; stored in localStorage | ⬜ |

**Research notes (2026-06-14):**
- Research in progress. Implementation plan will be updated once findings confirmed.
- Key question: does `black-translucent` status bar + `viewport-fit=cover` cause
  any layout issues with the current hamburger menu / fullscreen button position?
- Related: the bottom toolbar that inspired the glass shapes — B1-1 may finally
  remove the inspiration for E8, and that's poetic.

---

## 24-Hour Sprint — current

> Replace this section at the start of each session.

### Goal
Refine movement feel; begin water surface layer.

### Sprint stories

| Priority | ID | Story | Notes |
|----------|----|-------|-------|
| 🔴 High | E7-2 | Water surface simple mode — CPU wave grid, fish inject energy, brightness tint overlay | Next render pipeline step; big payoff for little code |
| 🔴 High | E1-1 + E5-1 | PWA manifest + icons | Completes nightstand use-case; small effort |
| 🟠 Medium | E2-1 | Tap → visual ripple at tap point | Can inject into wave grid once E7-2 exists |
| 🟠 Medium | E7-5 | `Boundary` class + soft-border mode | Hard-border toggle done; soft boundary + camera sub-region outstanding |
| 🟡 Nice | E1-2 | iOS home-screen meta tags | 10-min job |

### What to defer
- Display filters (E7-6) — fun, well-scoped, but not next
- Glass UI panel (E7-7) — depends on Steps 3+4 being solid first
- Socializing state (E4-1) — not on critical path to shareable
- Creator Workshop (E6) — architectural; needs more planning

---

*Updated: 2026-06-14*
