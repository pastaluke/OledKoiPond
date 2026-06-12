// src/palettes/palette-manager.js
// Weighted-random color rolling from a palette bag.
// Colors without pct → equal-split; remainder % → draws from the special bag.

const CUSTOM_KEY = 'koipond.palettes';

let _registry = [];
let _activePaletteId = null;
const _builtinIds = new Set();

export function initRegistry(palettes) {
  _registry = palettes;
  _builtinIds.clear();
  for (const p of palettes) { if (p.builtin) _builtinIds.add(p.id); }
  if (_activePaletteId === null && palettes.length > 0) {
    _activePaletteId = palettes[0].id;
  }
}

export function isBuiltin(id) { return _builtinIds.has(id); }
export function getAllPalettes() { return [..._registry]; }
export function getCustomPalettes() { return _registry.filter(p => !p.builtin); }

export function loadCustomPalettes() {
  try { return JSON.parse(localStorage.getItem(CUSTOM_KEY)) || []; }
  catch { return []; }
}

function _saveCustomPalettes() {
  try { localStorage.setItem(CUSTOM_KEY, JSON.stringify(getCustomPalettes())); } catch { /* ignore */ }
}

export function addCustomPalette(palette) {
  _registry = [..._registry.filter(p => p.id !== palette.id), palette];
  _saveCustomPalettes();
}

export function updateCustomPalette(id, patch) {
  _registry = _registry.map(p => (p.id === id && !p.builtin) ? { ...p, ...patch } : p);
  _saveCustomPalettes();
}

export function deleteCustomPalette(id) {
  if (isBuiltin(id)) return;
  _registry = _registry.filter(p => p.id !== id);
  _saveCustomPalettes();
}

export function setActivePalette(id) {
  _activePaletteId = id;
}

export function getActivePaletteId() {
  return _activePaletteId;
}

export function getActivePalette() {
  return _registry.find(p => p.id === _activePaletteId) ?? _registry[0];
}

export function getSpecialPalette() {
  return _registry.find(p => p.id === 'special');
}

/**
 * Roll a color from `palette` using its pct weights (or equal-split if omitted).
 * The remainder after summing pcts (always < 100) is the easter-egg chance —
 * that roll draws from `special` instead, falling back to the first color if
 * the special bag is empty.
 */
export function rollColor(palette, special) {
  const colors = palette?.colors;
  if (!colors?.length) return { r: 200, g: 200, b: 200 };

  const hasPct = colors.some(c => c.pct != null);
  const each   = hasPct ? null : Math.floor(100 / colors.length);

  let cum = 0;
  const buckets = colors.map(c => {
    cum += hasPct ? (c.pct ?? 0) : each;
    return { color: c, cum };
  });

  const roll = Math.floor(Math.random() * 100) + 1;   // 1..100 inclusive
  const hit  = buckets.find(b => roll <= b.cum);

  if (!hit) {
    // Roll landed in the remainder → easter egg
    const sc = special?.colors;
    const src = sc?.length ? sc : colors;
    const c = src[Math.floor(Math.random() * src.length)];
    return { r: c.r, g: c.g, b: c.b };
  }

  return { r: hit.color.r, g: hit.color.g, b: hit.color.b };
}
