/**
 * rainfall.js — the NWS gridded rainfall series, read. SPEC §48.3–§48.6, §48.8.
 *
 * Pure. No DOM, no network, no clock of its own — every function that needs
 * "now" is handed it, for the same reason the home dashboard is: a sentence
 * about what is still ahead can only be tested against a moment somebody can
 * choose, and the one complete capture this project has is from August.
 *
 * ==> THE UNITS ARE MILLIMETRES AND THEY ARE READ, NEVER ASSUMED. <== §48.4.
 * `quantitativePrecipitation.uom` reads `wmoUnit:mm` at every point ever
 * probed, INCLUDING the five American ones, while the advisory beside it is
 * written in inches. Code that assumes inches because the words say inches
 * produces a number 25.4 times too small and looks entirely plausible on the
 * page — there is no shape to that failure, only a wrong figure. So the unit
 * is parsed, an unrecognised one is an ANSWER (`unreadable`) rather than a
 * guess, and every number below this line is millimetres.
 *
 * ==> `validTime` IS AN INTERVAL, NOT A TIMESTAMP. <== §48.4. The format is
 * `2026-08-15T22:00:00+00:00/PT6H` — an instant, a solidus, and an ISO 8601
 * duration saying how long the value covers. Two ways to get this wrong, both
 * of which parse and neither of which throws: splitting on `T` returns
 * nonsense, and discarding the duration treats a twelve-hour block as an hour.
 *
 * ==> THE DURATIONS ARE NOT UNIFORM. <== Not within one response and not
 * between offices. Measured on the captured grids: Hilo mixes `PT1H` and
 * `PT6H`, Guam runs to `PT12H`, San Juan includes `PT3H`, and Key West — which
 * §48.4 does not mention — carries a `PT5H`. That last one is the whole
 * argument for parsing the duration rather than enumerating the ones a spec
 * happened to list.
 *
 * Imports: config/ and lib/ only.
 */

import { RAIN, UNITS } from '../config/constants.js';
import { resolveSystem } from './units.js';
import { formatDayPart } from './time.js';

const MM_PER_INCH = 25.4;

/** The unit codes this file knows how to turn into millimetres.
 *
 *  DELIBERATELY A SHORT LIST WITH NO FALLBACK. An unrecognised code means the
 *  API changed or we are reading a field we did not think we were; both are
 *  cases where the honest output is "could not read this", and neither is a
 *  case where a plausible number helps anybody (§5). */
const TO_MM = Object.freeze({
  'wmounit:mm': 1,
  'wmounit:cm': 10,
  'wmounit:m': 1000,
  'wmounit:in': MM_PER_INCH,
});

/**
 * An ISO 8601 duration → milliseconds, or null.
 *
 * Only the forms this field actually publishes: days, hours and minutes. A
 * duration carrying months or years is not a rainfall block, and returning
 * null for one is better than inventing a length for a month.
 */
export function parseDuration(iso) {
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?)?$/.exec(String(iso || ''));
  if (!m || (!m[1] && !m[2] && !m[3])) return null;
  const days = Number(m[1] || 0);
  const hours = Number(m[2] || 0);
  const mins = Number(m[3] || 0);
  return ((days * 24 + hours) * 60 + mins) * 60 * 1000;
}

/**
 * One `validTime` → `{ startMs, durationMs, endMs }`, or null.
 *
 * Both halves must parse. A block with a readable start and an unreadable
 * length is not a shorter block, it is an unknown one, and summing it as if
 * it were an hour is exactly the silent error §48.4 names.
 */
export function parseInterval(validTime) {
  const raw = String(validTime || '');
  const slash = raw.indexOf('/');
  if (slash < 0) return null;
  const startMs = Date.parse(raw.slice(0, slash));
  const durationMs = parseDuration(raw.slice(slash + 1));
  if (!Number.isFinite(startMs) || durationMs == null) return null;
  return { startMs, durationMs, endMs: startMs + durationMs };
}

