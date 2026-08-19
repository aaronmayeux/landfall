/**
 * cap.js (lib) — the CAP alert feed, read and put into English. SPEC §50.
 *
 * PURE. No DOM, no fetch, no clock of its own — `now` arrives as a parameter
 * so every state in here is reachable from a test with a fixture and a number.
 *
 * ==> THE ONE THING THIS FILE WILL NOT DO IS TRANSLATE. <== §50.4. An alert's
 * `event` and `headline` are the issuing agency's free text in the issuing
 * agency's language, and a mistranslated safety warning is worse than an
 * untranslated one. What IS translated is everything CAP defines as a CODE:
 * severity, urgency and certainty come from a fixed vocabulary that means the
 * same thing whatever language surrounds it, so those become an English
 * sentence with no interpretation and no risk. The agency's own words are
 * shown underneath, untouched, labelled with their language.
 *
 * ==> AND IT WILL NOT DECIDE THAT AN ALERT MEANS A STORM IS COMING. <== §50.1.
 * The archived feed contains an alert whose headline translates to "Rain and
 * showers this Tuesday" and another announcing the END of a tropical wave's
 * influence, both matched by the word "Tropical". Nothing here reads severity
 * as a threat level, ranks alerts against each other, or derives an all-clear.
 * It reports that an agency said something and shows what.
 *
 * WHY MATCHING IS BY COUNTRY AND NOT BY SHAPE (§50.2): the shapes are national
 * outlines and basin-sized boxes — one archived area was 6,585 points, another
 * was a seven-vertex box covering 17 degrees of ocean — so a point-in-polygon
 * test would call a storm "in" an area the size of a basin. GDACS publishes
 * each storm's affected countries WITH ISO-2 codes already on them
 * (`affectedcountries[].iso2`), and a CAP row carries `countryCode` in the same
 * alphabet, so the join needs no lookup table.
 *
 * ==> THE SHAPES ARE DOWNLOADED, JUST NOT FOR MATCHING. <== `data/cap-shapes.js`
 * fetches them for the alerts already matched, so `map/layers/cap-coast.js` can
 * band them onto the coast. Fetched for PAINT, after the join — never to decide
 * the join.
 *
 * ==> AND THE JOIN IS ONLY AS GOOD AS GDACS'S ATTRIBUTION, WHICH IS SLOWER THAN
 * THE ALERTS. <== See `stormCountries()` for the measurement.
 *
 * Imports: nothing.
 */

/* ---------------------------------------------------------------------------
 * THE CODE VOCABULARIES — CAP's, not ours.
 *
 * These three fields are the only part of an alert with defined meaning across
 * every agency on earth, which is exactly why the English sentence is built
 * from them and from nothing else.
 *
 * ==> CLOSED TABLES THAT FALL BACK RATHER THAN DROP. <== An unrecognised code
 * is a code CAP added or an agency mis-set, and either way the honest response
 * is to say we do not recognise it — never to silently omit that half of the
 * sentence, which would leave a reader thinking the alert had no urgency
 * rather than an unreadable one.
 * ------------------------------------------------------------------------ */

/** How bad the issuer says it is. CAP: Extreme/Severe/Moderate/Minor/Unknown. */
export const SEVERITY_EN = Object.freeze({
  extreme: 'extraordinary threat',
  severe: 'significant threat',
  moderate: 'possible threat',
  minor: 'minor threat',
  unknown: 'unstated severity',
});

/** How soon. CAP: Immediate/Expected/Future/Past/Unknown. */
export const URGENCY_EN = Object.freeze({
  immediate: 'act now',
  expected: 'expected within the hour',
  future: 'expected later',
  past: 'no longer expected',
  unknown: 'timing not stated',
});

/** How sure. CAP: Observed/Likely/Possible/Unlikely/Unknown. */
export const CERTAINTY_EN = Object.freeze({
  observed: 'already happening',
  likely: 'likely',
  possible: 'possible',
  unlikely: 'unlikely',
  unknown: 'confidence not stated',
});

/* ---------------------------------------------------------------------------
 * THE LIFECYCLE FIELDS — §50.8.
 *
 * ==> THESE THREE DECIDE WHETHER A ROW IS A WARNING AT ALL, AND THE FEED WAS
 * SHIPPING WITHOUT THEM. <== Measured on the archive branch 2026-08-19: Costa
 * Rica's institute published `Fin de Influencia de Onda Tropical` — "end of
 * tropical wave influence" — tagged `severity: Severe`. Rendered through
 * `plainEnglish()` alone that reads "Significant threat", which is the exact
 * inversion of what the agency said. The relay was asking for twelve of the
 * service's fifty-odd fields and none of the three that carry this.
 *
 *   status       Actual | Exercise | System | Test | Draft
 *   msgType      Alert  | Update   | Cancel | Ack  | Error
 *   responseType Shelter | Evacuate | Prepare | Execute | Avoid | Monitor |
 *                Assess | AllClear | None
 *
 * A drill and a real warning are otherwise IDENTICAL on the wire, so without
 * `status` a national exercise renders as a live threat. That is the §5
 * failure in its most literal form and it is why these are filtered rather
 * than merely displayed.
 * ------------------------------------------------------------------------ */

