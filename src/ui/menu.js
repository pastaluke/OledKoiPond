// src/ui/menu.js
// Hamburger menu UI — small floating panel, not full-screen.

import {
  MOVEMENT_PARAMS, snapshot, applyValues, defaultRanges,
  loadPersisted, savePersisted, toCodeSnippet,
} from '../movement/tuning.js';
import {
  getAllPalettes, isBuiltin,
  setActivePalette, getActivePaletteId, getActivePalette,
  addCustomPalette, updateCustomPalette, deleteCustomPalette,
} from '../palettes/index.js';
import { WATER_DEFAULTS } from '../fluid/ripple-field.js';
import { buildBodyOutline, buildCenterline, buildAppendageOutlines, finSpineFrame, upgradeCreature } from '../entities/fish-base.js';

const FISH_MIN = 0, FISH_MAX = 40;
const LONG_PRESS_MS = 450;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/**
 * Initialise the hamburger menu and wire up controls.
 * @param {object} refs
 * @param {import('../debug-overlay.js').DebugOverlay} refs.overlay
 * @param {import('../simulation.js').Simulation} refs.sim
 * @param {import('../grid.js').Grid} refs.grid
 * @param {typeof import('../entities/fish-base.js').FishBase} refs.FishClass - spawned fish type to tune
 */
