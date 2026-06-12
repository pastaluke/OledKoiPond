// src/entities/koi.js
import { FishBase } from './fish-base.js';

/**
 * Koi carp — medium schooler, variable size (normal distribution), warm colours.
 */
export class Koi extends FishBase {
  static TYPE_ID    = 'koi';
  static SIZE_MIN   = 12;
  static SIZE_MAX   = 22;
  static SIZE_CURVE = 'normal';   // most koi are mid-sized; very large/small are rare

  static SPEED_MAX  = 0.051;       // logical px/ms
  static SCHOOL_WEIGHT     = 0.14; // loose schooling tendency (scales align + cohesion)
  static PERCEPTION_RADIUS = 42;   // px
  static SEPARATION_DIST   = 20;   // px

  // Colors managed by src/palettes/ — see builtin/koi-classic.js for the defaults.
}
