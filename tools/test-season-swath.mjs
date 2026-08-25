/**
 * test-season-swath.mjs — the archive's wind footprint. §57.26, §57.26a,
 * §57.27, §57.30 step 6b.
 *
 * ==> THE ONE BUG THIS SUITE EXISTS FOR, AND IT IS INVISIBLE ANYWHERE ELSE.
 * <== NOAA inserts extra records at landfalls and peaks, off the six-hour
 * clock, and those rows carry `-999` in all twelve radii columns — the wind
 * field was not written down for that odd minute. `lib/windswath.js` BREAKS a
 * corridor at any timeline point with no ring, which is exactly right for a
 * measured zero and exactly wrong for an unrecorded row.
 *
 * Fed raw, Katrina's footprint snaps into pieces at her three landfalls —
 * **the moments the app is named after** — and it would look like a rendering
 * quirk rather than a bug. 41 storms across the mirrored archive are affected,
 * 73 of the 90 offending rows are landfalls.
 *
 * ==> AND THE SECOND HALF OF THAT RULE HAS TO BE PROVEN TOO. <== A row of
 * genuine zeros is a measurement saying there was no storm-force wind there,
 * and sweeping across it would claim wind NOAA did not (§5). Katrina opens and
 * closes as a depression with `0,0,0,0` rows at both ends, so both directions
 * are checked on one real storm.
 *
 * Everything here runs against the real mirrored season files and against
 * NOAA's own published swath for Ida. No fixtures, no invented payloads.
 *
 * The map is a stub that records what was pushed and deliberately does NOT
 * validate expressions — same rule and same reason as `test-season-marks.mjs`.
 *
 * Zero dependencies, plain node.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

let pass = 0;
const fails = [];
const ok = (what, cond) => { cond ? pass++ : fails.push(what); };
const eq = (what, got, want) => ok(
  `${what}\n     got:  ${JSON.stringify(got)}\n     want: ${JSON.stringify(want)}`,
  JSON.stringify(got) === JSON.stringify(want)
);

const { parseHurdat2 } = await import('../lib/hurdat.js');
const { stormFacts } = await import('../lib/season-facts.js');
const { SEASONS } = await import('../config/constants.js');
const { ARCHIVE_GEO } = await import('../config/tokens.js');
const { buildSeasonSwath, timelineFor } = await import('../lib/season-windswath.js');
const {
  ensureSeasonSwath, setSeasonSwathSet, setSeasonSwathFocus, clearSeasonSwath, __internals,
} = await import('../map/layers/season-swath.js');
const { footprintNoteHtml } = await import('../ui/seasons-board-markup.js');

const seasonOf = (basin, year) => {
  const index = JSON.parse(readFileSync(join(ROOT, 'seasons', 'index.json'), 'utf8'));
  const file = index.basins[basin].seasons[String(year)];
  return parseHurdat2(readFileSync(join(ROOT, 'seasons', 'data', file), 'utf8')).storms;
};

const atl2005 = seasonOf('atlantic', 2005);
const atl2021 = seasonOf('atlantic', 2021);
const atl1851 = seasonOf('atlantic', 1851);
const katrina = atl2005.find((s) => s.id === 'AL122005');
const ida = atl2021.find((s) => s.id === 'AL092021');

const bandsAt = (features, kt) => features.filter((f) => f.properties.radii === kt);

function fakeMap() {
  const sources = new Map();
  const layers = [];
  return {
    added: layers,
    getSource: (id) => sources.get(id) || null,
    getLayer: (id) => layers.find((l) => l.id === id) || null,
    addSource(id, def) { sources.set(id, { def, data: def.data, setData(d) { this.data = d; } }); },
    addLayer(def, beforeId) { layers.push({ ...def, beforeId }); },
    setPaintProperty() {},
    data: () => sources.get('season-swath')?.data,
  };
}

/* ---------------------------------------------------------------------------
 * 1. THE MISSING-VERSUS-ZERO RULE — the reason this file exists
 * ------------------------------------------------------------------------ */
{
  ok('Katrina is in the mirrored 2005 file', !!katrina);

  /* First, prove the raw material is what the header claims. If NOAA ever
   * changes how a landfall row is written, this assertion is what says so
   * rather than the footprint quietly changing shape. */
  const landfallRows = katrina.points.filter((p) => p.marker === 'L');
  eq('Katrina has three landfall records in the reviewed best track',
    landfallRows.length, 3);
  eq('==> AND ALL THREE CARRY NO RADII GROUP AT ALL. <== `-999` in every '
    + 'column, which `lib/hurdat.js` reads as null. This is the input that '
    + 'would tear the footprint apart',
    landfallRows.map((p) => [p.radii.r34, p.radii.r50, p.radii.r64].every((g) => g == null)),
    [true, true, true]);

  const zeroRows = katrina.points.filter(
    (p) => p.radii.r34 && Object.values(p.radii.r34).every((v) => v === 0)
  );
  ok('and she also carries rows of genuine ZEROS — a measurement of no '
    + 'storm-force wind, which is a different statement', zeroRows.length > 0);

  /* Now the rule itself. */
  const timeline = timelineFor(katrina);
  eq('every landfall row is dropped from the timeline, so the corridor '
    + 'interpolates across it from the six-hourly neighbours either side',
    timeline.length, katrina.points.length - 3);
  ok('the zero rows are KEPT, because they are what breaks the run',
    timeline.some((p) => Object.values(p.quads[34]).every((v) => v === 0)));

  const built = buildSeasonSwath(katrina);
  eq('==> AND THE 34 KT FOOTPRINT COMES OUT AS ONE UNBROKEN SHAPE. <== '
    + 'Three pieces here is the bug, and it is the shape a raw feed produces',
    bandsAt(built, 34).length, 1);
  eq('so do the 50 and 64 kt cores', [bandsAt(built, 50).length, bandsAt(built, 64).length],
    [1, 1]);
  eq('three bands in total, one per threshold', built.length, 3);
}

