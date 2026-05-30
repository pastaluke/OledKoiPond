// src/ui/menu.js
// Hamburger menu UI — small floating panel, not full-screen.

import {
  MOVEMENT_PARAMS, snapshot, applyValues,
  loadPersisted, savePersisted, toCodeSnippet,
} from '../movement/tuning.js';

const FISH_MIN = 0, FISH_MAX = 40;

/**
 * Initialise the hamburger menu and wire up controls.
 * @param {object} refs
 * @param {import('../debug-overlay.js').DebugOverlay} refs.overlay
 * @param {import('../simulation.js').Simulation} refs.sim
 * @param {import('../grid.js').Grid} refs.grid
 * @param {typeof import('../entities/fish-base.js').FishBase} refs.FishClass - spawned fish type to tune
 */
export function initMenu({ overlay, sim, grid, FishClass }) {
  // Capture pristine defaults BEFORE any persisted tuning is applied (for Reset).
  const defaults = snapshot(FishClass);

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

  // Wire an (i) icon inside `row` to toggle the popup with `text`.
  function wireInfoIcon(row, text) {
    const icon = row.querySelector('.info-icon');
    if (!icon) return;
    icon.addEventListener('click', (e) => { e.stopPropagation(); showInfo(text, icon); });
  }

  // Close the popup on any click that isn't an (i) icon or the popup itself.
  document.addEventListener('click', (e) => {
    if (!infoPop.hidden && !e.target.closest('.info-icon') && !infoPop.contains(e.target)) hideInfo();
  });

  // ── Persistence ─────────────────────────────────────────────────────────────
  const fmt = (v, d) => Number(v).toFixed(d);
  const save = () => savePersisted({ params: snapshot(FishClass), fishCount: sim.entities.length });

  function setFishCount(n) {
    n = Math.max(FISH_MIN, Math.min(FISH_MAX, Math.round(n)));
    while (sim.entities.length < n) sim.add(new FishClass(grid));
    while (sim.entities.length > n) sim.remove(sim.entities[sim.entities.length - 1]);
  }

  // Restore any previously persisted tuning before building the controls.
  const persisted = loadPersisted();
  if (persisted) {
    applyValues(FishClass, persisted.params);
    if (Number.isFinite(persisted.fishCount)) setFishCount(persisted.fishCount);
  }

  // ── Movement sliders (built from descriptors) ────────────────────────────────
  const sliderHost = panel.querySelector('#movement-sliders');
  const controls = {};

  for (const p of MOVEMENT_PARAMS) {
    const row = document.createElement('div');
    row.className = 'slider-row';
    const info = p.desc ? `${p.label}: ${p.desc}` : '';
    if (info) row.title = info;
    row.innerHTML = `
      <span class="slider-head">
        <span class="slider-label">${p.label}${p.desc ? `<button type="button" class="info-icon" aria-label="About ${p.label}">i</button>` : ''}</span>
        <span class="slider-val"></span>
      </span>
      <input type="range" min="${p.min}" max="${p.max}" step="${p.step}">
    `;
    if (info) wireInfoIcon(row, info);
    const input = row.querySelector('input');
    const out   = row.querySelector('.slider-val');
    const sync  = () => { input.value = FishClass[p.key]; out.textContent = fmt(FishClass[p.key], p.decimals); };
    input.addEventListener('input', () => {
      FishClass[p.key] = parseFloat(input.value);
      out.textContent = fmt(FishClass[p.key], p.decimals);
      save();
    });
    controls[p.key] = sync;
    sync();
    sliderHost.appendChild(row);
  }

  // ── Fish count slider (operates on the sim, not a class static) ──────────────
  const countInfo = 'Fish count: number of koi in the pond. Handy for judging how schooling feels at different densities.';
  const countRow = document.createElement('div');
  countRow.className = 'slider-row';
  countRow.title = countInfo;
  countRow.innerHTML = `
    <span class="slider-head">
      <span class="slider-label">Fish count<button type="button" class="info-icon" aria-label="About Fish count">i</button></span>
      <span class="slider-val"></span>
    </span>
    <input type="range" min="${FISH_MIN}" max="${FISH_MAX}" step="1">
  `;
  wireInfoIcon(countRow, countInfo);
  const countInput = countRow.querySelector('input');
  const countOut   = countRow.querySelector('.slider-val');
  const syncCount  = () => { countInput.value = sim.entities.length; countOut.textContent = sim.entities.length; };
  countInput.addEventListener('input', () => {
    setFishCount(parseFloat(countInput.value));
    countOut.textContent = sim.entities.length;
    save();
  });
  syncCount();
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
    for (const p of MOVEMENT_PARAMS) controls[p.key]();
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
