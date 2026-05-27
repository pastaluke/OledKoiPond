// src/ui/menu.js
// Hamburger menu UI — small floating panel, not full-screen.

/**
 * Initialise the hamburger menu and wire up controls.
 * @param {{ overlay: import('../debug-overlay.js').DebugOverlay }} refs
 */
export function initMenu({ overlay }) {
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
    <details open>
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

  // ── Interactions ────────────────────────────────────────────────────────────
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    panel.hidden = !panel.hidden;
  });

  // Close when tapping outside the panel or button
  document.addEventListener('pointerdown', (e) => {
    if (!panel.hidden && !panel.contains(e.target) && e.target !== btn) {
      panel.hidden = true;
    }
  });

  // Spline toggle
  panel.querySelector('#toggle-spline').addEventListener('change', (e) => {
    overlay.splineEnabled = e.target.checked;
  });

  // Entity Stats toggle
  panel.querySelector('#toggle-stats').addEventListener('change', (e) => {
    overlay.statsEnabled = e.target.checked;
  });
}
