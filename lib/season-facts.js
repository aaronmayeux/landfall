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
import { firstCycloneTime, landfallNature } from './landfall.js';
import { comeback, seasonWindow, origin, trackLoop } from './storm-shape.js';

const HOURS = 3600 * 1000;
const RAD = Math.PI / 180;
/** Earth's radius in nautical miles. Everything measurable in this app is
 *  stored in nautical miles and converted at the last moment by
 *  `lib/units.js`, so the distance below comes out in the unit the rest of
 *  the app already speaks. */
const EARTH_NM = 3440.065;

/** Great-circle distance in nautical miles.
 *
 *  ==> THE DATE LINE IS SAFE HERE FOR FREE, AND THAT IS MEASURED RATHER THAN
 *  DESIGNED. <== Haversine takes `sin(Δλ/2)`, which is periodic, so 359.1° of
 *  raw longitude difference and 0.9° of real travel give the identical answer.
 *  Checked against Della (CP011957) crossing at record 34: passing the
 *  published `lon` instead of `lonU` changes nothing, to every decimal place.
 *
 *  It is still handed `lonU`, because that is this app's convention everywhere
 *  else and because the protection above belongs to the FORMULA rather than to
 *  the data — a later session swapping in flat-plane arithmetic for speed would
 *  lose it silently. `tools/test-season-facts.mjs` asserts Della's fastest leg
 *  stays sane, so that swap goes red. */
function distanceNm(aLat, aLon, bLat, bLon) {
  const p1 = aLat * RAD;
  const p2 = bLat * RAD;
  const dp = (bLat - aLat) * RAD;
  const dl = (bLon - aLon) * RAD;
  const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * EARTH_NM * Math.asin(Math.min(1, Math.sqrt(h)));
}

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
 * HOW FAST IT WAS MOVING — §57.43
 * ------------------------------------------------------------------------- */

/**
 * The fastest and slowest the storm's centre ever travelled.
 *
 * ==> SYNOPTIC ROWS ONLY, AND THAT IS NOT TIDINESS — IT IS THE DIFFERENCE
 * BETWEEN A SPEED AND A ROUNDING ERROR. <== NOAA inserts extra records at
 * landfalls and at peaks, off the six-hour clock: Ida's Louisiana landfall is
 * stamped 1655Z. Measured over the whole archive, 2,250 of 71,941 raw legs are
 * shorter than six hours, some as short as thirty minutes — and every position
 * in the file is rounded to 0.1°, about 6 nautical miles. Half an hour of
 * travel divided by that rounding produced legs reading 49 kt on storms that
 * were crawling. Walking the synoptic rows alone BRIDGES those inserted rows
 * rather than tripping over them, so a 12:00 → 18:00 leg is measured whole.
 *
 * ==> AND THE NON-CYCLONE FIXES ARE DROPPED, WHICH IS ABOUT WHAT THE NUMBER
 * MEANS. <== A remnant low sprinting northeast in the westerlies is the
 * atmosphere moving, not the storm; the same rule `stallWindow` and ACE both
 * already apply. Dropping them can join the two sides of a gap, which is
 * exactly what `SEASONS.trackSpeedMaxLegHours` then refuses.
 *
 * @param {Array<object>} ordered  fixes, already sorted, with `lonU`
 * @returns {{fastestKt:number, fastestFromTime:number, fastestToTime:number,
 *   slowestKt:number, slowestFromTime:number, slowestToTime:number,
 *   legs:number} | null}
 */
function forwardSpeed(ordered, { maxLegHours = SEASONS.trackSpeedMaxLegHours } = {}) {
  const pts = ordered.filter((p) => isSynoptic(p.time) && isCyclone(p.status)
    && Number.isFinite(p.lat) && Number.isFinite(p.lonU ?? p.lon));
  let fast = null;
  let slow = null;
  let legs = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const hours = (b.time - a.time) / HOURS;
    if (!(hours > 0) || hours > maxLegHours) continue;
    const kt = distanceNm(a.lat, a.lonU ?? a.lon, b.lat, b.lonU ?? b.lon) / hours;
    const leg = { kt, fromTime: a.time, toTime: b.time };
    legs++;
    if (!fast || kt > fast.kt) fast = leg;
    if (!slow || kt < slow.kt) slow = leg;
  }
  if (!legs) return null;
  return {
    fastestKt: fast.kt,
    fastestFromTime: fast.fromTime,
    fastestToTime: fast.toTime,
    slowestKt: slow.kt,
    slowestFromTime: slow.fromTime,
    slowestToTime: slow.toTime,
    legs,
  };
}

