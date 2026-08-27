/**
 * season-facts.js — the figures nobody publishes, computed from the numbers.
 * SPEC-SEASONS-BUILD.md §57.15, §57.22.
 *
 * ==> NONE OF THIS IS IN ANY FILE. <== HURDAT2 carries positions, winds and
 * pressures. Peak intensity, lifespan, days at hurricane strength, ACE, the
 * landfall list, how the storm ended and the season scorecard all fall out of
 * those numbers. This is the whole of the detail panel and the whole of the
 * season board, and it is arithmetic rather than a fetch.
 *
 * ==> ACE COUNTS SYNOPTIC RECORDS ONLY, AND GETTING THAT WRONG INFLATES
 * EXACTLY THE FAMOUS STORMS. <== The index is defined over the four six-hourly
 * observation times. NOAA inserts EXTRA records at landfalls and at peaks —
 * Ida has three landfall rows and a peak row that are not on the six-hour
 * clock — so a sum over every row in the file double-counts the most intense
 * moments of the most intense storms. `tools/test-season-facts.mjs` counts
 * both ways and asserts they differ, so the day someone "simplifies" this the
 * suite says so.
 *
 * ==> CATEGORY IS NOT IN THE FILE EITHER. <== It is derived from wind, by the
 * same `lib/category.js` the live app grades a dot with. One category
 * function, both worlds, so a Cat 3 in 1935 and a Cat 3 today are the same
 * claim.
 *
 * Imports config/ and lib/category.js. No DOM, no network, no clock, no map.
 */

import { SEASONS } from '../config/constants.js';
import { categoryFromKt } from './category.js';

const HOURS = 3600 * 1000;

/** True for a record on the six-hourly synoptic clock. Minutes must be zero:
 *  a landfall row stamped 1655Z is not a synoptic observation even though it
 *  sits in the same hour as one. */
function isSynoptic(timeMs) {
  const d = new Date(timeMs);
  if (d.getUTCMinutes() !== 0) return false;
  return SEASONS.aceSynopticHours.includes(d.getUTCHours());
}

/** True when the system was a tropical or subtropical cyclone at this record.
 *  `EX` extratropical, `LO` low, `WV` wave and `DB` disturbance are all in the
 *  file and none of them counts. */
const isCyclone = (status) => SEASONS.cycloneStatuses.includes(String(status || '').toUpperCase());

/* ---------------------------------------------------------------------------
 * ONE STORM
 * ------------------------------------------------------------------------- */

/**
 * Every derived fact about one storm.
 *
 * ==> A FACT THAT CANNOT BE COMPUTED COMES BACK AS `null`, NEVER AS ZERO. <==
 * §5, and it matters most here: a 1935 storm has no wind radii and a 1900 one
 * may have no pressure at all. Zero pressure is a claim; null is the truth,
 * and §57.25's honest line is what the panel draws instead.
 */
