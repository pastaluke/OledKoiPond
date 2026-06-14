// src/palettes/index.js
// Palette registry manifest. Add a new built-in palette by importing it here
// and appending it to BUILTIN_PALETTES. It will appear in the Food bag dropdown.

import koiClassic from './builtin/koi-classic.js';
import special    from './builtin/special.js';
import community  from './builtin/community.js';

import {
  initRegistry, rollColor,
  setActivePalette, getActivePaletteId,
  getActivePalette, getSpecialPalette,
  loadCustomPalettes, addCustomPalette, updateCustomPalette, deleteCustomPalette,
  getAllPalettes, getCustomPalettes, isBuiltin,
} from './palette-manager.js';

export const BUILTIN_PALETTES = [koiClassic, ...community, special];

// Merge persisted custom palettes into the registry on init.
const _customs = loadCustomPalettes();
initRegistry([...BUILTIN_PALETTES, ..._customs]);

export {
  rollColor, setActivePalette, getActivePaletteId, getActivePalette, getSpecialPalette,
  getAllPalettes, getCustomPalettes, isBuiltin, loadCustomPalettes,
  addCustomPalette, updateCustomPalette, deleteCustomPalette,
};
