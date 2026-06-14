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

## Open architectural decisions

| # | Question | Notes |
|---|----------|-------|
| A1 | Fluid sim on CPU or GPU? | CPU is simpler; GPU fragment shader is faster at scale. Decide when E2-2 is picked up. |
| A2 | Entity plugin format: ES module, JSON + behavior keys, or WASM? | ES module is ergonomic; WASM is more sandbox-friendly. |
| A3 | Shader DSL vs. restricted GLSL? | Restricted GLSL reuses existing knowledge; a custom DSL is safer but a bigger build. |
| A4 | Preset distribution: self-hosted, itch.io community, GitHub Gists? | Lowest friction to start: Gist import by URL. |
| A5 | Monetisation model on itch.io? | Pay-what-you-want with a free tier is standard for ambient tools. |

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
