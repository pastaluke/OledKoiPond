// src/sim/perf.js
// Per-phase frame profiler behind the Debug menu's "Perf HUD" toggle (E14-2).
// Zero cost when disabled (every call gates on `enabled` first). main.js wraps
// its frame phases with begin/end; DebugOverlay renders the panel.

const RING = 120;   // ~2s of frames for p50/p95

export const PERF = {
  enabled: false,

  _t0: {},          // phase → start timestamp
  _ms: {},          // phase → last frame ms
  phases: [],       // insertion-ordered phase names
  _ring: new Float32Array(RING),   // total frame ms ring buffer
  _ringI: 0, _ringN: 0,
  _frameStart: 0,
  entityCount: 0,

  begin(name) {
    if (!this.enabled) return;
    if (!(name in this._ms)) { this.phases.push(name); this._ms[name] = 0; }
    this._t0[name] = performance.now();
  },

  end(name) {
    if (!this.enabled) return;
    this._ms[name] = performance.now() - (this._t0[name] ?? performance.now());
  },

  frameStart() {
    if (!this.enabled) return;
    this._frameStart = performance.now();
  },

  frameEnd() {
    if (!this.enabled) return;
    const total = performance.now() - this._frameStart;
    this._ring[this._ringI] = total;
    this._ringI = (this._ringI + 1) % RING;
    if (this._ringN < RING) this._ringN++;
  },

  ms(name) { return this._ms[name] ?? 0; },

  /** { p50, p95, n } over the ring buffer of total frame ms. */
  percentiles() {
    const n = this._ringN;
    if (!n) return { p50: 0, p95: 0, n: 0 };
    const a = Array.from(this._ring.subarray(0, n)).sort((x, y) => x - y);
    return { p50: a[(n * 0.5) | 0], p95: a[Math.min(n - 1, (n * 0.95) | 0)], n };
  },
};
