// src/fluid/rain.js
// Ambient rain: random droplets that patter across the pond, each stamping a
// small disturbance into the RippleField so concentric rings spread from where
// it "landed". Rain owns only the *when/where/how-hard* of drops; the ripple
// physics live entirely in RippleField.
//
// Drops arrive as a Poisson process at `frequency` drops/second, so the patter
// stays sparse and irregular at low rates instead of ticking like a metronome.
// Each drop's amplitude is drawn from a normal distribution centred on
// `strength` with spread `stddev` — real raindrops vary in size, and a bit of
// amplitude scatter reads far more like rain than uniform taps.

/**
 * First-run rain settings. Off by default so the pond stays calm until a visitor
 * opts in; their own changes persist over the top via localStorage. The Rain
 * "Reset" button restores exactly this set.
 *
 * The default `stddev` (0.5 on a mean of 1.2 → coefficient of variation ≈ 0.4)
 * is a realistic amplitude spread for the gentle, low-frequency drizzle the other
 * defaults describe — light rain has noticeably varied drop sizes.
 */
export const RAIN_DEFAULTS = Object.freeze({
  enabled: false,
  frequency: 2.0,   // mean droplets per second
  strength: 1.2,    // mean droplet amplitude injected into the ripple field
  stddev: 0.5,      // std deviation of droplet amplitude (Gaussian spread)
});

export class Rain {
  constructor() {
    const d = RAIN_DEFAULTS;
    this.enabled   = d.enabled;
    this.frequency = d.frequency; // drops/second (mean of the Poisson process)
    this.strength  = d.strength;  // mean amplitude per drop
    this.stddev    = d.stddev;    // amplitude std-dev; 0 = every drop identical
    this._spare    = null;        // cached second Box–Muller sample
  }

  /**
   * One standard-normal sample (mean 0, variance 1) via Box–Muller. The method
   * yields two independent samples per pair of uniforms; we cache the spare so
   * every other call is free.
   */
  _gaussian() {
    if (this._spare !== null) { const s = this._spare; this._spare = null; return s; }
    let u = 0, v = 0;
    while (u === 0) u = Math.random();   // avoid log(0)
    while (v === 0) v = Math.random();
    const mag = Math.sqrt(-2 * Math.log(u));
    this._spare = mag * Math.sin(2 * Math.PI * v);
    return mag * Math.cos(2 * Math.PI * v);
  }

  /**
   * Advance the rain by one frame, injecting any drops that fell into the field.
   * @param {number} dtMs   frame delta in milliseconds
   * @param {import('./ripple-field.js').RippleField} rippleField
   * @param {import('../grid.js').Grid} grid
   */
  update(dtMs, rippleField, grid) {
    if (!this.enabled || this.frequency <= 0 || !rippleField) return;
    const dtS = dtMs / 1000;

    // Expected drops this frame = rate × elapsed time. Spawn the whole part
    // outright and the fractional part with matching probability, so the average
    // rate is frame-rate independent and a low frequency still yields the odd,
    // randomly-placed drop. Cap the whole part so a long tab-stall can't unleash
    // a burst on the next frame.
    const expected  = this.frequency * dtS;
    const whole     = Math.min(Math.floor(expected), 20);
    const frac      = expected - Math.floor(expected);
    const count     = whole + (Math.random() < frac ? 1 : 0);

    for (let i = 0; i < count; i++) {
      const lx = Math.random() * grid.logicalW;
      const ly = Math.random() * grid.logicalH;
      // Normal-distributed amplitude, floored to a small positive value so a
      // wide stddev never produces a dead or sign-flipped drop.
      const amp = Math.max(0.05, this.strength + this._gaussian() * this.stddev);
      rippleField.inject(lx, ly, amp);
    }
  }
}
