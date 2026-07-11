// src/renderer/cartridges.js
// Shader-cartridge registry (E14 Phase 7a, architecture §3.4 / §5.3).
//
// A cartridge is a swappable *scene* render style that runs as stage A of the
// compositor's two-stage pass graph: the pond texture is sampled through the
// cartridge fragment shader into an FBO, then the existing post stage (water
// refraction, border glass, glass shapes, chroma-key) runs unchanged on top.
// With no cartridge active, stage A is skipped and the post stage samples the
// pond texture directly — today's exact path, pixel-identical.
//
// This module owns only DATA + selection state (mirrors palette-manager.js and
// species-registry.js: builtin records + active id + CRUD-ish accessors). All
// GL lives in compositor.js, which compiles a cartridge's `frag` on demand.
//
// Cartridge record:
//   { id, name, builtin, wantsWave, frag, params }
// where `params[key] = { label, min, max, default, step }` and the compositor
// exposes each param key to the fragment as `uniform float <key>;`. The menu
// auto-builds a slider row per param via the existing makeRow factory.
//
// The fragment source is a GLSL ES 1.00 body: it may declare helper functions
// and MUST define `void main()`. The compositor injects this preamble first:
//   precision highp float;
//   varying vec2 vUv;                     // scene/texture-space UV (0..1)
//   uniform sampler2D uTex;               // the pond scene
//   uniform sampler2D uWaveTex;           // ripple height field (if wantsWave)
//   uniform vec2  uRes;                   // output resolution in px
//   uniform float uTime;                  // seconds since start
//   uniform float <param key>;            // one per params entry
// plus, on the WATER cartridge only, the caustic look ports @paper-design/shaders
// (Apache-2.0 — see docs/THIRD-PARTY-LICENSES.md).

// ── Builtin cartridge fragments ────────────────────────────────────────────────

// Retro phosphor terminal: monochrome luminance mapped to a phosphor colour, a
// cheap 4-tap bloom on bright cells, and screen-space scanlines. Pure-black scene
// pixels stay black (OLED-friendly — only lit content glows).
const TERMINAL_FRAG = `
vec3 phosphorTint(float p) {
  if (p < 0.5)      return vec3(0.30, 1.00, 0.45);   // green
  else if (p < 1.5) return vec3(1.00, 0.72, 0.24);   // amber
  else              return vec3(1.00, 0.34, 0.28);   // red
}
float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
void main() {
  vec2 px = 1.0 / uRes;
  float l = luma(texture2D(uTex, vUv).rgb);
  // Cheap glow: average the four orthogonal neighbours' luminance.
  float g = 0.25 * (
      luma(texture2D(uTex, vUv + vec2( px.x, 0.0)).rgb)
    + luma(texture2D(uTex, vUv + vec2(-px.x, 0.0)).rgb)
    + luma(texture2D(uTex, vUv + vec2(0.0,  px.y)).rgb)
    + luma(texture2D(uTex, vUv + vec2(0.0, -px.y)).rgb));
  float lum = clamp(l + glow * g, 0.0, 1.5);
  vec3 col = phosphorTint(phosphor) * lum;
  // Scanlines: a fixed number of dark bands independent of resolution.
  float band = 0.5 + 0.5 * sin(vUv.y * 260.0 * 3.14159265);
  col *= 1.0 - scanline * (1.0 - band);
  gl_FragColor = vec4(col, 1.0);
}`.trim();

