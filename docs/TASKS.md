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
| 2 | **Water surface — FluidSim + tint overlay** — CPU wave equation, double-buffered; V-wake fish injection; tint drawn on Canvas2D; wave data simultaneously available for GPU pass. See E7-2 below. | ⬜ |
| 3 | **Glass edge shader** — chromatic aberration in border band; R/G/B displaced along inward edge normal at 1.5×/1.0×/0.5×; `uBorderPx` driven by `border.width × scale` | ✅ Done |
| 4 | **Water refractive mode** — upload wave heights as GPU texture; surface-normal-derived UV displacement in frag shader; wave crests contribute to `envLight()` specular. See E7-4 below. | ⬜ |
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

#### E7-2 — Water surface: FluidSim + tint overlay  ⬜

**Architecture decisions (2026-06-16):**
- Both visual modes (Canvas2D tint + GPU refraction) built together and made independently toggleable. Wave data is always computed so both can run simultaneously.
- V-wake directional injection behind each fish (not simple point injection).
- Grid resolution configurable at runtime via menu (world-unit or display-cell).
- Edge mode user-selectable: reflect / absorb / mostly-absorb-slight-reflect.
- No hardcoded constants — all tuning parameters exposed in a Water section in the menu.

---

**New file: `src/fluid/fluid-sim.js`**

```js
export class FluidSim {
  constructor(grid) {
    this.grid = grid;
    // All fields are menu-tunable — no magic numbers.
    this.enabled       = true;
    this.damping       = 0.97;          // 0.90–0.99; lower = faster decay
    this.edgeMode      = 'partial';     // 'reflect' | 'absorb' | 'partial'
    this.partialCoeff  = 0.10;          // 0.0–0.50; how much energy reflects back
    this.resolution    = 'world';       // 'world' | 'display'
    this.tapStrength   = 0.9;           // 0.0–1.0
    this.wakeStrength  = 0.4;           // 0.0–1.0
    this.wakeAngleDeg  = 19.5;          // 10–30; Kelvin default is 19.5°
    this.wakePoints    = 4;             // points per arm; 2–6
    this.wakeLengthMul = 2.0;           // wake arm length in fish.length multiples

    // Tint overlay (Canvas2D)
    this.tintEnabled   = true;
    this.tintR = 180; this.tintG = 210; this.tintB = 255;
    this.tintMaxAlpha  = 5;             // 0–255; ~2% at 5 on OLED
    this.tintThreshold = 0.02;          // cells below this are not drawn

    this._curr = null; this._prev = null;
    this._w = 0; this._h = 0; this._mult = 1;
    this._allocate();
  }

  _allocate() {
    this._mult = this.resolution === 'display' ? this.grid.density : 1;
    this._w    = Math.ceil(this.grid.logicalW * this._mult);
    this._h    = Math.ceil(this.grid.logicalH * this._mult);
    this._curr = new Float32Array(this._w * this._h);
    this._prev = new Float32Array(this._w * this._h);
  }

  _idx(x, y) { return y * this._w + x; }

  inject(lx, ly, strength) {
    const gx = Math.round(lx * this._mult);
    const gy = Math.round(ly * this._mult);
    if (gx < 0 || gx >= this._w || gy < 0 || gy >= this._h) return;
    const i = this._idx(gx, gy);
    this._curr[i] = Math.min(1, this._curr[i] + strength);
    // Spread to cardinal neighbors at half strength for softer injection point:
    for (const [dx, dy] of [[-1,0],[1,0],[0,-1],[0,1]]) {
      const nx = gx + dx, ny = gy + dy;
      if (nx >= 0 && nx < this._w && ny >= 0 && ny < this._h)
        this._curr[this._idx(nx, ny)] = Math.min(1, this._curr[this._idx(nx, ny)] + strength * 0.5);
    }
  }

  injectVWake(fish) {
    const vx = fish.vx ?? 0, vy = fish.vy ?? 0;
    const speed = Math.sqrt(vx * vx + vy * vy);
    if (speed < 0.05) return;
    const angle     = Math.atan2(vy, vx);
    const wakeRad   = this.wakeAngleDeg * Math.PI / 180;
    const wakeLen   = (fish.length ?? 8) * this.wakeLengthMul;
    const str       = Math.min(speed / 5.0, 1.0) * this.wakeStrength;
    for (let i = 1; i <= this.wakePoints; i++) {
      const t    = i / this.wakePoints;
      const dist = wakeLen * t;
      const fade = 1 - t * 0.6;    // strength tapers toward wake tips
      for (const sign of [-1, 1]) { // left and right arms
        const a = angle + Math.PI + sign * wakeRad;
        this.inject(fish.x + Math.cos(a) * dist, fish.y + Math.sin(a) * dist, str * fade);
      }
    }
  }

  update(deltaMs, entities) {
    if (!this.enabled) return;
    const { _w: W, _h: H, damping } = this;
    const curr = this._curr, prev = this._prev;
    const next = new Float32Array(W * H);

    for (let y = 1; y < H - 1; y++) {
      for (let x = 1; x < W - 1; x++) {
        const i = y * W + x;
        next[i] = Math.max(-1, Math.min(1,
          2 * curr[i] - prev[i] + damping * (
            curr[(y-1)*W+x] + curr[(y+1)*W+x] +
            curr[y*W+(x-1)] + curr[y*W+(x+1)] - 4 * curr[i]
          )
        ));
      }
    }

    // Edge handling
    const coeff = this.edgeMode === 'reflect' ? -1.0
                : this.edgeMode === 'absorb'  ?  0.0
                :                           -this.partialCoeff;  // 'partial'
    for (let x = 0; x < W; x++) {
      next[0 * W + x]       = next[1 * W + x] * -coeff;     // top
      next[(H-1) * W + x]   = next[(H-2) * W + x] * -coeff; // bottom
    }
    for (let y = 0; y < H; y++) {
      next[y * W + 0]       = next[y * W + 1] * -coeff;     // left
      next[y * W + (W-1)]   = next[y * W + (W-2)] * -coeff; // right
    }

    // Inject fish V-wakes
    for (const entity of entities) this.injectVWake(entity);

    this._prev = curr;
    this._curr = next;
  }

  drawTint(grid) {
    if (!this.tintEnabled || !this.enabled) return;
    const { _curr: curr, _w: W, _h: H, _mult: mult } = this;
    const cellPx = grid.cellScale / mult;
    const { tintR: r, tintG: g, tintB: b, tintThreshold, tintMaxAlpha } = this;
    const ctx = grid.ctx;
    ctx.save();
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const v = Math.abs(curr[y * W + x]);
        if (v < tintThreshold) continue;
        const alpha = Math.min(v, 1) * tintMaxAlpha / 255;
        ctx.fillStyle = `rgba(${r},${g},${b},${alpha})`;
        ctx.fillRect(x * cellPx, y * cellPx, Math.ceil(cellPx), Math.ceil(cellPx));
      }
    }
    ctx.restore();
  }

  /** Returns the current wave buffer for GPU upload (E7-4). */
  getBuffer() { return this._curr; }
  get width()  { return this._w; }
  get height() { return this._h; }

  /** Reallocate when grid is resized or resolution setting changes. */
  onResize() { this._allocate(); }
}
```

---

**`main.js` integration:**

```js
import { FluidSim } from './fluid/fluid-sim.js';
// ...
const fluidSim = new FluidSim(grid);

// In frame():
fluidSim.update(deltaMs, sim.entities);
sim.draw();
fluidSim.drawTint(grid);   // after sim.draw, before WebGL upload
grid.drawBorder();
compositor.frame(...);     // compositor.frame also uploads wave texture (E7-4)
```

**Tap injection (`main.js` tap handler):**
```js
// In the quick-tap branch (currently calls _recolorNearest):
fluidSim.inject(lx, ly, fluidSim.tapStrength);
```

---

**Menu additions — new `<details>` section "Water":**