/** Only `Actual` is a real event. Everything else is a drill, a system
 *  message or an unfinished draft. ==> AN ABSENT `status` COUNTS AS ACTUAL.
 *  <== CAP's own default is Actual, and treating a missing field as a drill
 *  would silently discard live warnings from any agency that omits it. */
export function isActual(alert) {
  const s = String(alert?.status ?? '').trim().toLowerCase();
  return !s || s === 'actual';
}

/** Has the agency withdrawn this message? `Cancel` retracts an earlier alert
 *  and `Error` disowns it; neither is a warning in force. `Ack` is
 *  machine-to-machine plumbing that names no hazard. */
export function isRetracted(alert) {
  const t = String(alert?.msgType ?? '').trim().toLowerCase();
  return t === 'cancel' || t === 'error' || t === 'ack';
}

/** The agency's own all-clear, carried as a response type rather than as a
 *  message type. A row can be `msgType: Alert` and `responseType: AllClear`
 *  at once — that is an agency ANNOUNCING the stand-down, which is a real
 *  message worth reading and NOT a coast worth painting red. */
export function isAllClear(alert) {
  const r = String(alert?.responseType ?? '').trim().toLowerCase();
  return r.includes('allclear');
}

/**
 * Is this row a warning currently in force?
 *
 * ==> IT IS DELIBERATELY NOT THE SAME QUESTION AS "SHOULD WE SHOW IT". <==
 * A cancellation is worth READING — "the tropical wave has passed" is useful
 * — and §50 renders it. What it must never do is drive paint or a threat
 * word. `readAlerts()` keeps these rows and tags them; the map layer asks
 * this function.
 */
export function isInForce(alert, now) {
  if (!alert) return false;
  if (!isActual(alert)) return false;
  if (isRetracted(alert)) return false;
  if (isAllClear(alert)) return false;
  return !isExpired(alert, now);
}

/* ---------------------------------------------------------------------------
 * SEVERITY -> THE NHC COLOUR RUNGS — §50.9.
 *
 * ==> BY THE CODED SEVERITY, NEVER BY THE AGENCY'S WORDS. <== Aaron's call,
 * 2026-08-19. `event` is free text in the issuing agency's language and there
 * is no closed vocabulary behind it, so reading "warning" out of it is a
 * translation problem in a hundred languages that fails silently. `severity`
 * is one of five defined codes that mean the same thing everywhere.
 *
 * WHAT THIS COSTS, STATED PLAINLY: CAP's one axis is DANGER and NHC's four
 * codes are two axes — hazard (hurricane vs tropical storm) crossed with
 * confidence (warning vs watch). There is no honest way to recover the second
 * axis from the first, so the five severities are laid onto the four rungs in
 * `wwSortKey` order and nothing here claims a foreign Extreme alert IS a
 * Hurricane Warning. It claims it sits on the same rung.
 *
 * `Unknown` maps to nothing. A severity the agency declined to state is not a
 * rung, and picking one for them would be this file inventing the only fact
 * the paint depends on.
 * ------------------------------------------------------------------------ */
export const SEVERITY_RUNG = Object.freeze({
  extreme: 'HWR',
  severe: 'HWA',
  moderate: 'TWR',
  minor: 'TWA',
});

/** The NHC watch/warning code whose colour this alert paints in, or null. */
export function severityRung(alert) {
  const key = String(alert?.severity ?? '').trim().toLowerCase();
  return SEVERITY_RUNG[key] || null;
}

const gloss = (table, code) => {
  const key = String(code ?? '').trim().toLowerCase();
  if (!key) return null;
  return table[key] || `${code} (a code we do not recognise)`;
};

/** An ArcGIS date field is epoch MILLISECONDS, or null. Measured on the
 *  archive branch: `expires: 1787119140000`. NOT seconds — the same trap
 *  `sessions.ts` sets in the other direction, and dividing here would put
 *  every alert in 1970 without erroring. */
const epochMs = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

const clean = (v) => {
  const s = String(v ?? '').trim();
  return s ? s : null;
};