/* ---------------------------------------------------------------------------
 * HOW FAR IT WENT — §57.45
 * ------------------------------------------------------------------------- */

/**
 * The length of the track, and how much of it the storm covered as a cyclone.
 *
 * ==> IT WALKS EVERY FIX, WITH NONE OF `forwardSpeed`'s RULES, AND THAT IS A
 * MEASUREMENT RATHER THAN AN OVERSIGHT. <== Three things say so:
 *
 * 1. **THE FILE HAS NO GAPS TO BRIDGE.** Counted 2026-08-29 across both
 *    mirrored basins: **84,365 consecutive legs and not one longer than six
 *    hours**, the worst being exactly 6.00. The 228-hour leg
 *    `trackSpeedMaxLegHours` exists to refuse is CREATED by that walk's own
 *    cyclone filter, not present in the record. A straight sum over the raw
 *    fixes has nothing to trip over, so it gets no cap.
 * 2. **IT IS THE LINE ON THE GLOBE.** `map/layers/season-tracks.js` draws
 *    every recorded position with no status filter. A panel printing a
 *    shorter number under a longer line is the app disagreeing with its own
 *    picture, and the reader has no way to tell which half is wrong.
 * 3. **IT IS THE SPAN `lifespanHours` ALREADY MEASURES.** That runs first
 *    record to last and filters nothing either, so these two divide into a
 *    real average speed. Filtering one and not the other would put two
 *    figures on one panel that cannot be used together.
 *
 * ==> A LEG IS ATTRIBUTED TO THE STATUS AT ITS START, SO THE TWO FIGURES
 * PARTITION THE TRACK. <== Requiring both ends to be a cyclone would leave
 * every transition leg belonging to neither, and the panel's *"the rest was
 * covered as a wave or a remnant"* sentence would then be quietly short by
 * six hours of travel per transition. The start is also the honest
 * attribution: the leg is the ground covered FROM that fix.
 *
 * @param {Array<object>} ordered  fixes, already sorted, with `lonU`
 * @returns {{totalNm:number, cycloneNm:number, legs:number} | null}
 */
function trackDistance(ordered) {
  const pts = ordered.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lonU ?? p.lon));
  let totalNm = 0;
  let cycloneNm = 0;
  let legs = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const leg = distanceNm(a.lat, a.lonU ?? a.lon, b.lat, b.lonU ?? b.lon);
    totalNm += leg;
    if (isCyclone(a.status)) cycloneNm += leg;
    legs++;
  }
  if (!legs) return null;
  return { totalNm, cycloneNm, legs };
}

/* ---------------------------------------------------------------------------
 * HOW MUCH IT WEAKENED BEFORE THE COAST — §57.43
 * ------------------------------------------------------------------------- */

/**
 * The storm at its strongest before it came ashore, against the storm at the
 * coast. Katrina peaked at 150 kt and landed at 110 — a Category 5 that
 * arrived as a Category 3, and the fact people get wrong most often.
 *
 * ==> THE ANCHOR IS THE PEAK BEFORE THAT LANDFALL, NOT THE STORM'S OVERALL
 * PEAK, AND 17% OF THE ARCHIVE IS WHY. <== Measured 2026-08-29: of 1,341
 * storms with a landfall we can grade, **226 reached their overall peak AFTER
 * their hardest landfall.** For those the overall peak describes a storm that
 * went out to sea and got stronger, so subtracting it would report a
 * "weakening before the coast" that had not happened yet — a fluent wrong
 * number with nothing about it inviting a second look.
 *
 * ==> THE LANDFALL'S OWN WIND IS INSIDE THE WINDOW. <== `lib/landfall.js`
 * interpolates the wind at the crossing between the two fixes either side and
 * rounds it, so a storm still strengthening can be marginally stronger at the
 * coast than at any fix at or before it. Leaving it out produced 84 negative
 * "drops" across the archive — a weakening figure that says the storm got
 * stronger. With it in, the drop cannot be negative by construction.
 *
 * ==> THE LANDFALL PICKED IS THE HARDEST ONE, WHICH IS THE SAME CHOICE
 * `lib/season-story.js` MAKES. <== Two surfaces on one panel naming different
 * landfalls as the important one would read as a contradiction.
 *
 * A drop of zero is a real measurement — the storm came ashore at its
 * strongest — and 703 of those 1,341 storms did. It comes back as 0 and the
 * markup writes a different sentence for it; it is never null, because null
 * here means "cannot be computed".
 *
 * @returns {{landfallIndex:number, peakWindKt:number, peakCategory:number,
 *   landfallWindKt:number, landfallCategory:number|null, dropKt:number,
 *   categoriesDropped:number} | null}
 */
