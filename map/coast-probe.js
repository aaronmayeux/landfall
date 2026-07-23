/**
 * coast-probe.js — TEMPORARY DIAGNOSTIC. DELETE WHEN TRACING LANDS.
 *
 * Answers the three questions that decide what the coast tracer has to be.
 * The sandbox cannot reach NOAA and a screenshot cannot measure vertices, so
 * this measures on glass, against the live service, on the real device.
 *
 *   Q1 — IS IT ACTUALLY CHORDED? Vertex count and the gap between
 *        consecutive vertices per segment. NHC breakpoints are tens to
 *        hundreds of km apart; a real traced coastline is sub-km. If the
 *        median gap is large, the stripe is breakpoint chords and tracing is
 *        the fix. If it is small, the geometry is already coastal and the
 *        jaggedness is OURS — a rendering or simplification bug — and a
 *        tracer would be built to solve a problem that isn't there.
 *
 *   Q2 — DO THE ENDPOINTS SIT ON THE COAST? Distance from each vertex to the
 *        nearest drawn-coast vertex. This decides the tracer's shape:
 *        endpoints ON the coast means snap-and-walk; endpoints offshore
 *        means find-the-coast-first, which is a different and harder job.
 *
 *   Q3 — IS THERE ANYTHING TO TRACE AGAINST? How many coast vertices the
 *        basemap actually yields right now, at this zoom, for this viewport.
 *        Q2's numbers are meaningless if the answer is zero, and on the
 *        OpenMapTiles scaffolding it may well be — the coast there is the
 *        edge of a `water` fill, present only for LOADED tiles.
 *
 * NOTHING HERE FEEDS RENDERING. It reads, measures, and reports. It is safe
 * to leave attached and safe to delete in one move.
 *
 * On a phone there is no console, so every entry point returns a plain-text
 * report suitable for reading on glass or pasting into a chat.
 *
 * Imports: config/ only (the overlay obeys the single visual contract even
 * though it is disposable — a hardcoded hex here would be one more thing to
 * find and remove later).
 */

import { DARK, FONT, SIZE, SPACE } from '../config/tokens.js';
import { coastRings } from './coast-source.js';
import {
  traceSegments,
  stitchRings,
  nearestVertex,
  walkBetween,
  linePositions,
  pathLengthKm,
  haversineKm as traceHaversine,
} from './coast-trace.js';

/**
 * Per-leg walk measurements — the detail `implausible-length` hides.
 *
 * Re-runs the tracer's own steps leg by leg and reports each one, so the
 * failure can be READ rather than inferred: which leg blew the ratio, by how
 * much, how far its endpoints had to snap, and whether the two ends even
 * landed on the same stitched ring.
 */
