/**
 * season-story.js — one storm's life, assembled into a paragraph.
 * SPEC-SEASONS-BUILD.md §57.41.
 *
 * ==> EVERY CLAUSE IS BACKED BY A FIGURE AND A CLAUSE WITH NO FIGURE BEHIND IT
 * IS DROPPED RATHER THAN SOFTENED. <== No model writes this. It is arithmetic
 * over the storm's own rows plus the names the runner looked up, which keeps it
 * offline, instant, and incapable of inventing a fact. A generated sentence in a
 * hurricane archive that turns out to be wrong is the all-clear-during-an-outage
 * bug wearing better prose — it reads perfectly and nothing about it invites a
 * second look.
 *
 * ==> IT IS SHIPPED CODE, UNLIKE §57.40's GAZETTEER, AND THE SEASON IN PROGRESS
 * IS WHY. <== The archive gets its place names from a runner pass. The running
 * season has no runner pass at all, so the phone has to assemble that storm's
 * paragraph itself — every clause except the ones that need a name.
 *
 * ==> A MISSING PLACES FILE AND A PLACE WITH NO TOWN NEAR IT ARE DIFFERENT
 * ANSWERS AND THIS FILE KEEPS THEM APART. <== §5. `places: null` means nobody
 * looked, so the paragraph says nothing about where; `places.genesis === null`
 * means we looked and there is no town inside `placeFarKm`, which is what open
 * water looks like and is sayable. Collapsing those would put "over open water"
 * under a storm that formed in the Gulf of Mexico on a day the sidecar 404'd.
 *
 * ==> THE REPETITIVE "It … It … It …" IS DELIBERATE. <== Aaron's call,
 * 2026-08-29. Varied templates are where assembled prose starts sounding
 * written, and sounding written is how a reader stops checking it. Plain and
 * slightly repetitive is the correct trade for a paragraph made of facts.
 *
 * ==> AND NO FIGURE IN A SENTENCE IS TYPED. <== The prototype's stall clause
 * said "within 100 km" while `stallRadiusKm` was 150. It read as a measurement
 * and was a leftover from an earlier draft. Every number here interpolates the
 * constant that produced it.
 *
 * Pure. Imports config/ and lib/. No DOM, no network, no clock, no map.
 */

import { SEASONS } from '../config/constants.js';
import { formatDistance, formatWind } from './units.js';

const HOURS = 3600 * 1000;
const KM_PER_NM = 1.852;
const RAD = Math.PI / 180;
const KM_PER_DEG = 111.2;

/** True when the system was a tropical or subtropical cyclone at this record.
 *  The app's own list, not a second one — the same call `lib/landfall.js` and
 *  `lib/season-facts.js` both make. */
const isCyclone = (status) => SEASONS.cycloneStatuses.includes(String(status || '').toUpperCase());

/* ---------------------------------------------------------------------------
 * SAYING NUMBERS
 * ------------------------------------------------------------------------- */

const WORDS = [
  'zero', 'one', 'two', 'three', 'four', 'five', 'six',
  'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve',
];

/** ==> COUNTS ARE WORDS, NOT DIGITS. <== Aaron's call. "came ashore four
 *  times" is a sentence; "came ashore 4 times" is a readout. Above twelve the
 *  word is longer than the number is useful, and no storm in the archive has
 *  ever come close, so the digits are the honest fallback rather than a
 *  spelled-out "twenty-three". */
export const countWord = (n) => (Number.isInteger(n) && n >= 0 && n < WORDS.length ? WORDS[n] : String(n));

/** UTC, always. ==> THE STORM'S OWN TIME ZONE IS NOT KNOWABLE AND THE
 *  READER'S IS THE WRONG ONE. <== The same rule and the same reason as
 *  `ui/season-detail-markup.js`: rendering an 1893 Louisiana landfall in the
 *  reader's clock would put a Gulf hurricane ashore at a time nobody in
 *  Louisiana experienced, and the offset would depend on where the reader
 *  happens to be sitting. */
const FULL_DAY = new Intl.DateTimeFormat('en-US', {
  timeZone: 'UTC', year: 'numeric', month: 'long', day: 'numeric',
});
const SHORT_DAY = new Intl.DateTimeFormat('en-US', {
  timeZone: 'UTC', month: 'long', day: 'numeric',
});