export function stormFacts(storm) {
  const pts = (storm?.points || []).filter((p) => Number.isFinite(p?.time));
  if (!pts.length) return null;

  const ordered = pts.slice().sort((a, b) => a.time - b.time);
  const withWind = ordered.filter((p) => Number.isFinite(p.windKt));
  const withPressure = ordered.filter((p) => Number.isFinite(p.pressureMb));

  /* PEAK. Ties go to the EARLIER record, so a storm that holds its peak for
   * eighteen hours reports when it first got there rather than when it
   * happened to be last measured at it. */
  let peak = null;
  for (const p of withWind) {
    if (!peak || p.windKt > peak.windKt) peak = p;
  }

  let lowest = null;
  for (const p of withPressure) {
    if (!lowest || p.pressureMb < lowest.pressureMb) lowest = p;
  }

  /* TIME AT STRENGTH. Measured as the gap each record covers, taken as the
   * span to the NEXT record — so a storm's last record contributes nothing
   * rather than an invented six hours. */
  const hoursAt = (minKt) => {
    let ms = 0;
    for (let i = 0; i < ordered.length - 1; i++) {
      const p = ordered[i];
      if (!Number.isFinite(p.windKt) || p.windKt < minKt) continue;
      if (!isCyclone(p.status)) continue;
      ms += ordered[i + 1].time - p.time;
    }
    return ms / HOURS;
  };

  /* ACE — synoptic records, cyclone status, at least tropical-storm force. */
  let ace = 0;
  let aceRecords = 0;
  for (const p of ordered) {
    if (!Number.isFinite(p.windKt)) continue;
    if (p.windKt < SEASONS.namedStormKt) continue;
    if (!isCyclone(p.status)) continue;
    if (!isSynoptic(p.time)) continue;
    ace += p.windKt * p.windKt;
    aceRecords++;
  }
  ace = ace / SEASONS.aceDivisor;

  /* ==> LANDFALLS ARE OURS NOW, AND NOAA'S ARE THE FALLBACK RATHER THAN THE
   * ANSWER. <== §57.7a, Aaron's call 2026-08-27. `lib/landfall.js` crosses the
   * track against a real coastline on the runner and the result arrives here
   * attached to the storm; NOAA's `L` markers are still parsed, still carried,
   * and no longer decide.
   *
   * WHY, in one number: NOAA marked 839 storms across the archive and we find
   * 1,343, because the `L` marker is missing entirely for twelve Atlantic
   * years and for thirty-nine East Pacific ones (§57.7) and is heavily
   * US-biased everywhere else. Liza in 1976 killed about a thousand people at
   * La Paz and carries no `L` record at all.
   *
   * ==> THE FALLBACK IS NOAA'S LIST, NOT AN EMPTY ONE. <== §5. When the
   * computed file has not arrived — the season in progress, which has no
   * reviewed record at all, or a sidecar that failed to load — an empty list
   * would say "this storm stayed at sea", which is a claim. NOAA's sparser
   * answer plus `landfallSource` naming it is the honest degradation, and it
   * is what keeps the 1971-1982 sentence in `ui/season-detail-markup.js`
   * reachable for exactly the case it was written for.
   *
   * `source` on each entry is the per-mark stamp §57.7 asked for on day one;
   * `landfallSource` below is the same fact about the LIST, so a caller does
   * not have to look inside an empty array to find out whose empty it is. */
  const computed = Array.isArray(storm?.landfallsComputed) ? storm.landfallsComputed : null;
  const landfallSource = computed ? 'computed' : 'noaa';
  const landfalls = computed || ordered
    .filter((p) => String(p.marker || '').toUpperCase() === 'L')
    .map((p) => ({
      time: p.time,
      lat: p.lat,
      lon: p.lon,
      windKt: p.windKt,
      pressureMb: p.pressureMb,
      category: Number.isFinite(p.windKt) ? categoryFromKt(p.windKt) : null,
      source: 'noaa',
    }));

  /* FASTEST 24 HOURS. The rapid-intensification figure, measured over a real
   * window rather than over "four records", because the record spacing is not
   * six hours everywhere in this file. */
  const windowMs = SEASONS.intensificationWindowHours * HOURS;
  let fastest = null;
  for (let i = 0; i < withWind.length; i++) {
    for (let j = i + 1; j < withWind.length; j++) {
      const span = withWind[j].time - withWind[i].time;
      if (span > windowMs) break;
      const gain = withWind[j].windKt - withWind[i].windKt;
      if (!fastest || gain > fastest.gainKt) {
        fastest = { gainKt: gain, fromTime: withWind[i].time, toTime: withWind[j].time, hours: span / HOURS };
      }
    }
  }

  /* HOW IT ENDED. The last record's status, read rather than guessed. `EX` is
   * a transition to extratropical; a cyclone status at the end means the file
   * simply stops, which is what dissipation looks like in this format. HURDAT2
   * does not record absorption at all, so nothing here claims it. */
  const last = ordered[ordered.length - 1];
  const lastStatus = String(last.status || '').toUpperCase();
  const ending = lastStatus === 'EX' ? 'extratropical'
    : isCyclone(lastStatus) ? 'dissipated'
      : lastStatus === 'LO' ? 'remnant_low'
        : 'unknown';

  return {
    id: storm.id,
    name: storm.name,
    year: storm.year,
    basin: storm.basin,
    provisional: !!storm.provisional,

    firstTime: ordered[0].time,
    lastTime: last.time,
    lifespanHours: (last.time - ordered[0].time) / HOURS,

    peakWindKt: peak ? peak.windKt : null,
    peakCategory: peak ? categoryFromKt(peak.windKt) : null,
    peakTime: peak ? peak.time : null,
    peakLat: peak ? peak.lat : null,
    peakLon: peak ? peak.lon : null,

    lowestPressureMb: lowest ? lowest.pressureMb : null,
    lowestPressureTime: lowest ? lowest.time : null,

    hoursAtHurricane: hoursAt(SEASONS.hurricaneKt),
    hoursAtMajor: hoursAt(SEASONS.majorKt),

    ace: aceRecords ? ace : null,
    aceRecords,

    landfalls,
    landfallSource,
    fastest24h: fastest,
    ending,

    /* What the file could NOT tell us, said out loud rather than left as a
     * shape full of nulls for a renderer to interpret. §57.25. */
    missing: {
      wind: withWind.length === 0,
      pressure: withPressure.length === 0,
      windField: !ordered.some((p) => p.radii && (p.radii.r34 || p.radii.r50 || p.radii.r64)),
      rmw: !ordered.some((p) => Number.isFinite(p.rmwNm)),
    },
  };
}

/* ---------------------------------------------------------------------------
 * ONE SEASON
 * ------------------------------------------------------------------------- */

/**
 * The scorecard for a whole season.
 *
 * ==> A QUIET-LOOKING 1935 IS NOT EVIDENCE OF A QUIET SEASON. <== Before
 * roughly 1966 nobody saw the storms that stayed at sea, so the counts below
 * are an undercount and the board has to say so. `undercountLikely` is that
 * flag, set from the year rather than from the numbers, because the numbers
 * are exactly what cannot show it.
 */
