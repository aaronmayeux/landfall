/**
 * index.js — the one import for the selection-layer system.
 *
 * Each layer file registers itself with the engine as a side effect of being
 * imported; this file is just the roll call. Adding a layer in a later phase
 * means adding a file and a line here — never touching registry.js (§7).
 * Z-order is the `order` field on each definition, not import order.
 */

import './cone.js';
import './track-past.js';
import './track-forecast.js';
import './watch-warning.js';
import './points-forecast.js';

export { createLayerEngine } from './registry.js';