// Game-Boy-Color handheld: 4-tone quantize with Bayer-ordered dithering and a
// faint LCD pixel grid. `tone`=0 → classic DMG green LCD, 1 → neutral greys.
// Near-black scene pixels are held at true black to preserve the OLED backdrop.
const GBC_FRAG = `
// Recursive 4x4 Bayer ordered-dither threshold in [0,1) (compact, ES 1.00-safe).
float bayer2(vec2 a) { a = floor(a); return fract(a.x / 2.0 + a.y * a.y * 0.75); }
float bayer4(vec2 a) { return bayer2(0.5 * a) * 0.25 + bayer2(a); }
vec3 dmgShade(float lv, float tone) {
  // lv is 0..3. DMG green LCD ramp vs. neutral grey ramp.
  vec3 green =
      lv < 0.5 ? vec3(0.06, 0.22, 0.06)
    : lv < 1.5 ? vec3(0.19, 0.38, 0.19)
    : lv < 2.5 ? vec3(0.55, 0.67, 0.06)
    :            vec3(0.61, 0.74, 0.06);
  float grey = lv / 3.0;
  return mix(green, vec3(grey), tone);
}
void main() {
  vec3 scene = texture2D(uTex, vUv).rgb;
  float lum = dot(scene, vec3(0.299, 0.587, 0.114));
  if (lum < 0.02) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }   // keep OLED black
  float d = (bayer4(gl_FragCoord.xy) - 0.5) * dither * 0.33;
  float q = clamp(lum + d, 0.0, 1.0);
  float lv = floor(q * 3.0 + 0.5);                 // 0,1,2,3  → 4 tones
  vec3 col = dmgShade(lv, tone);
  // LCD grid: faint dark lattice every 3 device px.
  vec2 cell = fract(gl_FragCoord.xy / 3.0);
  float line = max(step(cell.x, 0.12), step(cell.y, 0.12));
  col *= 1.0 - grid * 0.35 * line;
  gl_FragColor = vec4(col, 1.0);
}`.trim();

// Paper-water: caustic surface look adapted from @paper-design/shaders `water`
// (Apache-2.0). Their layered-noise `getCausticNoise` drives both a refraction
// of the scene and animated highlight bands; we additionally displace by the
// live ripple height field (uWaveTex) so taps/rain feed the surface (wantsWave).
const WATER_FRAG = `
// ── adapted from @paper-design/shaders (Apache-2.0) — see THIRD-PARTY-LICENSES.md
mat2 rotate2D(float r) { return mat2(cos(r), sin(r), -sin(r), cos(r)); }
float getCausticNoise(vec2 uv, float t, float scale) {
  vec2 n = vec2(0.1);
  vec2 N = vec2(0.1);
  mat2 m = rotate2D(0.5);
  for (int j = 0; j < 6; j++) {
    uv *= m;
    n  *= m;
    vec2 q = uv * scale + float(j) + n + (0.5 + 0.5 * float(j)) * (mod(float(j), 2.0) - 1.0) * t;
    n += sin(q);
    N += cos(q) / scale;
    scale *= 1.1;
  }
  return (N.x + N.y + 1.0);
}
// ── end adapted section
void main() {
  vec2 px = 1.0 / uRes;
  float aspect = uRes.x / uRes.y;
  vec2 uv = vUv;
  vec2 suv = vec2(uv.x * aspect, uv.y) * (0.6 + size * 3.4);
  float t = uTime * 0.35;
  float c  = getCausticNoise(suv, t, 1.0);
  float cx = getCausticNoise(suv + vec2(0.012, 0.0), t, 1.0) - c;
  float cy = getCausticNoise(suv + vec2(0.0, 0.012), t, 1.0) - c;
  vec2 refr = vec2(cx, cy) * caustic * 0.05;
  // Live ripple field displacement (surface normals from the height texture).
  float h  = texture2D(uWaveTex, uv).r * 2.0 - 1.0;
  float hR = texture2D(uWaveTex, uv + vec2(px.x, 0.0)).r * 2.0 - 1.0;
  float hD = texture2D(uWaveTex, uv + vec2(0.0, px.y)).r * 2.0 - 1.0;
  vec2 wn = vec2(h - hR, h - hD);
  vec2 sampleUV = clamp(uv + refr + wn * abs(h) * waves * 0.6, vec2(0.001), vec2(0.999));
  vec3 scene = texture2D(uTex, sampleUV).rgb;
  float bandv = pow(clamp(c * 0.5, 0.0, 1.0), 3.0);
  vec3 hi = vec3(0.45, 0.82, 1.0) * bandv * highlights;
  gl_FragColor = vec4(scene + hi, 1.0);
}`.trim();