const fullDay = (ms) => (Number.isFinite(ms) ? FULL_DAY.format(new Date(ms)) : null);

/** Month and day, with the year added back when it differs from the storm's
 *  first year. A season that runs past New Year is rare and real, and
 *  "it dissipated on January 6" under a storm headed 2005 is a puzzle. */
function shortDay(ms, firstMs) {
  if (!Number.isFinite(ms)) return null;
  const a = new Date(ms).getUTCFullYear();
  const b = Number.isFinite(firstMs) ? new Date(firstMs).getUTCFullYear() : a;
  return a === b ? SHORT_DAY.format(new Date(ms)) : FULL_DAY.format(new Date(ms));
}

/**
 * Hours as a phrase, days once it is past a day.
 *
 * ==> DURATIONS ARE DIGITS EVEN THOUGH COUNTS ARE WORDS, AND THAT IS NOT A
 * CONTRADICTION. <== `countWord` exists because "came ashore four times" is a
 * sentence and "came ashore 4 times" is a readout. A duration is the opposite:
 * it is a measurement the reader may want to compare against another storm, and
 * a paragraph reading "twelve days" beside one reading "22 days" makes two
 * facts of the same kind look like two different kinds of fact. The prototype
 * §57.41 records used digits for both spans it printed.
 */
export function spanPhrase(hours) {
  if (!Number.isFinite(hours) || hours <= 0) return null;
  if (hours < 36) {
    const h = Math.round(hours);
    return `${h} hour${h === 1 ? '' : 's'}`;
  }
  const d = Math.round(hours / 24);
  return `${d} day${d === 1 ? '' : 's'}`;
}

/** ==> A PROSE CATEGORY LABEL, GRADED BY THE SAME FUNCTION AS EVERYTHING ELSE.
 *  <== The index comes from `categoryFromKt` and is already on `facts`; only
 *  the WORDING differs from `categoryShortLabel`, which says "Cat 4" because it
 *  is sized for a list row. A sentence says "a Category 4". The grading is not
 *  duplicated — a Cat 3 in 1935 and a Cat 3 today are still one claim. */
export function categoryPhrase(category) {
  if (!Number.isInteger(category)) return null;
  if (category <= 0) return 'a tropical depression';
  if (category === 1) return 'a tropical storm';
  return `a Category ${category - 1}`;
}

/** Kilometres in the reader's units, through the app's one distance formatter.
 *  The gazetteer answers in km because that is what it measured in; every
 *  reader-facing figure in this app converts from nautical miles, so it goes
 *  back through that door rather than growing a second conversion table. */
const kmPhrase = (km, system) => (Number.isFinite(km) ? formatDistance(km / KM_PER_NM, system) : null);

/**
 * A THRESHOLD in the reader's units, rounded to something a person would say.
 *
 * ==> A ROUND NUMBER THAT SURVIVES A UNIT CONVERSION STOPS BEING ROUND, AND
 * THAT READS AS A MEASUREMENT. <== `stallRadiusKm` is 150 — a chosen bound, not
 * something anybody counted. Converted straight it prints "93 mi", which looks
 * like the answer to a question rather than the edge of a box, and a reader is
 * entitled to wonder why 93. Rounded to the nearest ten and prefixed "about",
 * it reads as what it is. The figure is still interpolated from the constant,
 * so moving the constant moves the sentence.
 */
function thresholdPhrase(km, system) {
  const exact = kmPhrase(km, system);
  if (!exact) return null;
  const m = /^([\d,.]+)\s+(\S+)$/.exec(exact);
  if (!m) return exact;
  const n = Number(m[1].replace(/,/g, ''));
  if (!Number.isFinite(n) || n < 10) return exact;
  return `${Math.round(n / 10) * 10} ${m[2]}`;
}

/* ---------------------------------------------------------------------------
 * THE STALL
 * ------------------------------------------------------------------------- */