export function seasonFacts(storms, { year = null, basin = null } = {}) {
  const list = (storms || []).map(stormFacts).filter(Boolean);

  const named = list.filter((f) => Number.isFinite(f.peakWindKt) && f.peakWindKt >= SEASONS.namedStormKt);
  const hurricanes = list.filter((f) => Number.isFinite(f.peakWindKt) && f.peakWindKt >= SEASONS.hurricaneKt);
  const majors = list.filter((f) => Number.isFinite(f.peakWindKt) && f.peakWindKt >= SEASONS.majorKt);

  const withAce = list.filter((f) => Number.isFinite(f.ace));
  const ace = withAce.length ? withAce.reduce((s, f) => s + f.ace, 0) : null;

  const landfalls = list.reduce((s, f) => s + f.landfalls.length, 0);
  const stormsWithLandfall = list.filter((f) => f.landfalls.length > 0).length;

  /* ==> ONE SOURCE FOR THE WHOLE SEASON, OR NONE. <== The sidecar arrives per
   * BASIN, so every storm in a season has the same answer — but saying
   * `computed` off the first storm would be a guess if that ever stopped being
   * true, and a season silently mixing NOAA's sparse marks with ours would
   * make its own total uninterpretable. Unanimity or `mixed`. */
  const sources = new Set(list.map((f) => f.landfallSource));
  const landfallSource = sources.size === 1 ? [...sources][0] : (sources.size === 0 ? 'noaa' : 'mixed');

  const y = Number.isFinite(year) ? year : (list[0]?.year ?? null);

  return {
    year: y,
    basin: basin || list[0]?.basin || null,
    storms: list.length,
    named: named.length,
    hurricanes: hurricanes.length,
    majors: majors.length,
    ace,
    landfalls,
    stormsWithLandfall,
    landfallSource,
    strongest: list.reduce((a, b) => {
      if (!Number.isFinite(b.peakWindKt)) return a;
      if (!a || b.peakWindKt > a.peakWindKt) return b;
      return a;
    }, null),

    /* §57.6's last two entries, which are not date cliffs but are missing data
     * all the same. Both are properties of the ERA, so they are decided here
     * and drawn as a line rather than left for a reader to notice. */
    undercountLikely: Number.isFinite(y) ? y < SEASONS.satelliteEraFrom : false,
    provisional: list.some((f) => f.provisional),
  };
}

/* ---------------------------------------------------------------------------
 * IS THIS STORM STILL HAPPENING? (§57.21c)
 * ------------------------------------------------------------------------- */

/**
 * True when this storm is still running RIGHT NOW.
 *
 * ==> IT IS THE ONE FACT THAT SEPARATES THE TWO GLOBES, WHICH IS WHY IT IS A
 * FUNCTION AND NOT A FIELD ON `stormFacts`. <== A storm that is still happening
 * belongs to the LIVE globe: it has a cone, a wind field, a watch and warning
 * map and an advisory behind it, none of which the archive has or should
 * pretend to. Drawing its half-written best track on the sepia globe as though
 * it were history is the archive claiming a storm is over when nobody has said
 * so — §5's shape, wearing a year.
 *
 * `stormFacts` describes a storm from its own rows and is therefore stable
 * forever; this answer changes every six hours. Folding it in would make a
 * memoised fact a perishable one.
 *
 * ==> THE B-DECK HAS NO "OVER" FLAG, SO THIS IS AN INFERENCE AND IS LABELLED
 * ONE. <== NHC stops appending rows and the file goes quiet; the only signal is
 * how long ago the last row was written. `SEASONS.activeWithinHours` carries
 * the cadence argument and the direction the error should fall in.
 *
 * ==> `provisional` IS ASKED FIRST AND IT IS NOT A SHORTCUT. <== A settled year
 * cannot contain a running storm no matter what the arithmetic says, and
 * without this a reviewed file whose clock or timestamps went wrong could put
 * "active" beside a storm from 1938.
 *
 * @param {object|null} facts  from `stormFacts`
 * @param {object}  [opts]
 * @param {boolean} [opts.provisional]  is this the season still running?
 * @param {number}  [opts.nowMs]        injectable, so the suite can pin it
 * @returns {boolean}
 */
export function isStillRunning(facts, { provisional = false, nowMs = Date.now() } = {}) {
  if (!provisional) return false;
  if (!Number.isFinite(facts?.lastTime)) return false;
  const ageHours = (nowMs - facts.lastTime) / HOURS;
  /* A NEGATIVE AGE IS STILL RUNNING, NOT AN ERROR. A fix stamped slightly
   * ahead of the reader's clock is an ordinary consequence of a phone whose
   * time is a minute out, and the honest reading of "the last row is in the
   * future" is certainly not "this storm finished". */
  return ageHours <= SEASONS.activeWithinHours;
}

export const __internals = { isSynoptic, isCyclone };
