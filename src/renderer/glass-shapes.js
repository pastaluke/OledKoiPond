// src/renderer/glass-shapes.js
// Freeform glass shapes that sit on top of the simulation render layer — draggable,
// resizable "glass toys" that run the same chromatic edge shader as the pond border.
// This class owns the shape DATA and INTERACTION math; it writes shape uniforms to
// the Compositor and knows nothing about the DOM or raw WebGL. The menu drives it;
// main.js routes pointer drags into it; the debug overlay draws grab-handle rings.
//
// Coordinate model (resolution-independent so a shape keeps its place/size on resize):
//   cx, cy    — center in UV space (0..1)
//   radius    — in height-fraction units (aspect-corrected in the shader → round)
//   bandFrac  — rim band thickness as a fraction of radius (the distorted ring)
//   strength  — chromatic displacement at the rim, in pixels

import { MAX_SHAPES } from './compositor.js';

export { MAX_SHAPES };

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const num = (v, lo, hi, fallback) => (Number.isFinite(v) ? clamp(v, lo, hi) : fallback);

/** A fresh default circle, centered, with a moderate rim and distortion. */
export function defaultShape() {
  return { type: 'circle', cx: 0.5, cy: 0.5, radius: 0.15, bandFrac: 0.5, strength: 8 };
}

export class GlassShapes {
  /** @param {import('./compositor.js').Compositor} compositor */
  constructor(compositor) {
    this._comp = compositor;
    /** @type {ReturnType<typeof defaultShape>[]} */
    this.list = [];
    this.selected = -1;
    /** Set by the menu: called on structural/selection changes to refresh UI. */
    this.onChange = null;
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
   * region matches the round on-screen shape.
   */
  hitTest(u, v) {
    const aspect = this._comp.aspect;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const s = this.list[i];
      const dx = (s.cx - u) * aspect;
      const dy = s.cy - v;
      if (Math.hypot(dx, dy) <= s.radius) return i;
    }
    return -1;
  }

  /** Map shapes to shader form (band = bandFrac×radius) and upload to the compositor. */
  sync() {
    this._comp.setShapes(this.list.map((s) => ({
      cx: s.cx, cy: s.cy, radius: s.radius,
      band: Math.max(1e-4, s.bandFrac * s.radius),
      strength: s.strength,
    })));
  }

  /** Plain-object snapshot for persistence. */
  serialize() { return this.list.map((s) => ({ ...s })); }

  /** Replace the shape list from persisted data (clamped), then upload + notify. */
  restore(arr) {
    if (!Array.isArray(arr)) return;
    this.list = arr.slice(0, MAX_SHAPES).map((s) => ({
      type: 'circle',
      cx: num(s.cx, 0, 1, 0.5),
      cy: num(s.cy, 0, 1, 0.5),
      radius: num(s.radius, 0.02, 0.6, 0.15),
      bandFrac: num(s.bandFrac, 0.02, 1, 0.5),
      strength: num(s.strength, 0, 40, 8),
    }));
    this.selected = this.list.length ? 0 : -1;
    this.sync();
    this._notify();
  }

  /** Ask the menu to persist current state (used at drag end). */
  requestSave() { this.onPersist?.(); }

  _notify() { this.onChange?.(); }
}
