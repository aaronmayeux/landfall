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

/**
 * Blocks that have already FINISHED. §56.14. The mirror of `futureBlocks`.
 *
 * ==> IT IS THE COMPLEMENT AND IT IS WRITTEN TO BE EXACTLY THE COMPLEMENT.
 * <== `futureBlocks` keeps `endMs > nowMs`; this keeps `endMs <= nowMs`. Every
 * block in the series lands in one list or the other, never both and never
 * neither, so the two totals can never overlap and no hour is counted twice.
 * Written any other way — "starts before now", say — the block containing this
 * moment would appear in both, and a reader would be shown rain that is both
 * already fallen and still expected.
 *
 * ==> THE BLOCK CONTAINING `now` BELONGS TO THE FUTURE, NOT TO THE PAST. <==
 * It is still partly ahead of the reader, and `futureBlocks` already keeps it
 * whole rather than prorating it (§48.19) — splitting it would mean inventing
 * a rate inside it. So the past understates by at most part of one block and
 * never invents a figure, which is the same trade made at the other end and in
 * the same direction: never claim more than was published.
 *
 * ==> AND `nowMs` MISSING IS AN EMPTY PAST, NOT THE WHOLE SERIES. <==
 * `futureBlocks` returns everything when it cannot tell the time, which is
 * safe there — the worst case is a forecast total that includes an elapsed
 * hour. The same default here would report a five-day FORECAST as rain that
 * has already fallen, which is a fluent wrong number of the exact class §5
 * exists to stop.
 */
export function pastBlocks(blocks, nowMs) {
  if (!blocks?.length) return [];
  if (!Number.isFinite(nowMs)) return [];
  return blocks.filter((b) => b.endMs <= nowMs);
}

/**
 * Past blocks that END inside `hours` back from `nowMs`. §56.14.
 *
 * ==> THE WINDOW IS ANCHORED ON THE CLOCK, NOT ON THE SERIES, AND THAT IS THE
 * DIFFERENCE FROM `windowBlocks` ABOVE. <== Measured, and it is the thing this
 * is most likely to get wrong: Open-Meteo prepends WHOLE UTC DAYS and its
 * forecast half also begins at 00:00 UTC today, so how far back the series
 * actually reaches swings by 24 hours through the UTC day. Anchoring on
 * `blocks[0]` — which is what the forward window does, correctly, because
 * there the first block IS the reader's starting point — would give two
 * readers an hour apart a figure measured over different periods, with neither
 * sentence wrong. §56.14 rejects exactly that, and it is why `past_days` is
 * asked for generously and then trimmed here.
 *
 * ==> THE RULE IS THE BLOCK'S END, WHICH IS THE MIRROR OF `windowBlocks`'
 * START. <== Both keep a block that straddles the cutoff, both for the same
 * reason: splitting invents a rate, dropping loses real rain. A six-hour NWS
 * block ending 47 hours ago is inside a 48-hour window even though it began
 * outside one.
 */
