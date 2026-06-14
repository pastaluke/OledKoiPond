// src/renderer/glass-shapes.js
// Freeform glass shapes that sit on top of the simulation render layer — draggable,
// resizable "glass toys" running a physically-based displacement shader inspired by
// liquidGL (MIT © NaughtyDuk). Owns shape DATA and INTERACTION math; writes shape
// uniforms to the Compositor; knows nothing about the DOM or raw WebGL.
//
// Coordinate model (resolution-independent):
//   cx, cy      — center in UV space (0..1)
//   radius      — height-fraction units (aspect-corrected in shader → round circles)
//   bevelWidth  — rim-band thickness as fraction of radius
//   refraction  — smooth displacement amplitude (UV units, ~0–0.05)
//   bevelDepth  — pow(edge,10) sharp-rim factor (UV units, ~0–0.10)
//   chromatic   — R/G/B channel-split in pixels (our addition; 0 = off)
//   frost       — Poisson blur radius in pixels (0 = off)
//   magnify     — lens zoom factor (1 = passthrough)
//   specular    — animated light-glint highlight (bool)

import { MAX_SHAPES } from './compositor.js';

export { MAX_SHAPES };

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const num   = (v, lo, hi, fallback) => (Number.isFinite(v) ? clamp(v, lo, hi) : fallback);

/** A fresh default shape with the new field set. */
export function defaultShape() {
  return {
    type:       'circle',
    cx:          0.5,
    cy:          0.5,
    radius:      0.15,
    bevelWidth:  0.35,
    refraction:  0.008,
    bevelDepth:  0.03,
    chromatic:   6,
    frost:       0,
    magnify:     1.0,
    specular:    false,
  };
}

/** Clamp-and-default a raw (possibly persisted) shape object to valid ranges. */
function _sanitize(s) {
  return {
    type:       'circle',
    cx:          num(s.cx,         0,    1,    0.5),
    cy:          num(s.cy,         0,    1,    0.5),
    radius:      num(s.radius,     0.02, 0.60, 0.15),
    bevelWidth:  num(s.bevelWidth  ?? s.bandFrac, 0.05, 1.0, 0.35),  // migrate old key
    refraction:  num(s.refraction, 0,    0.05, 0.008),
    bevelDepth:  num(s.bevelDepth, 0,    0.10, 0.03),
    chromatic:   num(s.chromatic   ?? s.strength, 0, 20, 6),          // migrate old key
    frost:       num(s.frost,      0,    8,    0),
    magnify:     num(s.magnify,    0.5,  3.0,  1.0),
    specular:    typeof s.specular === 'boolean' ? s.specular : false,
  };
}

export class GlassShapes {
  /** @param {import('./compositor.js').Compositor} compositor */
  constructor(compositor) {
    this._comp = compositor;
    /** @type {ReturnType<typeof defaultShape>[]} */
    this.list     = [];
    this.selected = -1;
    /** Set by the menu: called on structural/selection changes to refresh UI. */
    this.onChange  = null;
    /** Set by the menu: called when a change should be persisted (e.g. drag end). */
    this.onPersist = null;
  }

  get current() { return this.list[this.selected] ?? null; }

  /** Append a shape (up to MAX_SHAPES), select it, upload, notify. Returns it or null. */
  add(shape = defaultShape()) {
    if (this.list.length >= MAX_SHAPES) return null;
    this.list.push(shape);
    this.selected = this.list.length - 1;
    this.sync();
    this._notify();
    return shape;
  }

  /** Remove shape i, fix selection, upload, notify. */
  remove(i) {
    if (i < 0 || i >= this.list.length) return;
    this.list.splice(i, 1);
    this.selected = this.list.length ? clamp(this.selected, 0, this.list.length - 1) : -1;
    this.sync();
    this._notify();
  }

  /** Select shape i and notify (no uniform change needed). */
  select(i) {
    if (i < -1 || i >= this.list.length) return;
    this.selected = i;
    this._notify();
  }

  /**
   * Topmost shape index under a UV point, or -1. Aspect-corrected so the hit
   * region matches the round on-screen circle.
   */
  hitTest(u, v) {
    const aspect = this._comp.aspect;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const s  = this.list[i];
      const dx = (s.cx - u) * aspect;
      const dy = s.cy - v;
      if (Math.hypot(dx, dy) <= s.radius) return i;
    }
    return -1;
  }

  /** Upload all active shapes to the compositor. */
  sync() {
    this._comp.setShapes(this.list.map((s) => ({
      cx:         s.cx,
      cy:         s.cy,
      radius:     s.radius,
      bevelWidth: s.bevelWidth,
      refraction: s.refraction,
      bevelDepth: s.bevelDepth,
      chromatic:  s.chromatic,
      frost:      s.frost,
      magnify:    s.magnify,
      specular:   s.specular,
    })));
  }

  /** Plain-object snapshot for persistence. */
  serialize() { return this.list.map((s) => ({ ...s })); }

  /**
   * Replace the shape list from persisted data (sanitized + clamped).
   * Handles old-format keys (bandFrac → bevelWidth, strength → chromatic).
   */
  restore(arr) {
    if (!Array.isArray(arr)) return;
    this.list     = arr.slice(0, MAX_SHAPES).map(_sanitize);
    this.selected = this.list.length ? 0 : -1;
    this.sync();
    this._notify();
  }

  /** Ask the menu to persist current state (used at drag end). */
  requestSave() { this.onPersist?.(); }

  _notify() { this.onChange?.(); }
}
