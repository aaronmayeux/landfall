/**
 * index.js — the one import for the selection-layer system.
 *
 * Each layer file registers itself with the engine as a side effect of being
 * imported; this file is just the roll call. Adding a layer in a later phase
 * means adding a file and a line here — never touching registry.js (§7).
 * Z-order is the `order` field on each definition, not import order.
 */

/* Genesis is FIRST in this list only because it reads first — z-order is the
 * `order` field (0, below everything), not import order. §45. */
import './genesis.js';
import './cone.js';
/* Directly after the cone, because it colours the cone. §47. */
import './environment.js';
import './wind-field.js';
import './model-tracks.js';
import './track-past.js';
import './track-forecast.js';
import './watch-warning.js';
import './surge.js';
import './points-forecast.js';

export { createLayerEngine } from './registry.js';