/**
 * The relay's series → blocks in millimetres, oldest first.
 *
 * @returns {{state:'ok', blocks:Array, uom:string} |
 *           {state:'unreadable', detail:string} |
 *           {state:'not_covered'}}
 *
 * ==> A MISSING SERIES IS `not_covered`, NOT AN ERROR. <== §48.5's `[VERIFY]`:
 * some offices reportedly do not populate every element, and all eight probed
 * points that answered 200 carried this one. Until one is seen that does not,
 * the honest reading of a 200 with no precipitation in it is that this place
 * has no rainfall forecast — which is a fact, and not something a Retry button
 * can change.
 */
export function readSeries(payload) {
  const series = payload?.values;
  if (!Array.isArray(series) || series.length === 0) return { state: 'not_covered' };

  const uom = String(payload?.uom || '');
  const factor = TO_MM[uom.toLowerCase()];
  if (!factor) return { state: 'unreadable', detail: `unrecognised units ${uom || '(none)'}` };

  const blocks = [];
  for (const v of series) {
    const span = parseInterval(v?.validTime);
    if (!span || !Number.isFinite(v?.value)) continue;
    blocks.push({ ...span, mm: v.value * factor });
  }
  if (!blocks.length) return { state: 'unreadable', detail: 'no readable blocks in the series' };

  blocks.sort((a, b) => a.startMs - b.startMs);
  return { state: 'ok', blocks, uom };
}

/** Blocks that START inside `hours` of the first one.
 *
 *  ==> THE RULE IS THE BLOCK'S START, NOT ITS END. <== A six-hour block
 *  beginning an hour before the cutoff belongs to the window it began in;
 *  splitting it would mean inventing a rate inside it, and dropping it would
 *  lose rain the reader is going to get. Measured against Hilo, this is what
 *  makes the first 24 hours 254.508 mm (§48.11). */
export function windowBlocks(blocks, hours) {
  if (!blocks?.length) return [];
  const cutoff = blocks[0].startMs + hours * 3600 * 1000;
  return blocks.filter((b) => b.startMs < cutoff);
}

/** Total millimetres over a window of `hours` from the series start. */
export function windowTotalMm(blocks, hours) {
  return windowBlocks(blocks, hours).reduce((sum, b) => sum + b.mm, 0);
}

/** The wettest single block, or null. Ties go to the earlier one — a reader
 *  preparing for weather wants the first time it happens, not the last. */
export function peakBlock(blocks) {
  let best = null;
  for (const b of blocks || []) if (!best || b.mm > best.mm) best = b;
  return best;
}

/**
 * A rain total in the reader's own units.
 *
 * ==> WHOLE INCHES ABOVE ONE, AND THAT IS A DECISION ABOUT HONESTY RATHER
 * THAN ABOUT TIDINESS. <== §48.8. The grid says 282.956 mm, which converts to
 * 11.14 inches, and printing that claims a precision no rainfall forecast four
 * days out has. The reader's decision — sandbags or not — does not turn on the
 * tenth. Below an inch the tenth is the whole figure, so it stays.
 *
 * Metric gets whole millimetres in both bands: one millimetre in eleven inches
 * is a third of a percent, which is not a precision claim anybody would read
 * as one, and every weather service in the world states mm whole.
 */
export function formatRainTotal(mm, system) {
  if (!Number.isFinite(mm)) return null;
  if (resolveSystem(system) !== UNITS.IMPERIAL) return `${Math.round(mm)} mm`;
  const inches = mm / MM_PER_INCH;
  if (inches < 1) return `${inches.toFixed(1)} inches`;
  const whole = Math.round(inches);
  return `${whole} ${whole === 1 ? 'inch' : 'inches'}`;
}

/** A block's length in words: "six hours", "twelve hours", "an hour". Used in
 *  the peak sentence, where a numeral beside another numeral ("6 hours bring 3
 *  inches") reads as arithmetic rather than as a sentence. */
export function durationWords(ms) {
  const hours = Math.round(ms / 3600000);
  const NAMES = ['', 'an hour', 'two hours', 'three hours', 'four hours', 'five hours',
    'six hours', 'seven hours', 'eight hours', 'nine hours', 'ten hours', 'eleven hours',
    'twelve hours'];
  if (hours >= 1 && hours < NAMES.length) return NAMES[hours];
  if (hours >= 24 && hours % 24 === 0) return hours === 24 ? 'a day' : `${hours / 24} days`;
  return `${hours} hours`;
}