/**
 * One CAP row, normalized. Returns null for a row with nothing to show.
 *
 * @param {object} attrs the ArcGIS `attributes` object
 */
export function normalizeAlert(attrs) {
  if (!attrs || typeof attrs !== 'object') return null;

  const event = clean(attrs.event);
  const headline = clean(attrs.headline);
  /* NOTHING TO SAY IS NOT AN ALERT. Both text fields empty means there is no
   * sentence to show a reader, and the coded fields alone ("significant
   * threat, likely") name no hazard at all. */
  if (!event && !headline) return null;

  return {
    event,
    headline,
    agency: clean(attrs.senderName),
    /* UPPERCASED FOR THE JOIN. The feed publishes lowercase ("cr", "ph") and
     * GDACS publishes uppercase ("CR", "PH"); one of them has to move and it
     * is not the source of truth for storms. */
    country: clean(attrs.countryCode)?.toUpperCase() || null,
    area: clean(attrs.areaDesc),
    language: clean(attrs.language),
    severity: clean(attrs.severity),
    urgency: clean(attrs.urgency),
    certainty: clean(attrs.certainty),
    /* §50.8. Kept RAW rather than resolved to booleans here, because the
     * three of them answer different questions in different places — the map
     * asks "in force", the panel asks "what kind of message is this" — and a
     * single flag computed once would have to guess which. */
    status: clean(attrs.status),
    msgType: clean(attrs.msgType),
    responseType: clean(attrs.responseType),
    /* Esri's row id. ==> USED FOR ONE THING ONLY: asking `shapes.js` for this
     * row's polygon. <== It is NOT identity — `alertKey()` below is, and it is
     * built from fields the AGENCY controls, because nothing guarantees this
     * number survives a republish of the same alert. */
    objectId: typeof attrs.OBJECTID === 'number' ? attrs.OBJECTID : null,
    sent: epochMs(attrs.sent),
    effective: epochMs(attrs.effective),
    expires: epochMs(attrs.expires),
  };
}

/**
 * The English sentence, built ONLY from the coded fields (§50.4).
 *
 * Reads as "Significant threat — act now, already happening." Never contains
 * a word the agency wrote, so it is never a translation.
 */
export function plainEnglish(alert) {
  if (!alert) return null;
  const parts = [
    gloss(SEVERITY_EN, alert.severity),
    gloss(URGENCY_EN, alert.urgency),
    gloss(CERTAINTY_EN, alert.certainty),
  ].filter(Boolean);
  if (!parts.length) return null;
  const head = parts[0];
  const rest = parts.slice(1);
  const sentence = rest.length ? `${head} — ${rest.join(', ')}` : head;
  return sentence.charAt(0).toUpperCase() + sentence.slice(1);
}

/** Has this alert's own stated expiry passed? A row with no expiry has not —
 *  absence of an end time is not an end time. */
export function isExpired(alert, now) {
  return alert?.expires != null && alert.expires <= now;
}

/* ---------------------------------------------------------------------------
 * DEDUPE
 *
 * MEASURED, archive branch 2026-08-19: Costa Rica's meteorological institute
 * published the SAME event, for the SAME area, expiring at the SAME instant,
 * TWICE — once Severe/Expected/Likely and once Moderate/Immediate/Observed,
 * eight minutes apart. Rendering both puts one agency's single message on
 * screen twice, disagreeing with itself.
 *
 * ==> THE NEWER ONE WINS, NOT THE SCARIER ONE. <== Ranking by severity would
 * make this file decide which of an agency's statements is the real one, which
 * is exactly the judgement §50.1 says we do not make. `sent` says which the
 * agency issued last; that is the agency's own answer to the same question.
 * ------------------------------------------------------------------------ */
/**
 * A stable identity for one alert, from the fields an agency would have to
 * change for it to be a different message.
 *
 * ==> SHARED WITH THE UI ON PURPOSE. <== `ui/cap-storm.js` remembers which
 * alerts the reader has expanded across a repaint, and it has to key that on
 * the same notion of "the same alert" the dedupe uses. Two definitions of
 * alert identity would drift, and the symptom would be a disclosure that
 * silently collapses itself on the next poll.
 *
 * NOT `objectid`. The service has one, but it is Esri's row id rather than the
 * agency's, and nothing guarantees it survives a republish of the same alert.
 */
export const alertKey = (a) =>
  [a.agency || '', a.event || '', a.area || '', a.expires ?? ''].join('\u0000');