const BUILTIN_CARTRIDGES = [
  {
    id: 'terminal', name: 'Retro terminal', builtin: true, wantsWave: false,
    frag: TERMINAL_FRAG,
    params: {
      phosphor: { label: 'Phosphor', min: 0, max: 2, default: 0, step: 1 },
      scanline: { label: 'Scanlines', min: 0, max: 1, default: 0.35, step: 0.05 },
      glow:     { label: 'Glow', min: 0, max: 1.5, default: 0.5, step: 0.05 },
    },
  },
  {
    id: 'gbc', name: 'Game handheld', builtin: true, wantsWave: false,
    frag: GBC_FRAG,
    params: {
      tone:   { label: 'Grey ↔ Green', min: 0, max: 1, default: 0, step: 1 },
      dither: { label: 'Dithering', min: 0, max: 1, default: 0.7, step: 0.05 },
      grid:   { label: 'LCD grid', min: 0, max: 1, default: 0.5, step: 0.05 },
    },
  },
  {
    id: 'water', name: 'Paper water', builtin: true, wantsWave: true,
    frag: WATER_FRAG,
    params: {
      size:       { label: 'Scale', min: 0, max: 1, default: 0.35, step: 0.02 },
      caustic:    { label: 'Caustics', min: 0, max: 2, default: 0.8, step: 0.05 },
      waves:      { label: 'Wave refract', min: 0, max: 2, default: 0.9, step: 0.05 },
      highlights: { label: 'Highlights', min: 0, max: 1, default: 0.18, step: 0.02 },
    },
  },
];

// The "off" sentinel — selecting it skips stage A entirely (baseline path).
export const CARTRIDGE_NONE = 'none';

// ── Registry state ──────────────────────────────────────────────────────────────

const _clone = (o) => JSON.parse(JSON.stringify(o));
const _cartridges = BUILTIN_CARTRIDGES.map(_clone);
const _byId = new Map(_cartridges.map((c) => [c.id, c]));

// Live param values, keyed by cartridge id → { paramKey: value } (seeded to
// each cartridge's defaults; mutated by the menu, persisted by menu.save()).
const _paramValues = {};
for (const c of _cartridges) {
  _paramValues[c.id] = {};
  for (const k in c.params) _paramValues[c.id][k] = c.params[k].default;
}

let _activeId = CARTRIDGE_NONE;

export function getAllCartridges() { return [..._cartridges]; }
export function getCartridge(id)   { return _byId.get(id) ?? null; }

export function getActiveCartridgeId() { return _activeId; }
export function getActiveCartridge()   { return _byId.get(_activeId) ?? null; }
export function setActiveCartridge(id) {
  _activeId = (id === CARTRIDGE_NONE || _byId.has(id)) ? id : CARTRIDGE_NONE;
  return _activeId;
}

/** Live value map for a cartridge's params (the object the menu binds to). */
export function getParamValues(id) { return _paramValues[id] ?? {}; }
export function getParam(id, key)  { return _paramValues[id]?.[key]; }
export function setParam(id, key, val) {
  const cart = _byId.get(id);
  if (!cart || !cart.params[key]) return;
  const p = cart.params[key];
  _paramValues[id][key] = Math.max(p.min, Math.min(p.max, val));
}

/** Reset a cartridge's params to their record defaults. */
export function resetParams(id) {
  const cart = _byId.get(id);
  if (!cart) return;
  for (const k in cart.params) _paramValues[id][k] = cart.params[k].default;
}

// ── Persistence ─────────────────────────────────────────────────────────────────
// Shape: { activeId, params: { [cartridgeId]: { key: value } } }. Consumed by
// menu.save()/load; validated + clamped on the way back in.

export function serializeCartridges() {
  return { activeId: _activeId, params: _clone(_paramValues) };
}

export function restoreCartridges(blob) {
  if (!blob || typeof blob !== 'object') return;
  if (blob.params && typeof blob.params === 'object') {
    for (const id in blob.params) {
      const vals = blob.params[id];
      if (!_byId.has(id) || !vals || typeof vals !== 'object') continue;
      for (const k in vals) if (Number.isFinite(vals[k])) setParam(id, k, vals[k]);
    }
  }
  if (typeof blob.activeId === 'string') setActiveCartridge(blob.activeId);
}