| Slider / Control | Property | Range | Default |
|-----------------|----------|-------|---------|
| Water sim toggle | `fluidSim.enabled` | bool | true |
| Resolution | `fluidSim.resolution` | world / display | world |
| Damping | `fluidSim.damping` | 0.90–0.99 step 0.005 | 0.97 |
| Edge mode | `fluidSim.edgeMode` | reflect / absorb / partial | partial |
| Partial reflect | `fluidSim.partialCoeff` | 0.0–0.50 step 0.01 | 0.10 |
| Tap strength | `fluidSim.tapStrength` | 0.0–1.0 step 0.05 | 0.90 |
| Fish wake strength | `fluidSim.wakeStrength` | 0.0–1.0 step 0.05 | 0.40 |
| Wake angle | `fluidSim.wakeAngleDeg` | 10–30 step 0.5 | 19.5 |
| **— Tint overlay —** | | | |
| Tint toggle | `fluidSim.tintEnabled` | bool | true |
| Tint color | `fluidSim.tintR/G/B` | color picker | 180,210,255 |
| Tint max alpha | `fluidSim.tintMaxAlpha` | 1–20 step 1 | 5 |
| Tint threshold | `fluidSim.tintThreshold` | 0.01–0.10 step 0.01 | 0.02 |
| **— Refraction (GPU) —** | | | |
| Refraction toggle | `compositor.waterEnabled` | bool | false (until E7-4) |
| Wave strength | `compositor.waterRefr` | 0.001–0.020 step 0.001 | 0.006 |
| Wave specular | `compositor.waveSpecStr` | 0.0–0.20 step 0.01 | 0.05 |

*Persist all in a `water` blob in `save()`. `fluidSim` receives it via `applySettings()`.*

---

**E2 cross-reference:** `E2-2` in the interaction epic describes the same `FluidSim` class — implement once here (E7-2). `E2-3` (fish ripple injection) is the V-wake above, already included. `E2-4` (tint overlay renderer) is `drawTint()` above. `E2-5` (tap injection) is the tap handler above.

**Affected files:**
`src/fluid/fluid-sim.js` (new), `src/main.js`, `src/ui/menu.js`, `index.html` (Water section CSS)

---

#### E7-4 — Water refractive mode  ⬜

Uploads the `FluidSim` wave buffer as a WebGL texture each frame. The fragment shader derives
surface normals from the wave height gradient and displaces UV sampling — so the scene beneath
the water physically bends. Wave crests also feed into `envLight()` so glass shapes sparkle
brighter over choppy water.

**Note:** `FluidSim` (E7-2) must ship first. `compositor.waterEnabled` starts as `false`; this
story enables it and adds the frag shader branch.

---

**New compositor uniforms:**
```js
// In constructor:
this._uWaterEnabled  = loc('uWaterEnabled');
this._uWaterRefr     = loc('uWaterRefr');
this._uWaveSpecStr   = loc('uWaveSpecStr');
this._uWaveTex       = loc('uWaveTex');
gl.uniform1i(this._uWaveTex, 1);           // texture unit 1
gl.uniform1i(this._uWaterEnabled, 0);
gl.uniform1f(this._uWaterRefr, 0.006);
gl.uniform1f(this._uWaveSpecStr, 0.05);

// New wave texture:
this._waveTex = gl.createTexture();
gl.bindTexture(gl.TEXTURE_2D, this._waveTex);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
```

**`frame()` — upload wave texture:**
```js
frame(bandPx = 0, fluidSim = null) {
  const gl = this._gl;
  // ... existing pond texture upload on unit 0 ...

  if (fluidSim && this._waterEnabled) {
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this._waveTex);
    // Upload Float32 wave buffer as luminance texture:
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, fluidSim.width, fluidSim.height,
                  0, gl.LUMINANCE, gl.FLOAT, fluidSim.getBuffer());
    gl.activeTexture(gl.TEXTURE0);
  }
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
}
```
> WebGL 1 requires `OES_texture_float` extension for float textures. Fallback: quantise the
> buffer to `Uint8Array` (multiply by 127 + 128) and upload as `gl.UNSIGNED_BYTE` — loses
> sub-pixel precision but runs on every device. Detect on startup; use float if available.

**FRAG shader additions:**
```glsl
uniform sampler2D uWaveTex;
uniform bool      uWaterEnabled;
uniform float     uWaterRefr;
uniform float     uWaveSpecStr;
```

After the pond texture sample `vec4 c = texture2D(uTex, uv)` and before the border block:
```glsl
if (uWaterEnabled) {
  float h  = texture2D(uWaveTex, uv).r * 2.0 - 1.0;  // 0..1 → -1..1
  float hR = texture2D(uWaveTex, uv + vec2(px.x, 0.0)).r * 2.0 - 1.0;
  float hD = texture2D(uWaveTex, uv + vec2(0.0, px.y)).r * 2.0 - 1.0;
  vec2 wNorm = vec2(h - hR, h - hD);  // surface gradient → normal approx
  vec2 dispUV = clamp(uv + wNorm * abs(h) * uWaterRefr, vec2(0.001), vec2(0.999));
  c = texture2D(uTex, dispUV);
}
```

Uncomment the E7-4 hook already present in `envLight()`:
```glsl
float envLight(vec2 fieldUV) {
  float h = 0.0;
  h += smoothstep(0.45, 0.0, distance(fieldUV, vec2(0.22, 0.25))) * 0.14;
  h += smoothstep(0.55, 0.0, distance(fieldUV, vec2(0.75, 0.38))) * 0.10;
  h += smoothstep(0.40, 0.0, distance(fieldUV, vec2(0.52, 0.72))) * 0.08;
  h += texture2D(uWaveTex, fieldUV).r * uWaveSpecStr;  // ← uncomment this line
  return h;
}
```
This makes every glass shape specular respond to wave crests — fish swim past →
waves propagate → glass shapes sparkle brighter over the disturbed water.

> **`OES_texture_float` fallback path:** if the extension is unavailable, upload the wave
> buffer as `UNSIGNED_BYTE` (scale `float → 0..255`, unpack in shader with `/127.0 - 1.0`).
> Both paths should produce identical visual results. Check once at startup; store a flag.

**`main.js` — pass `fluidSim` to compositor:**
```js
compositor.frame(grid.border.enabled ? grid.border.width * grid.scale : 0, fluidSim);
```

**Affected files:** `src/renderer/compositor.js`, `src/main.js`

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
| E5-6 | Electron desktop app — transparent always-on-top window; fish roam across the full desktop surface (long-term) | ⬜ |

**E5-6 design notes — Desktop Roaming:**

The core idea: the app runs in an Electron `BrowserWindow` configured so its background
is transparent and it sits above all other OS windows. The black pond background becomes
invisible against the desktop, leaving only the glowing fish visible — swimming across
the taskbar, over open documents, whatever is on screen.

**Electron window config:**
```js
new BrowserWindow({
  transparent:    true,
  frame:          false,
  alwaysOnTop:    true,
  skipTaskbar:    true,
  width:  screen.getPrimaryDisplay().size.width,
  height: screen.getPrimaryDisplay().size.height,
  webPreferences: { nodeIntegration: false, contextIsolation: true },
});
win.setIgnoreMouseEvents(true, { forward: true });
// Selectively re-enable mouse events over fish hit areas:
// ipcRenderer sends hit-test results → main calls win.setIgnoreMouseEvents(false)
```

**Fish interaction in click-through mode:**
- Default: `setIgnoreMouseEvents(true, { forward: true })` — all clicks pass through
  to whatever app is beneath the pond.
- On each `mousemove`, renderer sends the cursor UV to main via IPC; main checks if
  the cursor is over a fish or glass shape. If yes: `setIgnoreMouseEvents(false)` so
  the next click is captured. If no: restore ignore. This creates a selective
  "fish is clickable, empty space is transparent" behavior.
- Feeding: click on empty desktop spawns a pellet at that position; fish swim to it.
  (The click is captured only when the cursor happens to be over a fish at that moment
  — on empty desktop, the click falls through to the app below as expected.)

