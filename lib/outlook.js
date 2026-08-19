/**
 * outlook.js — NHC's Tropical Weather Outlook, in words. SPEC-DATA §45.9.
 *
 * ==> THIS EXISTS BECAUSE THE MAP LAYER AND THE TEXT PRODUCT DISAGREED, AND
 * THE MAP LAYER WAS THE ONE THAT WAS WRONG. <==
 *
 * 2026-08-11: NHC's GIS layer 3 answered `{"features":[]}` for two hours while
 * this bulletin listed three Atlantic areas, one of them at 70% over seven
 * days. The app drew the layer and said "nothing is being watched". An empty
 * FeatureCollection is UNSTAMPED, so from the bytes alone "NHC is watching
 * nothing" and "NHC's layer is broken" are identical and no amount of care in
 * the parser could have separated them.
 *
 * This product separates them. It is issued by the same forecaster, on the
 * same schedule, from the same desk — and it carries the areas in prose when
 * the polygons are missing.
 *
 * ==> WHAT IT IS FOR, AND WHAT IT IS EMPHATICALLY NOT FOR. <==
 * It CANNOT DRAW. There is no geometry in a paragraph — a title, a rough prose
 * location and two percentages, nothing that puts a shape on a globe. So this
 * is not a second position source sitting alongside the GIS layer the way
 * GDACS sits alongside NHC. It is the ARBITER: it answers "is the layer
 * telling the truth right now", by count and by probability, and it never
 * answers "where".
 *
 * ==> AREAS ARE NEVER MATCHED TO POLYGONS. <== NHC publishes no id on either
 * side to join them with, and titles genuinely collide — two areas in the same
 * third of the Atlantic both title as "Central Atlantic", measured live. A
 * wrong match prints one area's probability on another area's shape, which is
 * the exact failure that killed the layer-2 anchor idea (the `GENESIS` block in
 * config/constants.js carries that measurement). Counts and probability sets
 * are compared. Nothing is joined.
 *
 * ==> AND NOTE WHAT DID CHANGE UNDERNEATH THIS FILE. <== The outlook's
 * POLYGONS now arrive from NHC's KMZ, which attaches the forecaster's
 * paragraph to the shape it describes — so an area's prose and its geometry
 * are joined AT THE SOURCE, by NHC. That does not make this file's rule
 * negotiable. What arrives here is still the standalone text bulletin, still
 * carrying no geometry and still full of colliding titles, and its whole value
 * is being an INDEPENDENT product: a second path that can contradict the
 * first. Matching these areas to those polygons would collapse the two into
 * one source and quietly delete the arbiter.
 *
 * ==> AND THE BULLETIN DATES ITSELF, WHICH THE LAYER CANNOT. <==
 * `ABNT20 KNHC 111142` is a day and a time. That one line is the whole reason
 * this source can be trusted to contradict another one: a mirror that quietly
 * stops updating is detectable here and is invisible everywhere else. It is
 * not hypothetical — `samples/outlook-text/README.md` records a NOAA mirror
 * found serving a two-month-old bulletin over HTTP 200, in plain text, looking
 * completely healthy. Every read checks the age. A second opinion that can
 * silently freeze is worse than no second opinion.
 *
 * Pure and synchronous, like `lib/abpw.js` next door: text in, state out,
 * never throws, no fetching. The relay unwraps the transport (§4 — routes
 * forward and cache, they do not interpret); this interprets.
 */

import { OUTLOOK } from '../config/constants.js';

/**
 * The WMO header line, which is also where parsing starts.
 *
 * ==> ANCHORING HERE IS WHAT MAKES ONE PARSER READ TWO TRANSPORTS. <== The
 * same bulletin is available as plain text and as a `<pre>` block inside an
 * NHC web page, and the page version arrives with a stray "en Español" link
 * and a bare sequence number above the header. Starting at the WMO line makes
 * every byte above it irrelevant instead of something to strip, so the day the
 * relay switches to a raw feed, nothing here changes.
 *
 * `ABNT20` is the Atlantic, `ABPZ20` the East Pacific. The six digits are
 * DDHHMM in UTC — no month and no year, which is the whole problem solved in
 * `issuedAt` below.
 */
