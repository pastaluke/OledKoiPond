// src/ui/menu.js
// Hamburger menu UI — small floating panel, not full-screen.

import {
  MOVEMENT_PARAMS, snapshot, applyValues, defaultRanges,
  loadPersisted, savePersisted, toCodeSnippet,
} from '../movement/tuning.js';

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
    const left = Math.max(6, Math.min(ar.left - pr.left, panel.clientWidth - infoPop.offsetWidth - 6));
    infoPop.style.left = `${left}px`;
    infoPop.style.top  = `${ar.bottom - pr.top + 4}px`;
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
  const save = () => savePersisted({ params: snapshot(FishClass), ranges, fishCount: sim.entities.length });

  function setFishCount(n) {
    n = clamp(Math.round(n), FISH_MIN, FISH_MAX);
    while (sim.entities.length < n) sim.add(new FishClass(grid));
    while (sim.entities.length > n) sim.remove(sim.entities[sim.entities.length - 1]);
  }

  // Restore persisted tuning (params, ranges, fish count) before building controls.
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
  sliderHost.appendChild(countRow);

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
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    panel.hidden = !panel.hidden;
    if (panel.hidden) hideInfo();
  });

  // Close when tapping outside the panel or button
  document.addEventListener('pointerdown', (e) => {
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
}