/**
 * The longest stretch of the storm's life spent going nowhere.
 *
 * ==> MEASURED FROM THE WINDOW'S OWN CENTRE, NOT FROM ITS FIRST FIX, AND THAT
 * IS THE SINGLE MOST IMPORTANT LINE IN THIS FILE. <== The obvious version —
 * "how far has it drifted from where this window started" — misses Harvey
 * completely, which is the one storm the clause exists for. Harvey went inland
 * near Rockport, back out over the Gulf and ashore again near Cameron; every
 * one of those legs breaks a window anchored on its own first point, so the
 * storm whose entire reputation is that it stopped moving reported no stall at
 * all. Measured against the centroid it reports three days near Bloomington,
 * Texas, and Dorian reports two days at High Rock.
 *
 * ==> ONLY CYCLONE-STATUS FIXES COUNT, AND THAT IS ABOUT CHRONOLOGY. <== A
 * remnant low wandering for a week barely moved too, and saying so would be
 * true — but the stall clause is printed BEFORE the ending clause, so a stall
 * measured on the extratropical tail would describe something that happened
 * after the paragraph has already said the storm was over.
 *
 * ==> LONGITUDE IS THE UNWRAPPED ONE. <== `lonU` runs continuously past ±180
 * (`lib/hurdat.js`), and a centroid taken from raw longitude would put the
 * middle of a storm sitting on the date line at 0°E — off the coast of Africa,
 * with every fix then reading as thousands of kilometres from its own centre.
 *
 * @param {Array<object>} points  fixes with `time`, `lat`, `lonU`, `status`
 * @param {object} [opts]
 * @returns {{startTime:number, endTime:number, hours:number, lat:number,
 *   lon:number, fixes:number} | null}
 */
export function stallWindow(points, {
  radiusKm = SEASONS.stallRadiusKm,
  minHours = SEASONS.stallMinHours,
} = {}) {
  const pts = (points || [])
    .filter((p) => Number.isFinite(p?.time) && Number.isFinite(p?.lat)
      && Number.isFinite(p?.lonU ?? p?.lon))
    .sort((a, b) => a.time - b.time);
  if (pts.length < 2) return null;

  const lonOf = (p) => (Number.isFinite(p.lonU) ? p.lonU : p.lon);

  /* ==> CONTIGUITY IS REQUIRED, SO THE NON-CYCLONE FIXES BREAK THE RUN RATHER
   * THAN BEING FILTERED OUT OF IT. <== Dropping them from a flat list would
   * silently join the two sides of a gap: a storm that was a wave for three
   * days in the middle of the Atlantic would have the fixes either side of
   * that gap treated as consecutive, and a window spanning it would claim the
   * storm sat still through days it spent crossing an ocean. */
  const runs = [];
  let run = [];
  for (const p of pts) {
    if (isCyclone(p.status)) run.push(p);
    else { if (run.length > 1) runs.push(run); run = []; }
  }
  if (run.length > 1) runs.push(run);
  if (!runs.length) return null;

  let best = null;
  for (const list of runs) {
    for (let i = 0; i < list.length; i++) {
      let sumLat = 0;
      let sumLon = 0;
      for (let j = i; j < list.length; j++) {
        sumLat += list[j].lat;
        sumLon += lonOf(list[j]);
        const n = j - i + 1;
        if (n < 2) continue;
        const cLat = sumLat / n;
        const cLon = sumLon / n;

        let inside = true;
        for (let k = i; k <= j; k++) {
          const dy = (list[k].lat - cLat) * KM_PER_DEG;
          const dx = (lonOf(list[k]) - cLon) * Math.cos(cLat * RAD) * KM_PER_DEG;
          if (Math.hypot(dx, dy) > radiusKm) { inside = false; break; }
        }
        /* ==> A WINDOW THAT HAS BURST DOES NOT END THE SEARCH FROM THIS START.
         * <== Adding a far fix moves the centroid, and a LATER fix can pull it
         * back so that everything sits inside again. Breaking here would stop
         * at the first excursion and lose the longer stall on the other side
         * of it. */
        if (!inside) continue;

        const hours = (list[j].time - list[i].time) / HOURS;
        if (hours < minHours) continue;
        if (!best || hours > best.hours) {
          best = {
            startTime: list[i].time,
            endTime: list[j].time,
            hours,
            lat: Math.round(cLat * 100) / 100,
            lon: Math.round(cLon * 100) / 100,
            fixes: n,
          };
        }
      }
    }
  }
  return best;
}