**Pond bounds in roaming mode:**
- Hard walls at the monitor edges (fish bounce off screen boundaries).
- Optional: treat visible OS window rectangles (queried via Electron's `screen` API
  or a native addon) as soft obstacles — fish gently arc around app windows.
  This is a stretch goal; flat screen-edge walls ship first.

**Multi-monitor:**
- V1: primary display only.
- V2: fish can swim off one screen edge and reappear on the adjacent monitor
  (requires enumerating `screen.getAllDisplays()` and spawning one window per display).

**Steam distribution:**
Once the Electron shell exists, wrapping it in a Steam build (via `electron-builder`
or Greenworks) is straightforward. The Electron shell IS the Steam wrapper.

**Affected files (when picked up):**
- `electron/main.js` (new) — BrowserWindow config, IPC hit-test handler
- `electron/preload.js` (new) — IPC bridge
- `src/main.js` — detect `window.__ELECTRON__` flag; expand canvas to `screen.*` size;
  send cursor position to main process each frame
- `package.json` — add `electron`, `electron-builder` dev deps

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

#### E8-4 — Static specular environment field + normal warping  ⬜

**What changes and why:**
The current specular highlight on glass shapes is driven by `uTime` — two virtual
light blobs orbit Lissajous paths across the screen and the glass brightens as they
pass over it. This means the highlight *moves on its own* regardless of what you do.

This story replaces the time-driven position with a **static light field in screen
space**: a procedural function `envLight(vec2 screenUV) → float` that returns how
bright that patch of the screen is supposed to be. The glass then samples this
field wherever it currently sits. Move the lens → it reveals a different portion of
the field → the highlight shifts with you, not against you. Time is out; position
is in.

This is also the foundational hook for the water lighting system. When E7-2 (CPU
wave grid) and E7-4 (wave normals → fragment shader) land, the wave height map gets
uploaded as a texture. At that point, `envLight()` can sample it and glass shapes
will reflect actual ripples — fish swim past, they inject waves (E2-3), waves
propagate, glass surfaces catch the light off crests. The architecture is designed
so that upgrade is a few added lines inside `envLight()`, not a refactor.

---

**GLSL changes (`compositor.js` — the `FRAG` string):**

*New uniform:*
```glsl
uniform int   uSpecularMode;    // 0=off  1=animated(legacy)  2=static-field
uniform float uSpecularCurve;   // normal-warp strength; 0=flat, ~0.04=glassy rim
// (reserved for E7-4):
// uniform sampler2D uWaveTex;  // wave height/normal map from CPU sim
// uniform float uWaveSpecStr;  // wave contribution to specular
```

*`envLight()` function — insert before `main()`:*
```glsl
// Static light environment sampled by glass surfaces. Three soft sources at
// fixed asymmetric positions; full-screen variation so any shape position is
// interesting. Designed to accept uWaveTex in E7-4 without signature change.
float envLight(vec2 fieldUV) {
  float h = 0.0;
  h += smoothstep(0.45, 0.0, distance(fieldUV, vec2(0.22, 0.25))) * 0.14;
  h += smoothstep(0.55, 0.0, distance(fieldUV, vec2(0.75, 0.38))) * 0.10;
  h += smoothstep(0.40, 0.0, distance(fieldUV, vec2(0.52, 0.72))) * 0.08;
  // E7-4 hook: h += texture2D(uWaveTex, fieldUV).r * uWaveSpecStr;
  return h;
}
```

*Replace shape specular block (currently lines 173–179):*
```glsl
if (specular > 0.5) {
  if (uSpecularMode == 1) {
    // Legacy: animated time-driven blobs (kept for A/B comparison).
    vec2 lp1 = vec2(sin(uTime * 0.2), cos(uTime * 0.30)) * 0.6 + 0.5;
    vec2 lp2 = vec2(sin(uTime * -0.4 + 1.5), cos(uTime * 0.25 - 0.5)) * 0.6 + 0.5;
    float h  = smoothstep(0.4, 0.0, distance(uv, lp1)) * 0.10
             + smoothstep(0.5, 0.0, distance(uv, lp2)) * 0.08;
    c.rgb += h;
  } else if (uSpecularMode == 2) {
    // Static field: warp lookup by outward surface normal at the rim.
    // -normTC = outward (away from center); edgeFact is strongest at the rim.
    vec2 fieldUV = uv - normTC * edgeFact * uSpecularCurve;
    float h = envLight(fieldUV);
    // Slight centre-falloff: glass edge reads brighter than the flat centre.
    h *= mix(1.0, centreBlend, 0.5);
    c.rgb += h;
  }
}
```

*Replace border specular block (currently lines 101–108) — same pattern:*
```glsl
if (uBorderSpecular) {
  if (uSpecularMode == 1) {
    // Legacy animated blobs.
    vec2 lp1 = vec2(sin(uTime * 0.15), cos(uTime * 0.22)) * 0.45 + 0.5;
    vec2 lp2 = vec2(sin(uTime * -0.28 + 2.1), cos(uTime * 0.18 - 0.8)) * 0.45 + 0.5;
    float h = smoothstep(0.15, 0.0, distance(uv, lp1)) * 0.15 * t
            + smoothstep(0.18, 0.0, distance(uv, lp2)) * 0.10 * t;
    c.rgb += h;
  } else if (uSpecularMode == 2) {
    // Static field: norm already computed (inward normal); warp by -norm (outward).
    vec2 fieldUV = uv - norm * t * uSpecularCurve;
    c.rgb += envLight(fieldUV) * t;
  }
}
```

---

**JS/Menu changes (`compositor.js` + `menu.js`):**

- `Compositor` gains `_specularMode = 2` (default to static field; 1 = animated for
  backward compat), `_specularCurve = 0.035` (default).
- New JS uniform locations: `uSpecularMode`, `uSpecularCurve`.
- `setGlassEdge()` opts gains `specularMode` and `specularCurve` params.
- Menu — Specular section (below existing Specular checkbox):
  - **Mode** select: `Animated | Static field` (radio/select)
  - **Curvature** slider: 0.00–0.10, step 0.005 — controls how strongly the rim
    bends the light field; 0 = flat glass, ~0.04 = strong dome.
  - Persist both in `save()` blob.

---

**E7-4 upgrade path (documented here, not implemented in E8-4):**

When E7-4 lands, the following changes integrate water into the specular field:

1. Upload the wave height map as `uWaveTex` (WebGL texture unit 1) alongside
   `uTex` (unit 0). This happens in `compositor.frame()`.
2. Add `uniform sampler2D uWaveTex` and `uniform float uWaveSpecStr` to FRAG.
3. Inside `envLight()`, uncomment the E7-4 hook line. The wave crests now
   contribute to the light field — glass surfaces over choppy water sparkle more.
4. Because the field UV is already normal-warped, wave normals get a second pass:
   they distort the UV displacement (E7-4) *and* they show up brighter in the
   specular field. Fish swimming past → ripples → glass glints. The two systems
   compose without additional work.

No other changes to the specular system are needed; the `envLight()` abstraction
absorbs the wave texture naturally.

---

**Optional follow-up tuning knobs (not in scope for this story):**

- `specularDrift` float (0 = fully static, 0.01–0.05 = the field breathes very
  slowly): `fieldUV += sin(uTime * drift) * 0.02` — gives life without losing the
  reveal mechanic. Could ship as a separate menu row after E8-4 is confirmed.
- Per-shape `specularIntensity` multiplier (currently uniform per scene).

---

**Affected files:**

| File | Change |
|------|--------|
| `src/renderer/compositor.js` | Add `envLight()` GLSL fn; `uSpecularMode`, `uSpecularCurve` uniforms; rewrite shape + border specular blocks; new JS state + getters |
| `src/ui/menu.js` | Mode select + Curvature slider in Glass section; persist to `save()` |

---