export function pastWindowBlocks(blocks, nowMs, hours) {
  if (!blocks?.length || !Number.isFinite(nowMs) || !Number.isFinite(hours)) return [];
  const cutoff = nowMs - hours * 3600 * 1000;
  return blocks.filter((b) => b.endMs <= nowMs && b.endMs > cutoff);
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
 * ONE ALERT, AS EVERY SURFACE READS IT.
 *
 * ==> EXTRACTED IN SLICE C BECAUSE IT ACQUIRED A SECOND CALLER, WHICH IS §12's
 * RULE. <== `floodAlerts()` below builds a LIST for a place; tapping a chip on
 * the globe needs exactly one of these for an alert that may be nowhere near
 * the reader's house or the selected storm. Two copies of this object literal
 * would be two places for "in force" to stop meaning "happening now", and the
 * one that drifts is the one nobody is looking at.
 *
 * ==> IT CARRIES THE `id` NOW AND THE LIST BUILDER DID NOT. <== The panel is
 * opened by id from the map and the row has to be able to say which alert it
 * is. It is the NWS CAP URN, which carries a content hash — a corrected alert
 * is issued under a new one rather than mutating the old — so it is a permanent
 * handle on one alert rather than a position in a list that repaints.
 *
 * NEITHER FILTER IS APPLIED HERE, deliberately. Which events belong to this
 * section, and whether one has run out, are the LIST's questions and they are
 * asked in `floodAlerts()`. A chip on the globe was already filtered by
 * `inForce` in `lib/flood-features.js` before it was ever drawn, and asking
 * again here would mean an alert that expired between the paint and the tap
 * returns null and opens nothing — a tap that does nothing, with no way for the
 * reader to tell that from a broken app (§5).
 *
 * @param {object} p an alert's properties, or the alert itself
 * @param {number} nowMs
 */
export function floodAlertFacts(p, nowMs) {
  const until = Date.parse(p?.ends || p?.expires || '');
  const onset = Date.parse(p?.onset || p?.effective || '');

  return {
    id: p?.id || null,
    event: String(p?.event || ''),
    /* ==> WHO ISSUED IT, AND WHETHER THE GLOBE COULD DRAW IT. <== Both come
     * from `/api/nws/flood` and both are undefined on the HOME dashboard's
     * rows, which arrive from the point-rainfall payload instead — a different
     * relay with a narrower projection. `senderName` absent means the panel
     * falls back to naming the agency rather than the office; `drawn`
     * UNDEFINED is deliberately not the same as `false`, because "we do not
     * know" must not print the sentence that says "this is not on the map".
     * Only an explicit false does that. */
    senderName: p?.senderName || null,
    drawn: typeof p?.drawable === 'boolean' ? p.drawable : undefined,
    /* ==> THE AREA, VERBATIM AND WHOLE. <== The reader is hunting for their
     * own zone in this list and we do not know which one it is, so any
     * shortening is a chance to hide it from them. */
    area: p?.areaDesc || null,
    severity: p?.severity || null,
    urgency: p?.urgency || null,
    onsetMs: Number.isFinite(onset) ? onset : null,
    untilMs: Number.isFinite(until) ? until : null,
    /** Has it actually started, by the clock rather than by the word. */
    begun: !Number.isFinite(onset) || onset <= nowMs,
    remaining: remainingWords(until, nowMs),
    /* ==> SEVERITY IS NOT THE ORDER. <== A Flood Watch and a Flash Flood
     * Warning are both `Severe`, so the word cannot separate them. What
     * does is `urgency`: `Immediate` is happening, `Expected` is soon,
     * `Future` is later. */
    immediate: p?.urgency === 'Immediate',
  };
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
 *
 * THE PER-ALERT SHAPE IS `floodAlertFacts` ABOVE — this is the filtering, the
 * sorting, and nothing else.
 */
export function floodAlerts(features, nowMs) {
  const out = [];
  for (const f of features || []) {
    const p = f?.properties || f || {};
    const event = String(p.event || '');
    if (!event.toLowerCase().includes(RAIN.alertEventMatch)) continue;

    const until = Date.parse(p.ends || p.expires || '');
    if (Number.isFinite(until) && until <= nowMs) continue;

    out.push(floodAlertFacts(p, nowMs));
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

/**
 * How much rain has ALREADY FALLEN at this point, over `RAIN.pastHours`.
 * §56.14. The Flooding section's global half.
 *
 * ==> THIS IS THE ONLY FLOOD-RELEVANT FIGURE THIS PROJECT HAS FOUND THAT
 * COVERS THE WHOLE PLANET, AND THAT IS THE ARGUMENT FOR IT. <== §48.15 records
 * the search: there is no global equivalent of NWS's `/alerts/active`, so the
 * alert rows stop dead at the American border and always will. A typhoon in
 * Japan gets a `Flooding` section whose only content is a modelled coastal
 * figure and a sentence apologising for the rest. Rain already on the ground
 * is available at every point on Earth, from a source this app already relays,
 * and it is the single biggest input to whether the next inch floods anybody.
 *
 * ==> IT IS NEVER SUMMED INTO THE FORECAST TOTAL, AND A LATER SESSION WILL BE
 * TEMPTED. <== §56.14's first rule. "Nine inches expected" and "three inches
 * fell" are different kinds of fact about different windows; adding them makes
 * a storm total nobody published. This returns its own object rather than a
 * field on `rainSummary` precisely so that there is no shared total for
 * somebody to reach for — the two functions read the same blocks and share no
 * arithmetic at all.
 *
 * ==> IT IS A MODEL, NOT A RAIN GAUGE, AND `provider` IS HOW THE WORDING KNOWS
 * IT. <== Open-Meteo's past hours are model and reanalysis output, not an
 * observation from an instrument near the reader. "3.1 in fell" overclaims.
 * The sentence has to say estimated and name the provider, exactly as the
 * forecast line already does (§48.12) — and this is the single most likely
 * thing to get wrong, because the number looks and behaves identically either
 * way.
 *
 * THE STATES, AND WHY `dry` IS NOT `none`:
 *
 *   ok            a real total, above `RAIN.negligibleMm`.
 *   dry           the source answered and almost nothing fell. ==> A REAL
 *                 ANSWER, SAFE TO STATE PLAINLY (§56.14's second rule). <==
 *                 The same judgement `RAIN.negligibleMm` already records for
 *                 the forecast: a modelled 0.2 mm printed as `0.01 in` reads
 *                 as a malfunction, said in words it reads as a fact.
 *   unsupported   this payload has no past half at all. Only NWS produces one
 *                 — `quantitativePrecipitation` is a forecast grid and there
 *                 is no matching observed series (§56.14) — so this is a fact
 *                 about the SOURCE, durable, and never retryable.
 *   lapsed        blocks exist but none of them ends inside the window. A
 *                 last-good payload old enough that its past has aged out.
 *   unreadable /
 *   not_covered   whatever `readSeries` said, passed through unchanged.
 *
 * ==> WHAT IS NOT HERE: A FETCH FAILURE. <== That never reaches this function.
 * §56.14's second rule is that nothing having fallen and the fetch having
 * failed must not render the same, and the way that is guaranteed is that a
 * failure has no payload to hand in — the caller holds it and says its own
 * sentence with its own Retry. A `dry` from here always means a source
 * answered.
 *
 * Pure, and handed its own clock, for the reason at the top of this file.
 *
 * @param {object} payload the relay's projection (§48.7)
 * @param {{system?:string|null, now?:number, hours?:number}} opts
 */
export function pastSummary(payload, { system = null, now = Date.now(), hours = RAIN.pastHours } = {}) {
  /* ==> THE SOURCE CHECK COMES FIRST, BEFORE THE SERIES IS EVEN READ. <== An
   * NWS payload is perfectly readable and carries a perfectly real series; it
   * simply has no elapsed half, because that grid is a forecast. Reading it
   * first and finding no past blocks would return `lapsed`, which invites a
   * reader to wait for hours that are never coming. */
  const provider = provenance(payload);
  if (provider.name !== 'open-meteo') {
    return { state: 'unsupported', provider, hours };
  }

  const series = readSeries(payload);
  if (series.state !== 'ok') {
    return { state: series.state, detail: series.detail || null, provider, hours };
  }

  const behind = pastWindowBlocks(series.blocks, now, hours);
  if (!behind.length) {
    return { state: 'lapsed', provider, hours };
  }

  const totalMm = behind.reduce((sum, b) => sum + b.mm, 0);

  /* THE OLDEST HOUR WE ACTUALLY HAVE, never the edge of the window. The same
   * rule `rainSummary` applies at the other end (§48.11): a sentence claiming
   * two days when the series only reaches back thirty hours is the same class
   * of claim as an undated stale reading. */
  const first = behind[0];

  return {
    state: totalMm < RAIN.negligibleMm ? 'dry' : 'ok',
    provider,
    hours,
    totalMm,
    totalText: formatRainTotal(totalMm, system),
    /** How far back the blocks in hand REACH, which is <= `hours`.
     *
     *  ==> IT IS CAPPED AT `hours`, AND THE CAP IS NOT COSMETIC. <== The
     *  window keeps a block that STRADDLES its far edge, for `pastWindowBlocks`'
     *  stated reason — splitting invents a rate, dropping loses real rain — so
     *  the oldest block in hand can begin slightly BEFORE the window. On the
     *  hourly global series that is up to 59 minutes, and uncapped it reports
     *  49 for a 48-hour window: an odd number on screen, and a claim to a
     *  period wider than the one asked for.
     *
     *  ==> THE ASYMMETRY IS DELIBERATE AND IT IS §48.11's RULE. <== Never
     *  claim MORE of a period than was asked for; always report LESS when the
     *  data genuinely does not reach back that far. Understating by under an
     *  hour on a two-day figure is not a precision claim anybody would read as
     *  one; overstating the period a total covers is the same class of error
     *  as an undated stale reading. */
    sinceMs: first ? first.startMs : null,
    coveredHours: first
      ? Math.min(hours, Math.round((now - first.startMs) / 3600000))
      : null,
  };
}
