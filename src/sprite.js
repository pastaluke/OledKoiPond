/**
 * @file sprite.js
 * Handles frame-by-frame animation for 0/1 sprite sheets.
 */

/**
 * @typedef {'loop'|'pingpong'|'once'} LoopMode
 *
 * @typedef {Object} SpriteSheet
 * @property {number[][][]} frames  - Array of 2-D frames; each frame is rows of 0/1 values.
 * @property {number}       frameRate - Frames per second.
 * @property {LoopMode}     loopMode
 */

export class SpriteAnimator {
  /**
   * @param {SpriteSheet} spriteSheet
   */
  constructor(spriteSheet) {
    this.frames    = spriteSheet.frames;
    this.frameRate = spriteSheet.frameRate;
    this.loopMode  = spriteSheet.loopMode;

    /** Index of the frame currently displayed. */
    this.currentFrameIndex = 0;

    /** Accumulated time since last frame advance (ms). */
    this._elapsed = 0;

    /** Direction of travel for pingpong mode: +1 or -1. */
    this._direction = 1;
  }

  /**
   * Advances the animation clock by deltaMs milliseconds.
   * Updates currentFrameIndex according to the loopMode.
   * @param {number} deltaMs
   */
  update(deltaMs) {
    const frameDuration = 1000 / this.frameRate;
    this._elapsed += deltaMs;

    while (this._elapsed >= frameDuration) {
      this._elapsed -= frameDuration;
      this._advance();
    }
  }

  /** Steps the frame index forward by one tick, respecting loopMode. */
  _advance() {
    const last = this.frames.length - 1;

    switch (this.loopMode) {
      case 'loop':
        this.currentFrameIndex = (this.currentFrameIndex + 1) % this.frames.length;
        break;

      case 'pingpong':
        this.currentFrameIndex += this._direction;
        if (this.currentFrameIndex >= last) {
          this.currentFrameIndex = last;
          this._direction = -1;
        } else if (this.currentFrameIndex <= 0) {
          this.currentFrameIndex = 0;
          this._direction = 1;
        }
        break;

      case 'once':
        if (this.currentFrameIndex < last) {
          this.currentFrameIndex += 1;
        }
        break;
    }
  }

  /**
   * The 2-D pixel array for the currently displayed frame.
   * @returns {number[][]}
   */
  get currentFrame() {
    return this.frames[this.currentFrameIndex];
  }

  /**
   * Returns the width and height of the current frame.
   * @returns {{ w: number, h: number }}
   */
  getBoundingBox() {
    const frame = this.currentFrame;
    const h = frame.length;
    const w = h > 0 ? frame[0].length : 0;
    return { w, h };
  }

  /**
   * Returns all pixel coordinates within the current frame that are lit (value === 1).
   * @returns {{ x: number, y: number }[]}
   */
  getHitPixels() {
    const frame = this.currentFrame;
    const pixels = [];
    for (let y = 0; y < frame.length; y++) {
      const row = frame[y];
      for (let x = 0; x < row.length; x++) {
        if (row[x] === 1) {
          pixels.push({ x, y });
        }
      }
    }
    return pixels;
  }
}