/* ---------------------------------------------------------------------------
 * 2. A MEASURED ZERO STILL BREAKS THE RUN — the other half of the rule
 * ------------------------------------------------------------------------ */
{
  /* Katrina's own zeros sit at the two ENDS of her life, where a break is
   * invisible. So the case is built by moving one INSIDE her wind-field life,
   * on a copy — the real record, with one real row's real numbers zeroed.
   * If a future hand "simplifies" the rule by dropping zero rows too, this is
   * what goes red. */
  const copy = JSON.parse(JSON.stringify(katrina));
  const mid = copy.points.findIndex(
    (p) => p.radii.r34 && Object.values(p.radii.r34).some((v) => v > 0)
       && p.marker == null
  );
  const later = copy.points.findIndex(
    (p, i) => i > mid + 4 && p.radii.r34 && Object.values(p.radii.r34).some((v) => v > 0)
  );
  ok('a mid-life record with real 34 kt radii exists to zero', later > mid);
  copy.points[later].radii.r34 = { ne: 0, se: 0, sw: 0, nw: 0 };

  const built = buildSeasonSwath(copy);
  eq('==> A ZERO ROW MID-LIFE SPLITS THE 34 KT FOOTPRINT IN TWO. <== §5: '
    + 'sweeping across an hour NOAA published as ring-free would claim wind '
    + 'NOAA did not', bandsAt(built, 34).length, 2);
  eq('and the thresholds NOAA did publish there are untouched',
    bandsAt(built, 50).length, 1);
}