#### E8-5 — Per-shape specular strength + radial band + Copy/Paste shader params  ⬜

**Goal:** Give each glass shape its own specular intensity knob and a radial
mask — so the highlight can be constrained to just the rim, just the body, or
anywhere in between — then add Copy/Paste buttons so a tuned shape can be saved
as a code preset or shared back to the developer.

---

**Three new per-shape params:**

| Param | Default | Range | Meaning |
|-------|---------|-------|---------|
| `specularStr` | 1.0 | 0 – 2.0 | Multiplies the envLight() result; 0 = off, 2 = double intensity |
| `specInner` | 0.0 | 0 – 1 (fraction of radius) | Specular fade-in starts here; 0 = from center |
| `specOuter` | 1.0 | specInner – 1 | Specular fade-out ends here; 1 = full lens |

The radial mask uses two `smoothstep` calls so the band edges are soft (±0.04 of
radius). When `specInner ≥ specOuter` the mask is always 0 (a safe degenerate case).

---

**GLSL changes (`compositor.js`):**

*New uniform array (add after `uShapeC` declaration):*
```glsl
// uShapeD: (specStr, specInner fraction, specOuter fraction, unused)
uniform vec4 uShapeD[MAX_SHAPES];
```

*In the shape loop, after reading `C`:*
```glsl
vec4 D = uShapeD[i];
float specStr   = D.x;
float specInner = D.y;
float specOuter = D.z;
```

*Replace the shape specular block:*
```glsl
if (specular > 0.5 && uSpecularMode > 0 && specStr > 0.0) {
  float radialFrac = dist / radius;
  float specMask = smoothstep(specInner, specInner + 0.04, radialFrac)
                 * smoothstep(specOuter, specOuter - 0.04, radialFrac);
  if (uSpecularMode == 1) {
    vec2 lp1 = vec2(sin(uTime * 0.2), cos(uTime * 0.30)) * 0.6 + 0.5;
    vec2 lp2 = vec2(sin(uTime * -0.4 + 1.5), cos(uTime * 0.25 - 0.5)) * 0.6 + 0.5;
    float h = smoothstep(0.4, 0.0, distance(uv, lp1)) * 0.10
            + smoothstep(0.5, 0.0, distance(uv, lp2)) * 0.08;
    c.rgb += h * specStr * specMask;
  } else {
    vec2 fieldUV = uv - normTC * edgeFact * uSpecularCurve;
    c.rgb += envLight(fieldUV) * mix(1.0, centreBlend, 0.5) * specStr * specMask;
  }
}
```

---

**JS changes (`compositor.js`):**

`setShapes()` packs `uShapeD`:
```js
const D = new Float32Array(MAX_SHAPES * 4);
for (let i = 0; i < n; i++) {
  const s = shapes[i];
  D[i*4+0] = s.specularStr ?? 1.0;
  D[i*4+1] = s.specInner   ?? 0.0;
  D[i*4+2] = s.specOuter   ?? 1.0;
  D[i*4+3] = 0;
}
gl.uniform4fv(this._uShapeD, D);
```

---

**`glass-shapes.js` changes:**

`defaultShape()` adds `specularStr: 1.0, specInner: 0.0, specOuter: 1.0`.
`_sanitize()` fills missing values with those defaults.

---

**Menu changes (`menu.js` — inside `buildGlassSliders()`):**

After the Specular checkbox, add three sliders:

- **Strength** — range 0–2.0, step 0.05, decimals 2;
  setVal clamps to [0, 2] and calls `glassShapes.sync(); save()`.
- **Spec inner** — range 0–1.0, step 0.01, decimals 2;
  setVal clamps to `[0, s.specOuter - 0.02]` to keep inner < outer.
- **Spec outer** — range 0–1.0, step 0.01, decimals 2;
  setVal clamps to `[s.specInner + 0.02, 1.0]` to keep outer > inner.

After the Wander/Speed rows, add a `menu-btn-row` with two buttons:

**Copy params** — writes to clipboard:
```js
const COPY_KEYS = ['radius','bevelWidth','refraction','bevelDepth','chromatic',
                   'frost','magnify','specular','specularStr','specInner','specOuter'];
const out = {};
for (const k of COPY_KEYS) out[k] = s[k];
navigator.clipboard.writeText(JSON.stringify(out, null, 2));
```

**Paste params** — reads from clipboard:
```js
navigator.clipboard.readText().then(text => {
  try {
    const p = JSON.parse(text);
    const bounds = {
      radius:[0.02,0.6], bevelWidth:[0.05,1], refraction:[0,0.05],
      bevelDepth:[0,0.10], chromatic:[0,20], frost:[0,8], magnify:[0.5,3],
      specularStr:[0,2], specInner:[0,1], specOuter:[0,1],
    };
    for (const [k,[lo,hi]] of Object.entries(bounds)) {
      if (Number.isFinite(p[k])) s[k] = clamp(p[k], lo, hi);
    }
    if (typeof p.specular === 'boolean') s.specular = p.specular;
    s.specInner = Math.min(s.specInner, s.specOuter - 0.02);
    glassShapes.sync();
    buildGlassSliders();
    save();
  } catch (_) {}
});
```

---

**Preset workflow this enables:**

1. User creates a glass shape and tunes it live.
2. Taps "Copy params" → clipboard has a clean JSON blob.
3. Developer (or AI) receives that blob and can encode it as a named preset in
   `glass-shapes.js`:
   ```js
   export const PRESETS = {
     'Water drop': { radius:0.12, bevelWidth:0.4, refraction:0.02, ... },
     'Portal':     { radius:0.28, bevelWidth:0.15, specularStr:1.8, specInner:0.7, ... },
   };
   ```
4. Later, a Preset dropdown in the menu lets users pick from named shapes.

---

**Affected files:**

| File | Change |
|------|--------|
| `src/renderer/compositor.js` | `uShapeD` uniform; pack specStr/specInner/specOuter in `setShapes()`; radial-mask + strength in shape specular block |
| `src/renderer/glass-shapes.js` | `defaultShape()` + `_sanitize()` get 3 new fields |
| `src/ui/menu.js` | 3 sliders + Copy/Paste button row in `buildGlassSliders()` |

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
---

### E11 · Fish Shader System 🫪
Per-fish selectable render shaders — `vanilla` (current solid color) and `glass`
(liquid-glass refraction). Rainbow is a **stackable effect modifier** that sits on top
of either shader, not an exclusive shader of its own. A glass fish can also be a rainbow
fish. A pond can have any mix simultaneously.

**Architecture decisions (captured 2026-06-15, revised 2026-06-15):**
1. **Glass render approach** — GPU glass-mask layer: a separate mask render target is drawn
   with the fish silhouette in white. The existing compositor is generalized to apply its
   glass refraction effect to any masked region, not just circles. Fish-shaped, not circular.
2. **Rainbow as a modifier** — `rainbowEffect = null | 'time'` is a separate per-fish flag
   that can be set alongside any shader. When active it replaces `this.color` each frame with
   a lerped value from the fish's assigned palette, cycling over time. Glass fish use this
   cycled color as their compositor tint. Field-driven rainbow is parked (see E11-6).
3. **Shader assignment** — per-fish, rolled at spawn from the food bag's shader palette, with
   a menu selector for the pond-wide default for newly spawned fish.
4. **Special pellet repurpose** — the existing `rollColor` remainder probability (old
   "special bag" mechanic) is repurposed in E12: instead of drawing from a separate color
   bag, the remainder triggers a special rainbow pellet that, when eaten, sets the fish's
   `rainbowEffect = 'time'`. The special color bag data structure is removed.

**Data model — per fish:**
```js
fish.shader       = 'vanilla' | 'glass';  // render type; persisted with color
fish.rainbowEffect = null | 'time';       // stackable modifier; null = solid color
fish._paletteId   = string | null;        // palette to cycle through for rainbow
fish._rainbowPhase = 0;                   // 0–1, updated every frame unconditionally
```