const HEADER_RE = /^(AB[A-Z]{2}\d{2})\s+KNHC\s+(\d{2})(\d{2})(\d{2})\s*$/m;

/** Which basin each WMO header belongs to. A closed table: an unrecognised
 *  header is reported as such rather than guessed at, because guessing the
 *  basin would file Atlantic areas against a Pacific outlook. */
const BASIN_BY_WMO = Object.freeze({
  ABNT20: 'atlantic',
  ABPZ20: 'epacific',
});

/**
 * The sentence that means "nothing at all", and the reason it is matched
 * loosely.
 *
 * NHC has spelled the horizon `5 days` and `7 days` in different eras, and the
 * 2013 experimental rollout is on record changing it once already. Pinning the
 * number would make a real all-clear unreadable the next time it moves —
 * and an unreadable all-clear does not fail loudly, it fails as
 * `formationNotExpected: false` with no areas, which reads as a parse that
 * found nothing. Same outcome, no signal.
 */
const NO_FORMATION_RE = /tropical cyclone formation is not expected during the next \d+ days?/i;

/**
 * One horizon's line: `* Formation chance through 48 hours...low...30 percent.`
 *
 * ==> `near 0 percent` IS WHY THIS IS NOT A BARE `\d+`. <== NHC writes a zero
 * chance in words, and it is not rare — two of the three areas in the
 * 2026-08-11 Atlantic bulletin use it. A regex demanding a digit immediately
 * after the risk word silently skips those areas, and an area skipped is an
 * area this feature would fail to notice the GIS layer had dropped. The
 * optional `near` is the entire fix and it is worth the comment.
 */
const CHANCE_RE =
  /\*\s*Formation chance through\s+(\d+)\s+(hours?|days?)\s*\.{2,}\s*(low|medium|high)\s*\.{2,}\s*(?:near\s+)?(\d+)\s*percent/i;

/**
 * A line that could be an area's title.
 *
 * Titles are short, end in a colon, and may carry an NHC invest designator —
 * `Central Pacific (CP93):`. `gtwo.php` renders the same bulletin with the
 * areas numbered (`1. Central Pacific (CP93):`), so the number is optional and
 * stripped.
 */
const TITLE_RE = /^(?:\d+\.\s*)?(.{2,80}?):\s*$/;

/**
 * Lines that end in a colon and are NOT areas.
 *
 * `For the North Atlantic...` opens every bulletin and `Active Systems:` lists
 * the named storms NHC is already writing advisories on. Neither has formation
 * chances under it, so the walk-back below would never reach them in a
 * well-formed bulletin — they are listed anyway because "would never" is a
 * claim about NHC's formatting, not about ours, and the cost of being wrong is
 * an active hurricane rendered as a thing that might one day form.
 */
const NOT_A_TITLE = [/^For the\b/i, /^Active Systems$/i, /^Tropical Weather Outlook$/i];

/**
 * Resolve `DDHHMM` against the reader's clock.
 *
 * ==> THE PRODUCT DOES NOT CARRY A MONTH OR A YEAR. <== Day-of-month alone is
 * ambiguous across a month boundary: a bulletin stamped `010600` read on the
 * 31st is tomorrow if you assume the current month and yesterday if you assume
 * the next one. Assuming the current month puts a fresh bulletin up to a month
 * in the FUTURE, which sails through any "is it stale" check — the failure
 * runs in the unsafe direction, so the wrap is handled rather than hoped about.
 *
 * The rule: take the current UTC month, and if that lands more than a day
 * ahead of now, it belongs to the previous month. A day of tolerance absorbs
 * clock skew without accepting a genuinely future date.
 */