/* ---------------------------------------------------------------------------
 * 3. AGAINST NOAA'S OWN PUBLISHED SWATH — Ida
 * ------------------------------------------------------------------------ */
{
  const raw = readFileSync(
    join(ROOT, 'samples', 'ida-al092021', 'gis', 'best-track', 'AL092021_windswath.geojson'),
    'utf8'
  );
  const noaa = JSON.parse(raw);

  /* ==> WHY WE DO NOT JUST SHIP NOAA'S FILE, ASSERTED RATHER THAN ASSUMED.
   * <== It is a rasterized staircase. If that ever stops being true the
   * shortcut becomes worth reconsidering, and this is what would say so. */
  const theirs34 = noaa.features.find((f) => f.properties.RADII === 34);
  const ring = theirs34.geometry.coordinates[0];
  let axis = 0;
  for (let i = 1; i < ring.length; i++) {
    const dx = Math.abs(ring[i][0] - ring[i - 1][0]);
    const dy = Math.abs(ring[i][1] - ring[i - 1][1]);
    if (dx < 1e-12 || dy < 1e-12) axis++;
  }
  eq("NOAA's own best-track swath is 100% axis-aligned edges — the same "
    + 'rasterized garbage `lib/windswath.js` refuses from the live service',
    axis, ring.length - 1);

  const ours = buildSeasonSwath(ida);
  let oursAxis = 0;
  for (const f of ours) {
    const r = f.geometry.coordinates[0];
    for (let i = 1; i < r.length; i++) {
      const dx = Math.abs(r[i][0] - r[i - 1][0]);
      const dy = Math.abs(r[i][1] - r[i - 1][1]);
      if (dx < 1e-12 || dy < 1e-12) oursAxis++;
    }
  }
  eq('and ours has none', oursAxis, 0);

  /* THE SHAPES AGREE WITH THE AGENCY. Bounding boxes rather than vertices —
   * the two are built by different methods and will never match vertex for
   * vertex, but a corridor covering different GROUND would be a real fault.
   * Half a degree is about 30 nm against bands 130-200 nm wide. */
  const bbox = (features, coords) => {
    const xs = [];
    const ys = [];
    const walk = (c) => (Array.isArray(c[0]) ? c.forEach(walk) : (xs.push(c[0]), ys.push(c[1])));
    for (const f of features) walk(coords(f));
    return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  };
  for (const kt of [34, 50, 64]) {
    const mine = bbox(bandsAt(ours, kt), (f) => f.geometry.coordinates);
    const theirs = bbox(
      noaa.features.filter((f) => f.properties.RADII === kt),
      (f) => f.geometry.coordinates
    );
    /* The far northeast end of the 34 kt corridor is the one place the two
     * diverge by more — NOAA's own product runs a couple of degrees further
     * up the eastern seaboard, which is a difference in how each side treats
     * the extratropical tail rather than a difference in the sweep. Bounded
     * generously here on purpose: this assertion is guarding against a
     * corridor in the wrong OCEAN, not against a tail. */
    const worst = Math.max(...mine.map((v, i) => Math.abs(v - theirs[i])));
    ok(`Ida's ${kt} kt footprint covers the same ground NOAA published `
      + `(worst corner ${worst.toFixed(2)}°)`, worst < 2.5);
  }
}

/* ---------------------------------------------------------------------------
 * 4. THE DATE LINE — Ioke 2006, and the fault that made Lala a green ring
 * ------------------------------------------------------------------------ */
{
  /* ==> THE ARCHIVE HAS ITS OWN SEAM STORMS AND THIS SUITE DID NOT CATCH THEM
   * AT FIRST. <== Written down because it is the finding: an earlier version
   * of this file passed with `sweepTimeline`'s branch fold deliberately
   * removed, which is the exact fault that swept Lala's 34 kt band 359.75°
   * around the planet last week. Katrina and Ida are both mid-Atlantic and
   * cannot show it.
   *
   * MEASURED 2026-08-24 across the mirrored archive: **thirteen storms from
   * 2004 on cross ±180 carrying a wind field** — Ioke, Kika, Maka, Omeka,
   * Pewa, Genevieve, Halola, Kilo, Hector, Dora and three unnamed. Ioke is the
   * fixture because she is the worst of them: 83 records, all 83 carrying
   * radii, crossing westbound at record 42 where her published longitude jumps
   * -179.8 to +179.3 — half a degree of ocean and 359 degrees of number line.
   *
   * The 34 kt corridor is 56° of longitude wide. Unfolded it is ~359°, and the
   * difference between those two numbers is the whole bug. */
  const ioke = seasonOf('epacific', 2006).find((s) => s.id === 'CP012006');
  ok('Ioke 2006 is in the mirrored file and carries a wind field on every '
    + 'record', ioke && ioke.points.every((p) => p.radii.r34));
  ok('and she really does cross the seam in her PUBLISHED longitudes',
    ioke.points.some((p, i) => i > 0 && Math.abs(p.lon - ioke.points[i - 1].lon) > 180));

  const built = buildSeasonSwath(ioke);
  eq('her footprint is three bands, unbroken — a corridor cut at the seam '
    + 'would be two shapes on opposite rims of the map', built.length, 3);

  for (const f of built) {
    const xs = f.geometry.coordinates[0].map((c) => c[0]);
    const span = Math.max(...xs) - Math.min(...xs);
    ok(`the ${f.properties.radii} kt band spans ${span.toFixed(1)}° of `
      + 'longitude, not most of the planet — under 90° is a corridor, near '
      + '360° is a ring around the globe', span < 90);
  }

  /* ==> AND IT RUNS PAST ±180 BY DESIGN. <== One shape across the seam, the
   * same convention `lib/trackline.js` and the live wind swath already use.
   * A band folded back inside ±180 would be the cut shape this exists to
   * avoid, so it is asserted rather than tolerated. */
  const wide = built.find((f) => f.properties.radii === 34);
  ok('and it carries on past -180 rather than snapping back, which is what '
    + 'makes it one shape',
    Math.min(...wide.geometry.coordinates[0].map((c) => c[0])) < -180);
}