**Food bag shader palette** (extends existing palette bag format):
```js
bag.shaderEnabled = false;   // independent toggle; color bag toggle unchanged
bag.shaders = [
  { type: 'vanilla', pct: 70 },
  { type: 'glass',   pct: 20 },
  // remainder (≥0%) → special rainbow pellet, handled by E12 rollColor logic
];
// rainbow is NOT an entry here — it is applied via the special-pellet path in E12
```

---

#### E11-1 — Per-fish `shader` + `rainbowEffect` properties + `vanilla` explicit default  ⬜

Refactors `FishBase` to carry `shader` and `rainbowEffect` fields without changing any
visible behavior. All fish start vanilla with no rainbow effect; `draw()` dispatches on
`this.shader` and applies the rainbow modifier if active.

**`fish-base.js` changes:**
- Constructor:
  ```js
  this.shader        = 'vanilla';
  this.rainbowEffect = null;        // null | 'time'
  this._paletteId    = null;        // set at spawn; used by rainbow cycling
  this._rainbowPhase = 0;           // 0–1
  ```
- `_computeEffectiveColor()` helper — returns the color to use when drawing:
  ```js
  _computeEffectiveColor() {
    if (this.rainbowEffect !== 'time') return this.color;
    const palette = getPaletteById(this._paletteId);
    const colors  = palette?.colors;
    if (!colors?.length) return this.color;
    const t   = this._rainbowPhase * colors.length;
    const i0  = Math.floor(t) % colors.length;
    const i1  = (i0 + 1) % colors.length;
    const f   = t - Math.floor(t);
    const c0  = colors[i0], c1 = colors[i1];
    return {
      r: c0.r + (c1.r - c0.r) * f,
      g: c0.g + (c1.g - c0.g) * f,
      b: c0.b + (c1.b - c0.b) * f,
    };
  }
  ```
- `draw(ctx, scale, debug)` becomes a dispatcher:
  ```js
  draw(ctx, scale, debug) {
    const color = this._computeEffectiveColor();  // replaces this.color throughout
    if (this.shader === 'glass') {
      this._drawGlassMask(ctx, scale, debug, color);
    } else {
      this._drawVanilla(ctx, scale, debug, color);
    }
  }
  ```
- Rename existing `draw()` body → `_drawVanilla(ctx, scale, debug, color)` — replaces
  internal `this.color` references with the `color` parameter. No other logic change.
- Stub `_drawGlassMask(ctx, scale, debug, color)` — just calls `_drawVanilla()` as placeholder.
- `update(dt)`: add `this._rainbowPhase = (this._rainbowPhase + dt * 0.15) % 1;`
  (unconditional so the phase is always fresh when rainbow is enabled mid-life).

**Affected files:** `src/entities/fish-base.js`, `src/palettes/palette-manager.js` (needs
`getPaletteById` export, also used in E11-5)

---

#### E11-2 — Menu shader selector (default for new fish)  ⬜

Adds a **Shader** select row to the Fish section in the menu. Controls what shader newly
spawned fish receive when no food-bag shader palette is active. `rainbow` is not an option
here — rainbow is applied via the special pellet path (E12-5), not as a pond default.

**`menu.js` changes — inside the Fish `<details>` section:**
```html
<label class="menu-row">
  <span>Default shader</span>
  <select id="shader-default-sel" class="menu-select">
    <option value="vanilla">Vanilla</option>
    <option value="glass">Glass</option>
  </select>
</label>
```

- On change: update a module-level `defaultShader` variable; only affects newly spawned
  fish (existing fish are not changed — shader is set once at spawn or when a pellet is eaten).
- Spawn wiring (`main.js`): assign `fish.shader = rollShader(getActivePalette(), getDefaultShader())`
  and `fish._paletteId = getActivePaletteId()` at spawn. `rollShader` is added in E11-3.
- Persist `defaultShader` in `save()`.

**Affected files:** `src/ui/menu.js`, `src/main.js`

---

#### E11-3 — Food bag shader palette  ⬜

Extends the food bag (palette) system so each bag can also roll a render shader at spawn.
The shader roll is independent from the color roll (two separate weighted draws per fish).
Only `vanilla` and `glass` appear in the shader list — rainbow is applied via the
special-pellet path (E12-5), not as an explicit shader entry.

**Palette data model additions (`src/palettes/palette-manager.js` + `index.js`):**

`rollShader(palette, defaultShader)`:
```js
export function rollShader(palette, defaultShader = 'vanilla') {
  if (!palette?.shaderEnabled || !palette.shaders?.length) return defaultShader;
  const hasPct = palette.shaders.some(s => s.pct != null);
  const each   = hasPct ? null : Math.floor(100 / palette.shaders.length);
  let cum = 0;
  const buckets = palette.shaders.map(s => {
    cum += hasPct ? (s.pct ?? 0) : each;
    return { type: s.type, cum };
  });
  const roll = Math.floor(Math.random() * 100) + 1;
  // If roll lands in remainder (above all entries), return defaultShader.
  // The E12 special-pellet logic handles the remainder separately for rainbow.
  return buckets.find(b => roll <= b.cum)?.type ?? defaultShader;
}
```

`getPaletteById(id)`:
```js
export function getPaletteById(id) { return _registry.find(p => p.id === id) ?? null; }
```

**Menu changes — inside the Palette Editor:**
- **Shader toggle** checkbox: `shaderEnabled` (independent of color-palette toggle).
- When enabled, show a **shader list** with up to 3 entries (vanilla/glass only):
  - Each entry: a `<select>` (Vanilla | Glass) + a `%` number input for pct.
  - `+ Add shader` button (up to 3, since rainbow is not user-selectable here);
    `×` remove per entry.
  - A read-only info line: _"Remainder % → shimmer pellet (rainbow)"_ — explains that
    the unaccounted probability becomes a rainbow special pellet.
  - Percentage display mirrors the color-pct UX — omitted % means equal-split of
    the non-remainder entries; the remainder always routes to special.
- Persist `shaderEnabled` + `shaders` array alongside existing palette data in localStorage.

**Spawn wiring (`main.js`):**
- At spawn: `fish.shader = rollShader(palette, defaultShader); fish._paletteId = palette.id`.

**Affected files:** `src/palettes/palette-manager.js`, `src/palettes/index.js`,
`src/ui/menu.js`, `src/main.js`

---

#### E11-4 — `glass` shader — GPU fish-shaped mask layer  ⬜

The most architecturally significant story. Generalizes the WebGL compositor to apply
liquid-glass refraction to any masked region, not just circular `uShapeX` uniforms.

**Overview:**
1. A second hidden `<canvas id="fish-mask">` captures only the glass-fish silhouettes
   in white on black each frame (same Canvas2D approach as the main pond canvas).
2. The compositor samples this mask texture to know where glass fish live.
3. Inside those pixels the same refraction + chromatic + frost + specular math applies,
   using the fish's body as the lens boundary instead of a circle.

**New canvas (`index.html` + `main.js`):**
```html
<canvas id="fish-mask" style="display:none"></canvas>
```
- Same logical dimensions as `#pond`.
- Cleared to black each frame; glass fish paint their `_drawGlassMask()` outline in
  solid white (opaque pixels = glass region).

**`_drawGlassMask(ctx, scale, debug)` in `fish-base.js`:**
- Identical spline path as `_drawVanilla`, but fills with `rgb(255,255,255)`.
- `ctx` receives the mask canvas context, not the pond context; `main.js` passes it.
- Uses `this.color` for nothing — mask is always white; color affects tint (see below).

**Compositor changes (`compositor.js`):**

*New texture binding:*
```js
this._maskTex  = createTexture(gl);   // unit 1
this._uMaskTex = gl.getUniformLocation(prog, 'uMaskTex');
this._uFishGlass = gl.getUniformLocation(prog, 'uFishGlass');  // bool
this._uFishColor = gl.getUniformLocation(prog, 'uFishColor');  // vec3 tint
```