/* ---------------------------------------------------------------------------
 * HOW LONG IT TOOK TO BECOME A HURRICANE
 * ------------------------------------------------------------------------- */

/**
 * Hours from the first fix to the first hurricane-strength one.
 *
 * ==> IT IS ONLY MEANINGFUL WHEN WE WATCHED THE STORM FORM, AND THE FIRST
 * VERSION OF THIS DID NOT KNOW THAT. <== It reported dozens of 1851 storms tied
 * at "0 hours to hurricane", because their first record was ALREADY a
 * hurricane. That is not a fast-forming storm; it is a storm nobody saw until
 * it was big — the same observational undercount `seasonFacts.undercountLikely`
 * flags at season level, at the size of one storm. So the answer carries WHICH
 * of the three cases it is and the caller writes a different sentence for each.
 *
 * @returns {{state:'formed', hours:number}
 *   | {state:'born_hurricane'}
 *   | {state:'unsayable'}}
 */
export function hoursToHurricane(points, {
  hurricaneKt = SEASONS.hurricaneKt,
  namedStormKt = SEASONS.namedStormKt,
} = {}) {
  const pts = (points || [])
    .filter((p) => Number.isFinite(p?.time))
    .sort((a, b) => a.time - b.time);
  const withWind = pts.filter((p) => Number.isFinite(p.windKt));
  if (!withWind.length) return { state: 'unsayable' };

  const first = withWind[0];
  if (first.windKt >= hurricaneKt) return { state: 'born_hurricane' };
  /* Already a named storm when first seen: we did not watch it form either,
   * but it was not a hurricane, so neither sentence is true. Say nothing —
   * "slightly incomplete" is the honest state and the peak clause covers it. */
  if (first.windKt >= namedStormKt) return { state: 'unsayable' };

  const reached = withWind.find((p) => p.windKt >= hurricaneKt);
  if (!reached) return { state: 'unsayable' };
  return { state: 'formed', hours: (reached.time - pts[0].time) / HOURS };
}

/* ---------------------------------------------------------------------------
 * THE PARAGRAPH
 * ------------------------------------------------------------------------- */

/** Did NOAA mark a landfall this app declined for being extratropical?
 *  §57.7a: a system that has already lost its tropical structure does not come
 *  ashore as a tropical cyclone anywhere else in this app, so it does not here
 *  either. Sandy 2012 is the case that makes it visible. */
function declinedExtratropicalMark(points) {
  return (points || []).some((p) => String(p?.marker || '').toUpperCase() === 'L'
    && !isCyclone(p?.status));
}

/**
 * The clauses, in order, each independently droppable.
 *
 * Returned as an array of sentences rather than a joined string so the markup
 * can decide how to set them and a suite can assert one clause without
 * matching against the whole paragraph.
 *
 * @param {object} facts  from `lib/season-facts.js`
 * @param {object} opts
 * @param {string} opts.name          the storm's display name
 * @param {Array<object>} [opts.points]  the storm's fixes, for the stall and
 *   the hurricane clock. Absent means both clauses are dropped.
 * @param {object|null} [opts.places]  this storm's entry from the places
 *   sidecar, or `null` when the sidecar is not on screen. **`null` and an
 *   entry with null fields mean different things — see the header.**
 * @param {string} [opts.system]  the reader's measurement preference
 * @returns {string[]}
 */
