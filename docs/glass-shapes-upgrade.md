# Glass Shapes — liquidGL Shader Upgrade

> Implementation plan + living reference for the glass shapes rendering system.
> Source inspiration: [liquidGL](https://github.com/naughtyduk/liquidGL) (MIT © NaughtyDuk)

---

## What we're upgrading and why

The current glass shapes use a simple linear chromatic band (`t * strength`, only in
a rim strip). The liquidGL shader (MIT) has a dramatically better model: SDF-based
edge detection, `pow(edge, 10) * bevelDepth` for a sharp thick-glass rim, `centreBlend`
so the center is a clean window, Poisson-disk frost blur, animated specular highlights,
and magnification. We adopt all of this while keeping our chromatic R/G/B channel-split
as an _additional_ effect that liquidGL doesn't have.

Architecture is unchanged — this is shader math + new shape params + new sliders only.

---

## New shape data model

```js
// glass-shapes.js — defaultShape()
{
  type:       'circle',  // 'circle' | 'roundedrect' (model ready; roundedrect in shader later)
  cx:          0.5,      // UV x center, 0–1
  cy:          0.5,      // UV y center, 0–1
  radius:      0.15,     // height-fraction radius (aspect-corrected in shader)
  bevelWidth:  0.35,     // rim thickness as fraction of radius (replaces bandFrac)
  refraction:  0.008,    // uniform displacement amplitude (UV units)
  bevelDepth:  0.03,     // pow(edge,10) sharp-rim factor (UV units)
  chromatic:   6,        // R/G/B channel split in pixels (our unique addition)
  frost:       0,        // Poisson blur radius px; 0 = off
  magnify:     1.0,      // lens zoom; 1 = passthrough, > 1 = zoom in
  specular:    false,    // animated orbiting highlight glints
}
```

**Removed:** `bandFrac`, `strength`. Replaced by `bevelWidth`, `refraction`, `bevelDepth`, `chromatic`.

Persisted shapes from the old model that have `strength`/`bandFrac` fields are
migrated on restore() via fallback defaults (old key missing → use default).

---

## New GLSL uniform layout

### Shape uniform arrays (replaces `uShapeCR` / `uShapeBS`)

| Uniform | Type | Packing |
|---------|------|---------|
| `uShapeA[4]` | vec4 | cx, cy, radius, bevelWidth (all height-fraction) |
| `uShapeB[4]` | vec4 | refraction, bevelDepth, chromatic_px, frost_px |
| `uShapeC[4]` | vec2 | magnify, specular (0.0 or 1.0) |

### New globals
| Uniform | Type | Purpose |
|---------|------|---------|
| `uTime` | float | seconds since page load — drives specular animation |

`uShapeCount` stays (int). Old `uShapeCR` / `uShapeBS` are removed.

---

## GLSL upgrade — shared primitives

```glsl
// ── Shared utility functions ───────────────────────────────────────────────────

// Signed distance to a rounded rectangle (from liquidGL, MIT).
float udRoundBox(vec2 p, vec2 b, float r) {
  return length(max(abs(p) - b + r, 0.0)) - r;
}

// Pseudo-random (for Poisson frost sampling).
float rand2(vec2 st) {
  return fract(sin(dot(st, vec2(12.9898, 78.233))) * 43758.5453);
}

// 16-sample Poisson disk blur at `sampleUV`, blur radius in texels.
vec4 frostSample(vec2 uv, vec2 texel, float radius) {
  vec4 sum = vec4(0.0);
  for (int i = 0; i < 16; i++) {
    float angle = rand2(uv + float(i)) * 6.2831853;
    float dist  = sqrt(rand2(uv - float(i))) * radius;
    sum += texture2D(uTex, uv + vec2(cos(angle), sin(angle)) * texel * dist);
  }
  return sum / 16.0;
}
```

---

## GLSL upgrade — shape loop body

```glsl
// Inside the per-shape loop, after computing aspect-corrected dist:

if (dist < radius) {
  vec2 toC    = shapeCenter - uv;           // toward center (plain UV)
  vec2 normTC = normalize(toC);

  // Edge factor: 1.0 at the rim, smoothly 0.0 inward over bevelWidth*radius.
  float bevelPx = bevelWidthFrac * radius;
  float edgeFact = 1.0 - smoothstep(0.0, max(bevelPx, 0.001), radius - dist);
  // edgeFact ≈ 1 at rim, ≈ 0 deeper inside.

  // Centre blend: 0 at exact center, 1 at ~40% of radius outward.
  // Keeps the very center of the lens as a clean pass-through window.
  float centreBlend = smoothstep(0.0, radius * 0.4, dist);

  // Displacement amount: smooth refraction + sharp bevel at rim (liquidGL formula).
  float dispAmt = edgeFact * refraction + pow(edgeFact, 10.0) * bevelDepth;

  // Magnification: zoom the sample UV toward shape center.
  vec2 magUV = (uv - shapeCenter) / max(magnify, 0.01) + shapeCenter;

  // Final sample UV: magnified base + displacement toward center.
  vec2 sampleUV = magUV + normTC * dispAmt * centreBlend;
  sampleUV = clamp(sampleUV, vec2(0.001), vec2(0.999));

  // Sample: frost blur or chromatic R/G/B split.
  vec4 refracted;
  if (frost > 0.0) {
    refracted = frostSample(sampleUV, px, frost);
    // (Chromatic skipped in frost mode — invisible through blur)
  } else {
    float chromaScale = chromatic_px * edgeFact; // fringing only near rim
    refracted = vec4(
      texture2D(uTex, sampleUV + normTC * chromaScale * 1.5 * px).r,
      texture2D(uTex, sampleUV                                     ).g,
      texture2D(uTex, sampleUV - normTC * chromaScale * 1.5 * px  ).b,
      1.0
    );
  }

  // Anti-halo: where displacement jumps across a hard edge (e.g. fish outline
  // to black), blend back to the base sample near center to avoid sharp seams.
  vec4 base = texture2D(uTex, uv);
  float diff     = clamp(length(refracted.rgb - base.rgb) * 4.0, 0.0, 1.0);
  float antiHalo = (1.0 - centreBlend) * diff;
  c = mix(refracted, base, antiHalo);

  // Specular: two animated light glints orbiting with sin/cos of uTime (liquidGL).
  if (specular > 0.5) {
    vec2 lp1 = vec2(sin(uTime * 0.2), cos(uTime * 0.3)) * 0.6 + 0.5;
    vec2 lp2 = vec2(sin(uTime * -0.4 + 1.5), cos(uTime * 0.25 - 0.5)) * 0.6 + 0.5;
    float h = smoothstep(0.4, 0.0, distance(uv, lp1)) * 0.10
            + smoothstep(0.5, 0.0, distance(uv, lp2)) * 0.08;
    c.rgb += h;
  }
}
```

---

## JS changes

### `compositor.js`
- Remove `uShapeCR`, `uShapeBS` uniforms + getLocations.
- Add `uShapeA`, `uShapeB`, `uShapeC`, `uTime` uniform locations.
- `setShapes(shapes)` uploads the three new float arrays (4×4 + 4×4 + 4×2 floats).
- `frame()` sets `uTime = (performance.now() - this._startTime) / 1000` each call.
- Add `this._startTime = performance.now()` in constructor.

### `glass-shapes.js`
- `defaultShape()` returns new field set (bevelWidth, refraction, bevelDepth,
  chromatic, frost, magnify, specular). Remove `bandFrac`, `strength`.
- `restore()` migration: if old field present (e.g. `bandFrac`) map it; missing
  new fields fall back to defaults. Forward-compatible.
- `sync()` maps the new model to `{cx, cy, radius, bevelWidth, refraction,
  bevelDepth, chromatic, frost, magnify, specular}` and calls `setShapes()`.
- `hitTest()`: unchanged (uses `radius`).

### `menu.js`
Replace 3 old sliders (Radius, Rim width, Distortion) with 7 new ones + 1 toggle:

| Label | Field | Range | Step |
|-------|-------|-------|------|
| Radius | radius | 0.02–0.60 | 0.01 |
| Bevel width | bevelWidth | 0.05–1.0 | 0.01 |
| Refraction | refraction | 0–0.05 | 0.001 |
| Bevel depth | bevelDepth | 0–0.10 | 0.001 |
| Chromatic | chromatic | 0–20 | 0.5 |
| Frost | frost | 0–8 | 0.5 |
| Magnify | magnify | 0.5–3.0 | 0.05 |
| Specular | specular | checkbox | — |

### `debug-overlay.js`
- Inner ring: `radius * (1 - bevelWidth)` (was `radius * (1 - bandFrac)`). One-line fix.

---

## Affected files summary

| File | Change |
|------|--------|
| `src/renderer/compositor.js` | New uniform layout; `uTime`; upgraded FRAG shader |
| `src/renderer/glass-shapes.js` | New shape model; updated `sync()` / `restore()` |
| `src/ui/menu.js` | 7 sliders + specular checkbox replacing old 3 |
| `src/debug-overlay.js` | Inner ring formula (1-line) |

---

## Verification

1. **No regression**: reload → fish swim normally, border glass edge unchanged.
2. **Add a shape** → faint ring appears; fish swimming under the rim show R/G/B
   fringing at the edge + cleaner center.
3. **Bevel depth > 0** → a sharp glassy rim appears at the circle boundary.
4. **Centre of lens** → fish pass through undistorted (centreBlend = 0 there).
5. **Frost > 0** → rim blurs into frosted appearance; chromatic fringing stops.
6. **Magnify > 1** → fish appear zoomed inside the lens circle.
7. **Specular on** → two animated light glints orbit the lens.
8. **Reload** → all params and positions restored from localStorage.
9. **Old saved data** (if any from pre-upgrade `strength`/`bandFrac` keys) loads
   without error; missing new fields use defaults.

---

*Created: 2026-06-14*