function legDiagnostics(features, rings) {
  const paths = stitchRings(rings);
  const out = [];

  for (const f of features || []) {
    const pos = linePositions(f.geometry);
    for (let i = 0; i < pos.length - 1; i++) {
      const a = nearestVertex(pos[i], paths);
      const b = nearestVertex(pos[i + 1], paths);
      const chordKm = traceHaversine(pos[i], pos[i + 1]);

      if (!a || !b) {
        out.push({
          leg: i, chordKm: chordKm.toFixed(1), walkKm: '-', ratio: '-',
          snapAkm: '-', snapBkm: '-', ringA: '-', ringB: '-', note: 'NO-COAST',
        });
        continue;
      }

      const walk = a.path === b.path ? walkBetween(paths[a.path], a.index, b.index) : null;
      const walkKm = walk ? pathLengthKm(walk) : null;

      /* A HIGH RATIO ALONE CANNOT TELL A BAY FROM A WRONG-WAY WALK.
       * Both produce a long path for a short chord. What separates them is
       * how far the walk WANDERS from the two endpoints: a bay stays local
       * (every vertex is within a few chord-lengths), while a walk that went
       * the wrong way around a landmass swings hundreds of km away. Measure
       * the furthest excursion and let the numbers say which it is. */
      let strayKm = null;
      let spanIdx = null;
      if (walk) {
        let worst = 0;
        for (const p of walk) {
          const d = Math.min(traceHaversine(p, pos[i]), traceHaversine(p, pos[i + 1]));
          if (d > worst) worst = d;
        }
        strayKm = worst;
        /* How much of the ring the walk consumed. A walk crossing most of a
         * 1539-vertex ring is going around it, not into a bay. */
        spanIdx = walk.length;
      }

      out.push({
        leg: i,
        chordKm: chordKm.toFixed(1),
        walkKm: walkKm == null ? '-' : walkKm.toFixed(1),
        ratio: walkKm == null || chordKm === 0 ? '-' : (walkKm / chordKm).toFixed(1),
        snapAkm: a.km.toFixed(2),
        snapBkm: b.km.toFixed(2),
        ringA: a.path,
        ringB: b.path,
        strayKm: strayKm == null ? '-' : strayKm.toFixed(1),
        walkVerts: spanIdx == null ? '-' : spanIdx,
        ringVerts: a.path === b.path ? paths[a.path].length : '-',
        note:
          a.path !== b.path ? 'SPLIT-RING'
            : !walk ? 'WALK-FAILED'
            : walk.length >= 6000 ? 'HIT-CAP'
            : '',
      });
    }
  }
  return out;
}

/** Mean earth radius, km. Local to the probe — the probe is disposable and
 *  must not leave a constant behind in config/ when it is deleted. */
const R_KM = 6371;