export function storyClauses(facts, {
  name, points = null, places = null, system = null,
} = {}) {
  if (!facts || !Number.isFinite(facts.firstTime)) return [];

  const out = [];
  const who = name || 'This storm';
  const known = places !== null && places !== undefined;

  /* --- 1. WHERE AND WHEN IT WAS FIRST SEEN. Never dropped: every storm in the
   * record has a first row, and this sentence is what the rest hangs off. */
  const bornDay = fullDay(facts.firstTime);
  const bornPlace = known ? (places.genesis || null) : null;
  if (bornPlace?.name) {
    const away = kmPhrase(bornPlace.km, system);
    out.push(`${who} was first seen on ${bornDay}, ${away ? `about ${away} from ` : 'near '}${bornPlace.name}.`);
  } else if (known) {
    out.push(`${who} was first seen on ${bornDay}, out over open water.`);
  } else {
    out.push(`${who} was first seen on ${bornDay}.`);
  }

  /* --- 2. HOW LONG TO HURRICANE STRENGTH. */
  if (points) {
    const clock = hoursToHurricane(points);
    if (clock.state === 'born_hurricane') {
      out.push('It was already a hurricane when it was first spotted, so nobody saw it form.');
    } else if (clock.state === 'formed') {
      const span = spanPhrase(clock.hours);
      /* ==> THE COMPARISON FIRES ONLY AT THE EXTREMES. <== Between 0.6× and 2×
       * the archive's median it says nothing, because "slightly above average"
       * is not a fact worth a reader's attention and printing it on every
       * storm is how the whole paragraph starts reading as filler. */
      const median = SEASONS.medianHoursToHurricane;
      /* ==> A COMMA RATHER THAN AN EM DASH, AND THAT IS NOT TYPOGRAPHY. <==
       * `lib/units.js` returns a bare em dash as its MISSING sentinel, so a
       * paragraph containing one is the single cheapest signal that a figure
       * failed to resolve and was printed anyway. `tools/test-season-story.mjs`
       * bans the character outright across every fixture, and that guard only
       * works if no clause here uses one decoratively. */
      const compare = clock.hours < median * 0.6 ? ', far faster than a storm usually takes'
        : clock.hours > median * 2 ? ', far longer than a storm usually takes'
          : '';
      if (span) out.push(`It reached hurricane strength ${span} later${compare}.`);
    }
  }

  /* --- 3. PEAK WIND, DATE, CATEGORY. */
  if (Number.isFinite(facts.peakWindKt)) {
    const cat = categoryPhrase(facts.peakCategory);
    const when = shortDay(facts.peakTime, facts.firstTime);
    const wind = formatWind(facts.peakWindKt, system);
    out.push(`It peaked at ${wind} on ${when}${cat ? `, ${cat}` : ''}.`);
  }

  /* --- 4. LANDFALLS, AND THE HARDEST ONE. */
  out.push(...landfallClauses(facts, { places: known ? places : null, system }));
  if (facts.ending === 'extratropical' && points && declinedExtratropicalMark(points)) {
    out.push('NOAA also marks a landfall for this storm after it had already lost its '
      + 'tropical structure. This app does not count those as tropical cyclone landfalls, '
      + 'so it is not in the list above.');
  }

  /* --- 5. THE STALL. The sidecar's answer when there is one, because the
   * runner is the only side that can name the place; the phone computes its
   * own for the season still running, which has no sidecar at all. One
   * function either way, so the two can never disagree about the window. */
  const stall = known && places.stall ? places.stall
    : (points ? stallWindow(points) : null);
  if (stall) {
    const span = spanPhrase(stall.hours);
    const within = thresholdPhrase(SEASONS.stallRadiusKm, system);
    if (span) {
      const anchor = stall.name ? ` of ${stall.name}`
        : (known ? ' of anywhere, out over open water' : '');
      out.push(`It barely moved for ${span}, staying within about ${within}${anchor}.`);
    }
  }

  /* --- 6. HOW AND WHEN IT ENDED, AND LIFESPAN. Never dropped. */
  const ENDINGS = {
    extratropical: 'It lost its tropical structure',
    dissipated: 'It faded out',
    remnant_low: 'It weakened to a remnant low',
    unknown: 'The record ends',
  };
  const verb = ENDINGS[facts.ending] || ENDINGS.unknown;
  const lived = spanPhrase(facts.lifespanHours);
  const died = shortDay(facts.lastTime, facts.firstTime);
  out.push(`${verb} on ${died}${lived ? `, ${lived} after it was first seen` : ''}.`);

  return out;
}

/**
 * The landfall sentence, or the sentence saying there was not one.
 *
 * ==> WHEN SOME LANDFALLS HAVE A NAME AND SOME DO NOT, THE LIST IS DROPPED
 * ENTIRELY. <== Andrew 1992 came ashore four times with three names available,
 * and printing four alongside three reads as a miscount. The count and the
 * hardest one survive, because neither of those is a list.
 *
 * ==> AND THE PLACES ARRAY IS ONLY TRUSTED WHEN THE LANDFALLS ARE OURS. <==
 * The sidecar's names are index-aligned against the COMPUTED landfall list. If
 * that file did not arrive, `stormFacts` falls back to NOAA's sparser `L`
 * markers — a different list, in a different order, of a different length — and
 * lining the two up would put Cameron's name on a Florida landfall.
 */
