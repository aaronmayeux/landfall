/**
 * abpw.js — JTWC's Significant Tropical Weather Advisory, parsed. SPEC §45.3.
 *
 * The only genesis product found outside NHC that carries a probability. It is
 * a plain-text bulletin written for a human reading a teleprinter, so this file
 * is the one genuinely new piece of code in §45 and the one most likely to be
 * broken by an upstream rewording.
 *
 * ==> WRITTEN AGAINST REAL BYTES, AND THE FIRST DRAFT WAS WRONG. <== Every
 * pattern lives in `GENESIS.ABPW` with the measurement that produced it. Three
 * of the four patterns in the version written from the spec's prose matched
 * nothing at all against the live bulletin (archive branch, 2026-08-09 03:00Z),
 * and the failure was SILENT: a parser that finds nothing returns an empty
 * list, and an empty list here renders as "nothing is brewing in the Western
 * Pacific" — a §5 failure that looks perfect on screen. If a pattern is
 * changed, change it against bytes on the archive branch, never against a
 * remembered shape.
 *
 * WHAT IT READS AND WHAT IT DELIBERATELY SKIPS:
 *   Section A, TROPICAL CYCLONE SUMMARY   — SKIPPED. Those systems are already
 *                                           in the storm list from JTWC's own
 *                                           warnings; parsing them here would
 *                                           show one typhoon twice.
 *   Section B, TROPICAL DISTURBANCE SUMMARY — READ. The genesis candidates.
 *   Section C, SUBTROPICAL SYSTEM SUMMARY  — SKIPPED. Not tropical genesis.
 *
 * THE OUTPUT SPEAKS JTWC'S LANGUAGE, NOT NHC'S. A word, over 24 hours. There
 * is no `prob7day` on these objects and there must never be one: mapping HIGH
 * onto some invented percentage would be inventing data (§45.3). The drawer
 * renders what each source said, labelled with its own horizon.
 *
 * Imports config/ and lib/ only.
 */

import { GENESIS } from '../config/constants.js';
import { normalizeRisk } from './genesis.js';
import { basinFromPosition, BASIN_LABEL } from './basin.js';

const A = GENESIS.ABPW;

/** A fresh copy of a global regex.
 *
 *  THE CONSTANTS ARE SHARED AND GLOBAL REGEXES CARRY `lastIndex` BETWEEN
 *  CALLS. Reusing the frozen object directly means the second poll starts
 *  scanning from wherever the first one stopped, so the app parses the
 *  bulletin correctly once and then finds nothing — intermittently, depending
 *  on how the last scan ended. Cheap to avoid, very expensive to debug. */
const fresh = (re) => new RegExp(re.source, re.flags);

/**
 * `090300` in a header dated within the last few days → an epoch ms.
 *
 * The bulletin gives DAY, HOUR and MINUTE and no month or year, so the rest
 * comes from the clock — which is the one place a device clock is unavoidable.
 * MONTH ROLLOVER IS HANDLED BY LOOKING BACKWARD ONLY: a bulletin can be hours
 * old, never days in the future, so a day-of-month ahead of today means last
 * month rather than next. Without this, a bulletin issued on the 31st and read
 * on the 1st lands a month in the future and is silently discarded as
 * impossible.
 */
export function parseHeaderTime(day, hour, minute, now = new Date()) {
  const d = Number(day);
  const h = Number(hour);
  const m = Number(minute);
  if (!(d >= 1 && d <= 31 && h >= 0 && h <= 23 && m >= 0 && m <= 59)) return null;

  let year = now.getUTCFullYear();
  let month = now.getUTCMonth();
  if (d > now.getUTCDate() + 1) {
    month -= 1;
    if (month < 0) {
      month = 11;
      year -= 1;
    }
  }
  const t = Date.UTC(year, month, d, h, m, 0, 0);
  return Number.isFinite(t) ? t : null;
}

/** `20.5`, `N` → `20.5`. `152.3`, `W` → `-152.3`. */
function signed(value, hemi) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const H = String(hemi).toUpperCase();
  return H === 'S' || H === 'W' ? -n : n;
}

/** Collapse the hard wrapping. The bulletin breaks at ~70 columns, including
 *  through the middle of the probability sentence, so every pattern is applied
 *  to this rather than to the raw bytes. */
const flatten = (text) => String(text).replace(/\s+/g, ' ').trim();

