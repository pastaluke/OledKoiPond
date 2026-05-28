# OLED Koi Pond — Game Design Document

> **Status:** Pre-production / Design phase  
> **Version:** 0.1  
> **Date:** 2026-05-26

---

## Table of Contents

1. [Vision Statement](#1-vision-statement)
2. [Core Experience](#2-core-experience)
3. [Display & Aspect Ratio](#3-display--aspect-ratio)
4. [Visual Language](#4-visual-language)
5. [Entity System](#5-entity-system)
6. [Sprite Format](#6-sprite-format)
7. [Collision & Hitbox System](#7-collision--hitbox-system)
8. [Fluid Simulation](#8-fluid-simulation)
9. [Color & Effects System](#9-color--effects-system)
10. [Platform & Deployment](#10-platform--deployment)
11. [Scope & Roadmap](#11-scope--roadmap)
12. [Open Questions](#12-open-questions)

---

## 1. Vision Statement

**OLED Koi Pond** is a meditative ambient simulation that transforms any OLED screen into a miniature pond diorama. Lay your phone on a desk, a coffee table, or inside a shadow box — the black OLED pixels disappear into the surface, and glowing outlines of koi fish drift through actual darkness. No backlight bleed, no gray "black" — just fish, water, and nothing.

The app is not a game in the traditional sense. It is a living screensaver / ambient toy that rewards being left alone as much as it rewards interaction.

---

## 2. Core Experience

### Primary Scenario
- User opens the app on a phone with an OLED display.
- The screen goes **pure black** (`#000000`).
- Koi fish, rendered as glowing white (or color-configured) outlines, swim slowly beneath an invisible surface.
- The user lays the phone face-up on a flat surface.
- The phone becomes a **physical pond rectangle** inside whatever environment it's placed in.
- Subtle ripple effects at the surface give the impression of real water movement.

### Secondary Interactions
- Tap the surface → generate a disturbance ripple at that point.
- (Future) Tilt / gyroscope → fish react to orientation changes.
- (Future) Long-press an area → attract fish toward that location.

---

## 3. Display & Aspect Ratio

### Responsive Layout
The simulation canvas always fills **100% of the available viewport** — width and height — regardless of device aspect ratio. This is non-negotiable; the "pond shape" IS the phone screen.

- Portrait phones: tall, narrow pond.
- Landscape phones/tablets: wide, shallow pond.
- Square displays: square pond.
- Desktop browser (for development): fills the window.

### Low Resolution Rendering
The simulation runs on a **logical grid** that is much smaller than the physical pixel resolution. A scale factor maps logical pixels to physical pixels.

| Setting | Default |
|---|---|
| Logical grid width | fill to aspect — see below |
| Logical grid height | fill to aspect — see below |
| Scale factor | `auto` (physical px / logical px, configurable) |
| Target logical short-edge | ~120 logical px |

**Auto-scale example:** A 390×844 pt iPhone screen with a target logical short-edge of 120 px:
- Scale = `390 / 120 ≈ 3.25`
- Logical grid: `120 × 260` (approximately)

The exact logical resolution is tunable per-device or globally in settings.

---

## 4. Visual Language

### The Three Rules
1. **Background is always `#000000`.** Not dark gray. Not `#010101`. Pure black — OLED pixels off.
2. **Entities are outlines only.** No filled shapes. Interior pixels of any entity sprite are `0` (transparent / black).
3. **Water ripples are semi-transparent overlays.** Still water contributes zero to the framebuffer. Moving water contributes a small, colored, partially transparent value.

### Aesthetic Reference
- Traditional Japanese koi pond viewed from directly above.
- Very low pixel resolution — think early Game Boy or PICO-8 aesthetic.
- Strict monochromatic-by-default palette; color is opt-in per entity type.
- Feels calm. Animation is never frantic.

---

## 5. Entity System

### Entity Definition
Every living or environmental thing in the pond is an **entity**. Entities share a common base structure:

```
Entity {
  id:           string          // unique identifier, e.g. "koi_default"
  spriteSheet:  SpriteSheet     // see §6
  color:        ColorConfig     // see §9
  position:     {x, y}         // logical grid coordinates (top-left of bounding box)
  velocity:     {vx, vy}       // logical pixels per simulation tick
  scale:        float           // 1.0 = native sprite size
  layer:        int             // draw order; higher = drawn on top
  behaviors:    Behavior[]      // pluggable AI / movement rules
}
```

### Built-in Entity Types (v1)

| Type | Description |
|---|---|
| `koi` | Standard koi fish; swims in lazy arcs, turns at edges |
| `lily_pad` | Static; drifts very slowly with a "current" offset |
| `bubble` | Small rising circle; pops at surface with a ripple event |
| `ripple_source` | Invisible; emits ripple events at a position (used by fish wake) |

### Adding New Entities
Creating a new entity requires **only two things**:

1. Author a sprite sheet (see §6).
2. Register it in the entity config file with a color and behavior list.

No code changes are required for simple entities. Behaviors are composed from a library of pre-built rules (wander, follow, flee, orbit, idle, surface-skim, etc.).

---

## 6. Sprite Format

### Sprite Data Structure
Sprites are stored as **multidimensional arrays of integers** where:
- `0` = black / transparent (OLED pixel off, no draw)
- `1` = entity outline color (rendered using the entity's `ColorConfig`)

```js
// Example: minimal 5×5 diamond outline
const diamond = [
  [0, 0, 1, 0, 0],
  [0, 1, 0, 1, 0],
  [1, 0, 0, 0, 1],
  [0, 1, 0, 1, 0],
  [0, 0, 1, 0, 0],
];
```

### Sprite Sheets
A `SpriteSheet` groups multiple frames into an animation sequence:

```js
SpriteSheet {
  frames: Frame[]        // ordered array of 2D pixel arrays
  frameRate: number      // frames per second (default: 8)
  loopMode: "loop"       // "loop" | "pingpong" | "once"
  anchorX: number        // logical px offset for position anchor
  anchorY: number
}
```

### Design Guidelines for Sprites
- Sprites are **outlines only** — do not fill the interior with `1`s.
- Keep sprites small: a large koi fish might be 24×12 logical pixels.
- Use frame differences to animate fins, tail oscillation, mouth movement, etc.
- The pixel art tool of choice is left to the author; the output must be serializable to the `0/1` array format.
- Rotation is handled by authoring multiple directional sprite sheets OR by runtime rotation of the array (nearest-neighbor, no anti-aliasing).

### Example: 3-Frame Koi Tail Wag
```js
const koiSheet: SpriteSheet = {
  frames: [
    // frame 0 — tail left
    [[0,0,1,1,0,0],[0,1,0,0,1,0],[1,0,0,0,0,1],[0,1,0,0,1,0],[0,0,1,0,0,0]],
    // frame 1 — tail center
    [[0,0,1,1,0,0],[0,1,0,0,1,0],[1,0,0,0,0,1],[0,1,0,0,1,0],[0,0,1,1,0,0]],
    // frame 2 — tail right
    [[0,0,1,1,0,0],[0,1,0,0,1,0],[1,0,0,0,0,1],[0,1,0,0,1,0],[0,0,0,1,0,0]],
  ],
  frameRate: 6,
  loopMode: "pingpong",
  anchorX: 0,
  anchorY: 2,
};
```

---

## 7. Collision & Hitbox System

### Hitbox Generation (Automatic)
There is **no manually authored hitbox**. The physical extent of an entity is derived directly from its current sprite frame:

> A logical pixel is considered **solid** if its value in the sprite array is `1`.  
> A logical pixel with value `0` is always non-solid (black / transparent).

This means:
- The hitbox shape-shifts every frame as the animation plays.
- Thin outline sprites have very thin hitboxes — fish can "pass through" each other's hollow centers.
- The bounding box of `1` pixels defines the broadphase AABB; per-pixel solid map defines the narrowphase.

### Collision Response (v1)
- Entity–entity collision is **soft**: entities gently steer away from each other rather than hard-stopping.
- Entity–wall collision: entities turn away from the logical grid boundary.
- Entity–ripple: ripple events nudge nearby fish slightly.

### No Physics Engine Required
Collision in v1 is simple enough to implement from scratch:
1. Broadphase: AABB overlap check.
2. Narrowphase: check if any `1` pixel in entity A overlaps any `1` pixel in entity B (with position offsets).
3. Response: apply a small steering force opposite the overlap direction.

---

## 8. Fluid Simulation

### Goal
Simulate the **surface of a still pond** disturbed by fish movement. The output is a 2D grid of values that drives the ripple overlay drawn on top of all entities.

### Data Model
The fluid layer is a 2D array the same size as the logical grid:

```
fluidGrid[y][x]: float  // range: 0.0 (still) to 1.0 (maximum disturbance)
```

### Physics (Simplified Wave Equation)
Uses a standard 2D discrete wave propagation model:

```
next[y][x] = (
  2 * curr[y][x]
  - prev[y][x]
  + damping * (
      curr[y-1][x] + curr[y+1][x] +
      curr[y][x-1] + curr[y][x+1] -
      4 * curr[y][x]
    )
)
```

Where `damping` ≈ `0.97–0.99` (configurable). Lower = faster decay.

### Ripple Sources
A ripple source injects energy into the fluid grid at a point:

| Event | Injection Strength |
|---|---|
| Fish tail cross-surface (near top of grid) | 0.3–0.6 |
| Fish body movement below surface | 0.05–0.15 |
| User tap | 0.8–1.0 |
| Bubble pop | 0.4 |

### Rendering the Fluid Layer
- Still cells (`< threshold`, e.g. `< 0.02`) are rendered as `0` — pixel off. No cost.
- Active cells are rendered as a **semi-transparent color overlay** on top of the entity layer.
- Opacity/alpha is mapped from the fluid value:

| Fluid Value | Alpha (opacity) |
|---|---|
| 0.0 – 0.02 | 0 (not drawn) |
| 0.02 – 0.2 | 1 (lightest visible) |
| 0.2 – 0.5 | 2–3 (medium) |
| 0.5 – 1.0 | 4–5 (peak) |

The alpha scale is small on purpose — ripples are subtle, not dominant. Maximum opacity is configurable (default: `5` on a 0–255 scale → roughly 2% opacity). These values need real-world tuning on an OLED screen.

- Ripple color defaults to a very faint blue-white. Configurable per theme.

---

## 9. Color & Effects System

### ColorConfig Structure
```js
ColorConfig {
  mode:     "solid" | "rainbow" | "custom_gradient" | "pulse"
  r, g, b:  0–255           // base color (used in "solid" mode)
  speed:    float           // animation speed for dynamic modes
}
```

### Modes

| Mode | Description |
|---|---|
| `solid` | Single RGB color, no animation |
| `rainbow` | Scrolling HSL hue cycle across the entity's pixels over time |
| `custom_gradient` | Author-defined gradient mapped across the sprite |
| `pulse` | Brightness pulses in and out (good for "glowing" effects) |

### Global Defaults
- Entity outline: `#FFFFFF` (solid white)
- Water ripple: `rgba(180, 210, 255, ~0.02)` (very faint cool blue)
- Background: `#000000` (hardcoded, never configurable)

---

## 10. Platform & Deployment

### Target Platforms (Priority Order)

| Priority | Platform | Notes |
|---|---|---|
| 1 | **Mobile web (OLED phones)** | Primary experience; runs in browser |
| 2 | **Desktop browser** | Development / debug |
| 3 | **itch.io** | HTML5 export; broadens accessibility |
| 4 | **Google Play** | Wrapped WebView or native port; long-term |
| 5 | **Steam** | Electron or native; long-term |

### Responsive / Aspect Ratio Requirements
- Canvas always fills 100% viewport (no letterboxing, no pillarboxing).
- Logical grid dimensions are computed at runtime based on physical screen size and chosen scale factor.
- Handles orientation changes gracefully (re-compute grid, preserve entity positions proportionally).

### Performance Targets
- Maintain 60 fps on a mid-range Android phone (2022+).
- Fluid sim update rate may run at a sub-multiple of render rate (e.g., update at 30 Hz, render at 60 Hz with interpolation).
- Total active logical pixels: typically < 20,000 for a phone-sized grid — trivially fast in any environment.

---

## 11. Scope & Roadmap

### v0.1 — Foundation
- [ ] Responsive canvas that fills viewport
- [ ] Logical grid renderer (scale factor → physical pixels)
- [ ] Sprite format parser (2D array → rendered pixels)
- [ ] Single entity type: `koi` with 3-frame tail-wag animation
- [ ] Basic wandering AI (smooth arc movement, wall avoidance)
- [ ] Pure black background

### v0.2 — Water
- [ ] 2D wave propagation fluid grid
- [ ] Ripple injection from fish movement
- [ ] Transparent ripple overlay rendering
- [ ] User-tap ripple injection

### v0.3 — Entity Ecosystem
- [ ] `lily_pad` entity
- [ ] `bubble` entity
- [ ] Entity config file (add entities without code changes)
- [ ] Multiple koi with flocking / avoidance

### v0.4 — Color & Polish
- [ ] `ColorConfig` system (solid, rainbow, pulse modes)
- [ ] Configurable ripple color
- [ ] Settings panel (accessible via long-press or swipe)
- [ ] Smooth animation interpolation

### v0.5 — Deployment
- [ ] itch.io HTML5 build
- [ ] PWA manifest (add-to-home-screen)
- [ ] Performance profiling pass

### Future / Backlog
- Gyroscope / tilt-based pond tilt
- Tap-to-feed interaction (fish attracted to tap point)
- Day/night cycle (very subtle color temperature shift)
- Sound: optional ambient water sounds
- Custom entity authoring tool (in-app pixel editor)
- Google Play wrapper
- Steam / Electron wrapper
- **Fish socializing** — A fish can enter a "socialize" state where it picks another fish and swims toward it. The target fish notices and turns to face the approaching fish. Once close, one of several outcomes plays out: fish A follows fish B for a while; fish B follows fish A for a while; the two briefly touch noses ("kiss") then part ways. More outcomes TBD.
- **5.5-second breathing circle** — A pixelated, semi-transparent circle outline in the center of the display. The outline draws clockwise from the top over exactly 5.5 s, then erases clockwise from the top over another 5.5 s, cycling indefinitely until the user turns it off. Fish gradually begin circling clockwise around the circle while it is active. A water ripple emanates from the center each time the circle finishes drawing or erasing. If the app ever has sound, beats or tones on the 5.5 s interval should tie in. Rendered on the pixelated display layer (not the debug overlay canvas).

---

## 12. Open Questions

These need decisions before or during tech stack selection:

| # | Question | Options |
|---|---|---|
| Q1 | **Tech stack?** | Vanilla Canvas2D JS, Phaser, PixiJS, Godot export, Unity WebGL, custom Rust/WASM |
| Q2 | **Sprite authoring pipeline?** | JSON files, JS/TS modules, in-app editor |
| Q3 | **Fluid sim runs on CPU or GPU?** | CPU (simple, works everywhere), GPU fragment shader (faster, more complex) |
| Q4 | **Config / settings storage?** | localStorage, URL params, none (in-memory only for v1) |
| Q5 | **Frame rendering strategy?** | Full redraw every frame vs. dirty-rect partial updates |
| Q6 | **Target logical resolution?** | Fixed (e.g., 120 × 260) vs. adaptive based on screen size |

---

*This document is a living design reference. Update it as decisions are made and scope evolves.*
