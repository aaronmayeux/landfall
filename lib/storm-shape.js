/**
 * storm-shape.js — three facts about the shape of a storm's life.
 * SPEC-SEASONS-BUILD.md §57.48, §57.42 Tier 1 items 4, 6 and 8.
 *
 * ==> ALL THREE ARE ARITHMETIC OVER ROWS `lib/hurdat.js` ALREADY PARSES. <==
 * No new data, no runner job, not one byte on the phone. The comeback walks
 * the wind column, the season window reads the first record's date against the
 * basin's own calendar, and the origin reads the first position.
 *
 * ==> THEY LIVE HERE RATHER THAN IN `lib/season-facts.js` BECAUSE THAT FILE
 * WAS 63 LINES UNDER §12's CEILING. <== Three functions carrying their reasons
 * would have taken it over, and the ceiling exists precisely so that the
 * answer is a new file rather than a bigger one. `season-facts.js` imports
 * this; nothing here imports it back.
 *
 * ==> AND ALL THREE ANSWER `null` WHEN THEY CANNOT ANSWER, NEVER `false`. <==
 * §5. `false` says the app looked and the storm was not one of these; `null`
 * says the app could not look. A 1851 storm with no wind column has not
 * "failed to make a comeback", and a basin whose season dates this repo does
 * not hold has not "formed in season".
 *
 * Imports config/ only. No DOM, no network, no clock, no map.
 */

import { SEASONS } from '../config/constants.js';

/* ---------------------------------------------------------------------------
 * THE COMEBACK — §57.42 item 4
 * ------------------------------------------------------------------------- */

/**
 * A hurricane that fell apart and came back as a hurricane.
 *
 * The walk is three stages in order: reach `hurricaneKt`, then fall below
 * `comebackFloorKt`, then reach `hurricaneKt` again. Order is the whole rule —
 * every storm on record starts below 34 kt, so a test that only asks whether
 * the storm was ever weak and ever strong is true of the entire archive.
 *
 * ==> IT STOPS AT THE FIRST COMEBACK RATHER THAN COUNTING THEM. <== No storm
 * in the mirrored archive does it twice, and a count would put "2" on a panel
 * with nothing to compare it against. The dates of the one that happened are
 * the story.
 *
 * ==> STATUS IS NOT FILTERED, AND JOHN 2024 IS WHY. <== The obvious tidy-up is
 * to require a cyclone status at the low point, the way `forwardSpeed` and ACE
 * both do. Measured 2026-08-29: thirteen of the fourteen storms this finds sit
 * at `TD` when they bottom out, and the fourteenth — John, EP102024 — is
 * `DB`, a disturbance. That is the storm that came ashore in Mexico, fell to
 * pieces over land and rebuilt itself into a hurricane offshore, which is the
 * single best example of the fact this sentence exists to state. A status
 * filter would delete it and nothing would look wrong.
 *
 * That filter is right for the other two callers for a reason that does not
 * apply here: they measure a rate, where a remnant carried along by the
 * westerlies is the atmosphere moving rather than the storm. This measures
 * whether the wind came back, and a disturbance's wind is still the storm's.
 *
 * @param {Array<object>} ordered  fixes, already sorted by time
 * @returns {{fellTime:number, fellKt:number, backTime:number,
 *   firstHurricaneTime:number} | null}  null means no comeback, or no wind
 *   column to look in
 */
export function comeback(ordered) {
  const w = (ordered || []).filter((p) => Number.isFinite(p?.windKt));
  if (!w.length) return null;

  const high = SEASONS.hurricaneKt;
  const low = SEASONS.comebackFloorKt;

  let firstHurricaneTime = null;
  let fell = null;
  for (const p of w) {
    if (firstHurricaneTime == null) {
      if (p.windKt >= high) firstHurricaneTime = p.time;
      continue;
    }
    if (!fell) {
      if (p.windKt < low) fell = p;
      continue;
    }
    if (p.windKt >= high) {
      return {
        firstHurricaneTime,
        fellTime: fell.time,
        fellKt: fell.windKt,
        backTime: p.time,
      };
    }
  }
  return null;
}

/* ---------------------------------------------------------------------------
 * OUT OF SEASON — §57.42 item 6
 * ------------------------------------------------------------------------- */

/** `[month, day]` as a comparable integer. June 1 is 601, November 30 is 1130. */
const dayKey = (month, day) => month * 100 + day;

