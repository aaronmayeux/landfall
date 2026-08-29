#!/usr/bin/env node
/**
 * test-seasons-places.mjs — the places sidecar. §57.40, §57.42 Tier 2 item 1.
 *
 * ZERO DEPENDENCIES, plain `node tools/test-seasons-places.mjs`.
 *
 * ==> THE GAZETTEER ITSELF IS NOT DRIVEN HERE AND CANNOT BE. <== It loads
 * 58 MB over the network — 135,233 towns and 4,596 admin-1 polygons — which is
 * a runner's job and not a suite's. What IS driven is everything around it:
 * which point gets asked, with which cap, what happens to the answer, and what
 * the file looks like. A stub gazetteer records every question it was asked,
 * so the assertions are about the QUESTIONS rather than about GeoNames.
 *
 * ==> THE ONE THING A STUB CANNOT CATCH IS THE DATE LINE, SO IT IS ASSERTED AS
 * A QUESTION. <== The archive stores longitude unwrapped: a Central Pacific
 * landfall in the Marshall Islands arrives as 187, not −173. Handed to a town
 * index keyed on real longitude, 187 is a point in the Atlantic and the answer
 * would be a confident wrong name rather than no name. The stub records the
 * longitude it was handed and this suite checks it was wrapped first.
 *
 * WHAT THIS CANNOT PROVE: that a name is the RIGHT name. §57.40's fifteen
 * hand-checked landfalls are that evidence, and the job prints its own hit rate
 * on every run.
 */