/**
 * The flood-family alerts in force at a point, now.
 *
 * TWO FILTERS, AND THEY ARE DIFFERENT JOBS. The event filter is about which
 * section owns a fact — a Hurricane Warning belongs to `In effect` and saying
 * it twice makes the app look like it does not know what it already told you.
 * The expiry filter is about time: a flash flood warning is routinely shorter
 * than one poll interval (Hilo's ran 52 minutes), so a cached alert becomes a
 * lie about now inside the hour. It is applied HERE, at render, and not only
 * where the payload is fetched.
 *
 * `ends` outranks `expires` when both are present and disagree: `expires` is
 * when the message goes stale, `ends` is when the weather does.
 */
export function floodAlerts(features, nowMs) {
  const out = [];
  for (const f of features || []) {
    const p = f?.properties || f || {};
    const event = String(p.event || '');
    if (!event.toLowerCase().includes(RAIN.alertEventMatch)) continue;

    const until = Date.parse(p.ends || p.expires || '');
    if (Number.isFinite(until) && until <= nowMs) continue;

    out.push({
      event,
      severity: p.severity || null,
      urgency: p.urgency || null,
      untilMs: Number.isFinite(until) ? until : null,
      /* ==> SEVERITY IS NOT THE ORDER. <== A Flood Watch and a Flash Flood
       * Warning are both `Severe`, so the word cannot separate them. What
       * does is `urgency`: `Immediate` is happening, `Expected` is soon,
       * `Future` is later. */
      immediate: p.urgency === 'Immediate',
    });
  }
  out.sort((a, b) => Number(b.immediate) - Number(a.immediate));
  return out;
}

/**
 * Everything the home Rain section renders, from one relay payload.
 *
 * ==> IT COMPUTES AND IT DOES NOT WRITE SENTENCES. <== The words live in
 * ui/rain-home.js, the same split the environment paragraph uses: figures that
 * can be asserted against captured bytes stay here where a test can reach them
 * with no browser, and the phrasing stays where somebody can change it without
 * touching arithmetic.
 *
 * @param {object} payload the relay's projection (§48.7)
 * @param {{system?:string|null, now?:number}} opts
 */
export function rainSummary(payload, { system = null, now = Date.now() } = {}) {
  const alerts = floodAlerts(payload?.alerts, now);

  const series = readSeries(payload);
  if (series.state !== 'ok') {
    return { state: series.state, detail: series.detail || null, alerts, place: payload?.place || null };
  }

  const blocks = windowBlocks(series.blocks, RAIN.windowHours);
  const totalMm = blocks.reduce((sum, b) => sum + b.mm, 0);

  /* THE END OF THE LAST BLOCK WE ACTUALLY HAVE, never the end of the window.
   * The series stops before five days on every grid captured, and a sentence
   * saying "through Wednesday" when the numbers stop on Monday is the same
   * class of claim as an undated stale reading (§5, §48.11). */
  const last = blocks[blocks.length - 1];

  const peak = peakBlock(blocks);
  const share = totalMm > 0 && peak ? peak.mm / totalMm : 0;

  return {
    state: 'ok',
    alerts,
    place: payload?.place || null,
    office: payload?.office || null,
    updateTime: payload?.updateTime || null,
    totalMm,
    totalText: formatRainTotal(totalMm, system),
    negligible: totalMm < RAIN.negligibleMm,
    throughMs: last ? last.endMs : null,
    throughWords: last ? formatDayPart(last.endMs) : null,
    /* Only a block carrying a real share of the total earns a sentence. */
    peak: peak && share >= RAIN.peakShare && totalMm >= RAIN.negligibleMm
      ? {
        mm: peak.mm,
        text: formatRainTotal(peak.mm, system),
        startMs: peak.startMs,
        endMs: peak.endMs,
        lengthWords: durationWords(peak.durationMs),
        share,
      }
      : null,
  };
}