/**
 * Whether the storm formed before its basin's season opened or after it shut.
 *
 * ==> THE DATE READ IS THE FIRST RECORD, WHICH IS THE ONE THE PANEL ALREADY
 * PRINTS. <== `lifeHtml` shows `First seen`, and a sentence saying a storm
 * formed three weeks early has to agree with the date two rows above it or the
 * panel is arguing with itself. Using the first CYCLONE fix instead would be
 * defensible in isolation and would put two different formation dates on one
 * screen.
 *
 * ==> AN UNKNOWN BASIN PRODUCES `null`, NOT AN ATLANTIC ANSWER. <== See
 * `SEASONS.seasonWindows`. Step 13's basins have their own calendars and some
 * of them straddle the new year; grading them against June-to-November would
 * read exactly like a measurement.
 *
 * @param {string} basin  `AL`, `EP`, `CP`
 * @param {number} firstTime  epoch ms of the storm's first record
 * @returns {{side:'early'|'late', month:number, day:number,
 *   startMonth:number, startDay:number, endMonth:number, endDay:number}
 *   | null}  null means in season, or a basin with no window on file
 */
export function seasonWindow(basin, firstTime) {
  const win = SEASONS.seasonWindows[String(basin || '').toUpperCase()];
  if (!win || !Number.isFinite(firstTime)) return null;

  const d = new Date(firstTime);
  const month = d.getUTCMonth() + 1;
  const day = d.getUTCDate();
  const key = dayKey(month, day);
  const [startMonth, startDay] = win.start;
  const [endMonth, endDay] = win.end;

  /* ==> BOTH ENDS ARE INCLUSIVE. <== A storm first seen on June 1 opened the
   * season rather than beating it, and one seen on November 30 closed it. */
  let side = null;
  if (key < dayKey(startMonth, startDay)) side = 'early';
  else if (key > dayKey(endMonth, endDay)) side = 'late';
  if (!side) return null;

  return { side, month, day, startMonth, startDay, endMonth, endDay };
}

/* ---------------------------------------------------------------------------
 * WHERE IT WAS BORN — §57.42 item 8
 * ------------------------------------------------------------------------- */

/**
 * Whether the storm came off Africa or formed inside the basin.
 *
 * ==> IT READS THE FIRST FIX WITH A POSITION, NOT SIMPLY THE FIRST FIX. <== A
 * record with a time and no coordinates exists in the older seasons, and
 * taking its missing longitude as zero would put a genesis on the prime
 * meridian and call every such storm Cape Verde.
 *
 * ==> `lon` RATHER THAN `lonU`, AND THAT IS DELIBERATE. <== The unwrapped
 * longitude is a running total built for measuring distance across the date
 * line; it can legitimately read -190 or +200. This test is a box on the real
 * globe, so it wants the published position. The Atlantic never reaches the
 * seam — measured 2026-08-29, no Atlantic genesis in the archive lies east of
 * the prime meridian at all — so the two agree there today, and using the
 * published value keeps them agreeing if step 13 ever files a basin that does.
 *
 * ==> THE ANSWER HAS THREE VALUES, NOT TWO, AND 11 REAL STORMS ARE WHY. <==
 * The obvious build is a boolean: inside the box is Cape Verde, everything
 * else is home-grown. Measured 2026-08-29 over the 2,004 Atlantic storms in
 * the archive: 182 are inside the box, 1,811 are west of `capeVerdeMaxLon`,
 * and **11 sit east of it but north of `capeVerdeMaxLat`** — born in the far
 * eastern Atlantic, off Africa, and not in the Cape Verde latitudes. A
 * boolean would tell each of those 11 it formed inside the basin, which is
 * false, and the sentence would read perfectly.
 *
 * So `kind` comes back `null` for them and nothing is printed. §5: the rule
 * looked and declined, which is a different thing from the rule not being
 * asked. Two labels that between them do not cover the globe must not be
 * forced onto the storms in the gap.
 *
 * @param {string} basin
 * @param {Array<object>} ordered  fixes, already sorted by time
 * @returns {{kind:'cape-verde'|'home-grown'|null, lat:number, lon:number}
 *   | null}  null in a basin where the distinction is not made, or with no
 *   usable genesis. A `kind` of null means neither label fits.
 */
export function origin(basin, ordered) {
  if (!SEASONS.capeVerdeBasins.includes(String(basin || '').toUpperCase())) return null;
  const g = (ordered || []).find((p) => Number.isFinite(p?.lat) && Number.isFinite(p?.lon));
  if (!g) return null;

  let kind = null;
  if (g.lon > SEASONS.capeVerdeMaxLon) {
    if (g.lat < SEASONS.capeVerdeMaxLat) kind = 'cape-verde';
  } else {
    kind = 'home-grown';
  }
  return { kind, lat: g.lat, lon: g.lon };
}
