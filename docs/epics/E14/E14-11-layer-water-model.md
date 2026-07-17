# E14-11 — Layers polish: parametric water model + vertical drift

> Design of record for the layer follow-up, slotted between E14-6 (depth layers,
> shipped) and the caustics chain (E7-8+). Locks the parts we're **definitely
> doing** — (1) a parametric water model, (3) gentle vertical drift — and records
> the deferred (2) per-species depth footprint and why it's blocked.

## Why (what E14-6 got wrong)

E14-6 shipped discrete layers where each layer has an **independent** `{color, a}`
depth filter. Playtest found three problems:

1. **Changing the layer count wipes edits.** `setLayerCount → defaultStack(n)`
   rebuilds every layer from scratch, discarding any authored colors.
2. **Per-layer independent color+opacity doesn't compose** into a believable body
   of water — the planes read as unrelated tints, not one pond sampled at depth.
3. **Magic constants.** The floor alpha (`0.62`) and the linear ramp were numbers
   picked in code, not player-meaningful knobs.

Root cause: customization lives *per layer* when it should live in a few **global
knobs**, with per-layer tints **derived**.

## (1) Parametric water model — DEFINITE

Replace the per-layer editors with global knobs; derive each layer's tint.

**Knobs (the whole Depth section):**
| Knob | Meaning |
|---|---|
| **Water color** | one base hue for the pond |
| **Layer count** `N` | depth resolution (planes) |
| **Murkiness** `m` (0–1) | how far the color darkens toward black from surface → floor |
| **Surface opacity** `aS` | depth-filter strength at the top |
| **Floor opacity** `aF` | depth-filter strength at the bottom |

**Derivation** (layer `i`, with `i=0` = floor … `i=N-1` = surface; `depth = (N-1-i)/(N-1)`, so 1 at the floor, 0 at the surface):
```
value   = 1 - m * depth               // 1 at surface, (1-m) at floor
tint.rgb = waterColor * value          // surface = full color, floor = darkened
tint.a   = lerp(aS, aF, depth)         // even distribution between the two ends
```
- **No wipe:** the knobs persist; changing `N` just re-samples the gradient.
- **Even distribution between authored endpoints** — exactly the user's ask.
- `m=0, aS=aF=0` → no depth (matches N=1 today). Sensible defaults: dark-ish
  water color (near black), `m≈0.6`, `aS≈0.1`, `aF≈0.6`.

**Aesthetic note:** the pond background is pure-black OLED. A **dark** water color
(fish fading into black depths) composes cleanly; a **bright** water color tints
fish over a black void (mismatch). Tinting the background to match a colored water
is a bigger, separate call — **deferred**; default stays black-fade.

**Persistence/migration:** the layer blob becomes the parametric params
(`{ waterColor, count, murkiness, opacitySurface, opacityFloor }`) instead of a
per-layer tint array. Old E14-6 blobs: read `count` if present, else defaults;
per-layer tints are dropped (regenerate). `serializeLayers/restoreLayers` swap to
the param shape; the derived `_layers` array stays the internal runtime form so
the renderer/draw-order code is untouched.

## (3) Vertical drift — DEFINITE

Make depth feel alive: each fish occasionally lerps to a nearby layer at a gentle
rate, instead of being pinned to its spawn plane.

- Reuses the existing `moveToLayer` / `advanceLayer` lerp machinery (built for
  food sinking in E14-6).
- Per-fish timer: every few seconds, pick an adjacent (±1, occasionally ±2) layer
  within the fish's allowed range and lerp over ~1–2 s.
- **Per-species vertical-roam rate** (`0` = pinned; gentle non-zero default). Data
  on the species record (e.g. `render.verticalRoam` or a `depth` block).
- Respects `layerLock` (rate forced 0) and the future `depthRange`.
- **Deferred:** schoolmates sharing layers — it couples the layer system into the
  boids steering (schoolmates would read/influence each other's depth), breaking
  the clean "layers don't touch movement" separation for a subtle payoff.

## (2) Per-species depth footprint — DEFERRED (blocked on creature size)

The right model (from the "inches" discussion): a creature's depth footprint =
its **vertical size** relative to pond depth. A big creature's body spans many
layers at once, so it has *few, coarse* resting depths spanning the whole column
(e.g. a shark steps by ~15 in a 30-layer pond; a tetra steps by 1). This is a
**size-driven depth step / span**, not a narrow top band.

**Why it's not in this story:** there is no absolute, cross-species size today —
`length` is emergent from Shape-editor offsets, `sizes{}` is per-instance variance
within a species, and nothing makes a shark comparably "bigger" than a tetra. The
footprint math (`span = ceil(vSize / layerHeight)`; slots ≈ `N − span + 1`;
distribute center) needs that primitive.

**Plan:** design (2) together with the creature-size work — **E13-8 (size &
growth)** plus an absolute **size-scale** primitive it implies. E14-11 leaves the
data slot (`species.render.depthRange` / `layerLock`) anticipated but unbuilt, so
it drops in cleanly. Do NOT half-build it against a size model that isn't real.

## Also deferred / noted
- **Continuous depth** (a 0–1 float vs discrete layers): keep discrete authored
  layers now; the caustics chain (E7-8+) will collapse to a few "projection
  planes" independently. Revisit only if banding bothers us.

## Acceptance sketch
- Depth section shows the 5 parametric knobs; per-layer editors gone.
- Changing layer count preserves the look (re-derives; no reset to black).
- A dark water color + murkiness + opacity gradient reads as one coherent pond.
- Fish visibly, slowly drift between depths; `layerLock` species stay put.
- N=1 / zero opacity still identical to pre-E14-6.
- Persistence round-trips the params; old E14-6 blobs load without error.