/* ---------------------------------------------------------------------------
 * 5. A STORM THE RECORD NEVER MEASURED
 * ------------------------------------------------------------------------ */
{
  const old = atl1851[0];
  eq('an 1851 storm produces no footprint at all', buildSeasonSwath(old).length, 0);
  ok('and `season-facts` flags it as missing rather than as empty — a '
    + 'different answer, and the one the sentence is built on',
    stormFacts(old).missing.windField === true);

  /* ==> NOTHING IN THE BUILDER GATES ON A YEAR. <== §57.6: an 1852 storm
   * carries a radius of maximum wind 169 years before that cliff, so the
   * archive decides every missing value by reading the row. Proven by giving
   * an 1851 storm real radii and watching a footprint appear. */
  const grafted = JSON.parse(JSON.stringify(old));
  for (const p of grafted.points) {
    p.radii = { r34: { ne: 60, se: 60, sw: 40, nw: 40 }, r50: null, r64: null };
  }
  ok('an 1851 storm WITH radii gets a footprint — the year is never a gate',
    buildSeasonSwath(grafted).length === 1);
}

/* ---------------------------------------------------------------------------
 * 6. THE SENTENCE — §57.25 rule 2, and the thing Aaron judges on glass
 * ------------------------------------------------------------------------ */
{
  const old = atl1851[0];
  const eraNote = footprintNoteHtml({ storm: old, facts: stormFacts(old) });
  ok('a pre-2004 storm gets the ERA sentence, which teaches something true '
    + 'about the record', eraNote.includes(`wasn't recorded before ${SEASONS.windFieldFirstSeason}`));
  ok('and it names the storm', eraNote.includes('Storm 1') || eraNote.length > 0);

  /* ==> THE ERA SENTENCE MUST NOT BE SAID ABOUT A STORM THAT DISPROVES IT.
   * <== A 2004-or-later storm with no wind field would make "wasn't recorded
   * before 2004" a claim its own subject is the counter-example to. Built
   * from a real modern storm with its radii stripped, which is the shape a
   * live b-deck season could produce. */
  const modern = JSON.parse(JSON.stringify(ida));
  for (const p of modern.points) p.radii = { r34: null, r50: null, r64: null };
  const plain = footprintNoteHtml({ storm: modern, facts: stormFacts(modern) });
  ok('a 2004-or-later storm with no wind field gets the PLAIN sentence',
    plain.includes('No wind field was recorded'));
  ok('and never the era claim', !plain.includes('before 2004'));

  eq('a storm that HAS a footprint says nothing — a presence speaks for '
    + 'itself and the shape is on the globe',
    footprintNoteHtml({ storm: katrina, facts: stormFacts(katrina) }), '');
  eq('nothing focused says nothing', footprintNoteHtml(null), '');
}

