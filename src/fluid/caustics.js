// src/fluid/caustics.js
// Water caustics (E7-8..11): the shimmering light web a pond surface focuses
// onto whatever sits below it — the floor, and the fish at each depth plane.
//
// The pattern is ANALYTIC, not simulated: a handful of drifting sine waves are
// summed per cell and sharpened through a power LUT, which reads as the classic
// interference web once animated. The RippleField then drives it two ways
// (answering E7-8's open question — how to get caustics from ripple data cheaply):
//
//   • REFRACTION — the ripple height gradient (surface normal tilt) displaces
//     the point where each cell samples the analytic pattern, so passing waves
//     visibly bend and smear the web exactly where the water moves.
//   • GLINT — a wave crest is a converging lens; the negative Laplacian of the
//     height field adds brightness, so expanding rings carry a bright band.
//
// Everything is evaluated on a coarse grid (like RippleField) and upscaled in
// one drawImage, so cost is flat in fish count and canvas size.
//
// LIGHT MODEL (E7-11): one directional light, infinitely far away — pure planar
// offset math, no shading. Stacked planes are 1 "layer gap" apart, with the pond
// floor FLOOR_GAP below the deepest fish plane. A surface feature at point p
// projects to p + dir·offset·depth at depth `depth` (in gaps); a fish at layer i
// casts its shadow at +dir·offset·(i + FLOOR_GAP). Caustic blits and shadow
// offsets share this rule, so the whole stack reads as lit from one direction.

/** Nominal gaps between the deepest fish plane and the pond floor itself. */
export const FLOOR_GAP = 1;

/** Selectable caustic pattern generators (E7-8 polish). One is active at a time
 *  (CausticsField.pattern); each is a different way to synthesize the web, all
 *  sharing the ripple-refraction + crest-glint driving and the layer/shadow
 *  compositing. `extras` lists the pattern-specific slider keys the menu shows. */
export const CAUSTIC_PATTERNS = [
  { id: 'web',        name: 'Warped web',  extras: ['warp'] },
  { id: 'cells',      name: 'Voronoi cells', extras: [] },
  { id: 'turbulence', name: 'Turbulence',  extras: ['iterations'] },
];
const PATTERN_ID = { web: 0, cells: 1, turbulence: 2 };

/** Cheap deterministic hash of integer cell coords → [0,1) (for Voronoi jitter). */
function hash2(ix, iy) {
  let h = (ix | 0) * 374761393 + (iy | 0) * 668265263;
  h = (h ^ (h >> 13)) * 1274126177;
  return ((h ^ (h >> 16)) >>> 0) / 4294967296;
}

/**
 * First-run caustics settings (same contract as WATER_DEFAULTS): what a visitor
 * sees before touching a slider; the Caustics "Reset" button restores exactly this.
 */
export const CAUSTICS_DEFAULTS = Object.freeze({
  enabled: true,
  pattern: 'web',         // which caustic generator is active (CAUSTIC_PATTERNS)
  iterations: 4,          // turbulence pattern: domain-warp iteration count
  intensity: 0.38,        // floor web opacity
  fishIntensity: 0.5,     // opacity of the web stamped onto fish (× layer opacity)
  scale: 1.0,             // feature size multiplier (higher = broader web)
  speed: 1.0,             // idle shimmer speed
  refract: 8.0,           // ripple gradient → sample displacement, in pattern cells
  glint: 120,             // ripple crest (−laplacian) → added brightness
  sharpness: 7.0,         // web sharpening exponent (higher = thinner filaments)
  warp: 1.8,              // domain-warp strength (0 = old regular lattice; higher = more organic wander)
  maxDim: 150,            // coarse grid long edge in cells
  color: [150, 205, 235], // cool skylight
  shadows: true,
  shadowStrength: 0.55,   // opacity of the black silhouette cast on the floor
  lightAngleDeg: 55,      // azimuth projections shift toward as depth increases
  lightOffset: 1.2,       // world units of shift per layer gap (0 = noon, straight down)
});

// Fixed wave set: direction vectors double as per-wave spatial frequency; the
// time multipliers make the interference morph rather than translate. Chosen by
// eye for an organic, non-repeating shimmer.
const WAVES = [
  { ux: 1.00, uy: 0.31, w: 0.90 },
  { ux: -0.46, uy: 0.88, w: -0.71 },
  { ux: 0.63, uy: -0.75, w: 0.53 },
  { ux: 0.22, uy: 0.57, w: -1.13 },
];
const LUT_N = 1024;