`frame()`:
- Upload the mask canvas to `_maskTex` (same as `_tex` but from `fishMaskCanvas`).
- `gl.uniform1i(this._uFishGlass, anyGlassFishExist ? 1 : 0)` — skip pass if no glass fish.

*FRAG shader additions:*
```glsl
uniform sampler2D uMaskTex;
uniform bool      uFishGlass;
uniform vec3      uFishColor;   // average tint from the fish's assigned color

// After shape loop, before final output:
if (uFishGlass) {
  float mask = texture2D(uMaskTex, vTexCoord).r;
  if (mask > 0.5) {
    // Reuse displacement helpers with fixed glass params for fish body.
    // refraction=0.025, bevelDepth=0.04, chromatic=6.0, frost=0.0 (reasonable defaults).
    // The fish body normal is approximated from the mask gradient (ddx/ddy of mask).
    vec2 fishNorm = normalize(vec2(
      dFdx(texture2D(uMaskTex, vTexCoord).r),
      dFdy(texture2D(uMaskTex, vTexCoord).r)
    ));
    float fishEdge = 1.0 - texture2D(uMaskTex,
                       vTexCoord + fishNorm * 0.004).r; // edge = neighbour outside mask
    // Apply refraction (same glassShift helper):
    vec4 displaced = glassShift(uTex, vTexCoord, -fishNorm, 0.025 * fishEdge, uPxSize);
    // Blend with fish color tint at low opacity so you can still see the glass:
    displaced.rgb = mix(displaced.rgb, uFishColor, 0.15);
    c = mix(c, displaced, mask);
  }
}
```

**Fish color tint uniform** — `main.js` computes average `{r,g,b}` across all glass fish
each frame using `fish._computeEffectiveColor()` (not `fish.color` directly — this ensures
glass fish with `rainbowEffect = 'time'` show a cycling tint rather than a frozen one)
and calls `compositor.setFishGlass(true, avgColor)`.

**Per-fish glass params (future refinement, not scope for this story):**
The initial ship uses pond-wide fixed glass params for all glass fish. Per-fish params
(different refraction per fish) require packing another parallel uniform array and are
deferred to E11-4b if users request it.

**Affected files:** `index.html`, `src/entities/fish-base.js`, `src/renderer/compositor.js`,
`src/main.js`

---

#### E11-5 — `rainbowEffect` time-cycle modifier  ⬜

Implements `rainbowEffect = 'time'` as a per-fish color modifier that stacks on top of
any shader. No GPU changes — pure Canvas2D math via `_computeEffectiveColor()`.

The core logic lives entirely in `_computeEffectiveColor()` (already designed in E11-1):
- When `rainbowEffect === 'time'`, look up `_paletteId` → get palette colors → lerp
  between adjacent colors using `_rainbowPhase` → return the cycled color.
- When `rainbowEffect === null`, return `this.color` unchanged.
- `_rainbowPhase` is incremented in `update()` unconditionally (added in E11-1).

The result feeds into `_drawVanilla(... color)` and `_drawGlassMask(... color)` via the
`draw()` dispatcher — both shaders already accept a color argument. Rainbow is composable
with glass because both shaders call `_computeEffectiveColor()` through the same path.

`getPaletteById` is added to `palette-manager.js` in E11-3 and is already available here.

**Affected files:** `src/entities/fish-base.js` (E11-1 already contains all the logic;
this story is a verification + integration test story — confirm rainbow cycles correctly
on vanilla fish and as a tint on glass fish before E11-6 is considered)

---

#### E11-6 — `rainbowEffect` field-driven sub-mode  ⬛ Parked

> **Parked** — implementation deferred until after E12 ships and the rainbow time-cycle
> modifier is confirmed to feel good in practice.

**Concept:** an animated gradient field flows across the pond. Each fish samples the field
at its `(x, y)` position to determine its current palette phase — fish at different
positions show different colors simultaneously, and the field drifts so the wash moves
across the pond over time. Works as `rainbowEffect = 'field'` alongside `rainbowEffect = 'time'`.

**Rough data model when this is eventually picked up:**
```js
fish.rainbowEffect = null | 'time' | 'field';

function rainbowField(normX, normY, elapsedS) {
  return ((normX * 0.6 + normY * 0.4 + elapsedS * 0.05) % 1 + 1) % 1;  // 0–1
}
// In _computeEffectiveColor():
const phase = this.rainbowEffect === 'field'
  ? rainbowField(this.x / grid.logicalW, this.y / grid.logicalH, this._age)
  : this._rainbowPhase;
```

No food-bag entry needed — this would be set via a special pellet variant or a menu
option; design deferred. `this._age` tracks lifetime in seconds (add to `update()`).

---

**Full affected-file summary for E11:**

| File | Stories | Change |
|------|---------|--------|
| `src/entities/fish-base.js` | 1,4,5 | `shader` + `rainbowEffect` + `_paletteId` + `_rainbowPhase`; dispatcher; `_drawVanilla/GlassMask`; `_computeEffectiveColor()` |
| `src/renderer/compositor.js` | 4 | Fish-mask texture + FRAG glass pass; tint via `_computeEffectiveColor` |
| `src/ui/menu.js` | 2,3 | Default shader select (vanilla/glass only); shader palette editor |
| `src/palettes/palette-manager.js` | 3 | `rollShader()`, `getPaletteById()` |
| `src/palettes/index.js` | 3 | Re-export new functions |
| `src/main.js` | 1,2,3,4 | Spawn wiring; mask canvas; compositor tint using `_computeEffectiveColor` |
| `index.html` | 4 | `<canvas id="fish-mask">` element |

| ID | Story | Status |
|----|-------|--------|
| E11-1 | Per-fish `shader` + `rainbowEffect` + `_paletteId`; dispatcher + `_drawVanilla` rename; `_computeEffectiveColor()` | ⬜ |
| E11-2 | Menu default-shader selector (vanilla/glass); persist; wired at spawn | ⬜ |
| E11-3 | Food bag shader palette — `shaderEnabled`, `shaders[]` (vanilla/glass only), `rollShader()`, `getPaletteById()`; editor UI; remainder info line | ⬜ |
| E11-4 | `glass` shader — fish-mask canvas; compositor fish-glass FRAG pass; tint via `_computeEffectiveColor` | ⬜ |
| E11-5 | `rainbowEffect = 'time'` modifier — verify cycles on vanilla + glass; integration test | ⬜ |
| E11-6 | `rainbowEffect = 'field'` — **parked**; concept documented above | ⬛ |

---

---

### E12 · Fish Food System 🐟🍡
Makes feeding a physical, animated interaction. Clicking the pond spawns a food pellet
entity that swims toward nearby fish; when eaten, the fish's color and shader fade
gradually to their new values rather than snapping. The "special" color-bag remainder
probability is repurposed: instead of drawing from a separate bag, it spawns a shimmer
pellet that gives the eating fish a rainbow time-cycle effect.

**Current state:** feeding is `nearest.color = rollColor()` — instantaneous, no pellet
entity, no animation, no transition.

**Key data structures:**

*FoodPellet entity:*
```js
class FoodPellet {
  constructor(lx, ly, targetColor, targetShader, targetRainbow, paletteId) {
    this.x = lx; this.y = ly;           // logical coords
    this.targetColor   = targetColor;    // {r,g,b} the fish will transition to
    this.targetShader  = targetShader;   // 'vanilla' | 'glass'
    this.targetRainbow = targetRainbow;  // null | 'time'
    this.paletteId     = paletteId;      // which palette to cycle (for rainbow)
    this.eaten         = false;
    this.isSpecial     = targetRainbow === 'time';
  }
}
```