/** Great-circle distance in km between two [lon, lat] pairs. */
function haversineKm(a, b) {
  const toRad = Math.PI / 180;
  const dLat = (b[1] - a[1]) * toRad;
  const dLon = (b[0] - a[0]) * toRad;
  const la1 = a[1] * toRad;
  const la2 = b[1] * toRad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * R_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Every [lon, lat] position in a GeoJSON geometry, flattened. */
function positionsOf(geometry) {
  if (!geometry) return [];
  const { type, coordinates } = geometry;
  if (type === 'LineString') return coordinates;
  if (type === 'MultiLineString') return coordinates.flat();
  if (type === 'Point') return [coordinates];
  if (type === 'MultiPoint') return coordinates;
  if (type === 'Polygon') return coordinates.flat();
  if (type === 'MultiPolygon') return coordinates.flat(2);
  return [];
}

function median(nums) {
  if (!nums.length) return null;
  const s = [...nums].sort((x, y) => x - y);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

const round = (n, dp = 2) =>
  n == null || !isFinite(n) ? null : Number(n.toFixed(dp));

/* ---------------------------------------------------------------------------
 * Q1 — SEGMENT SHAPE
 * ------------------------------------------------------------------------- */

/**
 * Measure the delivered watch/warning geometry.
 * @param {Array} features  raw NHC features, BEFORE any decoration
 */
export function measureSegments(features) {
  const segs = [];

  for (const f of features || []) {
    const pos = positionsOf(f.geometry);
    if (pos.length < 2) continue;

    const gaps = [];
    for (let i = 1; i < pos.length; i++) gaps.push(haversineKm(pos[i - 1], pos[i]));

    segs.push({
      type: f.geometry?.type || 'unknown',
      vertices: pos.length,
      totalKm: round(gaps.reduce((a, b) => a + b, 0), 1),
      medianGapKm: round(median(gaps)),
      maxGapKm: round(Math.max(...gaps)),
      minGapKm: round(Math.min(...gaps)),
      /* The property names matter as much as the numbers: lib/watchwarning.js
       * scans VALUES for a TCWW code because the field name was never
       * recorded. If tracing needs to group segments (mainland run vs each
       * barrier island) it will need a real key, so capture what exists. */
      propKeys: Object.keys(f.properties || {}),
    });
  }

  return segs;
}

/* ---------------------------------------------------------------------------
 * Q3 — WHAT COASTLINE DOES THE BASEMAP ACTUALLY YIELD?
 * ------------------------------------------------------------------------- */

/**
 * Pull coast vertices from the loaded basemap tiles.
 *
 * Schema-aware, because the two basemaps invert (style-dark.js): OpenMapTiles
 * has no land polygon and the coast is the ocean fill's edge; Protomaps has a
 * real `earth` layer. Tries both and reports which one answered — that answer
 * IS the finding when useR2 is still false.
 *
 * querySourceFeatures only sees LOADED tiles. That limitation is the point of
 * the measurement, not a flaw in it.
 */
export function coastVertices(map) {
  const attempts = [
    { sourceLayer: 'earth', schema: 'protomaps', filter: null },
    {
      sourceLayer: 'water',
      schema: 'openmaptiles',
      filter: ['==', ['get', 'class'], 'ocean'],
    },
  ];

  for (const a of attempts) {
    let feats = [];
    try {
      const opts = { sourceLayer: a.sourceLayer };
      if (a.filter) opts.filter = a.filter;
      feats = map.querySourceFeatures('basemap', opts) || [];
    } catch {
      continue; // source-layer absent on this schema — try the next
    }
    if (!feats.length) continue;

    const verts = [];
    for (const f of feats) verts.push(...positionsOf(f.geometry));
    if (verts.length) return { schema: a.schema, sourceLayer: a.sourceLayer, verts };
  }

  return { schema: null, sourceLayer: null, verts: [] };
}

/* ---------------------------------------------------------------------------
 * Q2 — HOW FAR IS THE STRIPE FROM THE DRAWN COAST?
 * ------------------------------------------------------------------------- */

/**
 * Nearest-coast distance for each stripe vertex.
 *
 * Brute force on purpose. This is a diagnostic that runs on demand, not a
 * render-path function, so an O(n·m) scan is the honest simple thing —
 * building a spatial index here would be optimizing a tool we intend to
 * delete. Capped so a dense viewport cannot hang the phone.
 */
export function measureOffset(features, coast, cap = 40000) {
  if (!coast.length) return null;
  const sample = coast.length > cap
    ? coast.filter((_, i) => i % Math.ceil(coast.length / cap) === 0)
    : coast;

  const dists = [];
  for (const f of features || []) {
    for (const p of positionsOf(f.geometry)) {
      let best = Infinity;
      for (const c of sample) {
        const d = haversineKm(p, c);
        if (d < best) best = d;
      }
      if (isFinite(best)) dists.push(best);
    }
  }

  if (!dists.length) return null;
  return {
    sampledCoastVertices: sample.length,
    stripeVertices: dists.length,
    medianKm: round(median(dists)),
    maxKm: round(Math.max(...dists)),
    minKm: round(Math.min(...dists)),
  };
}

/* ---------------------------------------------------------------------------
 * THE REPORT
 * ------------------------------------------------------------------------- */

/**
 * Run every measurement and return a plain-text report.
 *
 * Text, not an object, because the device that needs this answer is a phone
 * with no console. Returned AND logged.
 */
export function probe(map, features) {
  const lines = [];
  const say = (s) => lines.push(s);

  say('=== LANDFALL COAST PROBE ===');
  say(`zoom ${round(map?.getZoom?.(), 2)}`);

  const segs = measureSegments(features);
  say('');
  say(`--- Q1 stripe geometry: ${segs.length} segment(s) ---`);

  if (!segs.length) {
    say('NO STRIPE FEATURES. Either no watches/warnings are in effect for the');
    say('selected storm, or the layer failed. Check the detail panel, then');
    say('re-run with a storm that has active warnings.');
  } else {
    for (const [i, s] of segs.entries()) {
      say(
        `[${i}] ${s.type} verts=${s.vertices} len=${s.totalKm}km ` +
          `gap med=${s.medianGapKm} min=${s.minGapKm} max=${s.maxGapKm} km`
      );
    }
    const meds = segs.map((s) => s.medianGapKm).filter((n) => n != null);
    const overall = median(meds);
    say('');
    say(`median vertex spacing across all segments: ${round(overall)} km`);
    /* The interpretation is stated here rather than left to the reader,
     * because the whole point of the probe is to decide between two builds. */
    if (overall == null) say('VERDICT: inconclusive.');
    else if (overall > 5)
      say('VERDICT: CHORDED. Breakpoint-spaced. Tracing is the correct fix.');
    else if (overall > 0.5)
      say('VERDICT: MIXED. Coarse coastal geometry — simplify/smooth may beat a tracer.');
    else
      say('VERDICT: ALREADY COASTAL. The jaggedness is ours, not NHC\'s. Do NOT build a tracer.');
    say('');
    say(`property keys on segment 0: ${segs[0].propKeys.join(', ') || '(none)'}`);
  }

  const { schema, sourceLayer, verts } = coastVertices(map);
  say('');
  say('--- Q3 traceable coastline available right now ---');
  if (!verts.length) {
    say('ZERO coast vertices from the basemap source.');
    say('Nothing to trace against on this basemap at this viewport.');
  } else {
    say(`${verts.length} vertices from schema=${schema} layer=${sourceLayer}`);
  }

  say('');
  say('--- Q2 stripe offset from drawn coast ---');
  const off = measureOffset(features, verts);
  if (!off) {
    say('Not measurable (no coast vertices, or no stripe features).');
  } else {
    say(
      `stripe verts=${off.stripeVertices} vs coast sample=${off.sampledCoastVertices}`
    );
    say(`nearest-coast distance: med=${off.medianKm} min=${off.minKm} max=${off.maxKm} km`);
    if (off.medianKm != null && off.medianKm < 2)
      say('VERDICT: endpoints sit ON the coast → snap-and-walk tracer.');
    else say('VERDICT: endpoints sit OFF the coast → tracer must find the coast first.');
  }

  say('');
  say('--- Q4 trace result ---');
  try {
    const { schema, rings, vertexCount } = coastRings(map);
    say(`coastRings: schema=${schema} rings=${rings.length} verts=${vertexCount}`);
    if (!rings.length) {
      say('coastRings returned NOTHING — the tracer has no substrate.');
      say('(Q3 above uses a looser count; if Q3 found vertices and this did');
      say(' not, the difference is the minCoastVertices gate or ring filtering.)');
    } else {
      const sizes = rings.map((r) => r.length).sort((a, b) => b - a);
      say(`ring sizes (largest 5): ${sizes.slice(0, 5).join(', ')}`);
      const res = traceSegments(features, rings);
      say(`traced ${res.tracedCount}/${res.total} segment(s)`);
      for (const [i, f] of res.features.entries()) {
        const n = f.geometry?.coordinates?.length || 0;
        const t = f.properties?._traced;
        say(
          `[${i}] ${t ? 'TRACED' : 'chord'} verts=${n}` +
            (t ? '' : ` reason=${f.properties?._traceReason || '?'}`)
        );
      }

      /* PER-LEG DETAIL. `implausible-length` names the rule that rejected
       * the segment but not WHICH leg blew the ratio or by how much. Without
       * that, tuning maxTraceRatio is guesswork — and if one leg is 400x
       * rather than 9x, the walk is going somewhere wrong and raising the
       * threshold would ship a badly wrong line instead of an honest chord. */
      say('');
      say('per-leg walk ratios (traced length / chord):');
      const legs = legDiagnostics(features, rings);
      for (const L of legs) {
        say(
          `  leg ${L.leg}: chord=${L.chordKm} walk=${L.walkKm} ratio=${L.ratio}x ` +
            `stray=${L.strayKm}km verts=${L.walkVerts}/${L.ringVerts} ` +
            `snap=${L.snapAkm}/${L.snapBkm} ${L.note}`
        );
      }
    }
  } catch (e) {
    say(`trace threw: ${e?.message || e}`);
  }

  say('');
  say('--- Q5 what is actually ON THE MAP right now ---');
  /* The decisive question. Q4 traces in isolation; this reads back the data
   * the stripe layer actually pushed to the source. If Q4 traces and Q5 shows
   * 2-vertex lines, the tracer works and the WIRING is broken. */
  try {
    for (const id of ['sel-ww', 'amb-ww']) {
      const src = map.getSource(id);
      const data = src?._data;
      const feats = data?.features || [];
      if (!feats.length) {
        say(`${id}: empty`);
        continue;
      }
      const counts = feats.map((f) => f.geometry?.coordinates?.length || 0);
      const tracedFlags = feats.map((f) => f.properties?._traced);
      say(`${id}: ${feats.length} feature(s) verts=[${counts.join(',')}]`);
      say(`${id}: _traced=[${tracedFlags.join(',')}]`);
      const reasons = feats
        .map((f) => f.properties?._traceReason)
        .filter(Boolean);
      if (reasons.length) say(`${id}: reasons=[${reasons.join(',')}]`);
    }
  } catch (e) {
    say(`source read threw: ${e?.message || e}`);
  }

  say('');
  say('=== END PROBE ===');

  const text = lines.join('\n');
  console.log(text);
  showOverlay(text);
  return text;
}

/* ---------------------------------------------------------------------------
 * ON-GLASS READOUT
 *
 * The whole point of the probe is that it runs on the phone, where there is
 * no console. Text on screen, plus a copy button so the numbers can come back
 * as a message. Keyboard-reachable and Esc-closable like anything else (§10),
 * because a diagnostic that traps focus is still a trap.
 * ------------------------------------------------------------------------- */

const OVERLAY_ID = 'coast-probe-overlay';

function showOverlay(text) {
  document.getElementById(OVERLAY_ID)?.remove();

  const wrap = document.createElement('div');
  wrap.id = OVERLAY_ID;
  wrap.setAttribute('role', 'dialog');
  wrap.setAttribute('aria-label', 'Coast probe results');
  Object.assign(wrap.style, {
    position: 'fixed',
    inset: SPACE.base,
    zIndex: '9999',
    background: DARK.glassRaised,
    border: `1px solid ${DARK.glassBorder}`,
    borderRadius: SIZE.radiusLarge,
    padding: SPACE.panelPad,
    display: 'flex',
    flexDirection: 'column',
    gap: SPACE.rowGap,
    boxShadow: `0 8px 32px ${DARK.glassShadow}`,
  });

  const pre = document.createElement('pre');
  pre.textContent = text;
  Object.assign(pre.style, {
    flex: '1',
    margin: '0',
    overflow: 'auto',
    font: `12px ${FONT.numeric}`,
    color: DARK.textPrimary,
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    WebkitOverflowScrolling: 'touch',
  });

  const row = document.createElement('div');
  Object.assign(row.style, { display: 'flex', gap: SPACE.controlGap });

  const button = (label) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    Object.assign(b.style, {
      flex: '1',
      minHeight: SIZE.touchTarget,
      font: `14px ${FONT.ui}`,
      color: DARK.textPrimary,
      background: DARK.glass,
      border: `1px solid ${DARK.glassBorder}`,
      borderRadius: SIZE.radius,
      cursor: 'pointer',
    });
    return b;
  };

  const copy = button('Copy');
  copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(text);
      copy.textContent = 'Copied';
    } catch {
      /* Clipboard is permission-gated and fails silently on some mobile
       * browsers. Say so rather than showing a button that lies. */
      copy.textContent = 'Copy failed — select the text';
    }
  });

  const close = button('Close');
  const dismiss = () => {
    wrap.remove();
    document.removeEventListener('keydown', onKey);
  };
  function onKey(e) {
    if (e.key === 'Escape') dismiss();
  }
  close.addEventListener('click', dismiss);
  document.addEventListener('keydown', onKey);

  row.append(copy, close);
  wrap.append(pre, row);
  document.body.appendChild(wrap);
  close.focus();
}