export function initMenu({ overlay, sim, grid, FishClass, compositor, glassShapes, keyNav, rippleField }) {
  // Pristine defaults captured BEFORE persisted tuning is applied (for Reset).
  const defaults = snapshot(FishClass);
  // Live, per-param slider range { key: {min, max} } — adjustable + persisted.
  const ranges = defaultRanges();
  const fmt = (v, d) => Number(v).toFixed(d);

  // ── Hamburger button ────────────────────────────────────────────────────────
  const btn = document.createElement('button');
  btn.id = 'menu-btn';
  btn.setAttribute('aria-label', 'Menu');
  btn.innerHTML = '<span></span><span></span><span></span>';

  // ── Floating panel ──────────────────────────────────────────────────────────
  const panel = document.createElement('div');
  panel.id = 'menu-panel';
  panel.setAttribute('aria-label', 'Settings panel');
  panel.hidden = true;
  panel.innerHTML = `
    <div class="menu-rows">
      <button class="menu-row menu-action" id="btn-fullscreen">Fullscreen</button>
    </div>
    <details open>
      <summary>Movement</summary>
      <div class="menu-rows">
        <div class="menu-scroll" id="movement-sliders"></div>
        <div class="menu-btn-row">
          <button class="menu-action" id="btn-copy-tuning">Copy values</button>
          <button class="menu-action" id="btn-reset-tuning">Reset</button>
        </div>
      </div>
    </details>
    <details>
      <summary>Fish</summary>
      <div class="menu-rows">
        <label class="menu-row">
          <span>Filled in</span>
          <input type="checkbox" id="toggle-filled">
        </label>
        <label class="menu-row">
          <span>Food bag</span>
          <select id="palette-select" class="menu-select"></select>
        </label>
        <div id="palette-editor" class="pal-editor">
          <div id="pal-color-list" class="pal-color-list"></div>
          <div class="pal-add-row" id="pal-add-row">
            <input type="text" id="pal-color-input" class="menu-text-input" placeholder="#ff8c00 or 255,140,0">
            <button type="button" class="pal-icon-btn" id="pal-paste-btn" title="Paste from clipboard">&#x1F4CB;</button>
            <button type="button" class="pal-icon-btn" id="pal-add-btn" title="Add color">+</button>
          </div>
          <label class="menu-row" id="pal-name-row">
            <span>Name</span>
            <input type="text" id="pal-name-input" class="menu-text-input" maxlength="32">
          </label>
          <div class="menu-btn-row" id="pal-csv-row">
            <button class="menu-action" id="pal-copy-csv">Copy CSV</button>
            <button class="menu-action" id="pal-paste-csv">Paste CSV</button>
          </div>
          <div class="menu-btn-row" id="pal-manage-row">
            <button class="menu-action" id="pal-delete-btn">Delete palette</button>
          </div>
        </div>
        <button class="menu-action" id="pal-new-btn">+ New palette</button>
        <div id="fish-sliders"></div>
      </div>
    </details>
    <details>
      <summary>Shape</summary>
      <div class="menu-rows">
        <!-- Editor pane: accurate resting silhouette with draggable points -->
        <canvas id="shape-preview" class="shape-preview shape-edit"></canvas>
        <div class="menu-btn-row">
          <button class="menu-action" id="btn-zoom-out" title="Zoom out">Zoom −</button>
          <button class="menu-action" id="btn-zoom-fit" title="Fit to view (or double-click the preview)">Fit</button>
          <button class="menu-action" id="btn-zoom-in" title="Zoom in (or scroll on the preview)">Zoom +</button>
        </div>
        <label class="menu-row">
          <span>Edit</span>
          <select id="shape-target-sel" class="menu-select"></select>
        </label>
        <div class="menu-btn-row">
          <button class="menu-action" id="btn-fin-add" title="Add a fin (mirrored pair)">+ Fin</button>
          <button class="menu-action" id="btn-fin-remove" title="Remove the selected fin">− Fin</button>
        </div>
        <div id="shape-fin-sliders"></div>
        <label class="menu-row">
          <span>Point</span>
          <select id="shape-point-sel" class="menu-select"></select>
        </label>
        <div class="menu-btn-row">
          <button class="menu-action" id="btn-pt-add-left" title="Add a point halfway toward the tail-side neighbor">+pt ⇐</button>
          <button class="menu-action" id="btn-pt-add-right" title="Add a point halfway toward the head-side neighbor">+pt ⇒</button>
          <button class="menu-action" id="btn-pt-remove" title="Remove the selected point">− pt</button>
        </div>
        <div id="shape-t-row"></div>
        <div id="shape-w-row"></div>
        <div class="menu-btn-row">
          <button class="menu-action" id="btn-pt-left"  title="Move point toward tail">←</button>
          <button class="menu-action" id="btn-pt-right" title="Move point toward head">→</button>
          <button class="menu-action" id="btn-pt-up"    title="Widen (both sides)"><span class="wh-stack"><span>↑</span><span>↓</span></span></button>
          <button class="menu-action" id="btn-pt-down"  title="Narrow (both sides)"><span class="wh-stack"><span>↓</span><span>↑</span></span></button>
        </div>
        <div id="shape-proportion-sliders"></div>
        <!-- Live pane: the real fish swimming (gentle weave shows wiggle + bends) -->
        <canvas id="shape-live" class="shape-preview"></canvas>
        <div id="shape-motion-sliders"></div>
        <div class="menu-btn-row">
          <button class="menu-action" id="btn-copy-shape">Copy values</button>
          <button class="menu-action" id="btn-reset-shape">Reset</button>
        </div>
      </div>
    </details>
    <details>
      <summary>Display</summary>
      <div class="menu-rows">
        <div id="display-sliders"></div>
      </div>
    </details>
    <details>
      <summary>Water</summary>
      <div class="menu-rows">
        <label class="menu-row">
          <span>Ripples</span>
          <input type="checkbox" id="toggle-water-enabled">
        </label>
        <label class="menu-row">
          <span>Smooth edges</span>
          <input type="checkbox" id="toggle-water-smooth">
        </label>
        <div id="water-sliders"></div>
        <div class="menu-btn-row">
          <button class="menu-action" id="btn-water-reset">Reset</button>
          <button class="menu-action" id="btn-water-copy">Copy</button>
          <button class="menu-action" id="btn-water-paste">Paste</button>
        </div>
      </div>
    </details>
    <details>
      <summary>Border</summary>
      <div class="menu-rows">
        <label class="menu-row">
          <span>Show border</span>
          <input type="checkbox" id="toggle-border">
        </label>
        <label class="menu-row">
          <span>Hard wall</span>
          <input type="checkbox" id="toggle-hard-border">
        </label>
        <label class="menu-row">
          <span>Glass edge</span>
          <input type="checkbox" id="toggle-glass-edge">
        </label>
        <div id="border-sliders"></div>
      </div>
    </details>
    <details>
      <summary>Glass shapes</summary>
      <div class="menu-rows">
        <label class="menu-row">
          <span>Shape</span>
          <select id="glass-shape-sel" class="menu-select"></select>
        </label>
        <div class="menu-btn-row">
          <button class="menu-action" id="glass-add">+ Add</button>
          <button class="menu-action" id="glass-remove">Remove</button>
        </div>
        <div id="glass-shape-sliders"></div>
      </div>
    </details>
    <details>
      <summary>Debug</summary>
      <div class="menu-rows">
        <label class="menu-row">
          <span>Spline</span>
          <input type="checkbox" id="toggle-spline"${overlay.splineEnabled ? ' checked' : ''}>
        </label>
        <label class="menu-row">
          <span>Entity Stats</span>
          <input type="checkbox" id="toggle-stats"${overlay.statsEnabled ? ' checked' : ''}>
        </label>
        <label class="menu-row">
          <span>Perception Radius</span>
          <input type="checkbox" id="toggle-perception"${overlay.perceptionEnabled ? ' checked' : ''}>
        </label>
        <label class="menu-row">
          <span>Separation Radius</span>
          <input type="checkbox" id="toggle-separation"${overlay.separationEnabled ? ' checked' : ''}>
        </label>
        <label class="menu-row">
          <span>Edge Margin</span>
          <input type="checkbox" id="toggle-edge"${overlay.edgeEnabled ? ' checked' : ''}>
        </label>
        <label class="menu-row">
          <span>Neighbor Links</span>
          <input type="checkbox" id="toggle-neighbors"${overlay.neighborsEnabled ? ' checked' : ''}>
        </label>
        <label class="menu-row">
          <span>Velocity Vector</span>
          <input type="checkbox" id="toggle-velocity"${overlay.velocityEnabled ? ' checked' : ''}>
        </label>
        <label class="menu-row">
          <span>Wander Target</span>
          <input type="checkbox" id="toggle-wander"${overlay.wanderEnabled ? ' checked' : ''}>
        </label>
      </div>
    </details>
  `;

  document.body.appendChild(btn);
  document.body.appendChild(panel);

  // ── Info popup (click an (i) icon to toggle its description) ─────────────────
  const infoPop = document.createElement('div');
  infoPop.id = 'info-pop';
  infoPop.hidden = true;
  panel.appendChild(infoPop);
  let infoAnchor = null;

  function showInfo(text, anchor) {
    if (infoAnchor === anchor && !infoPop.hidden) { hideInfo(); return; }   // toggle off
    infoPop.textContent = text;
    infoPop.hidden = false;
    infoAnchor = anchor;
    const pr = panel.getBoundingClientRect();
    const ar = anchor.getBoundingClientRect();
    // Add scroll offsets: the panel is now a scroll container, and an absolutely
    // positioned child is placed relative to the (scrolled) content origin.
    const left = Math.max(6, Math.min(ar.left - pr.left + panel.scrollLeft, panel.clientWidth - infoPop.offsetWidth - 6));
    infoPop.style.left = `${left}px`;
    infoPop.style.top  = `${ar.bottom - pr.top + panel.scrollTop + 4}px`;
  }
  function hideInfo() { infoPop.hidden = true; infoAnchor = null; }

  function wireInfoIcon(row, text) {
    const icon = row.querySelector('.info-icon');
    if (icon) icon.addEventListener('click', (e) => { e.stopPropagation(); showInfo(text, icon); });
  }

  document.addEventListener('click', (e) => {
    if (!infoPop.hidden && !e.target.closest('.info-icon') && !infoPop.contains(e.target)) hideInfo();
  });

  // ── Water settings (de)serialisation ─────────────────────────────────────────
  // One shape, three consumers: persistence, the Copy button, and Paste/Reset.
  const waterSnapshot = () => rippleField ? {
    enabled: rippleField.enabled, smooth: rippleField.smooth,
    damping: rippleField.damping, speed: rippleField.speed,
    strength: rippleField.strength, tapRadius: rippleField.tapRadius,
    gain: rippleField.gain, maxDim: rippleField.maxDim,
    color: [...rippleField.color],
    wakeStrength: rippleField.wakeStrength, wakeSpacing: rippleField.wakeSpacing,
  } : undefined;

  // Apply a (possibly partial / untrusted) water blob, clamping every field to
  // its valid range. Returns true if anything plausibly applied.
  const applyWaterSettings = (wv) => {
    // Plain object only — reject null, arrays, and primitives so a stray paste
    // like `[1,2,3]` or `42` reports "Bad data" instead of silently doing nothing.
    if (!rippleField || wv === null || typeof wv !== 'object' || Array.isArray(wv)) return false;
    if (typeof wv.enabled === 'boolean')  rippleField.enabled  = wv.enabled;
    if (typeof wv.smooth  === 'boolean')  rippleField.smooth   = wv.smooth;
    if (Number.isFinite(wv.damping))      rippleField.damping   = clamp(wv.damping, 0.80, 0.999);
    if (Number.isFinite(wv.speed))        rippleField.speed     = clamp(wv.speed, 0.05, 0.5);
    if (Number.isFinite(wv.strength))     rippleField.strength  = clamp(wv.strength, 0.1, 5);
    if (Number.isFinite(wv.tapRadius))    rippleField.tapRadius = clamp(wv.tapRadius, 0, 6);
    if (Number.isFinite(wv.gain))         rippleField.gain      = clamp(Math.round(wv.gain), 20, 600);
    if (Number.isFinite(wv.maxDim))       rippleField.maxDim    = clamp(Math.round(wv.maxDim), 60, 400);
    if (Array.isArray(wv.color) && wv.color.length === 3 && wv.color.every(Number.isFinite)) {
      rippleField.color = wv.color.map((c) => clamp(Math.round(c), 0, 255));
    }
    if (Number.isFinite(wv.wakeStrength)) rippleField.wakeStrength = clamp(wv.wakeStrength, 0, 5);
    if (Number.isFinite(wv.wakeSpacing))  rippleField.wakeSpacing  = clamp(wv.wakeSpacing, 0.5, 20);
    rippleField.resize();
    return true;
  };

  // ── Persistence ─────────────────────────────────────────────────────────────
  // Snapshot shape: deep-clone so the persisted copy isn't affected by later mutations.
  const save = () => savePersisted({
    params: snapshot(FishClass), ranges, fishCount: sim.entities.length,
    fish:    { filled: FishClass.FILLED, paletteId: getActivePaletteId() },
    creature: JSON.parse(JSON.stringify(liveCreature)),
    display: { density: grid.density, worldShortEdge: grid.worldShortEdge },
    border:  { ...grid.border, hardBorder: FishClass.HARD_BORDER, glassEdge: compositor.glassEdge,
               borderChromatic: compositor.borderChromatic, borderRefr: compositor.borderRefr,
               borderBevel: compositor.borderBevel, borderSpecular: compositor.borderSpecular,
               specularMode: compositor.specularMode, specularCurve: compositor.specularCurve },
    glassShapes: glassShapes.serialize(),
    water: waterSnapshot(),
  });

  function setFishCount(n) {
    n = clamp(Math.round(n), FISH_MIN, FISH_MAX);
    while (sim.entities.length < n) sim.add(new FishClass(grid));
    while (sim.entities.length > n) sim.remove(sim.entities[sim.entities.length - 1]);
  }

  // ── Creature state — live mutable copy of FishClass.CREATURE ─────────────────
  // Captured before persisted restore so Reset can return to code defaults.
  const defaultCreature = JSON.parse(JSON.stringify(FishClass.CREATURE));
  let liveCreature      = JSON.parse(JSON.stringify(FishClass.CREATURE));

  // ── Display knobs (owned by the Grid) ─────────────────────────────────────────
  const DENSITY_RANGE = { min: 1, max: 4 };    // display cells per world unit
  const WORLD_RANGE   = { min: 60, max: 360 }; // world units across the short edge
  // Apply a grid-knob change: recompute the projection, then let main.js's
  // 'gridresize' handler reposition entities proportionally + resync the overlay.
  const applyGrid = () => {
    grid.resize();
    grid.canvas.dispatchEvent(new CustomEvent('gridresize'));
  };

  // Restore persisted tuning (params, ranges, fish count, display) before building controls.
  const persisted = loadPersisted();
  if (persisted) {
    if (persisted.ranges) {
      for (const p of MOVEMENT_PARAMS) {
        const r = persisted.ranges[p.key];
        if (r && Number.isFinite(r.min) && Number.isFinite(r.max)) {
          const min = clamp(r.min, p.floor, p.ceil);
          const max = clamp(Math.max(r.max, min + p.step), p.floor, p.ceil);
          ranges[p.key] = { min, max };
        }
      }
    }
    applyValues(FishClass, persisted.params);
    for (const p of MOVEMENT_PARAMS) {
      FishClass[p.key] = clamp(FishClass[p.key], ranges[p.key].min, ranges[p.key].max);
    }
    if (Number.isFinite(persisted.fishCount)) setFishCount(persisted.fishCount);
    if (persisted.display) {
      const d = persisted.display;
      if (Number.isFinite(d.density))        grid.density        = clamp(d.density, DENSITY_RANGE.min, DENSITY_RANGE.max);
      if (Number.isFinite(d.worldShortEdge)) grid.worldShortEdge = clamp(d.worldShortEdge, WORLD_RANGE.min, WORLD_RANGE.max);
      applyGrid();
    }
    if (persisted.fish) {
      if (typeof persisted.fish.filled   === 'boolean') FishClass.FILLED = persisted.fish.filled;
      if (typeof persisted.fish.paletteId === 'string') setActivePalette(persisted.fish.paletteId);
    }
    if (persisted.border) {
      const b = persisted.border;
      if (typeof b.enabled    === 'boolean') grid.border.enabled  = b.enabled;
      if (Number.isFinite(b.width))          grid.border.width    = clamp(b.width,   0.5, 10);
      if (Number.isFinite(b.opacity))        grid.border.opacity  = clamp(b.opacity, 0,   1);
      if (typeof b.hardBorder === 'boolean') FishClass.HARD_BORDER = b.hardBorder;
      if (typeof b.glassEdge  === 'boolean') compositor.setGlassEdge(b.glassEdge, {
        chromatic:    Number.isFinite(b.borderChromatic)      ? b.borderChromatic : undefined,
        refraction:   Number.isFinite(b.borderRefr)           ? b.borderRefr      : undefined,
        bevelDepth:   Number.isFinite(b.borderBevel)          ? b.borderBevel     : undefined,
        specular:     typeof b.borderSpecular === 'boolean'   ? b.borderSpecular  : undefined,
        specularMode: Number.isFinite(b.specularMode)         ? b.specularMode    : undefined,
        specularCurve: Number.isFinite(b.specularCurve)       ? b.specularCurve   : undefined,
      });
    }
    // Accept the new `creature` blob or upgrade a legacy `shape` blob in place.
    const upgraded = upgradeCreature(persisted.creature ?? persisted.shape);
    if (upgraded) {
      liveCreature = upgraded;
      FishClass.CREATURE = liveCreature;
    }
    if (persisted.glassShapes) glassShapes.restore(persisted.glassShapes);
    if (persisted.water) applyWaterSettings(persisted.water);
  }

  // ── Slider row builder ───────────────────────────────────────────────────────
  // cfg: { label, infoText, decimals, valueStep, coarse, step, hasBounds,
  //        getVal, setVal, getMin, getMax, setMin, setMax }
  function makeRow(cfg) {
    const { label, infoText, decimals, valueStep, coarse, hasBounds,
            getVal, setVal, getMin, getMax, setMin, setMax } = cfg;

    const row = document.createElement('div');
    row.className = 'slider-row';
    if (infoText) row.title = infoText;
    row.innerHTML = `
      ${hasBounds ? `
      <div class="bound-controls">
        <div class="btn-group">
          <button type="button" class="step-btn" data-act="lo-dec" title="Lower the minimum">−</button>
          <button type="button" class="bound-mid" data-act="lo-cap" title="Lower bound — shift-click or long-press to set it to the knob's value">[</button>
          <button type="button" class="step-btn" data-act="lo-inc" title="Raise the minimum">+</button>
        </div>
        <div class="btn-group">
          <button type="button" class="step-btn" data-act="hi-dec" title="Lower the maximum">−</button>
          <button type="button" class="bound-mid" data-act="hi-cap" title="Upper bound — shift-click or long-press to set it to the knob's value">]</button>
          <button type="button" class="step-btn" data-act="hi-inc" title="Raise the maximum">+</button>
        </div>
      </div>` : ''}
      <div class="value-controls">
        <span class="slider-label">${label}${infoText ? `<button type="button" class="info-icon" aria-label="About ${label}">i</button>` : ''}</span>
        <span class="slider-val"></span>
        <div class="btn-group knob-group">
          <button type="button" class="step-btn" data-act="v-dec" title="Decrease value">−</button>
          <span class="knob-mid" aria-hidden="true"></span>
          <button type="button" class="step-btn" data-act="v-inc" title="Increase value">+</button>
        </div>
      </div>
      <div class="slider-track">
        ${hasBounds ? '<span class="range-end range-min"></span>' : ''}
        <input type="range">
        ${hasBounds ? '<span class="range-end range-max"></span>' : ''}
      </div>
    `;

    const input  = row.querySelector('input');
    const valOut = row.querySelector('.slider-val');
    const minOut = row.querySelector('.range-min');
    const maxOut = row.querySelector('.range-max');

    function sync() {
      input.min = getMin();
      input.max = getMax();
      input.step = valueStep;
      input.value = getVal();
      valOut.textContent = fmt(getVal(), decimals);
      if (minOut) minOut.textContent = fmt(getMin(), decimals);
      if (maxOut) maxOut.textContent = fmt(getMax(), decimals);
    }

    input.addEventListener('input', () => { setVal(parseFloat(input.value)); sync(); save(); });
    if (infoText) wireInfoIcon(row, infoText);

    const actions = {
      'v-dec': () => setVal(getVal() - valueStep),
      'v-inc': () => setVal(getVal() + valueStep),
      'lo-dec': () => setMin(getMin() - coarse),
      'lo-inc': () => setMin(getMin() + coarse),
      'hi-dec': () => setMax(getMax() - coarse),
      'hi-inc': () => setMax(getMax() + coarse),
    };
    row.querySelectorAll('.step-btn').forEach((b) => {
      b.addEventListener('click', () => { const a = actions[b.dataset.act]; if (a) { a(); sync(); save(); } });
    });

    // Capture the knob value as a bound: shift-click OR long-press the [ / ] button.
    row.querySelectorAll('.bound-mid').forEach((b) => {
      const capture = () => {
        if (b.dataset.act === 'lo-cap') setMin(getVal()); else setMax(getVal());
        sync(); save();
      };
      b.addEventListener('click', (e) => { if (e.shiftKey) capture(); });
      let timer = null;
      const cancel = () => { if (timer) { clearTimeout(timer); timer = null; } };
      b.addEventListener('pointerdown', () => { timer = setTimeout(() => { timer = null; capture(); }, LONG_PRESS_MS); });
      b.addEventListener('pointerup', cancel);
      b.addEventListener('pointerleave', cancel);
      b.addEventListener('pointercancel', cancel);
    });

    sync();
    return { row, sync };
  }

  // ── Build movement sliders ────────────────────────────────────────────────────
  const sliderHost = panel.querySelector('#movement-sliders');
  const rowSyncs = {};

  for (const p of MOVEMENT_PARAMS) {
    const rng = ranges[p.key];
    const { row, sync } = makeRow({
      label: p.label,
      infoText: `${p.label}: ${p.desc}`,
      decimals: p.decimals,
      valueStep: p.step,
      coarse: p.coarse,
      hasBounds: true,
      getVal: () => FishClass[p.key],
      setVal: (v) => { FishClass[p.key] = clamp(v, rng.min, rng.max); },
      getMin: () => rng.min,
      getMax: () => rng.max,
      setMin: (v) => {
        rng.min = clamp(v, p.floor, rng.max - p.step);
        FishClass[p.key] = clamp(FishClass[p.key], rng.min, rng.max);
      },
      setMax: (v) => {
        rng.max = clamp(v, rng.min + p.step, p.ceil);
        FishClass[p.key] = clamp(FishClass[p.key], rng.min, rng.max);
      },
    });
    rowSyncs[p.key] = sync;
    sliderHost.appendChild(row);
  }

  // ── Fish section ─────────────────────────────────────────────────────────────
  const fishHost    = panel.querySelector('#fish-sliders');
  const filledToggle = panel.querySelector('#toggle-filled');
  filledToggle.checked = FishClass.FILLED;
  filledToggle.addEventListener('change', (e) => { FishClass.FILLED = e.target.checked; save(); });

  const palSel       = panel.querySelector('#palette-select');
  const palColorList = panel.querySelector('#pal-color-list');
  const palAddRow    = panel.querySelector('#pal-add-row');
  const palColorInput = panel.querySelector('#pal-color-input');
  const palPasteBtn  = panel.querySelector('#pal-paste-btn');
  const palAddBtn    = panel.querySelector('#pal-add-btn');
  const palNameRow   = panel.querySelector('#pal-name-row');
  const palNameInput = panel.querySelector('#pal-name-input');
  const palCsvRow    = panel.querySelector('#pal-csv-row');
  const palCopyCsv   = panel.querySelector('#pal-copy-csv');
  const palPasteCsv  = panel.querySelector('#pal-paste-csv');
  const palManageRow = panel.querySelector('#pal-manage-row');
  const palDeleteBtn = panel.querySelector('#pal-delete-btn');
  const palNewBtn    = panel.querySelector('#pal-new-btn');

  function addOption(sel, value, text) {
    const opt = document.createElement('option');
    opt.value = value;
    opt.textContent = text;
    sel.appendChild(opt);
  }

  function refreshPaletteSel() {
    palSel.innerHTML = '';
    for (const p of getAllPalettes()) addOption(palSel, p.id, p.name);
    palSel.value = getActivePaletteId() ?? (getAllPalettes()[0]?.id ?? '');
  }

  function parseColor(str) {
    str = str.trim();
    const h = str.match(/^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
    if (h) return { r: parseInt(h[1], 16), g: parseInt(h[2], 16), b: parseInt(h[3], 16) };
    const parts = str.split(/[\s,]+/).map(s => parseInt(s, 10));
    if (parts.length >= 3 && parts.every(v => Number.isInteger(v) && v >= 0 && v <= 255))
      return { r: parts[0], g: parts[1], b: parts[2] };
    return null;
  }

  function renderColorList(pal, custom) {
    palColorList.innerHTML = '';
    (pal.colors || []).forEach((c, i) => {
      const row = document.createElement('div');
      row.className = 'pal-color-row';
      row.innerHTML = `
        <span class="pal-swatch" style="background:rgb(${c.r},${c.g},${c.b})"></span>
        <span class="pal-rgb-text">${c.r}, ${c.g}, ${c.b}</span>
        ${custom ? `<button class="pal-del-color" data-idx="${i}" title="Remove color">&times;</button>` : ''}
      `;
      palColorList.appendChild(row);
    });
    if (custom) {
      palColorList.querySelectorAll('.pal-del-color').forEach(btn => {
        btn.addEventListener('click', () => {
          const idx = parseInt(btn.dataset.idx, 10);
          if (window.confirm('Remove this color?')) {
            const p = getActivePalette();
            const newColors = (p.colors || []).filter((_, i) => i !== idx);
            updateCustomPalette(getActivePaletteId(), { colors: newColors });
            refreshEditor();
          }
        });
      });
    }
  }

  function refreshEditor() {
    const id  = getActivePaletteId();
    const pal = getActivePalette();
    if (!pal) return;
    const custom = !isBuiltin(id);
    palNameRow.hidden    = !custom;
    palAddRow.hidden     = !custom;
    palCsvRow.hidden     = !custom;
    palManageRow.hidden  = !custom;
    renderColorList(pal, custom);
    if (custom) palNameInput.value = pal.name;
  }

  refreshPaletteSel();
  refreshEditor();

  palSel.addEventListener('change', (e) => {
    setActivePalette(e.target.value);
    save();
    refreshEditor();
  });

  // Clipboard paste into color input
  palPasteBtn.addEventListener('click', async () => {
    try {
      const text = await navigator.clipboard.readText();
      palColorInput.value = text.trim();
    } catch { /* clipboard not available */ }
  });

  // Add a single color
  palAddBtn.addEventListener('click', () => {
    const c = parseColor(palColorInput.value);
    if (!c) { alert('Invalid color. Use #rrggbb or r, g, b.'); return; }
    const pal = getActivePalette();
    updateCustomPalette(getActivePaletteId(), { colors: [...(pal.colors || []), c] });
    palColorInput.value = '';
    refreshEditor();
    save();
  });

  // Also add color on Enter in the input
  palColorInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); palAddBtn.click(); }
  });

  // Palette name update
  palNameInput.addEventListener('change', () => {
    const name = palNameInput.value.trim() || 'New Palette';
    updateCustomPalette(getActivePaletteId(), { name });
    const opt = palSel.querySelector(`option[value="${getActivePaletteId()}"]`);
    if (opt) opt.textContent = name;
    save();
  });

  // Copy CSV
  palCopyCsv.addEventListener('click', async () => {
    const pal = getActivePalette();
    const csv = (pal.colors || []).map(c => `${c.r},${c.g},${c.b}`).join('\n');
    try { await navigator.clipboard.writeText(csv); }
    catch { console.log(csv); }
    const prev = palCopyCsv.textContent;
    palCopyCsv.textContent = 'Copied!';
    setTimeout(() => { palCopyCsv.textContent = prev; }, 1200);
  });

  // Paste CSV — appends to existing colors
  palPasteCsv.addEventListener('click', async () => {
    let text;
    try { text = await navigator.clipboard.readText(); }
    catch { alert('Clipboard access denied.'); return; }
    const lines = text.split('\n').map(l => l.trim()).filter(l => l !== '');
    const parsed = [];
    for (let i = 0; i < lines.length; i++) {
      const c = parseColor(lines[i]);
      if (!c) { alert(`Invalid color on line ${i + 1}: "${lines[i]}". No colors were imported.`); return; }
      parsed.push(c);
    }
    if (!parsed.length) return;
    const pal = getActivePalette();
    updateCustomPalette(getActivePaletteId(), { colors: [...(pal.colors || []), ...parsed] });
    refreshEditor();
    save();
  });

  // New palette
  palNewBtn.addEventListener('click', () => {
    const id = `custom-${Date.now()}`;
    addCustomPalette({ id, name: 'New Palette', colors: [] });
    refreshPaletteSel();
    palSel.value = id;
    setActivePalette(id);
    save();
    refreshEditor();
  });

  // Delete palette
  palDeleteBtn.addEventListener('click', () => {
    const id = getActivePaletteId();
    if (isBuiltin(id)) return;
    if (!window.confirm('Delete this palette?')) return;
    deleteCustomPalette(id);
    const fallback = getAllPalettes()[0];
    if (fallback) setActivePalette(fallback.id);
    save();
    refreshPaletteSel();
    refreshEditor();
  });

  // Fish count — value control only (fixed range, no bound brackets).
  const { row: countRow } = makeRow({
    label: 'Fish count',
    infoText: 'Fish count: number of koi in the pond. Handy for judging how schooling feels at different densities.',
    decimals: 0,
    valueStep: 1,
    hasBounds: false,
    getVal: () => sim.entities.length,
    setVal: (v) => setFishCount(v),
    getMin: () => FISH_MIN,
    getMax: () => FISH_MAX,
  });
  fishHost.appendChild(countRow);

  // ── Shape editor ─────────────────────────────────────────────────────────────
  const shapePreview    = panel.querySelector('#shape-preview');   // editor pane (static + dots)
  const shapeLive       = panel.querySelector('#shape-live');      // live pane (animated, weaving)
  const shapePointSel   = panel.querySelector('#shape-point-sel');
  const shapeTargetSel  = panel.querySelector('#shape-target-sel');
  const shapeFinHost    = panel.querySelector('#shape-fin-sliders');
  const shapeTHost      = panel.querySelector('#shape-t-row');
  const shapeWHost      = panel.querySelector('#shape-w-row');
  const shapePropHost   = panel.querySelector('#shape-proportion-sliders');
  const shapeMotionHost = panel.querySelector('#shape-motion-sliders');

  const MIN_POINTS  = 3;     // floor on point count
  const T_GAP       = 0.01;  // minimum t separation between adjacent points
  const W_MAX       = 5.0;   // half-width ceiling
  const PREVIEW_LEN = 16;    // nominal body length both preview panes draw at
  const WEAVE_BEND  = 0.55;  // steeringBend amplitude of the live pane's lazy S-weave

  let selectedIdx = 0;
  // What the point editor targets: 'body' (spline.points) or a fin index (its profile).
  let editSel = 'body';
  const targetIsBody = () => editSel === 'body';
  const activePoints = () => targetIsBody()
    ? liveCreature.spline.points
    : liveCreature.appendages[editSel].profile;
  // Frames for placing the editable dots: the body centerline, or — for a fin — the
  // representative side's local fin spine. `at(a) → {x,y,nx,ny}` (rest pose).
  function activeFrames() {
    if (targetIsBody()) {
      const spine = buildCenterline(liveCreature.spline, liveCreature.motion, restOpts());
      return { pts: liveCreature.spline.points, at: (t) => spine.at(t) };
    }
    const fin = liveCreature.appendages[editSel];
    const sideSign = (fin.side ?? 1) === 0 ? 0 : 1;   // edit the representative side
    const { Rx, Ry, Dx, Dy } = finSpineFrame(liveCreature.spline, liveCreature.motion, fin, sideSign, restOpts());
    return { pts: fin.profile, at: (s) => ({ x: Rx + Dx * s * fin.length, y: Ry + Dy * s * fin.length, nx: -Dy, ny: Dx }) };
  }
  let shapeTRow = null, shapeWRow = null;
  let previewXform = { sc: 1, ox: 0, oy: 0 };   // world→canvas for the editor pane (drag inverse)
  let previewBase  = { sc: 1, ox: 0, oy: 0, W: 0, H: 0 };   // aspect-fit before zoom/pan
  const editorView = { zoom: 1, panX: 0, panY: 0 };          // editor-pane zoom + pan
  const EDIT_ZMAX  = 12;

  // Apply the editor zoom (about the canvas center) + pan to a base fit transform.
  function applyView(base) {
    const W = shapePreview.width, H = shapePreview.height, z = editorView.zoom;
    return {
      W, H, sc: base.sc * z,
      ox: (W / 2) * (1 - z) + base.ox * z + editorView.panX,
      oy: (H / 2) * (1 - z) + base.oy * z + editorView.panY,
    };
  }

  const ptLabel = (i, t) => `Point ${i + 1}  ·  t=${t.toFixed(2)}`;
  const isEnd   = (i) => i === 0 || i === activePoints().length - 1;
  const restOpts = () => ({ headAngle: 0, steeringBend: 0, swimOsc: 0, length: PREVIEW_LEN, swimAmp: 0 });

  // Fit world-space rings (body + fins) into a canvas, preserving aspect (no
  // fish-stretch). Sets the canvas backing size; pad leaves room for the dots.
  function fitPoly(canvas, rings, pad = 10) {
    const W = canvas.clientWidth || 240, H = canvas.clientHeight || 90;
    canvas.width = W; canvas.height = H;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const ring of rings) for (const p of ring) {
      if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
    }
    const bw = maxX - minX || 1, bh = maxY - minY || 1;
    const sc = Math.min((W - pad * 2) / bw, (H - pad * 2) / bh);
    return { W, H, sc, ox: (W - bw * sc) / 2 - minX * sc, oy: (H - bh * sc) / 2 - minY * sc };
  }

  const strokePoly = (ctx2, poly, xf, fill, stroke) => {
    ctx2.beginPath();
    poly.forEach((p, i) => {
      const x = p.x * xf.sc + xf.ox, y = p.y * xf.sc + xf.oy;
      i ? ctx2.lineTo(x, y) : ctx2.moveTo(x, y);
    });
    ctx2.closePath();
    ctx2.fillStyle = fill; ctx2.fill();
    ctx2.strokeStyle = stroke; ctx2.lineWidth = 1; ctx2.stroke();
  };

  // Editor pane: the accurate RESTING silhouette + draggable control-point dots.
  // Dots sit on the real outline — centerline.at(t) offset by ±w along the normal.
  function redrawShapePreview() {
    const cre = liveCreature, pr = cre.spline.points;
    const body = buildBodyOutline(cre.spline, cre.motion, restOpts());
    const fins = buildAppendageOutlines(cre, restOpts());
    previewBase = fitPoly(shapePreview, [body, ...fins]);
    const xf = applyView(previewBase);
    previewXform = xf;
    const ctx2 = shapePreview.getContext('2d');
    ctx2.clearRect(0, 0, xf.W, xf.H);
    for (const fp of fins) strokePoly(ctx2, fp, xf, 'rgba(255,255,255,0.05)', 'rgba(255,255,255,0.20)');
    strokePoly(ctx2, body, xf, 'rgba(255,255,255,0.10)', 'rgba(255,255,255,0.30)');

    // When editing a fin, brighten that fin's outline so it's clear which one is active.
    if (!targetIsBody() && cre.appendages[editSel]) {
      const sel = buildAppendageOutlines(
        { spline: cre.spline, motion: cre.motion, appendages: [cre.appendages[editSel]] }, restOpts());
      for (const r of sel) strokePoly(ctx2, r, xf, 'rgba(0,210,255,0.10)', 'rgba(0,210,255,0.6)');
    }

    // Draggable dots on the active target (body outline, or the selected fin's outline).
    const tgt = activeFrames();
    tgt.pts.forEach(([a, w], i) => {
      const f = tgt.at(a);
      for (const sgn of [1, -1]) {
        const x = (f.x + f.nx * w * sgn) * xf.sc + xf.ox;
        const y = (f.y + f.ny * w * sgn) * xf.sc + xf.oy;
        ctx2.beginPath();
        ctx2.arc(x, y, i === selectedIdx ? 4 : 2.5, 0, Math.PI * 2);
        ctx2.fillStyle = i === selectedIdx
          ? (sgn > 0 ? 'rgb(0,210,255)' : 'rgba(0,210,255,0.5)')
          : (sgn > 0 ? 'rgba(255,255,255,0.5)' : 'rgba(255,255,255,0.25)');
        ctx2.fill();
      }
    });
  }

  // Live pane: the real fish swimming with a lazy S-weave, so the tail wiggle AND both
  // bends are visible. Runs only while the Shape section is open.
  let liveRAF = 0, livePhase = 0, livePrevTs = 0;
  function drawLivePreview(ts) {
    livePhase += (livePrevTs ? ts - livePrevTs : 16) * 0.004;
    livePrevTs = ts;
    const cre = liveCreature;
    const opts = {
      headAngle: 0,
      steeringBend: Math.sin(livePhase * 0.55) * WEAVE_BEND,
      swimOsc: Math.sin(livePhase),
      length: PREVIEW_LEN, swimAmp: 1,
    };
    const body = buildBodyOutline(cre.spline, cre.motion, opts);
    const fins = buildAppendageOutlines(cre, opts);
    const xf = fitPoly(shapeLive, [body, ...fins]);
    const ctx2 = shapeLive.getContext('2d');
    ctx2.clearRect(0, 0, xf.W, xf.H);
    for (const fp of fins) strokePoly(ctx2, fp, xf, 'rgba(0,210,255,0.08)', 'rgba(0,210,255,0.4)');
    strokePoly(ctx2, body, xf, 'rgba(0,210,255,0.10)', 'rgba(0,210,255,0.5)');
    liveRAF = requestAnimationFrame(drawLivePreview);
  }
  function setLivePreview(on) {
    if (on && !liveRAF) { livePrevTs = 0; liveRAF = requestAnimationFrame(drawLivePreview); }
    else if (!on && liveRAF) { cancelAnimationFrame(liveRAF); liveRAF = 0; }
  }

  function buildShapeSliders(idx) {
    shapeTHost.innerHTML = '';
    shapeWHost.innerHTML = '';
    const pr   = activePoints();
    const last = pr.length - 1;
    const endpoint = idx === 0 || idx === last;

    // First/last points are pinned to t=0 / t=1; interior t is bounded by neighbors.
    const tMin = idx === 0    ? 0 : pr[idx - 1][0] + T_GAP;
    const tMax = idx === last ? 1 : pr[idx + 1][0] - T_GAP;

    const tResult = makeRow({
      label: 't position',
      infoText: 'Where this point sits along the body: 0 = tail tip, 1 = snout. The first and last points are pinned at the ends.',
      decimals: 2, valueStep: 0.01, hasBounds: false,
      getVal: () => pr[idx][0],
      setVal: (v) => {
        pr[idx][0] = clamp(Math.round(v * 100) / 100, tMin, tMax);
        const opt = shapePointSel.options[idx];
        if (opt) opt.textContent = ptLabel(idx, pr[idx][0]);
        FishClass.CREATURE = liveCreature;
        redrawShapePreview();
        save();
      },
      getMin: () => tMin, getMax: () => tMax,
    });
    shapeTHost.appendChild(tResult.row);
    if (endpoint) {
      tResult.row.querySelector('input[type="range"]').disabled = true;
      tResult.row.querySelectorAll('.step-btn').forEach((b) => b.disabled = true);
      tResult.row.style.opacity = '0.4';
    }
    shapeTRow = tResult;

    const wResult = makeRow({
      label: 'Half-width',
      infoText: 'Body half-thickness at this point (mirrored top and bottom).',
      decimals: 2, valueStep: 0.01, hasBounds: false,
      getVal: () => pr[idx][1],
      setVal: (v) => {
        pr[idx][1] = clamp(Math.round(v * 100) / 100, 0, W_MAX);
        FishClass.CREATURE = liveCreature;
        redrawShapePreview();
        save();
      },
      getMin: () => 0, getMax: () => W_MAX,
    });
    shapeWHost.appendChild(wResult.row);
    shapeWRow = wResult;
  }

  // Enable/disable add/remove/nudge for the current selection. Endpoints are pinned:
  // they can't be removed or moved in t (keeps t=0 / t=1 always present).
  function updatePtButtons() {
    const last = activePoints().length - 1;
    btnAddLeft.disabled  = selectedIdx === 0;
    btnAddRight.disabled = selectedIdx === last;
    btnRemove.disabled   = isEnd(selectedIdx) || activePoints().length <= MIN_POINTS;
    btnPtLeft.disabled   = isEnd(selectedIdx);
    btnPtRight.disabled  = isEnd(selectedIdx);
  }

  function selectPoint(idx) {
    const last = activePoints().length - 1;
    selectedIdx = Math.max(0, Math.min(last, idx));
    shapePointSel.value = String(selectedIdx);
    buildShapeSliders(selectedIdx);
    updatePtButtons();
    redrawShapePreview();
  }

  // Refresh label + slider readouts + preview after a drag/nudge (no row rebuild).
  function syncSelected() {
    const pr = activePoints();
    const opt = shapePointSel.options[selectedIdx];
    if (opt) opt.textContent = ptLabel(selectedIdx, pr[selectedIdx][0]);
    shapeTRow?.sync();
    shapeWRow?.sync();
    redrawShapePreview();
  }

  function buildShapePointSel() {
    shapePointSel.innerHTML = '';
    activePoints().forEach(([t], i) => {
      const opt = document.createElement('option');
      opt.value = i;
      opt.textContent = ptLabel(i, t);
      shapePointSel.appendChild(opt);
    });
    shapePointSel.value = String(Math.min(selectedIdx, activePoints().length - 1));
  }

  // ── Point management ─────────────────────────────────────────────────────────
  const btnAddLeft  = panel.querySelector('#btn-pt-add-left');
  const btnAddRight = panel.querySelector('#btn-pt-add-right');
  const btnRemove   = panel.querySelector('#btn-pt-remove');
  const btnPtLeft   = panel.querySelector('#btn-pt-left');
  const btnPtRight  = panel.querySelector('#btn-pt-right');

  // Insert a point halfway (in BOTH t and half-width) toward the given neighbor.
  function addPoint(side) {
    const pr = activePoints();
    const nbr = selectedIdx + side;
    if (nbr < 0 || nbr >= pr.length) return;
    const newT = Math.round(((pr[selectedIdx][0] + pr[nbr][0]) / 2) * 100) / 100;
    const newW = Math.round(((pr[selectedIdx][1] + pr[nbr][1]) / 2) * 100) / 100;
    const insertAt = side < 0 ? selectedIdx : selectedIdx + 1;
    pr.splice(insertAt, 0, [newT, newW]);
    FishClass.CREATURE = liveCreature;
    buildShapePointSel();
    selectPoint(insertAt);
    save();
  }
  btnAddLeft.addEventListener('click',  () => addPoint(-1));
  btnAddRight.addEventListener('click', () => addPoint(+1));
  btnRemove.addEventListener('click', () => {
    const pr = activePoints();
    if (isEnd(selectedIdx) || pr.length <= MIN_POINTS) return;
    pr.splice(selectedIdx, 1);
    FishClass.CREATURE = liveCreature;
    buildShapePointSel();
    selectPoint(Math.min(selectedIdx, pr.length - 1));
    save();
  });

  // ── Arrow nudge cluster (intentionally redundant with the sliders) ───────────
  function nudge(dt, dw) {
    const pr = activePoints(), last = pr.length - 1, i = selectedIdx;
    if (dt && !isEnd(i)) {
      const tMin = pr[i - 1][0] + T_GAP, tMax = pr[i + 1][0] - T_GAP;
      pr[i][0] = clamp(Math.round((pr[i][0] + dt) * 100) / 100, tMin, tMax);
    }
    if (dw) pr[i][1] = clamp(Math.round((pr[i][1] + dw) * 100) / 100, 0, W_MAX);
    FishClass.CREATURE = liveCreature;
    syncSelected();
    save();
  }
  btnPtLeft.addEventListener('click',  () => nudge(-0.01, 0));
  btnPtRight.addEventListener('click', () => nudge(+0.01, 0));
  panel.querySelector('#btn-pt-up').addEventListener('click',   () => nudge(0, +0.05));
  panel.querySelector('#btn-pt-down').addEventListener('click', () => nudge(0, -0.05));

  // ── Edit target (Body / Fin N) ──────────────────────────────────────────────
  const btnFinAdd    = panel.querySelector('#btn-fin-add');
  const btnFinRemove = panel.querySelector('#btn-fin-remove');
  const commitFin = () => { FishClass.CREATURE = liveCreature; redrawShapePreview(); save(); };

  function buildTargetSel() {
    shapeTargetSel.innerHTML = '';
    const add = (val, label) => {
      const o = document.createElement('option'); o.value = String(val); o.textContent = label;
      shapeTargetSel.appendChild(o);
    };
    add('body', 'Body');
    liveCreature.appendages.forEach((_, i) => add(i, `Fin ${i + 1}`));
    shapeTargetSel.value = String(editSel);
  }

  // Fin placement sliders (only when a fin is the edit target). The fin's *shape* is
  // edited with the Point editor below, retargeted to its profile.
  function buildFinSliders() {
    shapeFinHost.innerHTML = '';
    btnFinRemove.disabled = targetIsBody();
    if (targetIsBody()) return;
    const fin = liveCreature.appendages[editSel];
    const mk = (cfg) => shapeFinHost.appendChild(makeRow({ hasBounds: false, ...cfg }).row);
    const chk = (label, get, set) => {
      const row = document.createElement('label'); row.className = 'menu-row';
      row.innerHTML = `<span>${label}</span><input type="checkbox">`;
      const c = row.querySelector('input'); c.checked = get();
      c.addEventListener('change', (e) => set(e.target.checked));
      shapeFinHost.appendChild(row); return c;
    };

    chk('Centered', () => (fin.side ?? 1) === 0, (on) => {
      fin.side = on ? 0 : 1; if (on) fin.mirror = false; commitFin(); buildFinSliders();
    });
    const mirrorChk = chk('Mirror pair', () => !!fin.mirror, (on) => { fin.mirror = on; commitFin(); });
    mirrorChk.disabled = (fin.side ?? 1) === 0;

    mk({ label: 'Anchor', infoText: 'Where the fin roots along the body (0 = tail, 1 = snout).',
      decimals: 2, valueStep: 0.01, getVal: () => fin.anchor, getMin: () => 0, getMax: () => 1,
      setVal: (v) => { fin.anchor = clamp(Math.round(v * 100) / 100, 0, 1); commitFin(); } });
    mk({ label: 'Angle', infoText: 'Sweep: 0 = straight out the side, 90 = straight back (tailward).',
      decimals: 0, valueStep: 1, getVal: () => fin.angle, getMin: () => 0, getMax: () => 180,
      setVal: (v) => { fin.angle = clamp(Math.round(v), 0, 180); commitFin(); } });
    mk({ label: 'Length', infoText: 'Fin length in world units.',
      decimals: 1, valueStep: 0.5, getVal: () => fin.length, getMin: () => 1, getMax: () => 15,
      setVal: (v) => { fin.length = clamp(v, 1, 15); commitFin(); } });
    mk({ label: 'Sway on turn', infoText: 'How much the fin deflects when the fish turns (see the live pane).',
      decimals: 2, valueStep: 0.05, getVal: () => fin.swayOnTurn || 0, getMin: () => 0, getMax: () => 2,
      setVal: (v) => { fin.swayOnTurn = clamp(v, 0, 2); commitFin(); } });
    mk({ label: 'Flap on accel', infoText: 'Degrees the fin flaps while swimming (see the live pane).',
      decimals: 0, valueStep: 1, getVal: () => fin.flapOnAccel?.amp || 0, getMin: () => 0, getMax: () => 45,
      setVal: (v) => { (fin.flapOnAccel ??= {}).amp = clamp(Math.round(v), 0, 45); commitFin(); } });
  }

  function selectTarget(sel) {
    editSel = sel;
    selectedIdx = 0;
    buildFinSliders();
    buildShapePointSel();
    selectPoint(0);
  }

  shapeTargetSel.addEventListener('change', () => {
    const v = shapeTargetSel.value;
    selectTarget(v === 'body' ? 'body' : parseInt(v, 10));
  });
  btnFinAdd.addEventListener('click', () => {
    liveCreature.appendages.push({
      kind: 'fin', anchor: 0.78, side: 1, mirror: true, angle: 35, length: 4,
      swayOnTurn: 0.4, flapOnAccel: { amp: 12 }, profile: [[0.0, 0.2], [0.5, 1.1], [1.0, 0.5]],
    });
    FishClass.CREATURE = liveCreature;
    buildTargetSel();
    selectTarget(liveCreature.appendages.length - 1);
    save();
  });
  btnFinRemove.addEventListener('click', () => {
    if (targetIsBody()) return;
    liveCreature.appendages.splice(editSel, 1);
    FishClass.CREATURE = liveCreature;
    buildTargetSel();
    selectTarget('body');
    save();
  });

  buildTargetSel();
  selectTarget('body');

  shapePointSel.addEventListener('change', () => selectPoint(parseInt(shapePointSel.value, 10)));

  // ── Click / drag points on the editor pane ───────────────────────────────────
  // Both hit-testing and dragging go through the centerline + the editor's fit
  // transform, so dots sit on (and follow) the real silhouette.
  const pickPoint = (px, py) => {
    const tgt = activeFrames(), xf = previewXform;
    let best = -1, bestD = 14 * 14;   // 14px pick radius (squared)
    tgt.pts.forEach(([a, w], i) => {
      const f = tgt.at(a);
      for (const sgn of [1, -1]) {
        const x = (f.x + f.nx * w * sgn) * xf.sc + xf.ox;
        const y = (f.y + f.ny * w * sgn) * xf.sc + xf.oy;
        const d = (px - x) ** 2 + (py - y) ** 2;
        if (d < bestD) { bestD = d; best = i; }
      }
    });
    return best;
  };

  const dragTo = (px, py) => {
    const tgt = activeFrames(), pr = tgt.pts, i = selectedIdx, xf = previewXform;
    const wx = (px - xf.ox) / xf.sc, wy = (py - xf.oy) / xf.sc;   // canvas → world
    let a = pr[i][0];
    if (!isEnd(i)) {
      // Interior: snap the param to the nearest point along the active spine.
      let bestA = a, bestD = Infinity;
      for (let s = 0; s <= 200; s++) {
        const aa = s / 200, f = tgt.at(aa), d = (f.x - wx) ** 2 + (f.y - wy) ** 2;
        if (d < bestD) { bestD = d; bestA = aa; }
      }
      a = clamp(Math.round(bestA * 100) / 100, pr[i - 1][0] + T_GAP, pr[i + 1][0] - T_GAP);
      pr[i][0] = a;
    }
    const f = tgt.at(a);
    const w = Math.abs((wx - f.x) * f.nx + (wy - f.y) * f.ny);   // perpendicular distance
    pr[i][1] = clamp(Math.round(w * 100) / 100, 0, W_MAX);
    FishClass.CREATURE = liveCreature;
    syncSelected();
  };

  // Zoom helpers. clampView keeps pan sane and snaps back to centered at zoom 1.
  function clampView() {
    editorView.zoom = clamp(editorView.zoom, 1, EDIT_ZMAX);
    if (editorView.zoom <= 1.0001) { editorView.zoom = 1; editorView.panX = 0; editorView.panY = 0; }
  }
  function zoomAround(px, py, factor) {
    const z0 = editorView.zoom, z1 = clamp(z0 * factor, 1, EDIT_ZMAX);
    if (z1 === z0) return;
    // Keep the world point under (px,py) fixed across the zoom.
    const b = previewBase, W = shapePreview.width, H = shapePreview.height;
    const eff = previewXform;
    const wx = (px - eff.ox) / eff.sc, wy = (py - eff.oy) / eff.sc;
    editorView.zoom = z1;
    editorView.panX = px - wx * (b.sc * z1) - ((W / 2) * (1 - z1) + b.ox * z1);
    editorView.panY = py - wy * (b.sc * z1) - ((H / 2) * (1 - z1) + b.oy * z1);
    clampView();
    redrawShapePreview();
  }

  let dragging = false, panning = false, panStart = null;
  shapePreview.addEventListener('pointerdown', (e) => {
    const rect = shapePreview.getBoundingClientRect();
    const px = e.clientX - rect.left, py = e.clientY - rect.top;
    const hit = pickPoint(px, py);   // body points or the selected fin's profile points
    if (hit < 0) {
      // Empty space while zoomed in → pan the view.
      if (editorView.zoom > 1) {
        panning = true;
        panStart = { px, py, panX: editorView.panX, panY: editorView.panY };
        shapePreview.setPointerCapture(e.pointerId);
        e.preventDefault();
      }
      return;
    }
    // First click only selects; you drag the already-selected point to move it.
    if (hit !== selectedIdx) { selectPoint(hit); return; }
    dragging = true;
    shapePreview.setPointerCapture(e.pointerId);
    dragTo(px, py);
    e.preventDefault();
  });
  shapePreview.addEventListener('pointermove', (e) => {
    const rect = shapePreview.getBoundingClientRect();
    const px = e.clientX - rect.left, py = e.clientY - rect.top;
    if (panning) {
      editorView.panX = panStart.panX + (px - panStart.px);
      editorView.panY = panStart.panY + (py - panStart.py);
      redrawShapePreview();
    } else if (dragging) {
      dragTo(px, py);
    }
  });
  const endDrag = (e) => {
    if (panning) { panning = false; try { shapePreview.releasePointerCapture(e.pointerId); } catch { /**/ } return; }
    if (!dragging) return;
    dragging = false;
    try { shapePreview.releasePointerCapture(e.pointerId); } catch { /* not captured */ }
    save();
  };
  shapePreview.addEventListener('pointerup', endDrag);
  shapePreview.addEventListener('pointercancel', endDrag);

  // Wheel zooms toward the cursor; double-click resets to fit.
  shapePreview.addEventListener('wheel', (e) => {
    e.preventDefault();
    const rect = shapePreview.getBoundingClientRect();
    zoomAround(e.clientX - rect.left, e.clientY - rect.top, e.deltaY < 0 ? 1.2 : 1 / 1.2);
  }, { passive: false });
  shapePreview.addEventListener('dblclick', (e) => {
    e.preventDefault();
    editorView.zoom = 1; editorView.panX = 0; editorView.panY = 0;
    redrawShapePreview();
  });

  // Zoom buttons (centered) + Fit — discoverable alongside wheel/drag.
  panel.querySelector('#btn-zoom-out').addEventListener('click', () =>
    zoomAround(shapePreview.width / 2, shapePreview.height / 2, 1 / 1.4));
  panel.querySelector('#btn-zoom-in').addEventListener('click', () =>
    zoomAround(shapePreview.width / 2, shapePreview.height / 2, 1.4));
  panel.querySelector('#btn-zoom-fit').addEventListener('click', () => {
    editorView.zoom = 1; editorView.panX = 0; editorView.panY = 0;
    redrawShapePreview();
  });

  // ── Proportion sliders (editor pane) + motion sliders (live pane) ────────────
  const mkSpine = (host, sp) => {
    const { row } = makeRow({
      label: sp.label, infoText: sp.info, decimals: 3, valueStep: 0.001, hasBounds: false,
      getVal: () => liveCreature[sp.obj][sp.key],
      setVal: (v) => {
        liveCreature[sp.obj][sp.key] = Math.round(v * 1000) / 1000;
        FishClass.CREATURE = liveCreature;
        redrawShapePreview();
        save();
      },
      getMin: () => sp.min, getMax: () => sp.max,
    });
    host.appendChild(row);
  };
  // Resting-shape proportions — visible in the editor pane.
  [
    { obj: 'spline', key: 'headFrac',  label: 'Head offset', min: 0.10, max: 0.80,
      info: 'How far the snout reaches ahead of center, as a fraction of length. Larger = longer front half.' },
    { obj: 'spline', key: 'tailFrac',  label: 'Tail offset', min: 0.10, max: 0.90,
      info: 'How far the tail tip reaches behind center. Larger = longer back half. (Head + Tail ≈ total nose-to-tail length.)' },
    { obj: 'spline', key: 'waistFrac', label: 'Waist',       min: 0.05, max: 0.60,
      info: 'Where the neck between body and tail sits, and where the tail section meets the body. Larger = waist further forward.' },
  ].forEach((sp) => mkSpine(shapePropHost, sp));
  // Motion — only visible in the live pane (wiggle while swimming; bends while turning).
  [
    { obj: 'motion', key: 'swishAmp',  label: 'Tail wiggle', min: 0.00, max: 0.50,
      info: 'How far the tail swings side-to-side while swimming. Only shows in the live pane. 0 = stiff tail.' },
    { obj: 'spline', key: 'bendWaist', label: 'Waist bend',  min: 0.00, max: 0.50,
      info: 'How much the waist bows sideways when the fish turns. Shown by the live pane’s weave. 0 = stays straight.' },
    { obj: 'spline', key: 'bendBody',  label: 'Body bend',   min: 0.00, max: 0.50,
      info: 'How much the mid-body bows when turning — with Waist bend it shapes the turning C-curve. Shown in the live pane.' },
  ].forEach((sp) => mkSpine(shapeMotionHost, sp));

  // Copy values — emit the live CreatureDef as JSON (paste into a class override).
  panel.querySelector('#btn-copy-shape').addEventListener('click', async () => {
    const snippet = JSON.stringify(liveCreature, null, 2);
    const copyBtn = panel.querySelector('#btn-copy-shape');
    try { await navigator.clipboard.writeText(snippet); }
    catch { console.log(snippet); }
    const prev = copyBtn.textContent;
    copyBtn.textContent = 'Copied!';
    setTimeout(() => { copyBtn.textContent = prev; }, 1200);
  });

  // Reset shape
  panel.querySelector('#btn-reset-shape').addEventListener('click', () => {
    liveCreature = JSON.parse(JSON.stringify(defaultCreature));
    FishClass.CREATURE = liveCreature;
    editSel = 'body';
    buildTargetSel();
    selectTarget('body');
    save();
  });

  // Shape section open → draw the editor pane (canvas may have been 0-size when hidden)
  // and run the live pane; closed → pause the live loop.
  panel.querySelector('#shape-preview').closest('details').addEventListener('toggle', (e) => {
    if (e.target.open) { redrawShapePreview(); setLivePreview(true); }
    else setLivePreview(false);
  });

  // ── Build display sliders (grid knobs) ────────────────────────────────────────
  const displayHost = panel.querySelector('#display-sliders');

  const { row: densityRow } = makeRow({
    label: 'Density',
    infoText: 'Density: display cells per world unit (render fidelity). Higher = smoother, finer pixels — fish size, count, and speed are unchanged. Default 2.',
    decimals: 2,
    valueStep: 0.25,
    hasBounds: false,
    getVal: () => grid.density,
    setVal: (v) => { grid.density = clamp(v, DENSITY_RANGE.min, DENSITY_RANGE.max); applyGrid(); },
    getMin: () => DENSITY_RANGE.min,
    getMax: () => DENSITY_RANGE.max,
  });
  displayHost.appendChild(densityRow);

  const ZOOM_BASE = 120;
  const { row: worldRow } = makeRow({
    label: 'Zoom',
    infoText: 'Zoom: higher = fish appear bigger. Internally sets world units across the short edge (120 / zoom). Default 1.0.',
    decimals: 2,
    valueStep: 0.05,
    hasBounds: false,
    getVal: () => ZOOM_BASE / grid.worldShortEdge,
    setVal: (v) => {
      grid.worldShortEdge = clamp(Math.round(ZOOM_BASE / Math.max(v, 0.01)), WORLD_RANGE.min, WORLD_RANGE.max);
      applyGrid();
    },
    getMin: () => ZOOM_BASE / WORLD_RANGE.max,
    getMax: () => ZOOM_BASE / WORLD_RANGE.min,
  });
  displayHost.appendChild(worldRow);

  // ── Water controls ───────────────────────────────────────────────────────────
  if (rippleField) {
    const waterSliderHost  = panel.querySelector('#water-sliders');
    const waterEnableToggle = panel.querySelector('#toggle-water-enabled');
    const waterSmoothToggle = panel.querySelector('#toggle-water-smooth');

    waterEnableToggle.checked = rippleField.enabled;
    waterSmoothToggle.checked = rippleField.smooth;

    waterEnableToggle.addEventListener('change', (e) => { rippleField.enabled = e.target.checked; save(); });
    waterSmoothToggle.addEventListener('change', (e) => { rippleField.smooth  = e.target.checked; save(); });

    // Collect each row's sync() so Reset/Paste can refresh every displayed value.
    const waterRowSyncs = [];
    const mkW = (cfg) => {
      const { row, sync } = makeRow({ hasBounds: false, ...cfg });
      waterSliderHost.appendChild(row);
      waterRowSyncs.push(sync);
    };
    const syncWaterUI = () => {
      waterEnableToggle.checked = rippleField.enabled;
      waterSmoothToggle.checked = rippleField.smooth;
      waterRowSyncs.forEach((s) => s());
    };

    mkW({
      label: 'Damping', decimals: 3, valueStep: 0.001,
      infoText: 'How far ripples travel before fading. Higher = longer-lived.',
      getVal: () => rippleField.damping, getMin: () => 0.80, getMax: () => 0.999,
      setVal: (v) => { rippleField.damping = clamp(v, 0.80, 0.999); save(); },
    });
    mkW({
      label: 'Wave speed', decimals: 2, valueStep: 0.01,
      infoText: 'How fast rings travel outward. 0.5 is the fastest stable value.',
      getVal: () => rippleField.speed, getMin: () => 0.05, getMax: () => 0.5,
      setVal: (v) => { rippleField.speed = clamp(v, 0.05, 0.5); save(); },
    });
    mkW({
      label: 'Tap strength', decimals: 1, valueStep: 0.1,
      infoText: 'Amplitude of the disturbance dropped by a tap.',
      getVal: () => rippleField.strength, getMin: () => 0.1, getMax: () => 5.0,
      setVal: (v) => { rippleField.strength = clamp(v, 0.1, 5.0); save(); },
    });
    mkW({
      label: 'Tap size', decimals: 1, valueStep: 0.5,
      infoText: 'Radius of the tap splash in cells. Larger = smoother; 0 is a single-cell point tap.',
      getVal: () => rippleField.tapRadius, getMin: () => 0, getMax: () => 6,
      setVal: (v) => { rippleField.tapRadius = clamp(v, 0, 6); save(); },
    });
    mkW({
      label: 'Brightness', decimals: 0, valueStep: 10,
      infoText: 'Maps wave amplitude to on-screen opacity.',
      getVal: () => rippleField.gain, getMin: () => 20, getMax: () => 600,
      setVal: (v) => { rippleField.gain = clamp(Math.round(v), 20, 600); save(); },
    });
    mkW({
      label: 'Resolution', decimals: 0, valueStep: 20,
      infoText: 'Sim grid long-edge in cells. Higher = crisper, thinner rings.',
      getVal: () => rippleField.maxDim, getMin: () => 60, getMax: () => 400,
      setVal: (v) => { rippleField.maxDim = clamp(Math.round(v), 60, 400); rippleField.resize(); save(); },
    });
    mkW({
      label: 'Color R', decimals: 0, valueStep: 1,
      getVal: () => rippleField.color[0], getMin: () => 0, getMax: () => 255,
      setVal: (v) => { rippleField.color[0] = clamp(Math.round(v), 0, 255); save(); },
    });
    mkW({
      label: 'Color G', decimals: 0, valueStep: 1,
      getVal: () => rippleField.color[1], getMin: () => 0, getMax: () => 255,
      setVal: (v) => { rippleField.color[1] = clamp(Math.round(v), 0, 255); save(); },
    });
    mkW({
      label: 'Color B', decimals: 0, valueStep: 1,
      getVal: () => rippleField.color[2], getMin: () => 0, getMax: () => 255,
      setVal: (v) => { rippleField.color[2] = clamp(Math.round(v), 0, 255); save(); },
    });
    mkW({
      label: 'Wake strength', decimals: 2, valueStep: 0.05,
      getVal: () => rippleField.wakeStrength, getMin: () => 0, getMax: () => 5.0,
      setVal: (v) => { rippleField.wakeStrength = clamp(v, 0, 5.0); save(); },
    });
    mkW({
      label: 'Wake spacing', decimals: 1, valueStep: 0.5,
      getVal: () => rippleField.wakeSpacing, getMin: () => 0.5, getMax: () => 20,
      setVal: (v) => { rippleField.wakeSpacing = clamp(v, 0.5, 20); save(); },
    });

    // ── Reset / Copy / Paste ─────────────────────────────────────────────────
    const flash = (btn, msg) => {
      const prev = btn.textContent;
      btn.textContent = msg;
      setTimeout(() => { btn.textContent = prev; }, 1200);
    };

    const waterResetBtn = panel.querySelector('#btn-water-reset');
    waterResetBtn.addEventListener('click', () => {
      applyWaterSettings(WATER_DEFAULTS);
      syncWaterUI();
      save();
    });

    const waterCopyBtn = panel.querySelector('#btn-water-copy');
    waterCopyBtn.addEventListener('click', async () => {
      const json = JSON.stringify(waterSnapshot(), null, 2);
      try { await navigator.clipboard.writeText(json); flash(waterCopyBtn, 'Copied!'); }
      catch { console.log('[koi water]\n' + json); flash(waterCopyBtn, 'Logged'); }
    });

    const waterPasteBtn = panel.querySelector('#btn-water-paste');
    waterPasteBtn.addEventListener('click', async () => {
      let text;
      try { text = await navigator.clipboard.readText(); }
      catch { flash(waterPasteBtn, 'No access'); return; }
      let parsed;
      try { parsed = JSON.parse(text); }
      catch { flash(waterPasteBtn, 'Bad data'); return; }
      if (applyWaterSettings(parsed)) { syncWaterUI(); save(); flash(waterPasteBtn, 'Pasted!'); }
      else flash(waterPasteBtn, 'Bad data');
    });
  }

  // ── Border controls ──────────────────────────────────────────────────────────
  const borderHost   = panel.querySelector('#border-sliders');
  const borderToggle = panel.querySelector('#toggle-border');
  borderToggle.checked = grid.border.enabled;
  borderToggle.addEventListener('change', (e) => { grid.border.enabled = e.target.checked; save(); });

  const hardBorderToggle = panel.querySelector('#toggle-hard-border');
  hardBorderToggle.checked = FishClass.HARD_BORDER;
  hardBorderToggle.addEventListener('change', (e) => { FishClass.HARD_BORDER = e.target.checked; save(); });

  const glassEdgeToggle = panel.querySelector('#toggle-glass-edge');
  glassEdgeToggle.checked = compositor.glassEdge;
  glassEdgeToggle.addEventListener('change', (e) => { compositor.setGlassEdge(e.target.checked); save(); });

  const { row: borderWidthRow } = makeRow({
    label: 'Width',
    infoText: 'Width: border thickness in world units. 1 = one logical pixel wide.',
    decimals: 1,
    valueStep: 0.5,
    hasBounds: false,
    getVal: () => grid.border.width,
    setVal: (v) => { grid.border.width = clamp(v, 0.5, 10); },
    getMin: () => 0.5,
    getMax: () => 10,
  });
  borderHost.appendChild(borderWidthRow);

  const { row: borderOpacityRow } = makeRow({
    label: 'Opacity',
    infoText: 'Opacity: border visibility. 0 = invisible, 1 = fully white.',
    decimals: 2,
    valueStep: 0.05,
    hasBounds: false,
    getVal: () => grid.border.opacity,
    setVal: (v) => { grid.border.opacity = clamp(v, 0, 1); save(); },
    getMin: () => 0,
    getMax: () => 1,
  });
  borderHost.appendChild(borderOpacityRow);

  const { row: borderChromaticRow } = makeRow({
    label: 'Chromatic', decimals: 1, valueStep: 0.5,
    hasBounds: false,
    getVal: () => compositor.borderChromatic,
    setVal: (v) => { compositor.setGlassEdge(compositor.glassEdge, { chromatic: clamp(v, 0, 20) }); save(); },
    getMin: () => 0, getMax: () => 20,
  });
  borderHost.appendChild(borderChromaticRow);

  const { row: borderRefrRow } = makeRow({
    label: 'Refraction', decimals: 3, valueStep: 0.001,
    hasBounds: false,
    getVal: () => compositor.borderRefr,
    setVal: (v) => { compositor.setGlassEdge(compositor.glassEdge, { refraction: clamp(v, 0, 0.04) }); save(); },
    getMin: () => 0, getMax: () => 0.04,
  });
  borderHost.appendChild(borderRefrRow);

  const { row: borderBevelRow } = makeRow({
    label: 'Bevel depth', decimals: 3, valueStep: 0.001,
    hasBounds: false,
    getVal: () => compositor.borderBevel,
    setVal: (v) => { compositor.setGlassEdge(compositor.glassEdge, { bevelDepth: clamp(v, 0, 0.08) }); save(); },
    getMin: () => 0, getMax: () => 0.08,
  });
  borderHost.appendChild(borderBevelRow);

  const borderSpecularRow = document.createElement('label');
  borderSpecularRow.className = 'menu-row';
  borderSpecularRow.innerHTML = '<span>Specular</span><input type="checkbox">';
  const borderSpecularChk = borderSpecularRow.querySelector('input');
  borderSpecularChk.checked = compositor.borderSpecular;
  borderSpecularChk.addEventListener('change', (e) => {
    compositor.setGlassEdge(compositor.glassEdge, { specular: e.target.checked });
    save();
  });
  borderHost.appendChild(borderSpecularRow);

  const specModeRow = document.createElement('label');
  specModeRow.className = 'menu-row';
  specModeRow.innerHTML = '<span>Spec mode</span><select class="menu-select"><option value="2">Static field</option><option value="1">Animated</option></select>';
  const specModeSel = specModeRow.querySelector('select');
  specModeSel.value = String(compositor.specularMode);
  specModeSel.addEventListener('change', (e) => {
    compositor.setGlassEdge(compositor.glassEdge, { specularMode: parseInt(e.target.value, 10) });
    save();
  });
  borderHost.appendChild(specModeRow);

  const { row: specCurveRow } = makeRow({
    label: 'Spec curve', decimals: 3, valueStep: 0.005,
    hasBounds: false,
    getVal: () => compositor.specularCurve,
    setVal: (v) => { compositor.setGlassEdge(compositor.glassEdge, { specularCurve: clamp(v, 0, 0.10) }); save(); },
    getMin: () => 0, getMax: () => 0.10,
  });
  borderHost.appendChild(specCurveRow);

  // ── Glass shapes ─────────────────────────────────────────────────────────────
  // Draggable glass lenses on the render layer. The select + sliders drive the
  // currently-selected shape; dragging on canvas moves it (see main.js).
  const glassSel        = panel.querySelector('#glass-shape-sel');
  const glassSliderHost = panel.querySelector('#glass-shape-sliders');

  function refreshGlassSel() {
    glassSel.innerHTML = '';
    glassShapes.list.forEach((_, i) => addOption(glassSel, i, `Shape ${i + 1}`));
    if (glassShapes.selected >= 0) glassSel.value = String(glassShapes.selected);
  }

  function buildGlassSliders() {
    glassSliderHost.innerHTML = '';
    const s = glassShapes.current;
    if (!s) return;
    const mk = (cfg) => glassSliderHost.appendChild(makeRow({ hasBounds: false, ...cfg }).row);

    mk({
      label: 'Radius', decimals: 2, valueStep: 0.01,
      getVal: () => s.radius, getMin: () => 0.02, getMax: () => 0.6,
      setVal: (v) => { s.radius = clamp(v, 0.02, 0.6); glassShapes.sync(); save(); },
    });
    mk({
      label: 'Bevel width', decimals: 2, valueStep: 0.01,
      getVal: () => s.bevelWidth, getMin: () => 0.05, getMax: () => 1.0,
      setVal: (v) => { s.bevelWidth = clamp(v, 0.05, 1.0); glassShapes.sync(); save(); },
    });
    mk({
      label: 'Refraction', decimals: 3, valueStep: 0.001,
      getVal: () => s.refraction, getMin: () => 0, getMax: () => 0.05,
      setVal: (v) => { s.refraction = clamp(v, 0, 0.05); glassShapes.sync(); save(); },
    });
    mk({
      label: 'Bevel depth', decimals: 3, valueStep: 0.001,
      getVal: () => s.bevelDepth, getMin: () => 0, getMax: () => 0.10,
      setVal: (v) => { s.bevelDepth = clamp(v, 0, 0.10); glassShapes.sync(); save(); },
    });
    mk({
      label: 'Chromatic', decimals: 1, valueStep: 0.5,
      getVal: () => s.chromatic, getMin: () => 0, getMax: () => 20,
      setVal: (v) => { s.chromatic = clamp(v, 0, 20); glassShapes.sync(); save(); },
    });
    mk({
      label: 'Frost', decimals: 1, valueStep: 0.5,
      getVal: () => s.frost, getMin: () => 0, getMax: () => 8,
      setVal: (v) => { s.frost = clamp(v, 0, 8); glassShapes.sync(); save(); },
    });
    mk({
      label: 'Magnify', decimals: 2, valueStep: 0.05,
      getVal: () => s.magnify, getMin: () => 0.5, getMax: () => 3.0,
      setVal: (v) => { s.magnify = clamp(v, 0.5, 3.0); glassShapes.sync(); save(); },
    });

    // Specular toggle (checkbox, not a slider)
    const specRow = document.createElement('label');
    specRow.className = 'menu-row';
    specRow.innerHTML = '<span>Specular</span><input type="checkbox">';
    const specChk = specRow.querySelector('input');
    specChk.checked = !!s.specular;
    specChk.addEventListener('change', (e) => {
      s.specular = e.target.checked;
      glassShapes.sync();
      save();
    });
    glassSliderHost.appendChild(specRow);

    // Specular rings — up to 2, each with inner %, outer %, and strength.
    const ringsHost = document.createElement('div');
    ringsHost.className = 'spec-rings';
    glassSliderHost.appendChild(ringsHost);

    function buildRingSliders() {
      ringsHost.innerHTML = '';
      const rings = s.specRings ?? [];
      rings.forEach((ring, ri) => {
        const block = document.createElement('div');
        block.className = 'spec-ring-block';
        const header = document.createElement('div');
        header.className = 'spec-ring-header';
        const lbl = document.createElement('span');
        lbl.textContent = `Ring ${ri + 1}`;
        const delBtn = document.createElement('button');
        delBtn.className = 'spec-ring-del';
        delBtn.textContent = '×';
        delBtn.addEventListener('click', () => {
          s.specRings = rings.filter((_, j) => j !== ri);
          glassShapes.sync(); save(); buildRingSliders();
        });
        header.appendChild(lbl);
        header.appendChild(delBtn);
        block.appendChild(header);
        const rmk = cfg => block.appendChild(makeRow({ hasBounds: false, ...cfg }).row);
        rmk({
          label: 'Strength', decimals: 2, valueStep: 0.05,
          getVal: () => ring.strength, getMin: () => 0, getMax: () => 2.0,
          setVal: v => { ring.strength = clamp(v, 0, 2.0); glassShapes.sync(); save(); },
        });
        rmk({
          label: 'Inner %', decimals: 2, valueStep: 0.01,
          getVal: () => ring.inner, getMin: () => 0, getMax: () => 1.0,
          setVal: v => { ring.inner = clamp(v, 0, ring.outer - 0.05); glassShapes.sync(); save(); },
        });
        rmk({
          label: 'Outer %', decimals: 2, valueStep: 0.01,
          getVal: () => ring.outer, getMin: () => 0, getMax: () => 1.0,
          setVal: v => { ring.outer = clamp(v, ring.inner + 0.05, 1.0); glassShapes.sync(); save(); },
        });
        ringsHost.appendChild(block);
      });
      if (rings.length < 2) {
        const addBtn = document.createElement('button');
        addBtn.className = 'menu-action';
        addBtn.style.marginTop = '4px';
        addBtn.textContent = '+ Add ring';
        addBtn.addEventListener('click', () => {
          if (!s.specRings) s.specRings = [];
          s.specRings.push({ inner: 0.0, outer: 0.6, strength: 0.5 });
          glassShapes.sync(); save(); buildRingSliders();
        });
        ringsHost.appendChild(addBtn);
      }
    }
    buildRingSliders();

    // Wander toggle
    const wanderRow = document.createElement('label');
    wanderRow.className = 'menu-row';
    wanderRow.innerHTML = '<span>Wander</span><input type="checkbox">';
    const wanderChk = wanderRow.querySelector('input');
    wanderChk.checked = !!s.wander;
    wanderChk.addEventListener('change', (e) => {
      s.wander = e.target.checked;
      if (s.wander) {
        const angle = Math.random() * Math.PI * 2;
        s._vx    = Math.cos(angle) * s.wanderSpeed;
        s._vy    = Math.sin(angle) * s.wanderSpeed;
        s._vOmega = 0;
      } else {
        s._vx = null; s._vy = null; s._vOmega = null;
      }
      glassShapes.sync();
      save();
    });
    glassSliderHost.appendChild(wanderRow);

    mk({
      label: 'Speed', decimals: 3, valueStep: 0.005,
      getVal: () => s.wanderSpeed, getMin: () => 0.005, getMax: () => 0.05,
      setVal: (v) => { s.wanderSpeed = clamp(v, 0.005, 0.05); save(); },
    });

    // Copy / Paste shader params
    const COPY_SCALAR_KEYS = ['radius','bevelWidth','refraction','bevelDepth',
                              'chromatic','frost','magnify','specular'];
    const cpRow = document.createElement('div');
    cpRow.className = 'menu-btn-row';

    const copyBtn = document.createElement('button');
    copyBtn.className = 'menu-action';
    copyBtn.textContent = 'Copy params';
    copyBtn.addEventListener('click', () => {
      const out = {};
      for (const k of COPY_SCALAR_KEYS) out[k] = s[k];
      out.specRings = JSON.parse(JSON.stringify(s.specRings ?? []));
      navigator.clipboard.writeText(JSON.stringify(out, null, 2)).catch(() => {});
    });

    const pasteBtn = document.createElement('button');
    pasteBtn.className = 'menu-action';
    pasteBtn.textContent = 'Paste params';
    pasteBtn.addEventListener('click', () => {
      navigator.clipboard.readText().then(text => {
        try {
          const p = JSON.parse(text);
          const bounds = {
            radius:[0.02,0.6], bevelWidth:[0.05,1], refraction:[0,0.05],
            bevelDepth:[0,0.10], chromatic:[0,20], frost:[0,8], magnify:[0.5,3],
          };
          for (const [k,[lo,hi]] of Object.entries(bounds)) {
            if (Number.isFinite(p[k])) s[k] = clamp(p[k], lo, hi);
          }
          if (typeof p.specular === 'boolean') s.specular = p.specular;
          if (Array.isArray(p.specRings)) {
            s.specRings = p.specRings.slice(0, 2).map(r => ({
              inner:    clamp(Number.isFinite(r?.inner)    ? r.inner    : 0.7, 0, 1),
              outer:    clamp(Number.isFinite(r?.outer)    ? r.outer    : 1.0, 0, 1),
              strength: clamp(Number.isFinite(r?.strength) ? r.strength : 1.0, 0, 2),
            }));
          }
          glassShapes.sync();
          buildGlassSliders();
          save();
        } catch (_) {}
      }).catch(() => {});
    });

    cpRow.appendChild(copyBtn);
    cpRow.appendChild(pasteBtn);
    glassSliderHost.appendChild(cpRow);
  }

  function refreshGlassUI() { refreshGlassSel(); buildGlassSliders(); }

  glassShapes.onChange  = refreshGlassUI;
  glassShapes.onPersist = save;
  refreshGlassUI();

  glassSel.addEventListener('change', (e) => {
    glassShapes.select(parseInt(e.target.value, 10));
  });
  panel.querySelector('#glass-add').addEventListener('click', () => {
    if (glassShapes.add()) save();
  });
  panel.querySelector('#glass-remove').addEventListener('click', () => {
    if (glassShapes.selected >= 0) { glassShapes.remove(glassShapes.selected); save(); }
  });

  // ── Key-nav: rebuild focus list whenever a <details> section opens/closes ────
  if (keyNav) {
    panel.querySelectorAll('details').forEach(det => {
      det.addEventListener('toggle', () => {
        if (keyNav.mode === 'menu') keyNav.buildFocusList();
      });
    });
  }

  // ── Copy / Reset ─────────────────────────────────────────────────────────────
  const copyBtn = panel.querySelector('#btn-copy-tuning');
  copyBtn.addEventListener('click', async () => {
    const snippet = toCodeSnippet(FishClass);
    try { await navigator.clipboard.writeText(snippet); }
    catch { console.log('[koi tuning]\n' + snippet); }   // fallback if clipboard blocked
    const prev = copyBtn.textContent;
    copyBtn.textContent = 'Copied!';
    setTimeout(() => { copyBtn.textContent = prev; }, 1200);
  });

  panel.querySelector('#btn-reset-tuning').addEventListener('click', () => {
    applyValues(FishClass, defaults);
    const dr = defaultRanges();
    for (const p of MOVEMENT_PARAMS) {
      ranges[p.key].min = dr[p.key].min;
      ranges[p.key].max = dr[p.key].max;
      FishClass[p.key] = clamp(FishClass[p.key], ranges[p.key].min, ranges[p.key].max);
      rowSyncs[p.key]();
    }
    save();
  });

  // ── Interactions ────────────────────────────────────────────────────────────

  // Idle-fade: button fades out after 3s of no touch; any touch brings it back.
  let hideTimer = null;

  function showBtn() {
    btn.classList.remove('faded');
  }

  function scheduleHide() {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => { if (panel.hidden) btn.classList.add('faded'); }, 3000);
  }

  scheduleHide();

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    panel.hidden = !panel.hidden;
    if (panel.hidden) {
      hideInfo();
      scheduleHide();
      if (keyNav) keyNav.setMode('canvas');
    } else {
      clearTimeout(hideTimer);   // stay visible while panel is open
      if (keyNav) {
        keyNav.setPanel(panel);
        keyNav.buildFocusList();
        keyNav.focusFirst();
        keyNav.setMode('menu');
        keyNav.onMenuClose = () => {
          panel.hidden = true;
          hideInfo();
          scheduleHide();
          keyNav.setMode('canvas');
        };
      }
    }
  });

  // Close when tapping outside the panel or button; always reset the idle timer.
  document.addEventListener('pointerdown', (e) => {
    showBtn();
    scheduleHide();
    if (!panel.hidden && !panel.contains(e.target) && e.target !== btn) {
      panel.hidden = true;
      hideInfo();
      if (keyNav) keyNav.setMode('canvas');
    }
  });

  // Fullscreen
  const fsBtn = panel.querySelector('#btn-fullscreen');
  const updateFsLabel = () => {
    fsBtn.textContent = document.fullscreenElement ? 'Exit Fullscreen' : 'Fullscreen';
  };
  fsBtn.addEventListener('click', () => {
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      const el = document.documentElement;
      (el.requestFullscreen ?? el.webkitRequestFullscreen)?.call(el);
    }
    panel.hidden = true;
    hideInfo();
    if (keyNav) keyNav.setMode('canvas');
  });
  document.addEventListener('fullscreenchange', updateFsLabel);
  document.addEventListener('webkitfullscreenchange', updateFsLabel);

  // Spline toggle
  panel.querySelector('#toggle-spline').addEventListener('change', (e) => {
    overlay.splineEnabled = e.target.checked;
  });

  // Entity Stats toggle
  panel.querySelector('#toggle-stats').addEventListener('change', (e) => {
    overlay.statsEnabled = e.target.checked;
  });

  // Perception Radius toggle
  panel.querySelector('#toggle-perception').addEventListener('change', (e) => {
    overlay.perceptionEnabled = e.target.checked;
  });

  // Separation Radius toggle
  panel.querySelector('#toggle-separation').addEventListener('change', (e) => {
    overlay.separationEnabled = e.target.checked;
  });

  // Edge Margin toggle
  panel.querySelector('#toggle-edge').addEventListener('change', (e) => {
    overlay.edgeEnabled = e.target.checked;
  });

  // Neighbor Links toggle
  panel.querySelector('#toggle-neighbors').addEventListener('change', (e) => {
    overlay.neighborsEnabled = e.target.checked;
  });

  // Velocity Vector toggle
  panel.querySelector('#toggle-velocity').addEventListener('change', (e) => {
    overlay.velocityEnabled = e.target.checked;
  });

  // Wander Target toggle
  panel.querySelector('#toggle-wander').addEventListener('change', (e) => {
    overlay.wanderEnabled = e.target.checked;
  });
}