export class CausticsField {
  /** @param {import('../grid.js').Grid} grid */
  constructor(grid) {
    this.grid = grid;

    const d = CAUSTICS_DEFAULTS;
    this.enabled        = d.enabled;
    this.pattern        = d.pattern;
    this.iterations     = d.iterations;
    this.intensity      = d.intensity;
    this.fishIntensity  = d.fishIntensity;
    this.scale          = d.scale;
    this.speed          = d.speed;
    this.refract        = d.refract;
    this.glint          = d.glint;
    this.sharpness      = d.sharpness;
    this.warp           = d.warp;
    this.maxDim         = d.maxDim;
    this.color          = [...d.color];
    this.shadows        = d.shadows;
    this.shadowStrength = d.shadowStrength;
    this.lightAngleDeg  = d.lightAngleDeg;
    this.lightOffset    = d.lightOffset;

    this._t = 0;
    this._cols = 0;
    this._rows = 0;

    // Coarse pattern canvas — alpha carries the web, RGB is the (pre-filled)
    // caustic colour; one smoothed drawImage upscales it per blit.
    this._off    = document.createElement('canvas');
    this._offCtx = this._off.getContext('2d');
    this._img    = null;
    this._colorKey = '';

    // Full-resolution scratch for per-layer fish stamps (E7-9): a layer's
    // entities draw here, the web is stamped 'source-atop' (fish pixels only),
    // and the result composites onto the pond canvas.
    this._scratch    = document.createElement('canvas');
    this._scratchCtx = this._scratch.getContext('2d');
    this._savedCtx   = null;

    // Sharpening LUT: index = (s+W)/(2W) over the wave-sum range, value = u^sharp.
    this._lut = new Uint8Array(LUT_N);
    this._lutSharp = -1;

    this.resize();
  }

  /** Recompute the coarse grid from the pond's current aspect ratio. */
  resize() {
    const aspect = this.grid.logicalW / this.grid.logicalH;
    let cols, rows;
    if (aspect >= 1) { cols = this.maxDim; rows = Math.max(4, Math.round(this.maxDim / aspect)); }
    else             { rows = this.maxDim; cols = Math.max(4, Math.round(this.maxDim * aspect)); }

    if (cols === this._cols && rows === this._rows) return;
    this._cols = cols;
    this._rows = rows;
    this._off.width  = cols;
    this._off.height = rows;
    this._img = this._offCtx.createImageData(cols, rows);
    this._colorKey = '';   // force an RGB refill on the next update
  }

  _syncLut() {
    if (this._lutSharp === this.sharpness) return;
    this._lutSharp = this.sharpness;
    // Filament web: brightness peaks where the wave sum crosses ZERO (the centre
    // of the LUT), which traces thin connected strands — the caustic look —
    // rather than round blobs at the interference peaks.
    for (let i = 0; i < LUT_N; i++) {
      const s = (i / (LUT_N - 1)) * 2 - 1;   // wave sum, normalized to [-1, 1]
      this._lut[i] = Math.round(255 * Math.pow(1 - Math.abs(s), this.sharpness));
    }
  }

  _syncColor() {
    const key = this.color.join(',');
    if (this._colorKey === key) return;
    this._colorKey = key;
    const data = this._img.data, [r, g, b] = this.color;
    for (let j = 0; j < data.length; j += 4) { data[j] = r; data[j + 1] = g; data[j + 2] = b; }
  }

