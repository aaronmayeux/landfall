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
  if (!Array.isArray(series) || series.length === 0) {
    /* ==> A GLOBAL MODEL CANNOT REPORT A PLACE AS UNCOVERED. <== §48.16.
     * `/api/rain/global` covers the whole planet by construction, so a payload
     * of its with no series in it is a shape WE could not read — an
     * unrecognised unit, or a body that changed under us — and never a fact
     * about somebody's house. Rendered as `not_covered` it says *"neither the
     * National Weather Service nor the global model has a forecast for this
     * point"*, with no Retry, which is a confident claim about the world built
     * out of our own reading failure. The NWS route is different: a 200 grid
     * genuinely carrying no `quantitativePrecipitation` IS a statement about
     * coverage (§48.5), so that one keeps its old answer. */
    if (payload?.provider === 'open-meteo') {
      return { state: 'unreadable', detail: 'the global model sent no readable series' };
    }
    return { state: 'not_covered' };
  }

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

/**
 * Blocks that have not already finished. §48.19.
 *
 * ==> \"EXPECTED\" HAS TO MEAN EXPECTED. <== Both sources hand back a series
 * that begins BEFORE the moment it is read, and neither of them says so:
 *
 *   - Open-Meteo's `forecast_days` always starts at 00:00 UTC of the current
 *     day. Measured on the archive runner's own 2026-08-22T17:27Z capture:
 *     15.600 mm across the series, of which 3.600 mm — 23.1% — had already
 *     fallen before anybody could read it. That share climbs through the UTC
 *     day toward everything.
 *   - Every NWS grid captured starts hours before its own `updateTime`: Hilo
 *     6h11m early (1.9% of its total), San Juan 6h16m (5.1%), Guam 6h05m
 *     (3.5%), Galveston 2h20m (0.0%). Smaller, and the same fault.
 *
 * A total labelled \"About 11 inches expected\" that includes this morning's
 * downpour is a plausible wrong number with nothing on the page inviting a
 * second look, which is the most expensive kind this project ships. Same
 * failure in the peak sentence, where it puts a future tense on a cloudburst
 * that finished at breakfast.
 *
 * ==> THE BLOCK CONTAINING `now` IS KEPT WHOLE, NOT PRORATED. <== Splitting it
 * means inventing a rate inside it, which is the same thing `windowBlocks`
 * already refuses to do at the other end of the series, and for the same
 * reason: nobody published an hourly breakdown of a six-hour block. Keeping it
 * overstates by at most part of one block and never invents a figure; dropping
 * it would lose rain the reader is about to get.
 *
 * A block with an unreadable end is kept — `readSeries` has already dropped
 * anything whose interval did not parse, so `endMs` is real by the time this
 * runs.
 */
