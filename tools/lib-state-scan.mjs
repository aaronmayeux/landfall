/**
 * lib-state-scan.mjs — shared by the two global-state suites. Not a test.
 *
 * A plain module rather than an export from one of the suites, because a suite
 * runs on import and calls `process.exit`: importing one from the other ran it
 * and swallowed the caller whole.
 */

/** Expression operators that read the FEATURE rather than the camera. */
const FEATURE_READS = new Set([
  'get', 'has', 'feature-state', 'geometry-type', 'id', 'properties',
  'line-progress', 'accumulated',
]);

function scan(node, found = { state: false, feature: false }) {
  if (Array.isArray(node)) {
    if (node[0] === 'global-state') found.state = true;
    if (typeof node[0] === 'string' && FEATURE_READS.has(node[0])) found.feature = true;
    for (const child of node) scan(child, found);
  } else if (node && typeof node === 'object') {
    for (const v of Object.values(node)) scan(v, found);
  }
  return found;
}

/** Every `["global-state", k]` key in a tree. */
export function stateKeys(node, found = new Set()) {
  if (Array.isArray(node)) {
    if (node[0] === 'global-state' && typeof node[1] === 'string') found.add(node[1]);
    for (const c of node) stateKeys(c, found);
  } else if (node && typeof node === 'object') {
    for (const v of Object.values(node)) stateKeys(v, found);
  }
  return found;
}

/**
 * ==> THE CHECK THAT SHIPPED A BUG BEFORE IT EXISTED. <==
 *
 * MapLibre evaluates a DATA-DRIVEN paint property in the WORKER, and the worker
 * is never sent the global state. A `global-state` reference inside one does
 * not throw and does not warn: `to-color` of the missing value is BLACK, in
 * both themes, permanently. That is what the white ring on each storm's first
 * forecast dot rendered as for two deploys, while the `circle-stroke-width`
 * beside it — the same `case` on the same `_first`, plain numbers in its
 * branches — worked perfectly.
 *
 * Nothing else could see it. The style validated against MapLibre's own spec,
 * every state key resolved, and the expression evaluated correctly when
 * evaluated by hand on the main thread with a globalState supplied. The entire
 * failure is about WHERE MapLibre runs it, which checking the expression in
 * isolation cannot reveal.
 *
 * So the condition here is structural and deliberately stricter than MapLibre's
 * own notion of data-driven: an expression holding BOTH a `global-state` and a
 * feature read is rejected wherever it appears. There is no legitimate reason
 * to write one.
 */
export function assertNoDataDrivenState(layers, where, report) {
  for (const layer of layers) {
    for (const bag of ['paint', 'layout']) {
      for (const [prop, value] of Object.entries(layer[bag] || {})) {
        const { state, feature } = scan(value);
        report(!(state && feature),
          `${where}: ${layer.id}.${bag}['${prop}'] reads BOTH global-state and feature ` +
          `data. MapLibre evaluates that in the worker, which has no global state, so ` +
          `to-color of the missing value renders BLACK in both themes, silently. Either ` +
          `bake the colour from palette() — only if both palettes agree, and assert that ` +
          `they do — or give it a real repaint path.`);
      }
    }
  }
}
