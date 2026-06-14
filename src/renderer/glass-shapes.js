// src/renderer/glass-shapes.js
// Freeform glass shapes that sit on top of the simulation render layer — draggable,
// resizable "glass toys" running a physically-based displacement shader inspired by
// liquidGL (MIT © NaughtyDuk). Owns shape DATA and INTERACTION math; writes shape
// uniforms to the Compositor; knows nothing about the DOM or raw WebGL.

import { MAX_SHAPES } from './compositor.js';

export { MAX_SHAPES };

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const num   = (v, lo, hi, fallback) => (Number.isFinite(v) ? clamp(v, lo, hi) : fallback);

export function defaultShape() {
  return {
    type:        'circle',
    cx:           0.5,
    cy:           0.5,
    radius:       0.15,
    bevelWidth:   0.35,
    refraction:   0.008,
    bevelDepth:   0.03,
    chromatic:    6,
    frost:        0,
    magnify:      1.0,
    specular:     false,
    wander:       false,
    wanderSpeed:  0.02,
  };
}

function _sanitize(s) {
  return {
    type:        'circle',
    cx:           num(s.cx,          0,    1,    0.5),
    cy:           num(s.cy,          0,    1,    0.5),
    radius:       num(s.radius,      0.02, 0.60, 0.15),
    bevelWidth:   num(s.bevelWidth   ?? s.bandFrac,  0.05, 1.0,  0.35),
    refraction:   num(s.refraction,  0,    0.05, 0.008),
    bevelDepth:   num(s.bevelDepth,  0,    0.10, 0.03),
    chromatic:    num(s.chromatic    ?? s.strength,  0,    20,   6),
    frost:        num(s.frost,       0,    8,    0),
    magnify:      num(s.magnify,     0.5,  3.0,  1.0),
    specular:     typeof s.specular     === 'boolean' ? s.specular     : false,
    wander:       typeof s.wander       === 'boolean' ? s.wander       : false,
    wanderSpeed:  num(s.wanderSpeed, 0.005, 0.05, 0.02),
  };
}

export class GlassShapes {
  /** @param {import('./compositor.js').Compositor} compositor */
  constructor(compositor) {
    this._comp       = compositor;
    this.list        = [];
    this.selected    = -1;
    this.lastActivity = performance.now();
    this.onChange    = null;
    this.onPersist   = null;
  }

  get current() { return this.list[this.selected] ?? null; }

  touchActivity() { this.lastActivity = performance.now(); }

  add(shape = defaultShape()) {
    if (this.list.length >= MAX_SHAPES) return null;
    this.list.push(shape);
    this.selected = this.list.length - 1;
    this.touchActivity();
    this.sync();
    this._notify();
    return shape;
  }

  remove(i) {
    if (i < 0 || i >= this.list.length) return;
    this.list.splice(i, 1);
    this.selected = this.list.length ? clamp(this.selected, 0, this.list.length - 1) : -1;
    this.touchActivity();
    this.sync();
    this._notify();
  }

  select(i) {
    if (i < -1 || i >= this.list.length) return;
    this.selected = i;
    this.touchActivity();
    this._notify();
  }

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

  /**
   * Advance wander physics for all shapes that have wander enabled.
   * @param {number} deltaMs
   * @param {number} aspect - canvas width/height ratio (for x-wall correction)
   */
  update(deltaMs, aspect) {
    const dt = deltaMs / 1000;
    let changed = false;
    for (const s of this.list) {
      if (!s.wander) continue;
      // Initialise ephemeral velocity on first wander update.
      if (s._vx == null) {
        const angle = Math.random() * Math.PI * 2;
        s._vx    = Math.cos(angle) * s.wanderSpeed;
        s._vy    = Math.sin(angle) * s.wanderSpeed;
        s._vOmega = 0;
      }
      // Angular drift — smooth random walk clamped to ±0.5 rad/s.
      const maxOmega = 0.5;
      s._vOmega += (Math.random() * 2 - 1) * 0.08 * maxOmega;
      s._vOmega  = clamp(s._vOmega, -maxOmega, maxOmega);
      // Rotate velocity vector by _vOmega * dt.
      const c = Math.cos(s._vOmega * dt);
      const sn = Math.sin(s._vOmega * dt);
      const vx2 = s._vx * c - s._vy * sn;
      const vy2 = s._vx * sn + s._vy * c;
      s._vx = vx2;
      s._vy = vy2;
      // Normalise to wanderSpeed so speed is constant.
      const spd = Math.hypot(s._vx, s._vy);
      if (spd > 1e-9) { s._vx = (s._vx / spd) * s.wanderSpeed; s._vy = (s._vy / spd) * s.wanderSpeed; }
      // Integrate position.
      s.cx += s._vx * dt;
      s.cy += s._vy * dt;
      // Wall bounce (radius is height-fraction; x walls need aspect correction).
      const xMin = s.radius / aspect, xMax = 1 - s.radius / aspect;
      const yMin = s.radius,          yMax = 1 - s.radius;
      if (s.cx < xMin) { s.cx = xMin; s._vx =  Math.abs(s._vx); s._vOmega = (Math.random() - 0.5) * 0.2; }
      if (s.cx > xMax) { s.cx = xMax; s._vx = -Math.abs(s._vx); s._vOmega = (Math.random() - 0.5) * 0.2; }
      if (s.cy < yMin) { s.cy = yMin; s._vy =  Math.abs(s._vy); s._vOmega = (Math.random() - 0.5) * 0.2; }
      if (s.cy > yMax) { s.cy = yMax; s._vy = -Math.abs(s._vy); s._vOmega = (Math.random() - 0.5) * 0.2; }
      changed = true;
    }
    if (changed) this.sync();
  }

  /** Plain-object snapshot for persistence (excludes ephemeral wander velocity). */
  serialize() {
    return this.list.map(s => {
      const { _vx, _vy, _vOmega, ...data } = s;
      return data;
    });
  }

  restore(arr) {
    if (!Array.isArray(arr)) return;
    this.list     = arr.slice(0, MAX_SHAPES).map(_sanitize);
    this.selected = this.list.length ? 0 : -1;
    this.sync();
    this._notify();
  }

  requestSave() { this.onPersist?.(); }

  _notify() { this.onChange?.(); }
}