export function futureBlocks(blocks, nowMs) {
  if (!blocks?.length) return [];
  if (!Number.isFinite(nowMs)) return blocks;
  return blocks.filter((b) => b.endMs > nowMs);
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
 * How long a warning has left, in words. §56.7.
 *
 * ==> MINUTES MATTER HERE AND THEY MATTER NOWHERE ELSE IN THIS FILE. <==
 * `durationWords` above rounds to whole hours, which is right for a rainfall
 * block and wrong for this: Hilo's Flash Flood Warning ran **52 minutes**, and
 * rounding that to "an hour" overstates the time a reader has by eight minutes
 * on the one figure where the whole point is how little is left.
 *
 * Returns null when there is nothing to say — no end time, or it has already
 * gone. The caller decides what to print instead; an absent end time is a real
 * shape (the Hurricane Warning and the local statement both carry `ends: null`)
 * and inventing a duration for one would be §5.
 */
export function remainingWords(untilMs, nowMs) {
  if (!Number.isFinite(untilMs) || !Number.isFinite(nowMs)) return null;
  const mins = Math.round((untilMs - nowMs) / 60000);
  if (mins <= 0) return null;
  if (mins < 60) return `${mins} min left`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours} ${hours === 1 ? 'hour' : 'hours'} left`;
  return `${Math.round(hours / 24)} days left`;
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
 *
 * ==> `onset` IS CARRIED AND IT IS NOT THE SAME THING AS `urgency`. <== §56.7.
 * Measured on the captured set: the Flood Watch reads `urgency: Future` while
 * its `onset` is already four hours in the PAST — because the urgency describes
 * when the HAZARD is expected and the onset describes when the MESSAGE took
 * effect. A row that read "starts at 3:55 AM" off a Future urgency, or "not yet
 * begun" off that urgency alone, would be wrong in opposite directions. So both
 * travel and the renderer compares `onset` against the clock rather than
 * inferring a tense from a word.
 */
export function floodAlerts(features, nowMs) {
  const out = [];
  for (const f of features || []) {
    const p = f?.properties || f || {};
    const event = String(p.event || '');
    if (!event.toLowerCase().includes(RAIN.alertEventMatch)) continue;

    const until = Date.parse(p.ends || p.expires || '');
    if (Number.isFinite(until) && until <= nowMs) continue;

    const onset = Date.parse(p.onset || p.effective || '');

    out.push({
      event,
      /* ==> THE AREA, VERBATIM AND WHOLE. <== The reader is hunting for their
       * own zone in this list and we do not know which one it is, so any
       * shortening is a chance to hide it from them. */
      area: p.areaDesc || null,
      severity: p.severity || null,
      urgency: p.urgency || null,
      onsetMs: Number.isFinite(onset) ? onset : null,
      untilMs: Number.isFinite(until) ? until : null,
      /** Has it actually started, by the clock rather than by the word. */
      begun: !Number.isFinite(onset) || onset <= nowMs,
      remaining: remainingWords(until, nowMs),
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
 * Which source answered, and where it answered FOR. §48.16.
 *
 * ==> THE ABSENCE OF A `provider` FIELD IS ITSELF THE ANSWER. <== Only
 * `/api/rain/global` sends one; `/api/nws/rainfall` predates the second source
 * and does not. Defaulting the missing case to `nws` rather than to null means
 * every payload captured before §48.14 — the whole of `samples/rain/`, which
 * is what the acceptance cases run against — keeps reporting the source it
 * actually came from, with no fixture rewritten.
 *
 * ==> AND `alerts` MEANS TWO DIFFERENT THINGS DEPENDING ON WHO SENT IT. <==
 * From NWS, `null` means the alerts hop failed and what is in force is
 * UNKNOWN. From the global model, `null` means there is no flood-warning
 * source for this place at all. Those want opposite sentences — one retryable,
 * one a plain fact — and this is what tells them apart (§5).
 */
export function provenance(payload) {
  const name = payload?.provider === 'open-meteo' ? 'open-meteo' : 'nws';
  return {
    name,
    /* NWS names its nearest town. The global model names nothing, but it does
     * report the grid point it snapped to — measured, 14.5995/120.9842 asked
     * and 14.586995/121.002785 answered — and §48.10's whole risk is a reader
     * comparing this figure against an advisory without knowing which point it
     * is for. A coordinate is a poorer answer than a town name and it is not
     * nothing. */
    gridLat: Number.isFinite(payload?.gridLat) ? payload.gridLat : null,
    gridLon: Number.isFinite(payload?.gridLon) ? payload.gridLon : null,
    /* Whether "nothing in force" is a claim we are entitled to make. */
    alertsKnown: name === 'nws' ? payload?.alerts != null : false,
  };
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
    return {
      state: series.state,
      detail: series.detail || null,
      alerts,
      place: payload?.place || null,
      provider: provenance(payload),
    };
  }

  /* ==> WHAT IS STILL AHEAD, AND ONLY THAT. <== §48.19. The clip comes FIRST,
   * so the 120-hour window is anchored on the first block still to come rather
   * than on the first block the source happened to send — which on the global
   * path is always midnight UTC and can be a full day behind the reader. Every
   * figure below inherits it: the total, the \"through\" label, and the peak. */
  const ahead = futureBlocks(series.blocks, now);

  /* A SERIES THAT HAS ENTIRELY RUN OUT IS NOT A DRY FORECAST. Nothing is left
   * to say anything about, and printing \"no meaningful rain expected\" off an
   * empty list would be an all-clear built from an absence (§5). It happens on
   * a last-good payload old enough to have expired completely — six hours is
   * the edge cache's own hold — so it is reachable rather than theoretical. */
  if (!ahead.length) {
    return {
      state: 'lapsed',
      alerts,
      place: payload?.place || null,
      provider: provenance(payload),
      office: payload?.office || null,
      updateTime: payload?.updateTime || null,
    };
  }

  const blocks = windowBlocks(ahead, RAIN.windowHours);
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
    provider: provenance(payload),
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