export function issuedAt(day, hour, minute, now = Date.now()) {
  const ref = new Date(now);
  const build = (monthOffset) =>
    Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth() + monthOffset, day, hour, minute, 0);

  let ms = build(0);
  if (ms - now > OUTLOOK.futureToleranceMs) ms = build(-1);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Parse one bulletin.
 *
 * NEVER THROWS. Every failure is a state with a reason attached, because the
 * caller is deciding whether to contradict another source and "the arbiter
 * blew up" has to be distinguishable from "the arbiter says nothing is out
 * there" (§5). Those two must never collapse into each other — that collapse
 * is the original bug this whole feature answers.
 *
 * @param {string} text  the bulletin, with or without a web page around it
 * @param {{now?: number}} [opts]
 * @returns {{
 *   state: 'ok'|'stale'|'unreadable',
 *   reason: string|null,
 *   wmo: string|null,
 *   basin: 'atlantic'|'epacific'|null,
 *   issued: number|null,
 *   ageMs: number|null,
 *   formationNotExpected: boolean,
 *   areas: Array<{title:string, designator:string|null, prob48:number|null,
 *                 risk48:string|null, prob7:number|null, risk7:string|null}>
 * }}
 */
export function parseOutlook(text, { now = Date.now() } = {}) {
  const empty = {
    state: 'unreadable',
    reason: null,
    wmo: null,
    basin: null,
    issued: null,
    ageMs: null,
    formationNotExpected: false,
    areas: [],
  };

  if (typeof text !== 'string' || !text.trim()) {
    return { ...empty, reason: 'the outlook bulletin was empty' };
  }

  const header = HEADER_RE.exec(text);
  if (!header) {
    /* NO HEADER MEANS THIS IS NOT A BULLETIN. Most likely an error page or a
     * redirect served as 200 — the shape that must never be read as an
     * all-clear, so it is named as unreadable and never as "no areas". */
    return { ...empty, reason: 'the outlook bulletin had no WMO header' };
  }

  const wmo = header[1].toUpperCase();
  const basin = BASIN_BY_WMO[wmo] || null;
  const issued = issuedAt(Number(header[2]), Number(header[3]), Number(header[4]), now);
  const ageMs = issued == null ? null : now - issued;

  const body = text.slice(header.index);
  const lines = body.split(/\r?\n/);

  /* ==> AREAS ARE FOUND FROM THEIR NUMBERS UP, NOT FROM THEIR TITLES DOWN. <==
   *
   * A title is just a short line ending in a colon, which describes plenty of
   * things that are not areas. A pair of formation-chance lines describes
   * exactly one thing, always, and is the only part of this product with a
   * fixed machine-readable shape. So the chance lines are the anchor and the
   * title is recovered by walking back to the nearest plausible one.
   *
   * The practical payoff: a bulletin that grows a new prose section, or
   * renumbers its areas, or adds a heading nobody here has seen, still yields
   * the right count — because the count is driven by the thing that cannot be
   * reworded without changing what the product means. */
  const areas = [];
  let pending = null;

  for (let i = 0; i < lines.length; i++) {
    const chance = CHANCE_RE.exec(lines[i]);
    if (!chance) continue;

    const [, num, unit, risk, pct] = chance;
    const is48 = /hour/i.test(unit) && Number(num) <= 48;

    if (is48) {
      /* A new area opens. If one was already pending without a 7-day line, it
       * is pushed as-is — an area with half its horizons is still an area NHC
       * is watching, and dropping it would undercount exactly when the product
       * is malformed, which is when the count matters most. */
      if (pending) areas.push(pending);
      pending = { ...blankArea(titleAbove(lines, i)), prob48: Number(pct), risk48: risk.toLowerCase() };
    } else if (pending) {
      pending.prob7 = Number(pct);
      pending.risk7 = risk.toLowerCase();
      areas.push(pending);
      pending = null;
    } else {
      /* A 7-day line with no 48-hour line above it. Malformed, but it still
       * names an area, and this file's job is counting them honestly. */
      areas.push({ ...blankArea(titleAbove(lines, i)), prob7: Number(pct), risk7: risk.toLowerCase() });
    }
  }
  if (pending) areas.push(pending);

  const formationNotExpected = NO_FORMATION_RE.test(body);

  /* ==> A FROZEN MIRROR IS THE FAILURE THIS CHECK EXISTS FOR. <== Measured on
   * a real NOAA path serving a two-month-old bulletin at HTTP 200. Nothing
   * about the fetch, the status, or the bytes says anything is wrong; only the
   * issuance time does. An outlook older than two publication cycles is not
   * evidence about what NHC thinks today, and evidence is this file's entire
   * contribution — so it is downgraded rather than believed. */
  if (issued == null) {
    return { ...empty, wmo, basin, reason: 'the outlook bulletin had no readable issue time' };
  }
  if (ageMs > OUTLOOK.maxAgeMs) {
    return {
      state: 'stale',
      reason: 'the outlook bulletin has not been reissued',
      wmo,
      basin,
      issued,
      ageMs,
      formationNotExpected,
      areas,
    };
  }

  /* AREAS AND "FORMATION IS NOT EXPECTED" ARE MUTUALLY EXCLUSIVE, and a
   * bulletin claiming both is not one this file will speak for. It has never
   * been observed; it is refused rather than resolved because either half
   * could be the true one and picking wrong means either inventing areas or
   * announcing an all-clear over real ones. */
  if (formationNotExpected && areas.length) {
    return {
      ...empty,
      wmo,
      basin,
      issued,
      ageMs,
      areas,
      reason: 'the outlook bulletin both listed areas and said none were expected',
    };
  }

  return {
    state: 'ok',
    reason: null,
    wmo,
    basin,
    issued,
    ageMs,
    formationNotExpected,
    areas,
  };
}

