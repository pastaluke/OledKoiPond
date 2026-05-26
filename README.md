# OLED Koi Pond

A meditative ambient koi pond simulation designed for OLED displays. Lay your phone face-up on a surface — the pure-black background disappears into the hardware, and glowing fish outlines drift through real darkness.

## Documentation

- **[Game Design Document](docs/GDD.md)** — Vision, mechanics, sprite format, fluid sim, platform targets, roadmap

## Status

Pre-production. Tech stack TBD.

## Concept

- Pure `#000000` background — OLED pixels fully off
- Entities rendered as pixel-art outlines (1-bit sprite arrays, color configurable)
- Lightweight 2D wave equation fluid sim for surface ripples
- Fills any aspect ratio — the screen shape *is* the pond
- Targets mobile web first; itch.io HTML5 export planned