function coastalWeakening(ordered, landfalls) {
  let at = -1;
  for (let i = 0; i < landfalls.length; i++) {
    const w = landfalls[i].windKt;
    if (!Number.isFinite(w)) continue;
    if (at < 0 || w > landfalls[at].windKt) at = i;
  }
  if (at < 0) return null;

  const hard = landfalls[at];
  let peakKt = hard.windKt;
  for (const p of ordered) {
    if (!Number.isFinite(p.windKt) || p.time > hard.time) continue;
    if (p.windKt > peakKt) peakKt = p.windKt;
  }

  const peakCategory = categoryFromKt(peakKt);
  /* ==> THE ENTRY'S OWN CATEGORY, NOT A SECOND OPINION FROM ITS WIND. <==
   * §57.7c. `lib/landfall.js` withholds a Saffir-Simpson number from a
   * post-tropical landfall on purpose; recomputing one here from the same wind
   * would put "came ashore a Category 1" on Sandy's panel two lines under a
   * list that correctly declines to say so. */
  const landfallCategory = hard.category ?? null;
  return {
    landfallIndex: at,
    peakWindKt: peakKt,
    peakCategory,
    landfallWindKt: hard.windKt,
    landfallCategory,
    dropKt: peakKt - hard.windKt,
    categoriesDropped: landfallCategory == null ? 0 : Math.max(0, peakCategory - landfallCategory),
  };
}

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
  /* ==> THE FALLBACK ANSWERS THE SAME QUESTION AS THE WALK, AND UNTIL §57.7c
   * IT DID NOT. <== It had no status test at all, so a storm whose sidecar
   * failed to load showed NOAA's `L` on an extratropical record while the same
   * storm with the sidecar present did not. Sandy was two different storms
   * depending on whether a file arrived. `landfallNature` is now the one rule
   * both roads take, and the fallback is a SHORTER list rather than a
   * differently-judged one. */
  const bornAt = firstCycloneTime(ordered);
  const computed = Array.isArray(storm?.landfallsComputed) ? storm.landfallsComputed : null;
  const landfallSource = computed ? 'computed' : 'noaa';
  const landfalls = computed || ordered
    .filter((p) => String(p.marker || '').toUpperCase() === 'L')
    .map((p) => ({
      point: p,
      nature: landfallNature(p.status, p.windKt, p.time, bornAt),
    }))
    .filter((e) => e.nature)
    .map(({ point: p, nature }) => ({
      time: p.time,
      lat: p.lat,
      lon: p.lon,
      windKt: p.windKt,
      pressureMb: p.pressureMb,
      category: nature === 'post-tropical' || !Number.isFinite(p.windKt)
        ? null : categoryFromKt(p.windKt),
      nature,
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
    /* ==> HOW MANY REAL COAST CROSSINGS THE RULE TURNED DOWN, OR `null` FOR
     * "NOBODY WALKED". <== §5, §57.7e. Only a walk can answer this, so the
     * NOAA fallback leaves it null rather than zero: NOAA publishes markers,
     * not refusals, and a zero there would state that nothing was declined on
     * the strength of a file that never looked. A number, including 0, means
     * the coastline was actually crossed against. */
    crossingsDeclined: Number.isFinite(storm?.crossingsDeclined)
      ? storm.crossingsDeclined : null,
    fastest24h: fastest,
    ending,

    /* ==> BOTH OF THESE ARE COMPUTED FROM THE SAME ROWS EVERYTHING ELSE HERE
     * IS, AND NEITHER COSTS A BYTE ON THE PHONE. <== §57.43. `forwardSpeed`
     * takes the ordered fixes because it does its own synoptic filtering;
     * `coastalWeakening` takes the landfall list ABOVE IT, so it grades
     * whichever list is on screen — ours or NOAA's — rather than a third one
     * of its own. */
    forwardSpeed: forwardSpeed(ordered),
    coastalWeakening: coastalWeakening(ordered, landfalls),

    /* ==> AND THIS ONE WALKS THE SAME `ordered` FIXES WITH NONE OF
     * `forwardSpeed`'s FILTERING. <== §57.45, and the reasons are at the
     * function. Measured today the two agree exactly on which storms they can
     * answer for — 3,234 have both and the same 32 have neither — but that is
     * a fact about HURDAT2's regular six-hourly clock rather than a
     * guarantee, and step 13's basins arrive from other agencies. Nothing
     * downstream may assume one implies the other. */
    trackDistance: trackDistance(ordered),

    /* ==> THE THREE SHAPE-OF-LIFE FACTS, COMPUTED IN `lib/storm-shape.js`.
     * <== §57.48. Each is `null` when it cannot be answered rather than
     * `false`, so the markup can tell "this storm did not" from "the record
     * does not say" — the same §5 distinction `crossingsDeclined` above makes.
     *
     * `seasonWindow` takes `ordered[0].time` rather than a first-cyclone time
     * on purpose: it has to agree with the `First seen` row this same object
     * feeds. The reason is at the function. */
    comeback: comeback(ordered),
    seasonWindow: seasonWindow(storm.basin, ordered[0].time),
    origin: origin(storm.basin, ordered),

    /* ==> AND THE FOURTH, WHICH IS GEOMETRY RATHER THAN A READING OF A
     * COLUMN. <== §57.49. `trackLoop` walks every pair of segments looking for
     * a crossing, so it is the only fact in this object whose cost grows with
     * the square of the track length. Measured 2026-08-29 on the longest track
     * in the archive (AL031899, 133 fixes): **0.33 ms**, and 45 ms to walk all
     * 3,266 storms. Nothing here needs a bound on the track length. */
    loop: trackLoop(ordered),

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
 * WHERE THIS STORM SAT IN ITS OWN SEASON — §57.43
 * ------------------------------------------------------------------------- */

/**
 * One storm's standing among the storms it shared a season with.
 *
 * ==> A FUNCTION TAKING THE SEASON RATHER THAN A FIELD ON `stormFacts`,
 * BECAUSE A RANK IS NOT A PROPERTY OF A STORM. <== Katrina's peak wind is
 * hers forever; her being third strongest is a fact about 2005, and it would
 * be a different number the moment the record was reanalysed or the reader
 * was looking at a different basin. `stormFacts` describes a storm from its
 * own rows and nothing else, and folding a comparison in would make a stable
 * fact depend on what else happened to be loaded.
 *
 * ==> TIES SHARE A RANK, AND THEY ARE NOT AN EDGE CASE. <== HURDAT2 writes
 * wind in 5-knot steps, so a season's strongest is frequently a draw:
 * measured 2026-08-29, **54 of 294 seasons have a tied top peak wind** and 12
 * have a tie for longest-lived. Standard competition ranking — two storms tied
 * at the top are both 1st and the next is 3rd — plus a `tied` count so the
 * panel can say "tied strongest" rather than claiming an outright win.
 *
 * ==> A ONE-STORM SEASON HAS NO RANKING AND SAYS SO BY ANSWERING null. <== 24
 * seasons in the archive hold a single storm, and "1st strongest of 1" is a
 * sentence that tells the reader nothing while looking like it told them
 * something.
 *
 * @param {object|null} facts   the storm, from `stormFacts`
 * @param {Array<object>} all   every storm in that season, from `stormFacts`
 * @returns {{storms:number, strength:{rank:number, tied:number}|null,
 *   lifespan:{rank:number, tied:number}|null, majors:number,
 *   onlyMajor:boolean} | null}
 */
export function rankInSeason(facts, all) {
  if (!facts?.id) return null;
  const list = (all || []).filter((f) => f && f.id);
  if (list.length < 2) return null;
  if (!list.some((f) => f.id === facts.id)) return null;

  /* Ranked among the storms that HAVE the figure, never among all of them. A
   * storm with no wind recorded is not the weakest of the season; nobody
   * measured it, and counting it into the denominator would quietly make
   * every other storm's rank a claim about a different set. */
  const place = (key) => {
    const mine = facts[key];
    if (!Number.isFinite(mine)) return null;
    const graded = list.filter((f) => Number.isFinite(f[key]));
    if (graded.length < 2) return null;
    const above = graded.filter((f) => f[key] > mine).length;
    const same = graded.filter((f) => f[key] === mine).length;
    return { rank: above + 1, tied: same, of: graded.length };
  };

  const majors = list.filter((f) => Number.isFinite(f.peakWindKt)
    && f.peakWindKt >= SEASONS.majorKt);

  return {
    storms: list.length,
    strength: place('peakWindKt'),
    lifespan: place('lifespanHours'),
    majors: majors.length,
    onlyMajor: majors.length === 1 && majors[0].id === facts.id,
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

export const __internals = {
  isSynoptic, isCyclone, distanceNm, forwardSpeed, coastalWeakening, trackDistance,
};