const blankArea = (title) => ({
  title: title.text,
  designator: title.designator,
  prob48: null,
  risk48: null,
  prob7: null,
  risk7: null,
});

/** The nearest title line above index `i`, or a plain fallback. */
function titleAbove(lines, i) {
  for (let j = i - 1; j >= 0 && i - j <= OUTLOOK.titleLookbackLines; j--) {
    const m = TITLE_RE.exec(lines[j].trim());
    if (!m) continue;
    const raw = m[1].trim();
    if (NOT_A_TITLE.some((re) => re.test(raw))) continue;

    /* The invest designator, when NHC has assigned one: `(CP93)`, `(AL91)`.
     * CAPTURED FOR DISPLAY AND DELIBERATELY NOT USED AS A JOIN KEY — the GIS
     * layer publishes no matching field, so there is nothing on the other side
     * to join it to, and a half-available key is how a confident wrong match
     * gets built later by someone who finds it here and assumes. */
    const d = /\(([A-Z]{2}\d{2})\)\s*$/.exec(raw);
    return { text: raw, designator: d ? d[1] : null };
  }
  return { text: 'Unnamed area', designator: null };
}

/**
 * The comparison the whole feature exists to make.
 *
 * ==> IT COMPARES COUNTS AND PROBABILITIES. IT NEVER MATCHES AN AREA TO A
 * POLYGON. <== See this file's header for why.
 *
 * @param {number|null} layerCount  areas in NHC's GIS layer, or null if it could not answer
 * @param {object} textState        a `parseOutlook` result
 * @returns {{verdict:string, textCount:number|null, layerCount:number|null}}
 *
 * The verdicts, and what each one licenses the caller to do:
 *
 *   `agree`          both sources say the same number. Nothing to say.
 *   `layer-broken`   the layer is empty and the bulletin has areas. THIS IS
 *                    NO LONGER A GUESS — hold the last known areas past the
 *                    six-hour window, because we are not inferring an outage
 *                    from history, we are reading one.
 *   `layer-short`    both have areas, the layer has fewer. Say so; do not
 *                    guess which ones are missing.
 *   `layer-ahead`    the layer has MORE than the bulletin. Expected briefly —
 *                    the GIS layer updates before the prose is written — so it
 *                    is named and not treated as a fault.
 *   `both-clear`     both say nothing is out there. A true all-clear, and it
 *                    can be shown IMMEDIATELY rather than waiting out the
 *                    hold, which is the other half of what this buys.
 *   `no-arbiter`     the bulletin could not be read or is stale. Fall back to
 *                    the layer alone and the six-hour hold, exactly as before
 *                    this file existed.
 */