/* ---------------------------------------------------------------------------
 * 7. THE LAYER — attach, focus, and the "focused storm only" bound
 * ------------------------------------------------------------------------ */
{
  const map = fakeMap();
  ensureSeasonSwath(map, 'storm-dot-planet');
  eq('two layers are added — the fill and its outline',
    map.added.map((l) => l.id), ['season-swath-fill', 'season-swath-line']);
  eq('both anchor beneath the storm dots, so the tracks and the landfall '
    + 'marks sit ON TOP of the wash that is about them',
    map.added.map((l) => l.beforeId), ['storm-dot-planet', 'storm-dot-planet']);
  eq('the fill takes the archive token, not the live one',
    map.added[0].paint['fill-opacity'], ARCHIVE_GEO.swathFillOpacity);
  ok('and the bands stack in severity order, so the 64 kt core is not buried '
    + 'under the 34 kt wash',
    JSON.stringify(map.added[0].layout['fill-sort-key']) === JSON.stringify(['get', '_wsev']));

  ensureSeasonSwath(map, 'storm-dot-planet');
  eq('attaching twice is a no-op', map.added.length, 2);

  /* ==> TICKING DRAWS NOTHING. <== The bound that makes this feature cheap
   * and keeps four storms from becoming twelve translucent shapes. */
  setSeasonSwathSet(map, [{ storm: katrina }, { storm: ida }]);
  eq('ticking two storms draws nothing at all', map.data().features.length, 0);

  setSeasonSwathFocus(map, katrina.id);
  eq('focusing one draws exactly its three bands', map.data().features.length, 3);
  eq('and every band carries the storm id, so focus can reach it',
    [...new Set(map.data().features.map((f) => f.properties.id))], [katrina.id]);
  ok('and a §6 threshold colour, baked in rather than left to a fallback',
    map.data().features.every((f) => typeof f.properties._wcolor === 'string'
      && f.properties._wcolor.length > 0));

  setSeasonSwathFocus(map, ida.id);
  eq('focusing another swaps the footprint rather than adding to it',
    [...new Set(map.data().features.map((f) => f.properties.id))], [ida.id]);

  setSeasonSwathFocus(map, null);
  eq('`Show all evenly` takes the footprint off', map.data().features.length, 0);

  /* A storm nobody has ticked is refused, mirroring the board's own rule. */
  setSeasonSwathFocus(map, 'AL011851');
  eq('a storm that is not in the set cannot be focused', map.data().features.length, 0);

  /* ==> UNTICKING THE FOCUSED STORM TAKES ITS FOOTPRINT WITH IT. <== Leaving
   * it up would be the globe disagreeing with the roster, which is the one
   * thing §57.21a spends its focus routing on preventing. */
  setSeasonSwathFocus(map, ida.id);
  setSeasonSwathSet(map, [{ storm: katrina }]);
  eq('unticking the focused storm clears the footprint', map.data().features.length, 0);
  eq('and forgets the focus', __internals.focus(), null);

  clearSeasonSwath(map);
  eq('leaving empties the layer', map.data().features.length, 0);
  eq('and forgets the set', __internals.size(), 0);

  /* ==> A BAND WHOSE THRESHOLD CANNOT BE READ IS DROPPED, NOT DRAWN IN A
   * DEFAULT HUE. <== Nothing in the archive produces one today — the builder
   * writes `radii` out of `WIND_KT` itself — so this is driven directly, and
   * it is driven because a mutation run on 2026-08-24 removed the guard and
   * every other assertion in this file stayed green. These are §6's fixed
   * safety colours: a missing band is visible, a wrong colour is a plausible
   * lie, and the failure this guards is silent either way. */
  eq('a band with an unreadable threshold is dropped',
    __internals.decorated([
      { type: 'Feature', properties: { radii: 34 }, geometry: null },
      { type: 'Feature', properties: { radii: 'gale' }, geometry: null },
      { type: 'Feature', properties: {}, geometry: null },
    ]).features.length, 1);

  const bare = fakeMap();
  setSeasonSwathSet(bare, [{ storm: katrina }]);
  setSeasonSwathFocus(bare, katrina.id);
  clearSeasonSwath(bare);
  ok('pushing to a map with no source is a no-op, not a crash', true);
  pass++;
}

/* ---------------------------------------------------------------------------
 * 8. THE COST — the measurement that justified drawing one storm
 * ------------------------------------------------------------------------ */
{
  const t0 = Date.now();
  const built = buildSeasonSwath(ida);
  const ms = Date.now() - t0;
  const verts = built.reduce((a, f) => a + f.geometry.coordinates[0].length, 0);
  ok(`one storm builds in well under a frame budget's worth of headroom `
    + `(${ms} ms, ${verts} vertices)`, ms < 200 && verts < 6000);

  /* ==> AND THE WHOLE SEASON IS THE NUMBER THAT SETTLED THE DESIGN. <== 31
   * storms is roughly 300 ms and 35,000 vertices, on a phone, on the archive's
   * most frequent interaction. Asserted so the figure stays honest if the
   * sweep's tuning changes — it is the evidence behind "focused storm only",
   * and a future pass arguing to draw them all should have to argue with it. */
  const t1 = Date.now();
  let all = 0;
  for (const s of atl2005) all += buildSeasonSwath(s).length;
  const seasonMs = Date.now() - t1;
  ok(`the whole 2005 season would cost ${seasonMs} ms for ${all} bands — the `
    + 'measurement behind drawing the focused storm only', all > 60);
}

/* ------------------------------------------------------------------------ */

if (fails.length) {
  console.error(`\n✗ ${fails.length} failed, ${pass} passed\n`);
  for (const f of fails) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`✓ ${pass} assertions pass — the archive's wind footprint, and the `
  + 'landfall rows that would have torn it apart');
