// src/palettes/index.js
// Palette registry manifest. Add a new built-in palette by importing it here
// and appending it to BUILTIN_PALETTES. It will appear in the Food bag dropdown.

import koiClassic from './builtin/koi-classic.js';
import special    from './builtin/special.js';

import {
  initRegistry, rollColor,
  setActivePalette, getActivePaletteId,
  getActivePalette, getSpecialPalette,
} from './palette-manager.js';

export const BUILTIN_PALETTES = [koiClassic, special];

// Default active palette is the first entry (koi-classic).
initRegistry(BUILTIN_PALETTES);

export { rollColor, setActivePalette, getActivePaletteId, getActivePalette, getSpecialPalette };