function landfallClauses(facts, { places, system }) {
  const list = facts?.landfalls || [];
  if (!list.length) {
    /* Only sayable when the list is ours. NOAA's silence is not a claim that
     * the storm stayed at sea — that is the whole of §57.7's twelve-year hole,
     * and the panel's own landfall section already explains it. */
    return facts?.landfallSource === 'computed' ? ['It never came ashore.'] : [];
  }

  const aligned = places && facts.landfallSource === 'computed'
    && Array.isArray(places.landfalls) && places.landfalls.length === list.length
    ? places.landfalls : null;

  /* The hardest landfall is the strongest one at the coast, which is not the
   * storm's peak — Katrina peaked at Cat 5 over water and came ashore at Cat 3,
   * and that gap is a fact people get wrong constantly. */
  let worstAt = 0;
  for (let i = 1; i < list.length; i++) {
    const a = list[worstAt].windKt;
    const b = list[i].windKt;
    if (Number.isFinite(b) && (!Number.isFinite(a) || b > a)) worstAt = i;
  }

  const names = aligned ? aligned.map((p) => p?.name || null) : [];
  const allNamed = names.length > 0 && names.every(Boolean);
  const hardName = aligned ? (aligned[worstAt]?.name || null) : null;
  const hardWhen = shortDay(list[worstAt].time, facts.firstTime);
  const hardCat = categoryPhrase(list[worstAt].category);

  /* One landfall is one sentence. "It came ashore one times" is the shape this
   * guards against, and splitting a roll-call of one off from its own hardest
   * entry would be two sentences about the same event. */
  if (list.length === 1) {
    const where = hardName ? ` near ${hardName}` : '';
    return [`It came ashore once${where} on ${hardWhen}${hardCat ? `, ${hardCat}` : ''}.`];
  }

  /* `twice` rather than `two times`, which is the one count in this range that
   * has a word of its own and sounds wrong without it. */
  const times = `It came ashore ${list.length === 2 ? 'twice' : `${countWord(list.length)} times`}`;

  /* ==> THE ROLL-CALL AND THE HARDEST ONE ARE TWO SENTENCES, NOT ONE JOINED BY
   * AN EM DASH. <== The dash version read well and had to go: `lib/units.js`
   * returns a bare `—` when a figure fails to resolve, so a paragraph
   * containing one is the cheapest signal available that a number was printed
   * anyway, and `tools/test-season-story.mjs` can only ban the character
   * outright if nothing here uses one decoratively. A colon does the same work.
   *
   * ==> AND THE HARDEST ONE IS NAMED BY ITS TOWN ALONE ONCE THE FULL LABEL HAS
   * BEEN SPELLED OUT A SENTENCE EARLIER. <== §57.40's rule is that a place is
   * never named AMBIGUOUSLY. It is not a rule that the country must be repeated
   * six words later, and `hardest near Fulton, Texas, United States` under a
   * list that already said so reads as a machine. With no list — the partly
   * named case — the full label is the only mention and stays. */
  const hardShort = hardName && allNamed ? String(hardName).split(',')[0] : hardName;
  const strength = hardCat ? `, ${hardCat}` : '';
  const hardest = hardShort
    ? `The hardest was near ${hardShort} on ${hardWhen}${strength}.`
    : `The hardest was on ${hardWhen}${strength}.`;

  return allNamed
    ? [`${times}: ${joinList(names)}.`, hardest]
    : [`${times}.`, hardest];
}

/** `a, b and c`. Oxford comma left off deliberately — this is a list of place
 *  labels that already contain commas, and a fourth one before "and" makes the
 *  whole thing unreadable. */
function joinList(items) {
  const real = items.filter(Boolean);
  if (real.length <= 1) return real.join('');
  return `${real.slice(0, -1).join('; ')}; and ${real[real.length - 1]}`;
}

export const __internals = { isCyclone, declinedExtratropicalMark, joinList, landfallClauses };
