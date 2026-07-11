// src/sim/spatial-hash.js
// Uniform spatial hash for neighbor queries (E14-2). Replaces the O(n²)
// all-pairs scan in Simulation with O(n + n·k): entities are binned into a
// coarse grid each frame, and a query visits only the 3×3 cells around a point.
//
// Zero steady-state allocations: heads/next are Int32Array linked lists
// (head[cell] → entity index → next[index] → …, -1 terminated), reallocated
// only when the entity count or grid dimensions grow. Correctness constraint:
// `cellSize` must be ≥ the largest query radius used this frame — Simulation
// passes the max perception radius across all species present.

export class SpatialHash {
  constructor() {
    this._heads = new Int32Array(0);   // cell → first entity index, -1 = empty
    this._next  = new Int32Array(0);   // entity index → next in cell, -1 = end
    this._cols = 0; this._rows = 0; this._cellSize = 1;
    this._n = 0;
  }

  /** Re-bin all entities. O(n). Call once per frame before any query(). */
  rebuild(entities, cellSize, worldW, worldH) {
    const n = entities.length;
    this._cellSize = Math.max(1e-6, cellSize);
    const cols = Math.max(1, Math.ceil(worldW / this._cellSize));
    const rows = Math.max(1, Math.ceil(worldH / this._cellSize));

    if (cols * rows > this._heads.length) this._heads = new Int32Array(cols * rows);
    if (n > this._next.length) this._next = new Int32Array(Math.ceil(n * 1.5));
    this._cols = cols; this._rows = rows; this._n = n;

    this._heads.fill(-1, 0, cols * rows);
    for (let i = 0; i < n; i++) {
      const e = entities[i];
      const cx = Math.min(cols - 1, Math.max(0, (e.x / this._cellSize) | 0));
      const cy = Math.min(rows - 1, Math.max(0, (e.y / this._cellSize) | 0));
      const cell = cy * cols + cx;
      this._next[i] = this._heads[cell];
      this._heads[cell] = i;
    }
  }

  /**
   * Collect entities within `r` of (x, y) into `out` (cleared first), skipping
   * `selfIndex`. Requires r ≤ cellSize (guaranteed by Simulation's rebuild).
   * Returns `out` for convenience.
   */
  query(entities, x, y, r, selfIndex, out) {
    out.length = 0;
    if (r <= 0 || this._n === 0) return out;
    const cs = this._cellSize, cols = this._cols, rows = this._rows, rSq = r * r;
    const cx = Math.min(cols - 1, Math.max(0, (x / cs) | 0));
    const cy = Math.min(rows - 1, Math.max(0, (y / cs) | 0));
    const x0 = Math.max(0, cx - 1), x1 = Math.min(cols - 1, cx + 1);
    const y0 = Math.max(0, cy - 1), y1 = Math.min(rows - 1, cy + 1);
    for (let gy = y0; gy <= y1; gy++) {
      for (let gx = x0; gx <= x1; gx++) {
        for (let i = this._heads[gy * cols + gx]; i !== -1; i = this._next[i]) {
          if (i === selfIndex) continue;
          const o = entities[i];
          const dx = o.x - x, dy = o.y - y;
          if (dx * dx + dy * dy <= rSq) out.push(o);
        }
      }
    }
    return out;
  }
}
