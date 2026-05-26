/**
 * @file koi.js
 * Koi fish entity: sprite sheet, animation, wandering AI, and rendering.
 */

import { SpriteAnimator } from '../sprite.js';

// ---------------------------------------------------------------------------
// Sprite sheet
// ---------------------------------------------------------------------------

/**
 * Body (columns 0–12) is identical across all frames.
 * Columns 13–17 show the tail fin wagging.
 *
 * Frame 0 – tail swept up/left
 * Frame 1 – tail neutral
 * Frame 2 – tail swept down/right  (mirror of frame 0)
 * Frame 3 – tail neutral  (same as frame 1, gives pause at centre)
 *
 * loopMode 'pingpong' produces:  0 → 1 → 2 → 1 → 0 → …
 *
 * @type {import('../sprite.js').SpriteSheet}
 */
export const KOI_SPRITE_SHEET = {
  frameRate: 6,
  loopMode: 'pingpong',
  frames: [
    // ── Frame 0 : tail swept toward top ──────────────────────────────────
    // col:  0  1  2  3  4  5  6  7  8  9 10 11 12 13 14 15 16 17
    [
      [0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0],  // row 0
      [0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0],  // row 1
      [0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0],  // row 2
      [1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0],  // row 3
      [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0],  // row 4
      [0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0],  // row 5
      [0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0],  // row 6
      [0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0],  // row 7
    ],
    // ── Frame 1 : tail centred ────────────────────────────────────────────
    [
      [0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0],
      [0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0],
      [1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0],
      [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0],
      [0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0],
      [0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0],
      [0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0],
    ],
    // ── Frame 2 : tail swept toward bottom ───────────────────────────────
    [
      [0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0],
      [0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0],
      [1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1],
      [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1],
      [0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0],
      [0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0],
      [0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0],
    ],
    // ── Frame 3 : tail centred again (dwell at centre for natural rhythm) ─
    [
      [0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0],
      [0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0],
      [1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0],
      [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0],
      [0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0],
      [0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0],
      [0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0],
    ],
  ],
};

// ---------------------------------------------------------------------------
// Koi class
// ---------------------------------------------------------------------------

/** Maximum speed in logical pixels per millisecond. */
const MAX_SPEED = 0.4;

/** Minimum ms between voluntary direction changes. */
const MIN_WANDER_INTERVAL = 3000;

/** Maximum ms between voluntary direction changes. */
const MAX_WANDER_INTERVAL = 8000;

/** How far from the edge (logical px) before edge-avoidance kicks in. */
const EDGE_MARGIN = 5;

/** Lerp rate toward target velocity (fraction per ms). */
const LERP_RATE = 0.001;

/** Magnitude of the edge-avoidance nudge applied each frame (px/ms per ms). */
const TURN_FORCE = 0.002;

/**
 * A single koi fish with wandering AI and sprite animation.
 */
export class Koi {
  /**
   * @param {import('../grid.js').Grid} grid
   * @param {{ x?: number, y?: number, vx?: number, vy?: number, color?: {r:number,g:number,b:number} }} [options]
   */
  constructor(grid, options = {}) {
    const { logicalW, logicalH } = grid;

    this.x  = options.x  ?? Math.random() * logicalW;
    this.y  = options.y  ?? Math.random() * logicalH;
    this.vx = options.vx ?? _randVelocity();
    this.vy = options.vy ?? _randVelocity();

    /** Colour used when drawing lit pixels. */
    this.color = options.color ?? { r: 255, g: 255, b: 255 };

    /** @type {SpriteAnimator} */
    this.animator = new SpriteAnimator(KOI_SPRITE_SHEET);

    // Wandering state
    /** Target velocity the fish lazily steers toward. */
    this._targetVx = this.vx;
    this._targetVy = this.vy;

    /** ms remaining until next voluntary direction change. */
    this._wanderCooldown = _randWanderInterval();
  }

  /**
   * Advances physics and animation by deltaMs milliseconds.
   * @param {number} deltaMs
   * @param {import('../grid.js').Grid} grid
   */
  update(deltaMs, grid) {
    this.animator.update(deltaMs);

    // ── Voluntary wandering ─────────────────────────────────────────────
    this._wanderCooldown -= deltaMs;
    if (this._wanderCooldown <= 0) {
      this._targetVx = _randVelocity();
      this._targetVy = _randVelocity();
      this._wanderCooldown = _randWanderInterval();
    }

    // Lerp toward target velocity
    this.vx += (this._targetVx - this.vx) * LERP_RATE * deltaMs;
    this.vy += (this._targetVy - this.vy) * LERP_RATE * deltaMs;

    // ── Edge avoidance ──────────────────────────────────────────────────
    const { logicalW, logicalH } = grid;
    const { w, h } = this.animator.getBoundingBox();

    if (this.x < EDGE_MARGIN)              this.vx += TURN_FORCE * deltaMs;
    if (this.x + w > logicalW - EDGE_MARGIN) this.vx -= TURN_FORCE * deltaMs;
    if (this.y < EDGE_MARGIN)              this.vy += TURN_FORCE * deltaMs;
    if (this.y + h > logicalH - EDGE_MARGIN) this.vy -= TURN_FORCE * deltaMs;

    // ── Speed cap ───────────────────────────────────────────────────────
    const speed = Math.sqrt(this.vx * this.vx + this.vy * this.vy);
    if (speed > MAX_SPEED) {
      const inv = MAX_SPEED / speed;
      this.vx *= inv;
      this.vy *= inv;
    }

    // ── Move ────────────────────────────────────────────────────────────
    this.x += this.vx * deltaMs;
    this.y += this.vy * deltaMs;
  }

  /**
   * Draws the current animation frame onto the grid.
   * @param {import('../grid.js').Grid} grid
   */
  draw(grid) {
    const { r, g, b } = this.color;
    const pixels = this.animator.getHitPixels();
    const ox = Math.floor(this.x);
    const oy = Math.floor(this.y);

    for (const { x: lx, y: ly } of pixels) {
      grid.drawPixel(ox + lx, oy + ly, r, g, b);
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Returns a random velocity in [-MAX_SPEED, MAX_SPEED], biased toward slow values. */
function _randVelocity() {
  return (Math.random() * 2 - 1) * MAX_SPEED;
}

/** Returns a random wander interval between MIN and MAX. */
function _randWanderInterval() {
  return MIN_WANDER_INTERVAL + Math.random() * (MAX_WANDER_INTERVAL - MIN_WANDER_INTERVAL);
}