*Per-fish transition state (added in E12-3/4):*
```js
// Color transition
fish._colorFrom     = null;   // {r,g,b} | null
fish._colorTo       = null;   // {r,g,b} | null
fish._colorT        = 0;      // 0→1 progress
fish._colorDuration = 0;      // seconds; ∝ color distance

// Shader transition
fish._shaderFrom     = null;  // 'vanilla' | 'glass' | null
fish._shaderTo       = null;  // 'vanilla' | 'glass' | null
fish._shaderT        = 0;     // 0→1 progress
fish._shaderDuration = 1.5;   // fixed duration (seconds) for all shader transitions
```

**Color distance formula (used in E12-3):**
```js
function colorDist(a, b) {
  const dr = a.r - b.r, dg = a.g - b.g, db = a.b - b.b;
  return Math.sqrt(dr*dr + dg*dg + db*db) / (Math.sqrt(3) * 255);  // 0–1
}
const MIN_TRANSITION_S = 0.5;
const MAX_TRANSITION_S = 4.0;
const duration = MIN_TRANSITION_S + colorDist(current, target) * (MAX_TRANSITION_S - MIN_TRANSITION_S);
```

---

#### E12-1 — Food pellet entity  ⬜

A `FoodPellet` class that renders as a small colored dot at a logical position. Exists
in a `sim.pellets = []` array managed by the simulation.

**Visual:**
- Radius ~2.5 logical units; filled circle.
- Color = `targetColor` for vanilla/glass pellets; a soft white/gold shimmer animation for
  special (rainbow) pellets — cycle through a short gold→white→gold loop using `Date.now()`.
- Slight sink animation: `y += 0.3 * dt` (pellets settle slowly downward, feel physical).
- Despawn after 8 s with no fish eating them (no food waste forever).

**Spawn wiring (`main.js`):**
- Quick tap currently calls `_recolorNearest()`. Replace with:
  ```js
  function _spawnPellet(lx, ly) {
    const palette = getActivePalette();
    const special = getSpecialPalette();
    const color   = rollColor(palette, special);      // may hit remainder → special path
    const isSpecial = /* rollColor returned from special path */ ...;
    const shader  = rollShader(palette, getDefaultShader());
    sim.pellets.push(new FoodPellet(
      lx, ly, color,
      isSpecial ? fish.shader : shader,   // rainbow pellet keeps fish's current shader
      isSpecial ? 'time' : null,
      palette.id,
    ));
  }
  ```
  > *Note: `rollColor` needs to signal whether the special path was taken.* The cleanest
  > approach: `rollColor` returns `{ color, special: bool }` (a small breaking change to
  > a two-field object) so the caller can branch. Alternatively, a separate
  > `rollColorResult(palette, special) → { r,g,b, isSpecial }` function.

**`sim.pellets` lifecycle:**
- `simulation.update()` does not update pellets (they are passive sinking entities).
- `main.js` update loop calls `pellet.update(dt)` for each pellet, removes `eaten` and
  `expired` entries.

**Affected files:** `src/entities/food-pellet.js` (new), `src/simulation.js`,
`src/palettes/palette-manager.js` (rollColor signal), `src/main.js`

---

#### E12-2 — Fish seek-and-eat behavior  ⬜

Fish detect and swim toward the nearest pellet within a sensing radius; eating happens
on contact. Integrates with the existing state-machine in `states.js`.

**Sensing:** each fish, in `update()`, checks `sim.pellets` for the nearest uneaten pellet
within `senseRadius = fish.length * 8`. If found, fish switches to a `'seek'` state and
stores `fish._targetPellet`.

**Seek steering:** a new behavior `seekPellet(fish, ctx)` in `behaviors.js`:
- Returns a force toward `ctx.targetPellet.{x,y}`.
- Weight high enough to override wander/alignment but not separation.
- When `dist(fish, pellet) < fish.length * 0.6` (contact threshold): mark pellet eaten,
  call `fish.eatPellet(pellet)` (defined in E12-3), clear `_targetPellet`, return to `'swim'`.

**Priority with E10 (hold-to-attract):** pellet seek takes priority over attraction point
if a pellet is within sensing range.

**Multiple fish, one pellet:** whichever fish reaches contact first claims it. No
reservation needed — first-come first-served; `pellet.eaten = true` prevents double-eat.

**Affected files:** `src/movement/behaviors.js`, `src/movement/states.js`,
`src/entities/fish-base.js`, `src/simulation.js`

---

#### E12-3 — Gradual color transition  ⬜

When a fish eats a pellet, its color fades smoothly from the current displayed color to
the pellet's target color. Duration scales with color distance: white→black takes longer
than light-pink→red.

**`fish.eatPellet(pellet)` in `fish-base.js`:**
```js
eatPellet(pellet) {
  const current = this._computeEffectiveColor();  // snapshot mid-rainbow-cycle if active
  const dist    = colorDist(current, pellet.targetColor);
  this._colorFrom     = { ...current };
  this._colorTo       = { ...pellet.targetColor };
  this._colorT        = 0;
  this._colorDuration = MIN_TRANSITION_S + dist * (MAX_TRANSITION_S - MIN_TRANSITION_S);
  // shader + rainbow handled in E12-4 and E12-5
}
```

**`update(dt)` addition:**
```js
if (this._colorT < 1 && this._colorFrom) {
  this._colorT = Math.min(1, this._colorT + dt / this._colorDuration);
  const t = this._colorT;
  this.color = {
    r: this._colorFrom.r + (this._colorTo.r - this._colorFrom.r) * t,
    g: this._colorFrom.g + (this._colorTo.g - this._colorFrom.g) * t,
    b: this._colorFrom.b + (this._colorTo.b - this._colorFrom.b) * t,
  };
  if (this._colorT >= 1) { this._colorFrom = null; this._colorTo = null; }
}
```

**`_computeEffectiveColor()` priority:**
- Rainbow effect (`rainbowEffect === 'time'`) overrides `this.color` normally.
- During a color transition, `this.color` is mid-lerp. Rainbow cycling of a mid-lerp
  color is fine — the `_rainbowPhase` still advances, so the fish gets a rainbow effect
  *after* arriving at the target color naturally. No special case needed.

**Affected files:** `src/entities/fish-base.js`

---

#### E12-4 — Shader cross-fade transition  ⬜

When a pellet changes a fish's shader (e.g., vanilla → glass), the body cross-fades
between the two render modes rather than snapping. Uses `globalAlpha` on Canvas2D.

**`eatPellet(pellet)` extension:**
```js
if (pellet.targetShader !== this.shader) {
  this._shaderFrom     = this.shader;
  this._shaderTo       = pellet.targetShader;
  this._shaderT        = 0;
  this._shaderDuration = 1.5;   // fixed; feels independent of how different the shaders are
  this.shader = pellet.targetShader;  // update immediately for logic; visual cross-fades
}
```

**`draw()` dispatcher update:**
```js
draw(ctx, scale, debug) {
  const color = this._computeEffectiveColor();
  if (this._shaderT < 1 && this._shaderFrom !== null) {
    // Cross-fade: draw outgoing at decreasing alpha, incoming at increasing alpha
    ctx.save(); ctx.globalAlpha = 1 - this._shaderT;
    this._drawByShader(this._shaderFrom, ctx, scale, debug, color);
    ctx.restore();
    ctx.save(); ctx.globalAlpha = this._shaderT;
    this._drawByShader(this._shaderTo,   ctx, scale, debug, color);
    ctx.restore();
  } else {
    this._drawByShader(this.shader, ctx, scale, debug, color);
  }
}

_drawByShader(shader, ctx, scale, debug, color) {
  if (shader === 'glass') this._drawGlassMask(ctx, scale, debug, color);
  else                    this._drawVanilla(ctx, scale, debug, color);
}
```

**`update(dt)` addition:**
```js
if (this._shaderT < 1 && this._shaderFrom !== null) {
  this._shaderT = Math.min(1, this._shaderT + dt / this._shaderDuration);
  if (this._shaderT >= 1) this._shaderFrom = null;
}
```

**Affected files:** `src/entities/fish-base.js`

---

#### E12-5 — Special shimmer pellet → rainbow time-cycle  ⬜