  /**
   * Advance the shimmer and re-evaluate the pattern, warped by the live ripple
   * height field. Call once per frame after rippleField.update().
   * @param {number} deltaMs
   * @param {import('./ripple-field.js').RippleField} [ripple]
   */
  update(deltaMs, ripple) {
    if (!this.enabled) return;
    this.resize();
    this._syncLut();
    this._syncColor();
    this._t += deltaMs * 0.001 * this.speed;

    const cols = this._cols, rows = this._rows;
    const data = this._img.data;
    const lut = this._lut;
    const t = this._t;
    const refract = this.refract, glint = this.glint;
    const sharp = this.sharpness;
    const patId = PATTERN_ID[this.pattern] ?? 0;

    // ── web (domain-warped sines) constants ──
    const k = 0.45 / Math.max(0.05, this.scale);
    const p0 = WAVES[0].w * t, p1 = WAVES[1].w * t, p2 = WAVES[2].w * t, p3 = WAVES[3].w * t;
    const warpAmt = this.warp, WF = 0.34, tw0 = t * 0.23, tw1 = t * 0.17;
    const lutScale = (LUT_N - 1) / (2 * WAVES.length);
    // ── cells (animated Voronoi edges) constants ──
    const cdK = 0.10 / Math.max(0.05, this.scale);
    const tc = t * 0.6;
    // ── turbulence (Hoskins iterative domain-warp) constants ──
    const kt = 0.085 / Math.max(0.05, this.scale);
    const iters = Math.max(2, Math.min(8, this.iterations | 0));

    // Ripple field mapping (nearest cell; both grids span the same logical area).
    const h = ripple && ripple.enabled ? ripple._src : null;
    const rcols = h ? ripple._cols : 0, rrows = h ? ripple._rows : 0;
    const useR = !!(h && rcols > 2 && rrows > 2);
    const fx = useR ? (rcols - 1) / (cols - 1) : 0;
    const fy = useR ? (rrows - 1) / (rows - 1) : 0;

    let j = 3;   // alpha channel; RGB pre-filled by _syncColor
    for (let y = 0; y < rows; y++) {
      let rowBase = 0;
      if (useR) {
        let ry = (y * fy) | 0;
        if (ry < 1) ry = 1; else if (ry > rrows - 2) ry = rrows - 2;
        rowBase = ry * rcols;
      }
      for (let x = 0; x < cols; x++, j += 4) {
        let px = x, py = y, focus = 0;
        if (useR) {
          let rx = (x * fx) | 0;
          if (rx < 1) rx = 1; else if (rx > rcols - 2) rx = rcols - 2;
          const i = rowBase + rx;
          const gx = h[i + 1] - h[i - 1], gy = h[i + rcols] - h[i - rcols];
          px += gx * refract;
          py += gy * refract;
          const lap = h[i + 1] + h[i - 1] + h[i + rcols] + h[i - rcols] - 4 * h[i];
          if (lap < 0) focus = -lap * glint;
        }

        let a;
        if (patId === 1) {
          // ── VORONOI CELLS: bright thin filaments along Voronoi edges, points
          //    orbiting so the web crawls. Distance to the two nearest = the edge. ──
          const gxp = px * cdK, gyp = py * cdK;
          const cx0 = Math.floor(gxp), cy0 = Math.floor(gyp);
          const fxp = gxp - cx0, fyp = gyp - cy0;
          let f1 = 9, f2 = 9;
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              const hh = hash2(cx0 + dx, cy0 + dy);
              const ang = hh * 6.2831853 + tc;
              const jx = dx + 0.5 + 0.36 * Math.cos(ang) - fxp;
              const jy = dy + 0.5 + 0.36 * Math.sin(ang * 1.23) - fyp;
              const d = jx * jx + jy * jy;
              if (d < f1) { f2 = f1; f1 = d; } else if (d < f2) { f2 = d; }
            }
          }
          const edge = Math.sqrt(f2) - Math.sqrt(f1);
          let e = 1 - edge * 2.2;
          a = (e > 0 ? 255 * Math.pow(e, sharp) : 0) + focus;
        } else if (patId === 2) {
          // ── TURBULENCE (Dave Hoskins iterative caustic, Shadertoy MdlXz8): each
          //    step warps the coordinate by trig of the previous one, accumulating
          //    an inverse-distance field that reads as rich, non-tiling caustics.
          //    Faithful port — the large −250 offset breaks origin symmetry and the
          //    1.17−pow / pow(·,8) curve is what carves the bright thin filaments. ──
          const bx = px * kt - 250, by = py * kt - 250;
          let ix = bx, iy = by, c = 0;
          const inten = 0.005;
          for (let n = 0; n < iters; n++) {
            const tt = t * (1 - 3.5 / (n + 1));
            const nix = bx + Math.cos(tt - ix) + Math.sin(tt + iy);
            const niy = by + Math.sin(tt - iy) + Math.cos(tt + ix);
            ix = nix; iy = niy;
            const dx = bx / (Math.sin(ix + tt) / inten);
            const dy = by / (Math.cos(iy + tt) / inten);
            c += 1 / Math.sqrt(dx * dx + dy * dy + 1e-9);
          }
          c /= iters;
          c = 1.17 - Math.pow(c, 1.4);
          // Invert: the recursion's broad plateaus become the dark floor and the
          // narrow transition bands become bright light-pools — caustics on black,
          // not marble on blue. The band width tracks `sharpness` (higher = thinner).
          let col = 1 - Math.pow(Math.abs(c), 0.5 + sharp * 0.28);
          if (col < 0) col = 0;
          a = 255 * col + focus;
        } else {
          // ── WEB (default): domain-warped summed sines + zero-crossing LUT. ──
          let u = px * k, v = py * k;
          const qx = Math.sin(v * WF + tw0) + 0.7 * Math.sin(u * (WF * 1.3) - tw1);
          const qy = Math.sin(u * WF - tw1) + 0.7 * Math.sin(v * (WF * 1.3) + tw0);
          u += qx * warpAmt; v += qy * warpAmt;
          const s = Math.sin(u * WAVES[0].ux + v * WAVES[0].uy + p0)
                  + Math.sin(u * WAVES[1].ux + v * WAVES[1].uy + p1)
                  + Math.sin(u * WAVES[2].ux + v * WAVES[2].uy + p2)
                  + Math.sin(u * WAVES[3].ux + v * WAVES[3].uy + p3);
          a = lut[((s + WAVES.length) * lutScale) | 0] + focus;
        }
        data[j] = a > 255 ? 255 : a;
      }
    }
    this._offCtx.putImageData(this._img, 0, 0);
  }

  /** Unit vector pointing where projections shift as depth increases. */
  lightDir() {
    const a = this.lightAngleDeg * Math.PI / 180;
    return { x: Math.cos(a), y: Math.sin(a) };
  }

  /** Deepest plane's depth below the surface, in layer gaps. */
  _floorDepth(layerCount) { return (layerCount - 1) + FLOOR_GAP; }

  // Blit overscan: every layer's blit stretches the pattern over the canvas plus
  // this pad, so any per-layer shift stays fully covered. Shared across planes so
  // relative offsets are exact.
  _pad(layerCount) {
    return Math.abs(this.lightOffset) * this._floorDepth(layerCount) * this.grid.scale + 2;
  }

  /** Blit the pattern (shifted, padded, scaled) onto ctx for a plane at `depth` gaps. */
  _blit(ctx, alpha, depth, layerCount) {
    const { canvas, scale } = this.grid;
    const pad = this._pad(layerCount);
    const dir = this.lightDir();
    const s = this.lightOffset * depth * scale;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this._off, dir.x * s - pad, dir.y * s - pad,
                  canvas.width + 2 * pad, canvas.height + 2 * pad);
    ctx.restore();
  }

  /** Draw the caustic web on the pond floor (E7-8). Call before any entity draws. */
  drawFloor(layerCount) {
    if (this.intensity <= 0) return;
    this._blit(this.grid.ctx, this.intensity, this._floorDepth(layerCount), layerCount);
  }

  /**
   * Begin a fish-layer stamp pass (E7-9): reroutes grid drawing into the scratch
   * canvas, cleared over `rect` only. All the pass's canvas work (clear, stamp,
   * composite) stays inside that rect, so cost tracks the entities' bounding box,
   * not the canvas. Must be paired with endFishLayer()/endShadowPass().
   * @param {{x:number,y:number,w:number,h:number}} [rect]  physical px; default full canvas
   */
  beginFishLayer(rect) {
    const { canvas } = this.grid;
    this._rect = rect ?? { x: 0, y: 0, w: canvas.width, h: canvas.height };
    if (this._scratch.width !== canvas.width || this._scratch.height !== canvas.height) {
      this._scratch.width = canvas.width;    // sizing implicitly clears everything
      this._scratch.height = canvas.height;
    } else {
      const r = this._rect;
      this._scratchCtx.clearRect(r.x, r.y, r.w, r.h);
    }
    this._savedCtx = this.grid.ctx;
    this.grid.ctx = this._scratchCtx;
  }

  /**
   * End a shadow pass (E7-10): composites the scratch — carrying every creature's
   * silhouette in OPAQUE black — onto the pond canvas at one uniform alpha.
   * Opaque-then-fade keeps overlapping cell rects (fractional cell scales) and
   * overlapping fish from double-darkening into moiré. Pair with beginFishLayer().
   * @param {number} strength  shadow opacity 0..1
   */
  endShadowPass(strength) {
    this.grid.ctx = this._savedCtx;
    this._savedCtx = null;
    const ctx = this.grid.ctx, r = this._rect;
    ctx.save();
    ctx.globalAlpha = strength;
    ctx.drawImage(this._scratch, r.x, r.y, r.w, r.h, r.x, r.y, r.w, r.h);
    ctx.restore();
  }

  /**
   * End a fish-layer stamp pass: stamps the web over the layer's pixels only
   * ('source-atop', clipped to the pass rect), then composites the rect onto
   * the pond canvas.
   * @param {number} layerIdx    which depth plane was drawn (0 = deepest)
   * @param {number} layerCount  total planes
   * @param {number} [opacity]   the layer record's caustics.opacity
   */
  endFishLayer(layerIdx, layerCount, opacity = 1) {
    this.grid.ctx = this._savedCtx;
    this._savedCtx = null;
    const r = this._rect;
    const alpha = this.fishIntensity * opacity;
    if (alpha > 0) {
      const scr = this._scratchCtx;
      scr.save();
      scr.beginPath();
      scr.rect(r.x, r.y, r.w, r.h);
      scr.clip();
      scr.globalCompositeOperation = 'source-atop';
      this._blit(scr, alpha, layerCount - 1 - layerIdx, layerCount);
      scr.restore();
    }
    this.grid.ctx.drawImage(this._scratch, r.x, r.y, r.w, r.h, r.x, r.y, r.w, r.h);
  }
}