export function reconcile(layerCount, textState) {
  /* ==> STATED HONESTLY: THE `formationNotExpected` ARM CANNOT CHANGE THIS
   * ANSWER, AND IS KEPT ANYWAY. <== It was mutation-checked and the suite
   * stayed green with it removed. It can never differ, because `parseOutlook`
   * refuses a bulletin that both lists areas and says none are expected — so
   * whenever this flag is true, `areas` is already empty and both arms give 0.
   *
   * It is here because it pins the MEANING rather than the arithmetic: "no
   * formation expected" is zero areas, which stays true if that refusal is
   * ever relaxed. Labelled because coverage that cannot fail, presented as
   * coverage, is what made two of this project's suites green over live
   * bugs. */
  const textCount =
    textState && (textState.state === 'ok')
      ? textState.formationNotExpected
        ? 0
        : textState.areas.length
      : null;

  if (textCount == null) return { verdict: 'no-arbiter', textCount: null, layerCount };
  if (layerCount == null) return { verdict: 'no-arbiter', textCount, layerCount: null };

  return { ...reconcileCounts(layerCount, textCount), textCount, layerCount };
}

/**
 * The same comparison, against the TWO bulletins that cover ONE layer.
 *
 * ==> THE ASYMMETRY IS THE WHOLE REASON THIS EXISTS. <== NHC's GIS layer 3
 * returns the Atlantic and the East Pacific in a single FeatureCollection, and
 * the prose is published as two separate products. So there is one count on
 * one side and two on the other, and `reconcile()` above compares one to one.
 *
 * ==> AREAS ARE STILL NEVER MATCHED, AND THE LAYER IS NEVER SPLIT BY BASIN.
 * <== Deciding which polygons are "Atlantic" would mean drawing a boundary NHC
 * did not publish and then filing areas against it — the same invented join
 * this feature refuses everywhere else (§45.9). Counts are summed. Nothing is
 * assigned.
 *
 * ==> AND A HALF-READ SKY CANNOT DECLARE AN ALL-CLEAR. <== The two bulletins
 * fail independently, so one can be readable while the other is a 404 or two
 * months stale. That leaves two very different situations:
 *
 *   ONE BULLETIN LISTS AREAS AND THE LAYER HAS NONE. Certain, whatever the
 *   other bulletin says — you cannot un-see an area. `layer-broken`.
 *
 *   EVERY BULLETIN WE COULD READ SAYS NOTHING. Only an all-clear if we read
 *   ALL of them. With one basin unreadable the sum is understated and an
 *   all-clear over an ocean nobody looked at is precisely §5's worst failure,
 *   so it is `no-arbiter` and the layer is left to speak for itself.
 *
 * Every comparison finer than "the layer is empty" — `layer-short`,
 * `layer-ahead`, `agree` — needs the complete sum too, for the same reason:
 * a missing basin makes a healthy layer look like it is publishing extra.
 *
 * @param {number|null} layerCount  areas in the GIS layer, or null if it could
 *   not answer. **Pass 0 when the relay is HOLDING** — a held response carries
 *   remembered areas, and the number this arbiter has to judge is what upstream
 *   said, which while holding is zero by definition.
 * @param {Array<object>} textStates  one `parseOutlook` result per basin
 * @returns {{verdict:string, textCount:number|null, layerCount:number|null,
 *            readable:number, expected:number}}
 */
