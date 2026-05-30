// src/movement/vec2.js
// Minimal mutable 2D vector for the steering-behavior system.
// Methods mutate in place and return `this` for chaining.

export class Vec2 {
  constructor(x = 0, y = 0) { this.x = x; this.y = y; }

  add(v)        { this.x += v.x; this.y += v.y; return this; }
  addScaled(v, s) { this.x += v.x * s; this.y += v.y * s; return this; }
  sub(v)        { this.x -= v.x; this.y -= v.y; return this; }
  scale(s)      { this.x *= s; this.y *= s; return this; }

  mag() { return Math.hypot(this.x, this.y); }

  // Scale to an exact magnitude (Reynolds' "normalize then * speed"). No-op on zero.
  setMag(m) {
    const l = this.mag();
    if (l > 0) { this.x = this.x / l * m; this.y = this.y / l * m; }
    return this;
  }

  // Clamp magnitude to `max` (Reynolds' "truncate").
  limit(max) {
    const l = this.mag();
    if (l > max && l > 0) { this.x = this.x / l * max; this.y = this.y / l * max; }
    return this;
  }

  clone() { return new Vec2(this.x, this.y); }
}