Repurposes the `rollColor` "special bag" remainder mechanic. When the probability roll
lands in the remainder (below all color entries), instead of drawing from a special
color bag, the system spawns a special shimmer pellet. Eating it sets
`fish.rainbowEffect = 'time'` and assigns `fish._paletteId`.

**`rollColor` signal change (`palette-manager.js`):**

`rollColor` currently returns `{r,g,b}`. Change to return a result object:
```js
// New signature:
export function rollColor(palette, special) {
  // ... existing logic ...
  if (!hit) {
    // Remainder: signal special rather than drawing from special bag
    return { r: 0, g: 0, b: 0, isSpecial: true };
    // color values are ignored for special pellets; caller checks isSpecial
  }
  return { r: hit.color.r, g: hit.color.g, b: hit.color.b, isSpecial: false };
}
```

> Backward-compatibility note: all call sites that currently do
> `fish.color = rollColor(...)` must be updated to destructure the result.
> The fish-base.js constructor and main.js click handler are the two sites.
> `isSpecial` on existing call sites just gets ignored (falsy) until E12 wires it.

**Special pellet spawn (`main.js` `_spawnPellet`):**
```js
const result = rollColor(palette, special);
if (result.isSpecial) {
  // No color target — fish keeps current color and gains rainbow effect
  sim.pellets.push(new FoodPellet(
    lx, ly,
    null,            // targetColor = null (no color change)
    fish?.shader ?? getDefaultShader(),  // targetShader = fish's current shader
    'time',          // targetRainbow
    palette.id,
  ));
} else {
  sim.pellets.push(new FoodPellet(lx, ly, result, rollShader(palette, defaultShader), null, palette.id));
}
```

**`fish.eatPellet(pellet)` rainbow branch:**
```js
if (pellet.targetRainbow === 'time') {
  this.rainbowEffect = 'time';
  this._paletteId    = pellet.paletteId;
  this._rainbowPhase = 0;   // restart cycle from beginning for clean entry
  // No color transition (fish color stays as-is; rainbow takes over dynamically)
}
```

**Special palette data structure:** the existing `special` bag in `palette-manager.js`
and `src/palettes/builtin/special.js` can be removed once E12-5 ships. The
`getSpecialPalette()` function and `special` palette file become dead code.
Mark for deletion when cleaning up.

**Affected files:** `src/palettes/palette-manager.js`, `src/palettes/index.js`,
`src/entities/food-pellet.js`, `src/entities/fish-base.js`, `src/main.js`

---

**Full affected-file summary for E12:**

| File | Stories | Change |
|------|---------|--------|
| `src/entities/food-pellet.js` | 1,5 | New — FoodPellet class; visual; sink animation; despawn timer |
| `src/entities/fish-base.js` | 2,3,4,5 | `eatPellet()`; `_colorFrom/To/T/Duration`; `_shaderFrom/To/T`; `_drawByShader()`; cross-fade `draw()` |
| `src/movement/behaviors.js` | 2 | `seekPellet()` behavior |
| `src/movement/states.js` | 2 | `'seek'` state + pellet targeting |
| `src/simulation.js` | 1,2 | `sim.pellets = []`; expose to fish update |
| `src/palettes/palette-manager.js` | 5 | `rollColor` returns `{...color, isSpecial}`; remove special-bag draw path |
| `src/main.js` | 1,5 | Replace `_recolorNearest` with `_spawnPellet`; update `rollColor` call sites |

| ID | Story | Status |
|----|-------|--------|
| E12-1 | FoodPellet entity — visual, sink, despawn; `sim.pellets[]`; spawn on tap | ⬜ |
| E12-2 | Fish seek-and-eat — sense radius, `seekPellet` behavior, contact eat | ⬜ |
| E12-3 | Gradual color transition — `_colorFrom/To/T/Duration`; duration ∝ color distance | ⬜ |
| E12-4 | Shader cross-fade — `_shaderFrom/To/T`; globalAlpha cross-fade in `draw()` | ⬜ |
| E12-5 | Special shimmer pellet — `rollColor` isSpecial signal; rainbow effect on eat; retire special bag | ⬜ |

---

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

**Implementation plan:**

| ID | Story | Status |
|----|-------|--------|
| B1-1 | `viewport-fit=cover` added to viewport meta + `env(safe-area-inset-*)` CSS on hamburger button — expands canvas into notch / Dynamic Island area; prevents menu button rendering under the notch | 🟦 |
| B1-2 | `manifest.json` with `display: "standalone"`, `theme_color: "#000000"`, `start_url: "/"`, icon refs — linked from `index.html`; overlaps E1-1/E5-1, do together | 🟦 |
| B1-3 | Apple PWA meta tags in `index.html`: `apple-mobile-web-app-capable`, `apple-mobile-web-app-title`, `apple-mobile-web-app-status-bar-style: black-translucent`, `theme-color`, `apple-touch-icon` link — overlaps E1-2 | 🟦 |
| B1-4 | App icons — design + export `192×192`, `512×512`, `180×180` PNGs to `/icons/`; black background; simple koi or pond motif; blocking for B1-2 | ⬜ |
| B1-5 | iOS-aware fullscreen button — detect iOS in `menu.js` handler (`navigator.standalone !== undefined`); if in-browser (not standalone), replace click action with inline tip: "Tap Share → Add to Home Screen for fullscreen" | 🟦 |
| B1-6 | "Add to Home Screen" one-time banner — shown automatically to iOS-in-browser users on first visit; dismissable; stored in localStorage; `beforeinstallprompt` is NOT available on iOS so this must be a custom instructional banner | ⬜ |

**Research findings (2026-06-14 — confirmed):**

*Current fullscreen code (`src/ui/menu.js` ~line 1112):*
```js
(el.requestFullscreen ?? el.webkitRequestFullscreen)?.call(el);
```
Both `requestFullscreen` and `webkitRequestFullscreen` are `undefined` on iOS Safari.
The `?.call(el)` silently no-ops. The button label never changes. Nothing happens.
(`webkitRequestFullscreen` exists on *macOS* Safari but was never shipped on iOS.)

*iOS Fullscreen API status:*
Apple has never implemented the W3C Fullscreen API on iPhone. Every iOS browser
(Safari, Chrome, Firefox) uses WebKit under Apple's mandate, so all share the same
limitation. There is no JS call that can dismiss the bottom toolbar from within a
browser tab. This cannot be worked around — only replaced.

*What IS available:*
- **Home-screen standalone mode** removes 100% of browser chrome (URL bar + bottom
  toolbar). As of iOS 16.4+, `display: "fullscreen"` in the manifest also suppresses
  the status bar. `display: "standalone"` keeps the status bar but removes all
  browser chrome — safer for broad compatibility.
- `window.navigator.standalone === true` (iOS Safari only) detects when the app is
  running in standalone mode.
- `beforeinstallprompt` does NOT exist on iOS — we can't trigger the native Add to
  Home Screen prompt from JS; the user must do it manually via the Share sheet.

*Existing tasks E1-1 + E1-2 cover ~60% of what's needed:*
Missing from their current scope: `viewport-fit=cover` (one word in the viewport
meta), safe-area CSS on the hamburger button, the iOS-aware fullscreen button
behavior, and the app icons (design work — blocking; no icons exist in the repo yet).

*Safe-area CSS impact:*
- The canvases are `100vw`/`100vh` — they already fill the viewport and will extend
  under the notch once `viewport-fit=cover` is set. No canvas changes needed.
- The hamburger `#menu-btn` at `top: 8px; right: 8px` will render under the notch
  on iPhone X+ without safe-area correction. Fix:
  `top: max(8px, env(safe-area-inset-top));`
  `right: max(8px, env(safe-area-inset-right));`
- The panel top offset may also need `calc(env(safe-area-inset-top) + 40px)`.

*Note:* the bottom toolbar that inspired the liquid glass shapes (E8) may finally
disappear once B1 ships to home-screen users. Poetic.

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