export function reconcileBasins(layerCount, textStates) {
  const states = Array.isArray(textStates) ? textStates : [];
  const expected = states.length;
  const readable = states.filter((s) => s && s.state === 'ok');

  const countOf = (s) => (s.formationNotExpected ? 0 : s.areas.length);
  const textCount = readable.length ? readable.reduce((n, s) => n + countOf(s), 0) : null;

  /* ==> THE LAYER CAN NOW BE SPLIT THE WAY THE PROSE ALREADY IS. <== It
   * publishes a `basin` field — "Atlantic" and "Pacific", measured on the real
   * bytes — so a caller that can group by it passes an object and gets a
   * per-basin answer. A caller that cannot passes a plain number and gets the
   * summed answer, unchanged.
   *
   * WHY THIS IS NOT THE INVENTED JOIN §45.9 REFUSES. Nothing is matched to
   * anything. Areas are still never paired with paragraphs, and no boundary is
   * drawn by us — the grouping key is NHC's own word on NHC's own feature,
   * beside NHC's own bulletin for the same basin. What was refused was
   * inferring which polygon a paragraph describes; this only counts how many
   * of each there are on each side.
   *
   * WHAT IT BUYS: one basin going dark while the other is healthy. Summed,
   * that is `layer-short` — a verdict nothing acts on — so a broken Atlantic
   * beside a working Pacific silently under-reported. Split, it is
   * `layer-broken`, which holds. */
  const perBasin = layerCount !== null && typeof layerCount === 'object';

  const base = {
    textCount,
    layerCount: perBasin ? sumCounts(layerCount) : layerCount,
    readable: readable.length,
    expected,
    perBasin,
  };

  if (!readable.length || layerCount == null) {
    return { ...base, verdict: 'no-arbiter' };
  }

  if (perBasin) {
    /* Each basin judged against its own bulletin, then the worst answer wins.
     * A single dark basin is the whole reason for splitting, so it must not be
     * averaged away by a healthy neighbour. */
    const each = [];
    for (const s of readable) {
      const count = layerCount[s.basin];
      if (typeof count !== 'number') continue;
      each.push({ basin: s.basin, ...reconcileCounts(count, countOf(s)) });
    }
    if (!each.length) return { ...base, verdict: 'no-arbiter' };

    const broken = each.find((e) => e.verdict === 'layer-broken');
    if (broken) return { ...base, verdict: 'layer-broken', basins: each };

    /* An all-clear still needs the WHOLE sky: every basin readable, matched to
     * a layer count, and every one of them empty. */
    if (each.length === expected && each.every((e) => e.verdict === 'both-clear')) {
      return { ...base, verdict: 'both-clear', basins: each };
    }
    if (each.length !== expected) return { ...base, verdict: 'no-arbiter', basins: each };

    const short = each.find((e) => e.verdict === 'layer-short');
    if (short) return { ...base, verdict: 'layer-short', basins: each };
    const ahead = each.find((e) => e.verdict === 'layer-ahead');
    if (ahead) return { ...base, verdict: 'layer-ahead', basins: each };
    return { ...base, verdict: 'agree', basins: each };
  }

  /* CERTAIN EVEN ON A PARTIAL READ. One forecaster describing one area is
   * enough to know an empty layer is wrong. */
  if (layerCount === 0 && textCount > 0) {
    return { ...base, verdict: 'layer-broken' };
  }

  /* Everything below compares magnitudes, and a magnitude summed over a subset
   * is not a magnitude. */
  if (readable.length !== expected) {
    return { ...base, verdict: 'no-arbiter' };
  }

  return { ...base, ...reconcileCounts(layerCount, textCount) };
}

/** Total across a per-basin count object, ignoring anything that is not a
 *  number — an absent basin is unknown, not zero. */
function sumCounts(counts) {
  return Object.values(counts).reduce((n, v) => (typeof v === 'number' ? n + v : n), 0);
}

/** The count-to-count half of `reconcile`, shared so the two entry points can
 *  never drift into two different ideas of what `layer-short` means. */
function reconcileCounts(layerCount, textCount) {
  if (layerCount === textCount) {
    return { verdict: textCount === 0 ? 'both-clear' : 'agree' };
  }
  if (layerCount === 0) return { verdict: 'layer-broken' };
  if (layerCount < textCount) return { verdict: 'layer-short' };
  return { verdict: 'layer-ahead' };
}