/**
 * Parse a bulletin.
 *
 * ==> RETURNS A STATE, NEVER THROWS, AND `unavailable` IS NOT `none_matched`.
 *     <== §45.5 keeps three states apart and this is where two of them are
 * decided. A bulletin that will not parse is `unavailable` — we could not
 * read it. A bulletin that parses and lists no disturbances is `none_matched`
 * — JTWC looked and there is nothing. Collapsing them would turn a broken
 * upstream into a quiet all-clear over the busiest cyclone basin on earth.
 *
 * @returns {{status:'ok'|'none_matched'|'unavailable', issuedAt:number|null,
 *            systems:object[], reason?:string}}
 */
export function parseAbpw(text, { now = Date.now() } = {}) {
  const raw = String(text || '');

  const head = raw.match(A.headerPattern);
  if (!head) {
    return {
      status: 'unavailable',
      issuedAt: null,
      systems: [],
      reason: 'no WMO header — this is not an ABPW bulletin',
    };
  }

  const issuedAt = parseHeaderTime(head[2], head[3], head[4], new Date(now));
  if (issuedAt == null) {
    return {
      status: 'unavailable',
      issuedAt: null,
      systems: [],
      reason: 'unreadable issue time',
    };
  }

  /* TOO OLD IS UNAVAILABLE, NOT EMPTY. Reissued several times a day, so a
   * full day of silence means the product is broken rather than quiet — and a
   * day-old "HIGH" is a worse answer than an honest gap. */
  if (now - issuedAt > A.maxAge) {
    return {
      status: 'unavailable',
      issuedAt,
      systems: [],
      reason: 'bulletin is over a day old',
    };
  }

  const flat = flatten(raw);
  const systems = [];

  const blocks = fresh(A.disturbanceBlock);
  let block;
  while ((block = blocks.exec(flat)) !== null) {
    const items = fresh(A.itemPattern);
    let item;
    while ((item = items.exec(block[1])) !== null) {
      const parsed = parseItem(item[2]);
      if (parsed) systems.push(parsed);
    }
  }

  return {
    status: systems.length ? 'ok' : 'none_matched',
    issuedAt,
    systems,
  };
}

/**
 * One numbered disturbance item → a system, or null when it is not one.
 *
 * FOUR WAYS AN ITEM IS CORRECTLY NULL, and none of them is an error:
 *   - "NO OTHER SUSPECT AREAS."       no designator, nothing to show
 *   - it has been upgraded to a warning — it is a STORM now and is already in
 *     the storm list under its own number (measured: item (2) of the
 *     2026-08-09 bulletin, REMNANTS 13W, warned as TD 13W KUJIRA in the SAME
 *     bulletin's section A)
 *   - no position — nothing to put on a globe or sort by basin
 *   - no probability sentence — JTWC has not stated odds, and inventing one
 *     to fill the row is the thing §45.3 forbids in as many words
 */
function parseItem(body) {
  const text = flatten(body);
  if (!text) return null;

  if (A.upgradedPattern.test(text)) return null;

  const des = text.match(A.designatorPattern);
  if (!des) return null;

  const pos = text.match(A.positionPattern);
  if (!pos) return null;
  const lat = signed(pos[1], pos[2]);
  const lon = signed(pos[3], pos[4]);
  if (lat == null || lon == null) return null;

  const sentence = text.match(A.potentialSentence);
  if (!sentence) return null;
  const words = sentence[0].match(fresh(A.riskWord));
  if (!words || !words.length) return null;
  /* THE LAST WORD IN THE SENTENCE — see the note on `riskWord`. JTWC closes
   * with the level, and the paragraph is full of "LOW VERTICAL WIND SHEAR". */
  const risk = normalizeRisk(words[words.length - 1]);

  const designation = des[2].toUpperCase();
  const basin = basinFromPosition(lon, lat);

  return {
    id: `jtwc-genesis-${designation}`,
    source: 'JTWC',
    /* "Invest 98W" — JTWC's OWN designator, title-cased for a row. Unlike the
     * NHC areas, nothing here is invented: this is what the bulletin calls it.
     * REMNANTS keeps its own word rather than being flattened to "Invest",
     * because a regenerating system and a fresh wave are different things and
     * the bulletin distinguishes them. */
    title: `${des[1].charAt(0).toUpperCase()}${des[1].slice(1).toLowerCase()} ${designation}`,
    basin,
    basinLabel: BASIN_LABEL[basin] || null,
    centroid: { lon, lat },
    /* NO GEOMETRY. JTWC publishes a point and no area, so this system has a
     * position and nothing to hatch. The globe draws NHC's polygons only; a
     * JTWC system is a drawer row and a camera target. Do not invent a radius
     * to draw a circle with. */
    geometry: null,

    /* JTWC'S LANGUAGE, UNCONVERTED. A word, over 24 hours. There is no
     * percentage here and there must never be one. */
    risk,
    horizon: GENESIS.HORIZON.jtwc,
    prob2day: null,
    prob7day: null,
  };
}
