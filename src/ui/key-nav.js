// src/ui/key-nav.js
// Keyboard / TV-remote navigation manager.
//
// Two modes:
//   CANVAS (default, menu closed) — arrow keys move a UV-space cursor drawn by the
//     debug overlay; Space/Enter grabs glass shapes, targets fish, or recolors.
//   MENU (panel open) — arrow keys rove through focusable controls via the roving
//     tabindex pattern; native range Left/Right preserved; Up/Down always navigate.
//
// TV compat: uses event.key strings only (no keyCodes); Samsung "GoBack" → Escape.

const BASE_SPEED  = 0.15;   // UV/s at first press
const FAST_SPEED  = 0.40;   // UV/s after ACCEL_DELAY of continuous hold
const ACCEL_DELAY = 500;    // ms before fast speed kicks in
const FISH_RADIUS = 0.08;   // UV distance to target a fish

const FOCUS_SEL = 'summary, input[type="checkbox"], select, input[type="range"], button';

export class KeyNavManager {
  /**
   * @param {object} p
   * @param {import('../renderer/glass-shapes.js').GlassShapes} p.glassShapes
   * @param {import('../debug-overlay.js').DebugOverlay}        p.overlay
   * @param {import('../simulation.js').Simulation}             p.sim
   * @param {() => string}                                      p.recolorFn
   */
  constructor({ glassShapes, overlay, sim, recolorFn }) {
    this._gs      = glassShapes;
    this._overlay = overlay;
    this._sim     = sim;
    this._recolor = recolorFn;

    // ── Canvas cursor ──────────────────────────────────────────────────────────
    this.cursorX    = 0.5;
    this.cursorY    = 0.5;
    this._vx        = 0;
    this._vy        = 0;
    this._held      = new Set();    // currently-pressed arrow keys
    this._holdStart = {};           // key → timestamp of first keydown
    this._grabbed   = -1;           // grabbed glass shape index, or -1
    this._fishTarget = null;        // fish entity being followed, or null

    // ── Menu state ─────────────────────────────────────────────────────────────
    this.mode       = 'canvas';
    this._panel     = null;
    this._focusList = [];
    this._focusIdx  = -1;
    this.onMenuClose = null;        // set by menu.js when panel opens

    // ── Aria live region for mode announcements ────────────────────────────────
    this._live = null;

    this._onDown = this._onDown.bind(this);
    this._onUp   = this._onUp.bind(this);
    window.addEventListener('keydown', this._onDown);
    window.addEventListener('keyup',   this._onUp);
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  setMode(mode) {
    this.mode = mode;
    this._held.clear();
    this._holdStart = {};
    this._vx = 0;
    this._vy = 0;
    if (mode === 'canvas') this._announce('Canvas mode — arrow keys move cursor');
  }

  setPanel(panel) { this._panel = panel; }

  setAriaLive(el) { this._live = el; }

  /** Rebuild the flat ordered list of focusable elements in the panel. */
  buildFocusList() {
    if (!this._panel) return;
    // offsetParent === null means inside a closed <details> — skip those.
    this._focusList = Array.from(this._panel.querySelectorAll(FOCUS_SEL))
      .filter(el => el.offsetParent !== null);
    for (const el of this._focusList) el.tabIndex = -1;
  }

  /** Focus the first element in the panel (called when menu opens). */
  focusFirst() { this._focusEl(0); }

  /** Per-frame integration. dt in seconds. */
  frame(dt) {
    if (this.mode !== 'canvas') return;

    // Fish follow: cursor tracks the fish each frame.
    if (this._fishTarget) {
      const g = this._sim.grid;
      this.cursorX = this._fishTarget.x / g.logicalW;
      this.cursorY = this._fishTarget.y / g.logicalH;
      return;
    }

    // Compute velocity from held keys + hold duration.
    const now = performance.now();
    let vx = 0, vy = 0;
    for (const key of this._held) {
      const held = now - (this._holdStart[key] ?? now);
      const spd  = held > ACCEL_DELAY ? FAST_SPEED : BASE_SPEED;
      if (key === 'ArrowLeft')  vx -= spd;
      if (key === 'ArrowRight') vx += spd;
      if (key === 'ArrowUp')    vy -= spd;
      if (key === 'ArrowDown')  vy += spd;
    }
    this._vx = vx;
    this._vy = vy;

    // Integrate cursor position.
    this.cursorX = Math.max(0, Math.min(1, this.cursorX + vx * dt));
    this.cursorY = Math.max(0, Math.min(1, this.cursorY + vy * dt));

    // Grabbed shape follows the cursor.
    if (this._grabbed >= 0) {
      const s = this._gs.list[this._grabbed];
      if (s) { s.cx = this.cursorX; s.cy = this.cursorY; this._gs.sync(); }
    }
  }

  // ── Getters ─────────────────────────────────────────────────────────────────

  get grabbed()    { return this._grabbed; }
  get fishTarget() { return this._fishTarget; }

  // ── Key handlers ────────────────────────────────────────────────────────────

  _onDown(e) {
    // Never intercept inside free-text / color / number inputs.
    const t = e.target;
    if (t?.tagName === 'INPUT' &&
        (t.type === 'text' || t.type === 'color' || t.type === 'number')) return;

    const key = e.key === 'GoBack' ? 'Escape' : e.key;
    if (this.mode === 'canvas') this._canvasKey(key, e);
    else                         this._menuKey(key, e);
  }

  _onUp(e) {
    this._held.delete(e.key);
    delete this._holdStart[e.key];
  }

  // ── Canvas mode ─────────────────────────────────────────────────────────────

  _canvasKey(key, e) {
    const arrows = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'];
    if (arrows.includes(key)) {
      e.preventDefault();
      if (!this._held.has(key)) {
        this._held.add(key);
        this._holdStart[key] = performance.now();
      }
      return;
    }
    if (key === ' ' || key === 'Enter') { e.preventDefault(); this._activate(); }
    if (key === 'Escape') {
      if (this._fishTarget)   { this._fishTarget = null; return; }
      if (this._grabbed >= 0) { this._grabbed = -1;     return; }
    }
  }

  _activate() {
    // 1. Exit fish-follow by recoloring the fish.
    if (this._fishTarget) {
      if (this._recolor) this._fishTarget.color = this._recolor();
      this._fishTarget = null;
      return;
    }

    // 2. Drop a grabbed glass shape.
    if (this._grabbed >= 0) {
      this._gs.requestSave();
      this._grabbed = -1;
      return;
    }

    // 3. Grab a glass shape under the cursor.
    const hit = this._gs.hitTest(this.cursorX, this.cursorY);
    if (hit >= 0) { this._gs.select(hit); this._grabbed = hit; return; }

    // 4. Target the nearest fish within FISH_RADIUS UV.
    if (this._sim) {
      const g = this._sim.grid;
      let best = null, bestD2 = FISH_RADIUS ** 2;
      for (const f of this._sim.entities) {
        const d2 = ((f.x / g.logicalW) - this.cursorX) ** 2 +
                   ((f.y / g.logicalH) - this.cursorY) ** 2;
        if (d2 < bestD2) { bestD2 = d2; best = f; }
      }
      if (best) { this._fishTarget = best; return; }
    }

    // 5. Empty canvas: recolor nearest fish.
    if (this._sim && this._recolor) {
      const g = this._sim.grid;
      const lx = this.cursorX * g.logicalW, ly = this.cursorY * g.logicalH;
      let nearest = null, minD2 = Infinity;
      for (const f of this._sim.entities) {
        const d2 = (f.x - lx) ** 2 + (f.y - ly) ** 2;
        if (d2 < minD2) { minD2 = d2; nearest = f; }
      }
      if (nearest) nearest.color = this._recolor();
    }
  }

  // ── Menu mode ───────────────────────────────────────────────────────────────

  _menuKey(key, e) {
    const el = this._focusList[this._focusIdx] ?? null;

    if (key === 'Escape') {
      e.preventDefault();
      this.onMenuClose?.();
      return;
    }

    // Up/Down always navigate — prevent default even on range inputs.
    if (key === 'ArrowDown') { e.preventDefault(); this._moveFocus(1);  return; }
    if (key === 'ArrowUp')   { e.preventDefault(); this._moveFocus(-1); return; }

    // Left/Right on <summary>: collapse / expand the section.
    if (el?.tagName === 'SUMMARY') {
      if (key === 'ArrowRight') {
        e.preventDefault();
        const det = el.parentElement;
        if (!det.open) {
          det.open = true;
          requestAnimationFrame(() => { this.buildFocusList(); this._moveFocus(1); });
        }
        return;
      }
      if (key === 'ArrowLeft') {
        e.preventDefault();
        const det = el.parentElement;
        if (det.open) {
          det.open = false;
          requestAnimationFrame(() => { this.buildFocusList(); this._focusEl(this._focusIdx); });
        }
        return;
      }
      if (key === 'Enter' || key === ' ') {
        e.preventDefault();
        el.parentElement.open = !el.parentElement.open;
        requestAnimationFrame(() => { this.buildFocusList(); this._focusEl(this._focusIdx); });
        return;
      }
    }

    // Enter/Space on button or checkbox: click it.
    if ((el?.tagName === 'BUTTON' || el?.type === 'checkbox') &&
        (key === 'Enter' || key === ' ')) {
      e.preventDefault();
      el.click();
    }
    // Left/Right on range: fall through to native slider behavior.
  }

  _moveFocus(delta) {
    const next = this._focusIdx + delta;
    if (next < 0 || next >= this._focusList.length) return;
    if (this._focusList[this._focusIdx]) this._focusList[this._focusIdx].tabIndex = -1;
    this._focusEl(next);
  }

  _focusEl(idx) {
    if (!this._focusList.length) return;
    idx = Math.max(0, Math.min(idx, this._focusList.length - 1));
    this._focusIdx = idx;
    const el = this._focusList[idx];
    el.tabIndex = 0;
    el.focus({ preventScroll: true });
    el.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
  }

  _announce(msg) {
    if (this._live) this._live.textContent = msg;
  }
}