import path from 'node:path';
import { mkdtempSync, readFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';

const ROOT = path.resolve(import.meta.dirname, '..');
process.chdir(ROOT);

let pass = 0;
const failures = [];
const ok = (c, m) => { c ? pass++ : failures.push(m); };
const section = (n) => console.log(`\n  ${n}`);

const { SEASONS } = await import('../config/constants.js');
const { wrapLon, placeEntry, basinPlaces, syncPlaces, placesFile } = await import('./seasons-places.mjs');
const { landfallFileName, placesFileName } = await import('../lib/seasons-sidecar.js');
const SHIPPED_INDEX = JSON.parse(readFileSync('seasons/index.json', 'utf8'));

/** A gazetteer that answers a fixed name and remembers every question. */
function stubGazetteer(answer = { name: 'Testville', region: 'Testshire', country: 'Testland', km: 7 }) {
  const asked = [];
  return {
    asked,
    nearestPlace(lat, lon, capKm) {
      asked.push({ lat, lon, capKm });
      return typeof answer === 'function' ? answer(lat, lon, capKm) : answer;
    },
  };
}

const raw = (f) => readFileSync(`samples/seasons/storms/${f}.txt`, 'utf8');

/* ------------------------------------------------------------------------- */
section('THE DATE LINE — the archive is unwrapped and the town index is not');
{
  ok(wrapLon(187) === -173, `187 east is 173 west. Got ${wrapLon(187)}`);
  ok(wrapLon(-190) === 170, `-190 is 170 east. Got ${wrapLon(-190)}`);
  ok(wrapLon(-60) === -60 && wrapLon(0) === 0 && wrapLon(179.9) === 179.9,
    'and a longitude already in range is untouched');
  ok(wrapLon(180) === 180 && wrapLon(-180) === 180,
    'the seam itself resolves one way rather than two, so a cache key cannot split');

  const gaz = stubGazetteer();
  placeEntry(gaz, 10, 187, 60);
  ok(gaz.asked[0].lon === -173,
    '==> THE WRAP HAPPENS AT THE DOOR. <== A Marshall Islands landfall arrives at 187 and a '
    + `town index keyed on real longitude would answer with somewhere in the Atlantic. Got ${gaz.asked[0].lon}`);
}

/* ------------------------------------------------------------------------- */
section('TWO CAPS, AND THEY ARE DIFFERENT QUESTIONS');
{
  const gaz = stubGazetteer();
  const marks = { AL092017: [{ lat: 28.0, lon: -97.0, time: 1, windKt: 115, category: 5 }] };
  basinPlaces(raw('al092017'), marks, gaz);

  const caps = gaz.asked.map((q) => q.capKm);
  ok(caps.includes(SEASONS.placeNearKm),
    `a landfall is asked at placeNearKm (${SEASONS.placeNearKm}). Got ${caps.join(',')}`);
  ok(caps.filter((c) => c === SEASONS.placeFarKm).length >= 1,
    `genesis and the stall are asked at placeFarKm (${SEASONS.placeFarKm})`);
  ok(SEASONS.placeNearKm < SEASONS.placeFarKm,
    '==> A LANDFALL CLAIMS TO BE *AT* A PLACE AND A GENESIS ONLY CLAIMS A BEARING. <== §57.40. '
    + '"Came ashore near Nouakchott" for a point 400 km down an empty coast reads as a fact '
    + 'and is not one, so the two caps must not converge');
}

/* ------------------------------------------------------------------------- */
section('THE ANSWER IS TRIMMED TO WHAT A SENTENCE NEEDS');
{
  const gaz = stubGazetteer({ name: 'Fulton', region: 'Texas', country: 'United States', km: 11, pop: 1500 });
  const e = placeEntry(gaz, 28, -97, 60);
  ok(e.name === 'Fulton, Texas, United States', `assembled by placeLabel. Got ${e.name}`);
  ok(e.km === 11, 'and the distance rides along, because the genesis clause prints it');
  ok(e.pop === undefined && e.region === undefined,
    '==> POPULATION AND THE RAW REGION ARE DROPPED. <== Nothing downstream reads them and '
    + 'they are bytes on a phone for a field no sentence uses');
}

/* ------------------------------------------------------------------------- */
section('BEYOND THE CAP THE ANSWER IS NOTHING, NOT THE FAR-AWAY TOWN');
{
  const gaz = stubGazetteer(() => null);
  ok(placeEntry(gaz, 28, -97, 60) === null,
    'the gazetteer declining is passed straight through rather than softened');
  ok(placeEntry(gaz, NaN, -97, 60) === null && placeEntry(gaz, 28, undefined, 60) === null,
    'and a point that is not a point is never asked about at all');
}

/* ------------------------------------------------------------------------- */
section('THE LANDFALL ARRAY IS INDEX-ALIGNED WITH THE SIDECAR IT WAS GIVEN');
{
  const seen = [];
  const gaz = stubGazetteer((lat, lon) => {
    seen.push([lat, lon]);
    return lat > 25 ? { name: `N${Math.round(lat)}`, country: null, region: null, km: 5 } : null;
  });
  const marks = {
    AL092017: [
      { lat: 13.1, lon: -59.5, time: 1 },
      { lat: 28.0, lon: -97.0, time: 2 },
      { lat: 29.8, lon: -93.3, time: 3 },
    ],
  };
  const { places } = basinPlaces(raw('al092017'), marks, gaz);
  const lf = places.AL092017.landfalls;

  ok(lf.length === 3, `one slot per landfall, in order. Got ${lf.length}`);
  ok(lf[0] === null && lf[1] && lf[2],
    '==> A LANDFALL WITH NO TOWN NEAR IT HOLDS ITS SLOT AS `null` RATHER THAN BEING SKIPPED. '
    + '<== Compacting the array would slide every later name onto the wrong coast');
  ok(lf[1].name === 'N28' && lf[2].name === 'N30', 'and the order is the sidecar\'s order');
}

/* ------------------------------------------------------------------------- */
section('THE STALL IS WRITTEN DOWN WHOLE, NOT AS A NAME THE PHONE HAS TO RE-EARN');
{
  const gaz = stubGazetteer({ name: 'Bloomington', region: 'Texas', country: 'United States', km: 9 });
  const { places } = basinPlaces(raw('al092017'), { AL092017: [] }, gaz);
  const st = places.AL092017.stall;

  ok(st && Number.isFinite(st.at) && Number.isFinite(st.hours),
    '==> THE WINDOW TRAVELS WITH THE NAME. <== Leaving the phone to re-derive it means a '
    + 'constant moved without a new revision stamp attaches the right name to the wrong days, '
    + 'and nothing would notice');
  ok(st.hours >= SEASONS.stallMinHours,
    `and it clears the minimum. Got ${st && st.hours}`);
  ok(st.name === 'Bloomington, Texas, United States', `named. Got ${st && st.name}`);

  const nowhere = stubGazetteer(() => null);
  const out = basinPlaces(raw('al092017'), { AL092017: [] }, nowhere).places.AL092017;
  ok(out.stall && out.stall.name === null && out.stall.km === null,
    '==> A STALL WITH NO TOWN IS STILL A STALL. <== §57.41: "it barely moved for two days" '
    + 'with no anchor still tells the reader the storm stopped, and the paragraph says '
    + '"out over open water" rather than dropping the clause');
}

/* ------------------------------------------------------------------------- */
section('A STORM WITH NOTHING TO NAME IS ABSENT, AND THE FILE IS WHAT SAYS WE LOOKED');
{
  const gaz = stubGazetteer(() => null);
  const { places, storms, named } = basinPlaces(raw('al122005'), {}, gaz);
  ok(storms === 1, 'the fixture is one storm');
  ok(named === 0 && Object.keys(places).length === 0,
    '==> AN ENTRY OF ALL NULLS IS BYTES SAYING NOTHING. <== The same convention the landfall '
    + 'sidecar uses for a storm that stayed at sea: the FILE being on screen carries "this '
    + 'basin was walked", and a missing id inside it is an answer rather than a gap');

  const some = stubGazetteer({ name: 'Somewhere', region: null, country: null, km: 3 });
  const r2 = basinPlaces(raw('al122005'), {}, some);
  ok(r2.named === 1 && r2.places.AL122005.genesis?.name === 'Somewhere',
    'and one name is enough to earn an entry');
  ok(r2.places.AL122005.landfalls === undefined,
    'an empty landfall list is omitted rather than written as []');
}

/* ------------------------------------------------------------------------- */
section('THE COUNTERS THE JOB PRINTS ARE COUNTS OF REAL THINGS');
{
  const gaz = stubGazetteer((lat) => (lat > 25 ? { name: 'X', region: null, country: null, km: 1 } : null));
  const marks = { AL092017: [{ lat: 13, lon: -59, time: 1 }, { lat: 28, lon: -97, time: 2 }] };
  const r = basinPlaces(raw('al092017'), marks, gaz);
  ok(r.landfallMarks === 2 && r.landfallNamed === 1,
    `==> THE HIT RATE IS THE ONLY EVIDENCE ANYBODY HAS THAT THE CAP IS RIGHT. <== `
    + `Got ${r.landfallNamed}/${r.landfallMarks}`);
  ok(r.stalls === 1 && r.stallsNamed === 1, `stalls counted separately. Got ${r.stallsNamed}/${r.stalls}`);
}

/* ------------------------------------------------------------------------- */
section('WRITING — an unchanged archive commits nothing');
{
  const dir = mkdtempSync(path.join(tmpdir(), 'places-'));
  mkdirSync(path.join(dir, 'seasons/data'), { recursive: true });
  const payload = { basin: 'atlantic', revision: 'R1', storms: { A: { genesis: { name: 'X', km: 1 } } } };

  const first = syncPlaces(dir, 'atlantic', 'R1', payload);
  const second = syncPlaces(dir, 'atlantic', 'R1', payload);
  ok(first.written === true, 'the first write happens');
  ok(second.written === false,
    '==> BYTE-IDENTICAL OUTPUT MEANS NO COMMIT. <== The file carries no timestamp of its own '
    + 'precisely so a monthly run over an unchanged archive is a no-op in git');

  const changed = syncPlaces(dir, 'atlantic', 'R1',
    { ...payload, storms: { A: { genesis: { name: 'Y', km: 1 } } } });
  ok(changed.written === true, 'and a real change is written');

  const onDisk = JSON.parse(readFileSync(path.join(dir, placesFile('atlantic', 'R1')), 'utf8'));
  ok(onDisk.storms.A.genesis.name === 'Y', 'and it is the new bytes on disk');
  ok(placesFile('atlantic', 'R1') === `seasons/data/atlantic-places-${SEASONS.placesSchema}-R1.json`,
    '==> THE REVISION IS IN THE FILENAME. <== `seasons/data/*` is `immutable` for a year in '
    + '_headers, so a corrected archive has to arrive as a NEW URL or no browser ever sees it');
  rmSync(dir, { recursive: true, force: true });
}

/* ------------------------------------------------------------------------- */
section('THE SHIPPED FILES AGREE WITH THE SHIPPED LANDFALLS');
{
  for (const basin of ['atlantic', 'epacific']) {
    /* The revision off the index and the names off the shared builder, so a
     * schema bump does not leave this suite reading a deleted file. */
    const rev = SHIPPED_INDEX.basins[basin].revision;
    const places = JSON.parse(readFileSync(`seasons/data/${placesFileName(basin, rev)}`, 'utf8'));
    const marks = JSON.parse(readFileSync(`seasons/data/${landfallFileName(basin, rev)}`, 'utf8'));

    ok(places.source === 'computed',
      `${basin}: the file says so itself, so a reader of this JSON in two years does not have `
      + 'to find §57.40 to learn these names were derived');
    ok(places.nearKm === SEASONS.placeNearKm && places.farKm === SEASONS.placeFarKm,
      `${basin}: the caps it was built with are recorded`);

    let checked = 0;
    let mismatched = 0;
    for (const [id, entry] of Object.entries(places.storms)) {
      if (!entry.landfalls) continue;
      checked++;
      if ((marks.storms[id] || []).length !== entry.landfalls.length) mismatched++;
    }
    ok(checked > 0, `${basin}: something to check (${checked} storms with landfall names)`);
    ok(mismatched === 0,
      `${basin}: ==> EVERY PLACES ARRAY IS THE SAME LENGTH AS THE LANDFALL LIST IT NAMES. <== `
      + `They are joined by index on the phone. Got ${mismatched} of ${checked} out of step`);
  }
}

/* ------------------------------------------------------------------------- */
section('THE ATTACH POINT — `null` and `{}` must survive the trip to the panel');
{
  const { loadSeason, loadPlaces, clearSeasonCache } = await import('../data/seasons.js');
  const index = {
    dir: '/seasons/data',
    basins: { atlantic: { revision: '02272026', seasons: { 2017: 'atlantic-2017-02272026.txt' } } },
  };
  const realFetch = globalThis.fetch;

  /** Serve the real shipped files off disk; refuse whichever URL is named. */
  const serve = (deny = null) => async (url) => {
    const name = String(url).split('/').pop();
    if (deny && name.includes(deny)) return { ok: false, status: 404 };
    const body = readFileSync(`seasons/data/${name}`, 'utf8');
    return { ok: true, status: 200, text: async () => body, json: async () => JSON.parse(body) };
  };

  globalThis.fetch = serve();
  clearSeasonCache();
  let res = await loadSeason(index, 'atlantic', 2017);
  const harvey = res.storms.find((s) => s.name === 'HARVEY');
  ok(res.status === 'ok' && harvey, 'the season loads');
  ok(harvey.places && harvey.places.landfalls?.length === 4,
    `==> THE NAMES REACH THE STORM. <== Got ${JSON.stringify(harvey.places?.landfalls?.length)}`);

  const quiet = res.storms.find((s) => s.places && !s.places.genesis && !s.places.landfalls);
  ok(res.storms.every((s) => s.places !== null),
    'every storm in a loaded basin carries an object, even the ones with nothing to name');
  ok(quiet !== undefined || res.storms.some((s) => Object.keys(s.places).length === 0),
    '==> A STORM THE JOB HAD NOTHING TO SAY ABOUT ARRIVES AS `{}`. <== That is an ANSWER — '
    + '"the basin was walked and there is no town near this one" — and the paragraph is '
    + 'allowed to say "out over open water" on the strength of it');

  globalThis.fetch = serve('places');
  clearSeasonCache();
  res = await loadSeason(index, 'atlantic', 2017);
  ok(res.status === 'ok' && res.storms.length > 0,
    '==> LOSING A 38 KB COMPANION MUST NOT LOSE THE YEAR. <== §5. The storms are what the '
    + 'reader asked for; the names are an improvement on them');
  ok(res.storms.every((s) => s.places === null),
    '==> AND `null` TRAVELS ALL THE WAY, RATHER THAN BECOMING AN EMPTY OBJECT. <== The two '
    + 'mean different things in the paragraph, and collapsing them prints "out over open '
    + 'water" under a storm that formed in the Gulf of Mexico on a day this file 404\'d');
  ok(res.storms.some((s) => (s.landfallsComputed || []).length > 0),
    'and the landfalls, which are a different file and a different job, are unaffected');

  /* ==> AND THE SAME RULE ON THE OTHER FILE, WHICH IS THE OLDER HALF OF THIS
   * SEAM. <== A failed landfall fetch must fall back to NOAA's sparser marks
   * with `landfallSource` naming them, never to an empty list — an empty list
   * says "this storm stayed at sea", which is a claim. */
  globalThis.fetch = serve('landfalls');
  clearSeasonCache();
  res = await loadSeason(index, 'atlantic', 2017);
  const { stormFacts } = await import('../lib/season-facts.js');
  const noMarks = res.storms.find((s) => s.name === 'HARVEY');
  ok(noMarks && !Array.isArray(noMarks.landfallsComputed),
    'nothing is attached when the landfall file did not arrive');
  ok(stormFacts(noMarks).landfallSource === 'noaa',
    `and the panel falls back to NOAA's own marks. Got ${stormFacts(noMarks).landfallSource}`);

  clearSeasonCache();
  ok(await loadPlaces({ dir: '/seasons/data', basins: {} }, 'atlantic') === null,
    'a basin with no revision is answered null rather than fetched at a guessed filename');

  globalThis.fetch = realFetch;
}

/* ------------------------------------------------------------------------- */
console.log(`\n  ${pass} passed, ${failures.length} failed`);
for (const f of failures) console.log(`    FAIL  ${f}`);
process.exit(failures.length ? 1 : 0);