export function dedupeAlerts(alerts) {
  const best = new Map();
  for (const a of alerts) {
    const k = alertKey(a);
    const prev = best.get(k);
    if (!prev) { best.set(k, a); continue; }
    /* A row with no `sent` never displaces one that has it — an unknown time
     * is not a later time. */
    if (a.sent != null && (prev.sent == null || a.sent > prev.sent)) best.set(k, a);
  }
  return [...best.values()];
}

/**
 * Every alert in the feed body, normalized, unexpired and deduped.
 *
 * ==> THROWS NOTHING AND GUESSES NOTHING. <== A body that is not this
 * service's answer returns null rather than an empty array, because the two
 * mean opposite things: `[]` is "no country has an alert in force" and null is
 * "we could not read the answer". `data/cap.js` turns the second into
 * `unavailable`; collapsing them here would manufacture a global all-clear out
 * of a parse failure.
 *
 * @returns {Array|null}
 */
export function readAlerts(json, now) {
  if (!json || typeof json !== 'object') return null;
  if (json.error) return null;
  if (!Array.isArray(json.features)) return null;

  const out = [];
  for (const f of json.features) {
    const a = normalizeAlert(f && f.attributes);
    if (!a) continue;
    if (isExpired(a, now)) continue;
    /* ==> A DRILL IS DROPPED HERE AND NOT LATER. <== §50.8. An exercise, a
     * test or a draft is not a message to the public at all, so unlike a
     * cancellation there is no reader for whom it is worth showing. Dropping
     * it at the read means no surface downstream can accidentally render one.
     *
     * A CANCELLATION IS KEPT. "The tropical wave has passed" is information
     * somebody wants, and hiding it would leave the section silent on the one
     * question a reader watching a departing storm is actually asking. It is
     * tagged rather than filtered, and `isInForce()` is what keeps it off the
     * coast. */
    if (!isActual(a)) continue;
    out.push(a);
  }
  /* NEWEST FIRST, and stably — an agency that issues four alerts in a minute
   * should not have them shuffle between polls. */
  const sorted = dedupeAlerts(out).sort((x, y) => (y.sent ?? 0) - (x.sent ?? 0));
  return sorted;
}

/* ---------------------------------------------------------------------------
 * MATCHING A STORM TO AN AGENCY
 * ------------------------------------------------------------------------ */

/**
 * The ISO-2 country codes a storm is currently associated with.
 *
 * ==> ONLY GDACS ANSWERS THIS, AND THAT IS A REAL LIMIT RATHER THAN AN
 * OVERSIGHT (§50.3). <== A GDACS storm carries `countries` — the feed's
 * `affectedcountries`, each with `iso2` already on it. An NHC storm carries a
 * basin and no country at all, and inventing one from its position would mean
 * this file deciding which nation a storm belongs to. It does not.
 *
 * ==> AN EMPTY ANSWER IS OFTEN A GAP, NOT THE TRUTH, AND THE REASSURING NUMBER
 * WAS COUNTING THE WRONG ROWS. <== 63 of 98 rows in the archived GDACS list
 * carry countries — but that list is mostly ENDED storms, which is where the
 * attribution accumulates. Among the three storms actually LIVE on 2026-08-19
 * exactly ONE carried a country, and it was the American one. The other two
 * carried none in every hourly snapshot across the window.
 *
 * So GDACS attributes countries LATER than agencies issue warnings, and this
 * function returning `[]` frequently means "not scored yet" rather than "out
 * at sea". Callers must not word an empty result as an all-clear —
 * `ui/cap-storm.js` splits the two cases on whether anything is in force
 * anywhere, and the archive manifest records both halves hourly so the lag can
 * be measured rather than guessed at.
 */
export function stormCountries(storm) {
  const list = storm?.countries;
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  for (const c of list) {
    const iso2 = clean(c && c.iso2)?.toUpperCase();
    if (iso2) seen.add(iso2);
  }
  return [...seen];
}

/**
 * The alerts issued by the countries this storm is affecting.
 *
 * ==> A COUNTRY MATCH IS NOT A CAUSAL CLAIM, AND §50.5 REQUIRES THE UI TO SAY
 * SO. <== The Philippine agency's archived alert covers the whole Philippine
 * Area of Responsibility, 17 degrees of ocean; Environment Canada's storm
 * surge warnings are for the Yukon. This function answers "which agencies
 * covering this storm's countries currently have a cyclone alert out", which
 * is a weaker and TRUE statement, and the section header says exactly that.
 * It is not "this alert is about this storm" and must never be worded as one.
 */
export function alertsForStorm(alerts, storm) {
  if (!Array.isArray(alerts)) return [];
  const countries = new Set(stormCountries(storm));
  if (!countries.size) return [];
  return alerts.filter((a) => a.country && countries.has(a.country));
}
