// src/ui/menu.js
// Hamburger menu UI — small floating panel, not full-screen.

import {
  MOVEMENT_PARAMS, snapshot, applyValues, defaultRanges,
  loadPersisted, savePersisted, toCodeSnippet,
} from '../movement/tuning.js';
import {
  BUILTIN_PALETTES, setActivePalette, getActivePaletteId,
} from '../palettes/index.js';

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
export function initMenu({ overlay, sim, grid, FishClass }) {
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
        <div id="fish-sliders"></div>
      </div>
    </details>
    <details>
      <summary>Display</summary>
      <div class="menu-rows">
        <div id="display-sliders"></div>
      </div>
    </details>
    <details>
      <summary>Border</summary>
      <div class="menu-rows">
        <label class="menu-row">
          <span>Show border</span>
          <input type="checkbox" id="toggle-border">
        </label>
        <div id="border-sliders"></div>
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

  // ── Persistence ─────────────────────────────────────────────────────────────
  const save = () => savePersisted({
    params: snapshot(FishClass), ranges, fishCount: sim.entities.length,
    fish:    { filled: FishClass.FILLED, paletteId: getActivePaletteId() },
    display: { density: grid.density, worldShortEdge: grid.worldShortEdge },
    border:  { ...grid.border },
  });

  function setFishCount(n) {
    n = clamp(Math.round(n), FISH_MIN, FISH_MAX);
    while (sim.entities.length < n) sim.add(new FishClass(grid));
    while (sim.entities.length > n) sim.remove(sim.entities[sim.entities.length - 1]);
  }

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
      if (typeof b.enabled === 'boolean') grid.border.enabled = b.enabled;
      if (Number.isFinite(b.width))       grid.border.width   = clamp(b.width,   0.5, 10);
      if (Number.isFinite(b.opacity))     grid.border.opacity = clamp(b.opacity, 0,   1);
    }
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

  const palSel = panel.querySelector('#palette-select');
  for (const p of BUILTIN_PALETTES) {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.name;
    palSel.appendChild(opt);
  }
  palSel.value = getActivePaletteId();
  palSel.addEventListener('change', (e) => { setActivePalette(e.target.value); save(); });

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

  const { row: worldRow } = makeRow({
    label: 'World size',
    infoText: 'World size: world units across the short screen edge (zoom). Higher = more world on screen, so fish look smaller and slower; schooling and edge behavior are unchanged. Default 120.',
    decimals: 0,
    valueStep: 10,
    hasBounds: false,
    getVal: () => grid.worldShortEdge,
    setVal: (v) => { grid.worldShortEdge = clamp(v, WORLD_RANGE.min, WORLD_RANGE.max); applyGrid(); },
    getMin: () => WORLD_RANGE.min,
    getMax: () => WORLD_RANGE.max,
  });
  displayHost.appendChild(worldRow);

  // ── Border controls ──────────────────────────────────────────────────────────
  const borderHost   = panel.querySelector('#border-sliders');
  const borderToggle = panel.querySelector('#toggle-border');
  borderToggle.checked = grid.border.enabled;
  borderToggle.addEventListener('change', (e) => { grid.border.enabled = e.target.checked; save(); });

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
    } else {
      clearTimeout(hideTimer);   // stay visible while panel is open
    }
  });

  // Close when tapping outside the panel or button; always reset the idle timer.
  document.addEventListener('pointerdown', (e) => {
    showBtn();
    scheduleHide();
    if (!panel.hidden && !panel.contains(e.target) && e.target !== btn) {
      panel.hidden = true;
      hideInfo();
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
