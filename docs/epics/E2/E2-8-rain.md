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
| Freq std dev | 0–15 | 0.6 | Std deviation of the drop *rate* — how much the rain gusts and lulls over time. 0 = perfectly steady rate; higher = rain that swells and fades in waves. |
| Strength | 0.1–5.0 | 1.2 | Mean ripple amplitude per drop (same units as the Water "Tap strength"). |
| Strength std dev | 0–3.0 | 0.5 | Std deviation of per-drop amplitude (Gaussian). 0 = every drop identical; higher = a natural mix of big/small drops. |

Reset / Copy / Paste buttons mirror the Water section; settings persist to
localStorage alongside the water blob.

## Why the default std dev is 0.5

The user asked for a realistic default spread given the default is already a
gentle, low-frequency drizzle. Real light rain has noticeably varied drop sizes;
a coefficient of variation (std ÷ mean) around 0.4 is representative. With the
default mean strength of 1.2, `stddev = 0.5` gives CV ≈ 0.42 — visible drop-to-drop
variety without the occasional drop dominating the scene.

## Gusting frequency (Freq std dev)

The drop *rate* isn't held flat — it wanders around the mean via a mean-reverting
Ornstein–Uhlenbeck process, so rain naturally swells and lulls instead of averaging
out to a constant patter. `freqStddev` is the stationary standard deviation of that
wander; the OU noise term is scaled by `√(2·θ)` so the steady-state spread matches
`freqStddev` regardless of the mean-reversion rate `θ` (`FREQ_THETA = 0.4`, i.e.
gusts that come and go over a couple of seconds). The rate is floored at 0, and the
mean-zero offset means the long-run average frequency is unchanged. Set `freqStddev`
to 0 for a perfectly steady rate. Frequency `0` still disables rain entirely (gusts
only modulate a positive mean).

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
