# E2-8 — Rain (random ripple droplets)

**Status:** live · **Shipped:** 2026-07-02

Ambient rain: random droplets that patter across the pond, each stamping a small
disturbance into the existing `RippleField` so concentric rings spread from where
the drop "landed". Rain owns only the *when / where / how-hard* of drops; all
wave physics stay in `RippleField`.

## Menu — new **Rain** submenu

| Control | Range | Default | Meaning |
|---------|-------|---------|---------|
| Rain (toggle) | on/off | **off** | Master enable. Off by default so the pond stays calm until opted in. |
| Frequency | 0–30 /s | 2.0 | Mean droplets per second. Drops arrive as a Poisson process, so low values give a sparse, irregular patter rather than a metronome. |
| Strength | 0.1–5.0 | 1.2 | Mean ripple amplitude per drop (same units as the Water "Tap strength"). |
| Std dev | 0–3.0 | 0.5 | Std deviation of per-drop amplitude (Gaussian). 0 = every drop identical; higher = a natural mix of big/small drops. |

Reset / Copy / Paste buttons mirror the Water section; settings persist to
localStorage alongside the water blob.

## Why the default std dev is 0.5

The user asked for a realistic default spread given the default is already a
gentle, low-frequency drizzle. Real light rain has noticeably varied drop sizes;
a coefficient of variation (std ÷ mean) around 0.4 is representative. With the
default mean strength of 1.2, `stddev = 0.5` gives CV ≈ 0.42 — visible drop-to-drop
variety without the occasional drop dominating the scene.

## Implementation

- **`src/fluid/rain.js`** — `Rain` class + `RAIN_DEFAULTS`. Each frame,
  `update(dtMs, rippleField, grid)` computes expected drops = `frequency × dt`,
  spawns the whole part outright plus the fractional part probabilistically
  (frame-rate independent; the whole part is capped at 20 so a tab-stall can't
  unleash a burst). Each drop lands at a uniform-random `(lx, ly)` with amplitude
  drawn from a normal distribution (Box–Muller, spare sample cached) centred on
  `strength`, floored to `0.05` so a wide stddev never yields a dead or
  sign-flipped drop. Injection reuses `rippleField.inject(lx, ly, amp)`.
- **`src/main.js`** — constructs `Rain`, calls `rain.update(...)` before
  `rippleField.update()` each frame, and passes `rain` into `initMenu`.
- **`src/ui/menu.js`** — Rain `<details>` section, `rainSnapshot()` /
  `applyRainSettings()` (clamped, paste-safe), persistence in the `save()` blob
  and the restore path.
