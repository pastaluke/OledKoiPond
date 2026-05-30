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

  static SPEED_MAX  = 0.03;       // logical px/ms
  static SCHOOL_WEIGHT     = 0.4; // loose schooling tendency (scales align + cohesion)
  static PERCEPTION_RADIUS = 24;  // px
  static SEPARATION_DIST   = 10;  // px

  static COLORS = [
    { r: 255, g: 140, b: 0   },   // orange
    { r: 255, g: 60,  b: 60  },   // red-orange
    { r: 255, g: 220, b: 100 },   // yellow
    { r: 200, g: 255, b: 180 },   // pale green-white
    { r: 255, g: 255, b: 220 },   // cream / white
  ];
}
