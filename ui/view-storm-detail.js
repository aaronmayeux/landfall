/**
 * view-storm-detail.js — the storm detail view (SPEC §16).
 *
 * A VIEW INSIDE THE ONE DRAWER, pushed onto the stack by the storm list. The
 * drawer owns the header, the back button, and the close button; this file
 * owns the storm. Back returns to wherever you came from — the list normally,
 * and Layers if you took the side trip to turn something on.
 *
 * IDENTITY LIVES IN THE DRAWER HEADER. The storm's name is the view's title,
 * supplied through titleFor(), so the pinned identity is the drawer's own
 * chrome rather than a second header stacked under it. The category swatch
 * rides with it — category color is the SWATCH, never the text color (§6).
 *
 * Structure rules it implements:
 *  - The timestamp PINS below the header; the body scrolls under it. You must
 *    never lose track of which storm and how old while reading.
 *  - The timestamp is the load-bearing element: three freshness bands
 *    (fresh / aging / stale, thresholds in FRESHNESS), and a SEPARATE
 *    geometry line that exists only when the MapServer lags the feed by more
 *    than one advisory cycle — silence means synchronized.
 *  - Nulls are omitted, not zeroed. A missing pressure row is honest;
 *    "0 mb" is a lie.
 *  - Native unit first, converted in parentheses (knots is what NHC says).
 *  - Sections collapse per user, persisted (STORAGE_KEY.sections).
 *  - Watch/warning wording: "None in effect" vs "Watches and warnings
 *    unavailable" are two different strings, by design. Never "advisory".
 *  - Storm leaves the feed while open → the reduced ghost form in place:
 *    identity, last-known vitals, the notice. No home block, no layer link.
 *
 * THERE IS NO LAYERS SECTION HERE ANY MORE (2026-07-25). §16 sketched inline
 * toggles; that became a shortcut row into the Layers view; that is now gone
 * too. Layers are reached from the floating Layers button, which is on screen
 * the entire time this panel is open — a second door saved no navigation and
 * cost a summary line that had to be kept in step with the layer store. What
 * survives from that section is the map-geometry failure notice, promoted to
 * a bare uncollapsible block at the top of the body; see mapProblemHtml.
 *
 * UNITS ARE THE USER'S FIRST, THE SOURCE'S SECOND. "98 mph (85 kt)", not the
 * other way round. Knots and nautical miles stay in the parenthetical because
 * the advisory text a few rows down quotes them and a reader cross-checking
 * one against the other should not have to convert in their head — but they
 * are the footnote, not the headline.
 *
 * ==> THE DISCLAIMER FOOTER, AND WHY IT IS ON THIS PANEL SPECIFICALLY <==
 * §17 A1 shipped the disclaimer on two surfaces — a first-run acknowledgement
 * and the Settings/About view — and named this panel as the placement worth
 * more than either, left unbuilt. It is built now. This is the one screen in
 * the app where somebody reads a forecast and DECIDES SOMETHING: whether the
 * thing is coming for them, whether to leave. A provenance statement is worth
 * the most at the moment of the decision, not at the moment of arrival, which
 * is where the other two sit.
 *
 * It is a FOOTER, not a pinned banner. The stamp above is pinned and the body
 * scrolls beneath it; adding two lines to the pinned region costs reading
 * height on the phone that has the least of it, and colours the disclaimer
 * with the freshness band (fresh/aging/stale) it has nothing to do with. The
 * panel is short — vitals, home, in effect, wind field, advisory collapsed —
 * so a footer is read.
 *
 * The NHC link is not decoration. "Always follow the National Hurricane
 * Centre" with no way to get there is advice without a door.
 *
 * Imports: config/, lib/ only, PLUS ui/disclaimer.js for the wording — one
 * source for that text, never retyped at a call site (§17 A1). Home, geometry,
 * and layer state arrive through injected facades from main.js — ui/ never
 * imports data/ (SPEC §12).
 */

import { FRESHNESS, STORAGE_KEY } from '../config/constants.js';
import { DISCLAIMER } from './disclaimer.js';
import { categoryColor, categoryShortLabel } from '../lib/category.js';
import { formatAge, formatUntil, formatClockDay, ageMs } from '../lib/time.js';
import {
  formatWind, formatSpeed, formatDistance, formatPressure, formatBearing,
} from '../lib/units.js';
import { isSilent, silenceNote, silenceSectionNote } from '../lib/silence.js';
import {
  isEnded, endedNote, endedSectionNote, stormSwatch, noCurrentReading,
} from '../lib/lifecycle.js';
import { wwLegend } from '../lib/watchwarning.js';
import { windThresholdFromProps, windColor, WIND_LABEL } from '../lib/wind.js';
import { peopleInFeatures, formatPeople } from '../lib/population-count.js';
import { loadTowns, townsOrNull, populationState } from '../data/population.js';
import { POPULATION } from '../config/constants.js';

/* --- small helpers --------------------------------------------------------- */

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** "Hurricane · Category 2" — the second identity line. Trusts NHC's own
 *  label for what kind of thing it is (§4); derives only the number. */
/**
 * The classification line under the storm's name.
 *
 * ==> AN ENDED STORM GETS "LAST REPORTED", AND THE PREFIX IS NOT DECORATION.
 * Everything this function returns is a NOUN PHRASE in the present tense —
 * "Hurricane · Category 4" — set in the largest supporting text on the panel,
 * directly under the name. On a storm whose agency has issued its final
 * advisory that is a severity claim about right now, sourced from a bulletin
 * superseded by its own author. The grey swatch beside the name and the badge
 * below both qualify it, but neither is IN the sentence, and the sentence is
 * what a reader takes away. Two words fix it; nothing else on this panel had to
 * move.
 */
/**
 * The line under the storm's name.
 *
 * ==> IT IS QUALIFIED WHENEVER THERE IS NO CURRENT READING BEHIND IT. <==
 * Bare, this is the most present-tense claim on the panel: "Tropical
 * Depression", stated flat, reads as what the storm IS. On a system nobody has
 * analysed since Thursday that is a two-day-old classification wearing the
 * present tense, and it sat directly above a badge explaining that we have no
 * idea what the storm is doing — two answers to the same question, one screen.
 *
 * `noCurrentReading` rather than `isEnded` alone, and rather than a second
 * branch for silence. It is the one predicate for "nothing published lately"
 * and it already backs the cage head, the last-known dot and the swatch; a
 * fourth surface asking the same question with its own test is how one of them
 * ends up answering differently.
 *
 * ==> "LAST REPORTED", NOT "LAST KNOWN", AND THE REASON IS TWO INCHES BELOW IT.
 * <== It was written as "Last known" and tools/ended-check.mjs printed the
 * rendered panel back with the vitals header directly under it, which is
 * relabelled "Last known" for a storm in this state. Two identical phrases
 * stacked down one panel read as a templating bug. `reported` is also true of
 * both states: somebody reported this classification, and then stopped.
 */
function natureLine(storm) {
  if (noCurrentReading(storm)) return `Last reported: ${natureWords(storm)}`;
  return natureWords(storm);
}

function natureWords(storm) {
  const n = storm.nature;
  if (n === 'post-tropical') return 'Post-Tropical Cyclone';
  if (n === 'potential') return 'Potential Tropical Cyclone';
  if (n === 'remnant') return 'Remnant Low';
  const sub = n === 'subtropical';
  /* Hurricane strength with no category behind it — GDACS's ceiling, not a
   * gap in our parse. Named plainly rather than shown as a bare cyclone. */
  if (storm.category == null && storm.categoryCode === 'HU') return 'Hurricane / Typhoon';
  if (storm.category == null) return sub ? 'Subtropical Cyclone' : 'Tropical Cyclone';
  if (storm.category === 0) return sub ? 'Subtropical Depression' : 'Tropical Depression';
  if (storm.category === 1) return sub ? 'Subtropical Storm' : 'Tropical Storm';
  return `Hurricane · Category ${storm.category - 1}`;
}

function positionText(lat, lon) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const la = `${Math.abs(lat).toFixed(1)}°${lat >= 0 ? 'N' : 'S'}`;
  const lo = `${Math.abs(lon).toFixed(1)}°${lon >= 0 ? 'E' : 'W'}`;
  return `${la} ${lo}`;
}

/** Advisory string out of the advisoryKey ("nhc:al052026:12A" → "12A"). */
function advFromKey(key) {
  const parts = String(key || '').split(':');
  return parts.length >= 3 ? parts[2] : null;
}

/** The storm's own source, in the words the user should see.
 *
 *  The ghost note used to say "the NHC feed" for every storm regardless of
 *  where it came from, and `ghost` is set for BOTH sources. Bertha is the
 *  live case — she left NHC while GDACS still carried her, so the reverse
 *  will happen too and the note would have credited the wrong agency for a
 *  storm's disappearance. An unknown source degrades to the generic wording
 *  rather than guessing (§5). */
function sourceLabel(source) {
  if (source === 'nhc') return 'the NHC feed';
  if (source === 'gdacs') return 'the GDACS feed';
  return 'the feed it came from';
}

/** The footer that says this is not the National Hurricane Center.
 *
 *  `role="note"` and not `aria-live`: it is standing context, not something
 *  that just happened. A screen reader meets it in reading order like anyone
 *  else meets it at the end of the panel.
 *
 *  Rendered on the ghost form too. A storm that has left the feed is the case
 *  where a reader is MOST likely to be looking at something out of date, so
 *  dropping the provenance line there would be exactly backwards. */
function disclaimerHtml() {
  return `
    <div class="detail-disclaimer" role="note">
      ${esc(DISCLAIMER.short)}
      <a class="detail-disclaimer-link" href="${DISCLAIMER.officialUrl}"
         target="_blank" rel="noopener noreferrer">${esc(DISCLAIMER.officialLabel)}</a>
    </div>`;
}

/* --- section collapse persistence ------------------------------------------ */

function readSections() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY.sections)) || {}; }
  catch { return {}; }
}
function writeSections(s) {
  try { localStorage.setItem(STORAGE_KEY.sections, JSON.stringify(s)); } catch { /* session-only */ }
}

/**
 * @param {object} opts
 * @param {object}      opts.home                injected: {get, distanceTo, closestApproach}
 * @param {() => string|null} opts.units  the resolved unit system, injected
 *        from the settings store by main.js. ui/ never imports data/ (§12),
 *        and every formatter on this panel is handed the SAME answer so two
 *        figures in one drawer can never disagree about what system they are
 *        in.
 * @param {(storm) => void}      opts.onRetryGeometry
 * @param {(storm, opts?) => Promise<object>} opts.loadAdvisory  injected
 *   facade over data/advisory.js — ui/ never imports data/ (§12).
 */
export function createStormDetailView({
  home, onRetryGeometry, loadAdvisory, units,
}) {

  /** The resolved unit system, asked fresh on every render. NEVER cached: the
   *  user can change it in Settings while this panel is open, and a captured
   *  value would leave half the app in one system. */
  const sys = () => units?.() ?? null;
  let host = null;
  let visible = false;
  let storm = null;        // last-known storm object (survives feed exit → ghost)
  let ghost = false;
  let geo = { state: 'idle' }; // 'idle'|'loading'|'ok'|'error', bundle?, error?
  /* Advisory text is fetched ON EXPAND, not on selection — the collapsed
   * section IS the gate (§7's "fetching layers fetch only while switched on",
   * applied to a reading surface instead of a layer). `phase` is ours;
   * `rec.state` is the data layer's four-way answer. */
  /**
   * THE ADVISORY RECORD IS BOUND TO THE STORM IT BELONGS TO, and that binding
   * is the fix for a real bug (Aaron, on glass, 2026-07-25): open a storm's
   * advisory, then select another storm, and the FIRST storm's advisory stayed
   * on screen. A reload cleared it; navigating never did.
   *
   * THE CAUSE, and it is worth keeping because the shape of it will recur.
   * `onEnter` reset this state behind `if (s.id !== storm?.id)` — a comparison
   * that can never be true, because the drawer calls `titleFor(arg)` from
   * `renderChrome()` BEFORE it calls `onEnter(arg)` (ui/drawer.js `enter()`),
   * and `titleFor` assigns `storm = s` on its way past. By the time onEnter
   * ran, `storm` already WAS the new storm and the ids always matched.
   * Geometry survived only because main.js drives it externally with an
   * explicit `setGeometry({state:'loading'})`; the advisory had no such
   * driver and was the one piece of state relying on that dead branch.
   *
   * So this no longer INFERS whether the storm changed. `forId` and `forKey`
   * say which storm and which advisory the record is for, and anything else
   * is stale by definition — immune to call ordering, and immune to the next
   * method that decides to assign `storm` on its way past.
   */
  let adv = { phase: 'idle', rec: null, forId: null, forKey: null };
  let advSeq = 0;

  /** Only onEnter writes this, so no other method can clobber the comparison
   *  the way titleFor clobbered the last one. */
  let enteredId = null;

  const advisoryIsForCurrentStorm = () =>
    !!storm && adv.forId === storm.id && adv.forKey === storm.advisoryKey;
  let collapsed = readSections();
  /* The drawer re-renders its header when a view asks it to — a poll can
   * change a storm's category, and the title carries the swatch. */
  let requestChrome = null;

  let stampEl = null;
  let bodyEl = null;

  function buildSkeleton(el) {
    host = el;
    /* No header and no back button: the drawer owns both. The stamp pins
     * directly under the drawer's header; the body scrolls beneath it. */
    host.innerHTML = `
      <div class="detail-stamp" id="detail-stamp"></div>
      <div class="drawer-body detail-body" id="detail-body"></div>
    `;
    stampEl = host.querySelector('#detail-stamp');
    bodyEl = host.querySelector('#detail-body');
  }

  /* --- render pieces ------------------------------------------------------- */

  /** The drawer header's title for this view: swatch + name + nature. Built
   *  as a Node rather than a string because the drawer accepts either, and
   *  this one carries a colored swatch that must not be escaped away. */
  function titleNode() {
    const wrap = document.createElement('div');
    wrap.className = 'detail-identity';
    if (!storm) {
      wrap.textContent = 'Storm';
      return wrap;
    }
    wrap.innerHTML = `
      <div class="detail-name">
        <span class="row-swatch" style="background:${stormSwatch(storm)}"></span>
        <h1 class="drawer-title">${esc(storm.name)}</h1>
      </div>
      <div class="detail-nature">${esc(natureLine(storm))}</div>
    `;
    return wrap;
  }

  /**
   * The note a section shows when its content was DELIBERATELY withheld, or
   * null when nothing was.
   *
   * ==> ONE HELPER, SO PRECEDENCE CANNOT DIVERGE PER SECTION. <==
   * A storm can be both silent and ended — it went quiet, and then its feed
   * dropped it — and there are four sections that each ask this question. Four
   * copies of `endedSectionNote(storm) || silenceSectionNote(storm)` is three
   * chances for one of them to end up the other way round, which would leave the
   * panel saying "no update in over 24 hours, this storm may no longer be
   * active" in one place and "no further advisories will be issued" in another,
   * about the same storm, on the same screen.
   *
   * ENDED FIRST, always — lib/lifecycle.js `endedWins` states why: silence is a
   * hedge, and once the agency has said it is finished the hedge is the less
   * honest sentence.
   */
  function withheldNote() {
    return endedSectionNote(storm) || silenceSectionNote(storm);
  }

  function renderStamp() {
    if (!stampEl || !storm) return;

    /* ENDED IS THE FIFTH BAND, AND IT TAKES THE LINE THE SAME WAY SILENCE DOES
     * — for a stronger version of the same reason. The freshness bands qualify a
     * timestamp that is still arriving; silence says the next one has not come;
     * this says there will not be one. Leading with an advisory number here
     * would read as an update that is merely overdue. The advisory identity
     * moves to the second line, where it is provenance for the position on the
     * map rather than a claim about how current anything is. */
    const endNote = endedNote(storm);
    if (endNote) {
      /* THE ADVISORY NUMBER AND NOTHING ELSE. The headline above already carries
       * the clock, and on the declared path the two timestamps are THE SAME
       * INSTANT — the ending is stamped with the agency's own issuance time — so
       * repeating it printed "Mon 6:58 PM" twice, three lines apart, which reads
       * as two different facts that happen to agree. This line's only remaining
       * job is provenance for the position on the map: which advisory drew it. */
      const advE = advFromKey(storm.advisoryKey);
      const lastE = advE ? `Last advisory ${esc(advE)}` : '';
      stampEl.dataset.band = 'ended';
      stampEl.innerHTML =
        `<div>${esc(endNote.headline)}</div>` +
        (lastE ? `<div class="detail-stamp-geo">${lastE}</div>` : '') +
        `<div class="detail-stamp-detail">${esc(endNote.detail)}</div>`;
      return;
    }

    /* SILENCE IS THE FOURTH BAND AND IT REPLACES THE LINE RATHER THAN TINTING
     * IT. The other three qualify a timestamp that is still arriving — "this
     * is advisory 13, it is a few hours old". Once the publisher has stopped
     * there is no next advisory to be a few hours short of, and leading with
     * an advisory number under a red tint reads as a late update rather than
     * an absent one. The advisory identity moves down to the second line,
     * where it belongs: it is now provenance for the position on the map, not
     * a claim about how current anything is. */
    const note = silenceNote(storm);
    if (note) {
      /* NO CLOCK ON THIS LINE. The headline above it already states the
       * absolute time ("since Thu 7:00 AM"), and repeating it two lines later
       * with the same words spent the reader's attention on nothing. What is
       * NOT up there is how long ago that was, so the age stays and the clock
       * goes. The classification moved to the identity line, where it is now
       * qualified as last known \u2014 it does not need saying twice either. */
      const adv0 = advFromKey(storm.advisoryKey);
      const age0 = formatAge(storm.observedAt);
      const last = [
        adv0 ? `Last advisory ${esc(adv0)}` : null,
        age0 ? esc(age0) : null,
      ].filter(Boolean).join(' \u00b7 ');
      stampEl.dataset.band = 'silent';
      /* ==> NO WARNING GLYPH. <== It said "fault" a second time, on top of a
       * colour that was already saying it, about a state in which nothing
       * failed. See the band's note in ui/panels.css. */
      stampEl.innerHTML =
        `<div>${esc(note.headline)}</div>` +
        (last ? `<div class="detail-stamp-geo">${last}</div>` : '') +
        `<div class="detail-stamp-detail">${esc(note.detail)}</div>`;
      return;
    }

    const a = ageMs(storm.observedAt);
    const band =
      a == null ? 'stale'
      : a <= FRESHNESS.freshUntil ? 'fresh'
      : a <= FRESHNESS.agingUntil ? 'aging'
      : 'stale';
    const adv = advFromKey(storm.advisoryKey);
    const clock = formatClockDay(storm.observedAt);
    const age = formatAge(storm.observedAt);
    const line = [
      adv ? `Advisory ${esc(adv)}` : null,
      clock ? `${esc(clock)}${age ? ` (${esc(age)})` : ''}` : null,
    ].filter(Boolean).join(' · ');

    /* Geometry line exists ONLY when lagged OR when we are showing geometry
     * the source could not replace (`held`). Silence still means synchronized.
     * A held bundle inside the normal lag window would otherwise say nothing
     * at all, which is the case that blanked Fausto's map: the shape on screen
     * was right, it just wasn't this advisory's, and nothing said so. */
    let geoLine = '';
    if (geo.state === 'ok' && (geo.lagged || geo.held) && geo.bundle?.stamp) {
      const gAdv = geo.bundle.stamp.advisnum;
      const gAge = formatAge(geo.bundle.stamp.filedate);
      geoLine = `<div class="detail-stamp-geo">Cone and tracks from ${
        gAdv ? `advisory ${esc(gAdv)}` : 'an earlier advisory'
      }${gAge ? ` · ${esc(gAge)}` : ''}</div>`;
    }
    stampEl.dataset.band = band;
    stampEl.innerHTML = `<div>${band === 'stale' ? '⚠ ' : ''}${line || 'No timestamp'}</div>${geoLine}`;
  }

  /* `defaultCollapsed` exists for exactly one section. Everything on this
   * panel is a few lines and opens by default; the advisory is a full
   * teletype product and would push every one of them off screen (§16 item 7
   * — "never auto-expanded"). The user's own choice, once made, is persisted
   * and wins over the default from then on. */
  function section(id, title, innerHtml, { defaultCollapsed = false } = {}) {
    const isCollapsed =
      collapsed[id] === undefined ? defaultCollapsed : !!collapsed[id];
    return `
      <section class="detail-section" data-section="${id}" data-collapsed="${isCollapsed}">
        <button class="detail-section-head" type="button" aria-expanded="${!isCollapsed}">
          <h2>${esc(title)}</h2>
          <span class="detail-chevron" aria-hidden="true"></span>
        </button>
        <div class="detail-section-body">${innerHtml}</div>
      </section>`;
  }

  /** Nulls are omitted, not zeroed — rows only exist when there is a value. */
  function vitalsHtml() {
    const rows = [];
    if (Number.isFinite(storm.windKt)) {
      /* ATTRIBUTED WHEN IT IS NOT THIS STORM'S OWN AGENCY SPEAKING.
       *
       * A GDACS storm has no wind of its own — GDACS publishes none — so any
       * number in this row came from JTWC's active warning (lib/jtwc-wind.js).
       * Naming the source is not decoration: the whole reason the row can be
       * shown at all is that it is a real measurement rather than the derived
       * class midpoint the cage falls back to, and a reader has no other way
       * to tell those apart. NHC storms get no suffix — the panel already says
       * whose storm it is. */
      const from = storm.windSource === 'jtwc' ? ' · JTWC' : '';
      rows.push([
        'Winds',
        `${formatWind(storm.windKt, sys())} (${Math.round(storm.windKt)} kt)${from}`,
      ]);
      /* Gusts only ever arrive with a JTWC fix; NHC's storm list does not
       * publish them. Omitted, never zeroed, when absent. */
      if (Number.isFinite(storm.gustKt)) {
        rows.push([
          'Gusts',
          `${formatWind(storm.gustKt, sys())} (${Math.round(storm.gustKt)} kt)`,
        ]);
      }
    } else if (Number.isFinite(storm.peakWindKt)) {
      /* NAMED AS A FORECAST, because it is one. GDACS publishes no current
       * wind — only the maximum expected over the storm's life. Labelling
       * this "Winds" is what put a Cat 2 on a tropical storm. */
      rows.push([
        'Forecast peak',
        `${formatWind(storm.peakWindKt, sys())} (${Math.round(storm.peakWindKt)} kt)`,
      ]);
    }
    if (Number.isFinite(storm.pressureMb)) rows.push(['Pressure', formatPressure(storm.pressureMb)]);
    if (Number.isFinite(storm.headingDeg) && Number.isFinite(storm.speedKt)) {
      rows.push(['Moving', `${formatBearing(storm.headingDeg)} at ${formatSpeed(storm.speedKt, sys())} (${Math.round(storm.speedKt)} kt)`]);
    }
    const pos = positionText(storm.lat, storm.lon);
    if (pos) rows.push(['Position', pos]);
    if (!rows.length) return '<div class="detail-empty">No current vitals.</div>';
    return `<dl class="detail-vitals">${rows
      .map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`)
      .join('')}</dl>`;
  }

  function homeHtml() {
    const d = home.distanceTo(storm);
    if (!d) return null;
    let html = `
      <div class="detail-kicker">Distance</div>
      <div class="detail-figure">${formatDistance(d.nm, sys())} (${Math.round(d.nm).toLocaleString()} nm) ${esc(formatBearing(d.bearing))} of home</div>`;

    /* closestApproach reads storm.forecast — decorate a copy with the
     * geometry bundle's normalized points; the store's objects stay pure.
     *
     * THREE SENTENCES, FROM TWO ORTHOGONAL FLAGS. Each is checked against
     * what it actually claims, because the failure this block exists to
     * prevent is a true number under a false heading:
     *
     *   closing + near   → an approach. Give it a number and a time.
     *   receding         → the track never beats where it is now. Say that.
     *   closing + far    → it does get closer, so "never closer than current
     *                      position" would be measurably WRONG (NOUL-26 gains
     *                      230 nm of 7,315, over the pole). Claim only what
     *                      holds: it never comes near home. */
    /* NO CLOSEST APPROACH OFF A DEAD FORECAST. Noul's panel was reporting
     * "Nearest point 8,124 nm \u00b7 Moving away \u2014 never comes near home" from a
     * track computed before she made landfall. The distance above survives
     * because it is measured from the storm's own last position and is
     * qualified by the badge at the top; the approach figure does not,
     * because it is a claim about a future nobody is still publishing.
     *
     * The silenced bundle already empties `forecast`, so this branch would
     * fall through on its own — into the "No forecast track in this advisory"
     * arm, which is the wrong sentence for the right silence. Stated here
     * instead, so what the reader gets is the reason. */
    const silencedHome = withheldNote();
    if (silencedHome) {
      html += `
        <div class="detail-kicker">Closest approach</div>
        <div class="detail-soft">${esc(silencedHome)}</div>`;
      return html;
    }

    if (geo.state === 'ok' && geo.bundle?.forecast?.length) {
      const ca = home.closestApproach({ ...storm, forecast: geo.bundle.forecast });
      if (ca && ca.trend === 'closing' && ca.relevant) {
        const when = ca.time
          ? ` · ${esc(formatClockDay(ca.time))}${formatUntil(ca.time) ? ` (${esc(formatUntil(ca.time))})` : ''}`
          : '';
        html += `
          <div class="detail-kicker">Closest approach <span class="detail-soft">forecast</span></div>
          <div class="detail-figure">${esc(formatDistance(ca.nm, sys()))} (${Math.round(ca.nm).toLocaleString()} nm)${when}</div>`;
      } else if (ca && ca.trend === 'receding') {
        html += `
          <div class="detail-kicker">Nearest point <span class="detail-soft">forecast</span></div>
          <div class="detail-figure">${esc(formatDistance(ca.nm, sys()))} (${Math.round(ca.nm).toLocaleString()} nm)</div>
          <div class="detail-soft">Moving away, never closer than current position.</div>`;
      } else if (ca) {
        html += `
          <div class="detail-kicker">Nearest point <span class="detail-soft">forecast</span></div>
          <div class="detail-figure">${esc(formatDistance(ca.nm, sys()))} (${Math.round(ca.nm).toLocaleString()} nm)</div>
          <div class="detail-soft">Moving away — never comes near home.</div>`;
      }
    } else if (
      (geo.state === 'loading' || geo.state === 'idle') &&
      storm.can?.forecastPoints
    ) {
      /* `idle` is the moment before the fetch is dispatched — it is pre-load,
       * not a third outcome, so it says the same thing. Naming it explicitly
       * is what keeps the chain below from having a silent fall-through. */
      html += `<div class="detail-kicker">Closest approach</div><div class="detail-soft">Loading forecast track…</div>`;
    } else if (!storm.can?.forecastPoints) {
      /* UNSUPPORTED, not broken. Same three-way distinction the watch/warning
       * and wind-field blocks make (§4): a source that never publishes a
       * forecast track has not failed at anything. */
      html += `
        <div class="detail-kicker">Closest approach</div>
        <div class="detail-soft">This source doesn’t publish a forecast track.</div>`;
    } else if (geo.state === 'error') {
      /* BROKEN, and it says so with a way out. Distance above is still true —
       * it comes from the storm's own position, not the geometry — so this
       * names only what is actually missing. */
      html += `
        <div class="detail-kicker">Closest approach</div>
        <div class="detail-geo-error">
          The forecast track didn’t load, so there’s no approach figure.
          <button class="detail-retry" type="button">Retry</button>
        </div>`;
    } else if (geo.state === 'ok') {
      /* Bundle arrived, no usable track in it — and the two reasons for that
       * are DIFFERENT FACTS, so they get different sentences. The slot's own
       * status is what knows: `unavailable` means that one layer's fetch died
       * while the rest of the bundle survived; anything else means the source
       * genuinely published no points this advisory. Printing "none
       * published" over a failed fetch would be the §5 lie in miniature. */
      const slot = geo.bundle?.layers?.forecastPoints;
      html +=
        slot?.status === 'unavailable'
          ? `
        <div class="detail-kicker">Closest approach</div>
        <div class="detail-geo-error">
          The forecast track didn’t load, so there’s no approach figure.
          <button class="detail-retry" type="button">Retry</button>
        </div>`
          : `
        <div class="detail-kicker">Closest approach</div>
        <div class="detail-soft">No forecast track in this advisory.</div>`;
    }
    return html;
  }

  function wwHtml() {
    /* `can` distinguishes "this source never had it" from "the fetch died"
     * (§4). GDACS publishes no watch/warning product — that is unsupported,
     * not clear and not broken. Three strings, all different, by design. */
    if (storm.source !== 'nhc') {
      return '<div class="detail-soft">Not available for GDACS storms.</div>';
    }
    /* BEFORE THE SLOT IS READ, ALWAYS. This section's empty state is the
     * sentence "None in effect." — an all-clear on live government orders.
     * The silenced bundle hands it an empty slot, so without this branch the
     * fix for a frozen feed would publish exactly the false all-clear §5 is
     * written to forbid. Of every section on this panel, this is the one that
     * must not guess. */
    const silenced = withheldNote();
    if (silenced) return `<div class="detail-soft">${esc(silenced)}</div>`;

    const slot = geo.state === 'ok' ? geo.bundle?.layers?.watchWarning : null;
    if (geo.state === 'loading') return '<div class="detail-soft">Checking…</div>';
    if (geo.state === 'error' || slot?.status === 'unavailable') {
      /* The failure is named here because this IS the layer's surface; the
       * map simply lacks the stripe. Two strings by design (§16). */
      return '<div class="detail-soft">Watches and warnings unavailable.</div>';
    }
    if (!slot || slot.status === 'none') return '<div class="detail-soft">None in effect.</div>';
    const legend = wwLegend(slot.fc.features);
    if (!legend.length) return '<div class="detail-soft">None in effect.</div>';
    return `<ul class="detail-ww">${legend
      .map((e) => `<li><span class="row-swatch" style="background:${e.color}"></span>${esc(e.label)}</li>`)
      .join('')}</ul>`;
  }

  /**
   * Wind field — the size readout, and the ONE place a GDACS storm is told
   * why it has no bands (§14 both-sources rule).
   *
   * This section exists mostly for that sentence. On the map, a GDACS storm
   * with the wind layer on simply shows nothing — and nothing is exactly what
   * a storm with no dangerous wind would show. Identical pixels, opposite
   * meanings, which is the §5 failure. The map cannot say "not available" in
   * empty ocean; this panel can, so it does.
   */
  function windHtml() {
    if (storm.source !== 'nhc' && storm.source !== 'gdacs') {
      return '<div class="detail-soft">Not available for this source.</div>';
    }
    /* Same trap as the watch/warning block: the empty state here reads "No
     * wind field published for this advisory", which would be a flat untruth
     * about an advisory that published one and has simply gone quiet since. */
    const silencedWind = withheldNote();
    if (silencedWind) return `<div class="detail-soft">${esc(silencedWind)}</div>`;

    if (geo.state === 'loading') return '<div class="detail-soft">Checking…</div>';

    const slot = geo.state === 'ok' ? geo.bundle?.layers?.windCurrent : null;
    if (geo.state === 'error' || slot?.status === 'unavailable') {
      return '<div class="detail-soft">Wind field unavailable.</div>';
    }
    if (!slot || slot.status === 'none') {
      return '<div class="detail-soft">No wind field published for this advisory.</div>';
    }

    /* Which thresholds this storm actually has. A weak system publishes only
     * a 34 kt band; listing the two it lacks would read as missing data. */
    const present = new Map();
    for (const f of slot.fc?.features || []) {
      const kt = windThresholdFromProps(f.properties);
      if (!kt) continue;
      /* GDACS bands are drawn in the same three severity colors as NHC's,
       * but they are NOT the same numbers: GDACS publishes round metric
       * thresholds (60/90/120 km/h ≈ 32/49/65 kt), confirmed live
       * 2026-07-24. `_gdacsKmh` carries what the source actually said, and
       * it is what gets shown — relabelling those bands "34 kt" would be
       * putting NHC's words in GDACS's mouth. Same colors, honest numbers. */
      if (!present.has(kt)) present.set(kt, f.properties?._gdacsKmh ?? null);
    }
    if (!present.size) return '<div class="detail-soft">No wind field published for this advisory.</div>';

    const rows = [...present.entries()]
      .sort((a, b) => b[0] - a[0])
      .map(([kt, kmh]) => {
        const label = kmh != null ? `${WIND_LABEL[kt]} (${Math.round(kmh)} km/h)` : WIND_LABEL[kt];
        return `<li><span class="row-swatch" style="background:${windColor(kt)}"></span>${esc(label)}</li>`;
      })
      .join('');

    /* No source-limitation note for GDACS any more. The spec inherited a
     * claim that GDACS publishes ONE radius and therefore draws circles;
     * the live payload disproved it on glass (2026-07-24) — its bands are
     * quadrant-shaped, same as NHC's. Saying otherwise in the panel would
     * be an apology for a limitation that does not exist. */
    const note = '';

    return `<ul class="detail-ww">${rows}</ul>${note}`;
  }

  /** Which map layers this storm SHOULD have but doesn't, in human words.
   *  §16: storm in feed, geometry failed → the failure is named on the
   *  layer. The Layers panel proper is Phase 6; until then this section is
   *  the layer surface, so the naming lives here. */
  const LAYER_LABEL = {
    cone: 'cone', forecastTrack: 'forecast track', forecastPoints: 'forecast points',
    pastTrack: 'past track',
    windCurrent: 'wind field', windSwath: 'wind swath',
  };
  function failedLayerNames() {
    if (geo.state !== 'ok' || !geo.bundle?.layers) return [];
    return Object.entries(LAYER_LABEL)
      .filter(([k]) => geo.bundle.layers[k]?.status === 'unavailable')
      .map(([, label]) => label);
  }

  /** Did ANY slot come back with something to draw? `ok` is the only status
   *  that means features exist — `none` and `unavailable` are both empty, for
   *  different reasons. Mirrors data/cache.js's `bundleHasFeatures`, and is
   *  duplicated rather than imported because ui/ does not import data/ (§12). */
  function hasAnyFeatures() {
    const layers = geo.bundle?.layers;
    if (!layers) return false;
    return Object.values(layers).some((l) => l?.status === 'ok');
  }

  /**
   * THE MAP-GEOMETRY PROBLEM NOTICE.
   *
   * ==> THIS USED TO BE THE "LAYERS" SECTION AND IT NO LONGER IS. <==
   *
   * That section was a shortcut into the Layers view with a summary line of
   * what was drawn. It is gone (2026-07-25, Aaron's call): layers are reached
   * from the floating Layers button, one place, and a second door with its own
   * summary text was a second thing to keep in step for no navigation saved —
   * the button is on screen the whole time.
   *
   * WHAT COULD NOT GO WITH IT is the failure surface that had been living
   * inside it. When a storm's geometry fetch dies, this notice and its Retry
   * are the ONLY way to see that the cone and tracks are missing rather than
   * merely absent, and the only way to ask again (§5: never ship silence on
   * failure; every async surface gets an error state with a recovery action).
   * Deleting the section wholesale would have taken the recovery with it and
   * left a storm quietly drawing nothing.
   *
   * So it is now a BARE BLOCK PINNED ABOVE THE SECTIONS rather than a section
   * of its own — an error must not sit behind a collapsed header that the user
   * may have collapsed weeks ago. It renders to an empty string when there is
   * nothing wrong, which is most of the time.
   */
  function mapProblemHtml() {
    /* A SILENCED STORM HAS NO MAP PROBLEM. Its slots are empty because we
     * emptied them, and `hasAnyFeatures()` below can legitimately come up
     * false for a storm whose only geometry was forecast shapes. That path
     * renders "NHC hasn't published this advisory's cone and tracks yet" with
     * a Retry button \u2014 blaming the source for our own deliberate removal, and
     * inviting the reader to refetch something that would be discarded again
     * the moment it arrived. The stamp badge is already carrying this. */
    /* AN ENDED STORM HAS NO MAP PROBLEM EITHER, and it is the more important of
     * the two: its slots are empty because the storm is over, and this block
     * would offer a Retry button that refetches a flushed NHC bin forever. */
    if (isSilent(storm) || isEnded(storm)) return '';

    if (geo.state === 'error') {
      /* The detail line is our own short human-written message (never a
       * stack trace) — on a phone, this panel IS the console. */
      return `
        <div class="detail-geo-error detail-geo-block">
          Storm geometry unavailable — the map is missing this storm's cone and tracks.
          ${geo.error ? `<div class="detail-geo-detail">${esc(geo.error)}</div>` : ''}
          <button class="detail-retry" type="button">Retry</button>
        </div>`;
    }
    const failed = failedLayerNames();
    if (failed.length) {
      return `
        <div class="detail-geo-error detail-geo-block">
          Unavailable on the map: ${esc(failed.join(', '))}.
          <button class="detail-retry" type="button">Retry</button>
        </div>`;
    }

    /* NOTHING FAILED AND THERE IS STILL NOTHING TO DRAW. Every slot came back
     * empty — no cone, no track, no wind field — and the fetch reported no
     * error at all. This used to render as SILENCE, and silence is what the
     * user saw when Fausto changed basins: a storm in the list, a dot on the
     * globe, and no explanation for the missing shapes (§5, never ship
     * silence on failure). It is a real state with a real cause — NOAA has
     * not published this advisory's geometry yet — so it says that, and it
     * offers the retry. */
    if (geo.state === 'ok' && geo.bundle?.layers && !hasAnyFeatures()) {
      return `
        <div class="detail-geo-error detail-geo-block">
          NHC hasn’t published this advisory’s cone and tracks yet — the map has
          this storm’s position but not its shapes.
          <button class="detail-retry" type="button">Retry</button>
        </div>`;
    }

    /* SHOWING GEOMETRY FROM AN EARLIER ADVISORY, on purpose. The cache kept
     * what it had because the newer fetch had nothing better (data/cache.js).
     * This is the GOOD outcome of the case above — the shapes are real, they
     * are just not the newest — so it reads as information, not as an error,
     * and the timestamp is already on the stamp line above. Retry is still
     * offered: the user may know NOAA has caught up. */
    if (geo.state === 'ok' && geo.held) {
      const gAdv = geo.bundle?.stamp?.advisnum;
      return `
        <div class="detail-geo-note detail-geo-block">
          Cone and tracks are from ${gAdv ? `advisory ${esc(gAdv)}` : 'an earlier advisory'} —
          NHC hasn’t published newer shapes yet.
          <button class="detail-retry" type="button">Retry</button>
        </div>`;
    }

    return '';
  }

  /* --- advisory text (§16 item 7) ------------------------------------------
   *
   * THE RAW PRODUCT, WHOLE. Aaron's call, 2026-07-25, over a parsed version
   * that would have dropped the header block as a duplicate of Vitals three
   * inches up the same panel. The argument that won: a parser that hides a
   * section is a parser that can hide the WRONG section, and during a
   * hurricane the cost of showing a reader four redundant lines is nothing
   * against the cost of silently swallowing one they needed. Teletype is ugly
   * and complete. Complete wins.
   *
   * It soft-wraps rather than scrolling sideways. The products are fixed at
   * 69 columns, which does not fit a phone, and a horizontal scrollbar inside
   * a vertically scrolling drawer is a gesture fight nobody wins. `pre-wrap`
   * keeps every newline and every space the forecaster wrote and only breaks
   * lines that are too long for the glass.
   * ---------------------------------------------------------------------- */

  const ADVISORY_SECTION = 'advisory';

  function advisoryOpen() {
    return collapsed[ADVISORY_SECTION] === undefined
      ? false
      : !collapsed[ADVISORY_SECTION];
  }

  /** Fetch on expand, once per storm per advisory.
   *
   *  TWO guards, and they catch different things. `advSeq` stops a slow
   *  response for storm A painting over storm B — a race. The forId/forKey
   *  check stops a record that was never refreshed being shown under the
   *  wrong storm at all — a staleness bug, which is what actually shipped.
   *  A sequence number alone would not have caught it: nothing raced. */
  async function ensureAdvisory({ retry = false } = {}) {
    if (!storm || ghost || !loadAdvisory) return;
    if (!retry && adv.phase !== 'idle' && advisoryIsForCurrentStorm()) return;

    const seq = ++advSeq;
    const forId = storm.id;
    const forKey = storm.advisoryKey;
    adv = { phase: 'loading', rec: null, forId, forKey };
    renderAdvisoryBody();
    let rec;
    try {
      rec = await loadAdvisory(storm, { retry });
    } catch (e) {
      /* The data layer promises never to throw. If it does anyway, that is
       * still an error the reader must see NAMED rather than a section stuck
       * on "Loading…" forever with the reason in a console they do not have. */
      rec = { state: 'unavailable', detail: e?.message || 'failed' };
    }
    if (seq !== advSeq) return;
    adv = { phase: 'done', rec, forId, forKey };
    renderAdvisoryBody();
  }

  /** Which agency's words these are, said plainly. A reader in the Philippines
   *  looking at a US Navy bulletin should know that is what they are reading. */
  function advisoryAttribution(rec) {
    const bits = [];
    if (rec.agency === 'nhc') {
      bits.push('National Hurricane Center');
      if (rec.advisoryNumber) bits.push(`advisory ${esc(rec.advisoryNumber)}`);
    } else if (rec.agency === 'jtwc') {
      bits.push('Joint Typhoon Warning Center');
      if (rec.designation) bits.push(esc(rec.designation));
      if (rec.advisoryNumber) bits.push(`warning ${esc(rec.advisoryNumber)}`);
    }
    if (rec.relayStale) bits.push('served from cache');
    return bits.join(' · ');
  }

  function advisoryHtml() {
    /* A record belonging to a DIFFERENT storm is not content, it is the bug.
     * Rendered as pre-fetch rather than as itself; renderBody dispatches the
     * real fetch on the same pass. This is the last line of defence — if
     * something ever forgets to reset the state again, the worst outcome is
     * a redundant fetch, not another storm's advisory on screen. */
    if (adv.phase === 'idle' || !advisoryIsForCurrentStorm()) {
      /* Only reachable when the section is open and the fetch has not been
       * dispatched yet — a frame, not a state a reader sits in. */
      return '<div class="detail-soft">Loading advisory…</div>';
    }
    if (adv.phase === 'loading') {
      return '<div class="detail-soft">Loading advisory…</div>';
    }

    const rec = adv.rec || { state: 'unavailable' };

    if (rec.state === 'ok') {
      const attribution = advisoryAttribution(rec);
      return `
        ${attribution ? `<div class="detail-advisory-from">${attribution}</div>` : ''}
        <pre class="detail-advisory" tabindex="0" role="region"
             aria-label="Advisory text">${esc(rec.text)}</pre>`;
    }

    if (rec.state === 'none_matched') {
      /* NOT a failure, and worded so it cannot be read as one. Naming the
       * agency matters: "no advisory" sounds like the storm is over. */
      return `<div class="detail-soft">The Joint Typhoon Warning Center has no
        current warning under this storm's name.</div>`;
    }

    if (rec.state === 'unsupported') {
      return `<div class="detail-soft">No agency publishes advisory text for
        this storm.</div>`;
    }

    return `
      <div class="detail-geo-error">
        The advisory text didn’t load.
        ${rec.detail ? `<div class="detail-geo-detail">${esc(rec.detail)}</div>` : ''}
        <button class="detail-retry" data-retry="advisory" type="button">Retry</button>
      </div>`;
  }

  /* --- PEOPLE IN THE PATH -------------------------------------------------
   *
   * How many people live inside this storm's tropical-storm-force wind swath.
   *
   * ==> THE SWATH, NOT THE CONE, AND THAT IS THE WHOLE POINT OF THE SECTION.
   * <== The cone is where the CENTRE is likely to go. Counting people inside
   * it would produce a number that sounds like an impact figure and is not
   * one, and would teach the single most common misreading of a hurricane
   * forecast to everybody who saw it. `POPULATION.pathSlot` names the swath
   * and the reasoning lives beside it in constants.
   *
   * ==> AND THE NUMBER IS AN UNDERCOUNT, WHICH THE SECTION SAYS OUT LOUD.
   * <== It counts residents of named towns of 1,000 or more. Rural coast is
   * invisible to it, and rural coast is where a great many people in the
   * Gulf, the Bay of Bengal and the Philippines actually live. A "≈", the
   * word estimate, and the floor stated in plain English are not hedging —
   * they are the difference between a useful figure and a false one.
   * ---------------------------------------------------------------------- */

  const PEOPLE_SECTION = 'people';

  /** { forId, state:'idle'|'loading'|'ok'|'none'|'unavailable', people, towns } */
  let people = { forId: null, state: 'idle' };

  /**
   * Compute the headcount, fetching the town list if this is the first ask.
   *
   * BOUND TO THE STORM ID, NOT COMPARED AGAINST STATE ANOTHER LIFECYCLE
   * METHOD WRITES. `titleFor` assigns `storm` on its way past during
   * `enter()`, before `onEnter` runs, so any check shaped like
   * `if (s.id !== storm?.id)` is dead by construction — the advisory carried
   * exactly that bug to glass. `forId` is written only here and only read to
   * decide whether a result is stale.
   */
  function ensurePeople() {
    if (!storm || ghost) return;
    const forId = storm.id;
    if (people.forId === forId && people.state !== 'idle') return;

    const flat = townsOrNull();
    if (!flat) {
      people = { forId, state: populationState() === 'unavailable' ? 'unavailable' : 'loading' };
      renderPeopleBody();
      loadTowns(() => {
        /* Someone may have moved to another storm during the download. */
        if (!storm || storm.id !== forId) return;
        people = { forId: null, state: 'idle' };
        ensurePeople();
      });
      return;
    }

    const slot = geo.state === 'ok' ? geo.bundle?.layers?.[POPULATION.pathSlot] : null;
    if (geo.state === 'loading') {
      people = { forId, state: 'loading' };
      renderPeopleBody();
      return;
    }
    if (geo.state === 'error' || slot?.status === 'unavailable') {
      people = { forId, state: 'unavailable' };
      renderPeopleBody();
      return;
    }
    if (!slot || slot.status === 'none' || !slot.fc?.features?.length) {
      people = { forId, state: 'none' };
      renderPeopleBody();
      return;
    }

    /* Only the 34 kt ring. The swath nests three thresholds by construction
     * (§ wind-field), so counting every feature would count everyone inside
     * the 64 kt core three times over — the exact double-count PPLX causes in
     * the source data, arriving by a different road. */
    const outer = slot.fc.features.filter(
      (f) => windThresholdFromProps(f.properties) === POPULATION.pathThresholdKt
    );
    /* A storm too weak to publish a 34 kt band still publishes something; fall
     * back to the whole set rather than reporting nobody. Over-counting a weak
     * storm's overlap is a smaller lie than "0 people" about a live system. */
    const rings = outer.length ? outer : slot.fc.features;

    const result = peopleInFeatures(flat, rings);
    people = result
      ? { forId, state: 'ok', people: result.people, towns: result.towns }
      : { forId, state: 'unavailable' };
    renderPeopleBody();
  }

  function peopleHtml() {
    if (storm && ghost) {
      return '<div class="detail-soft">Not available for a storm that has left the feed.</div>';
    }
    const silenced = withheldNote();
    if (silenced) return `<div class="detail-soft">${esc(silenced)}</div>`;

    if (people.state === 'loading' || people.state === 'idle') {
      return '<div class="detail-soft">Counting…</div>';
    }
    if (people.state === 'unavailable') {
      return `<div class="detail-soft">Population estimate unavailable.
        <button type="button" class="detail-retry" data-retry="people">Try again</button></div>`;
    }
    if (people.state === 'none') {
      return '<div class="detail-soft">No wind field published for this advisory, so there is nothing to measure against.</div>';
    }

    const n = formatPeople(people.people);
    /* A measured zero is a real and common answer — a storm in the open
     * Atlantic genuinely has nobody in its path — and it must not read like a
     * failure. It gets its own sentence rather than "≈0". */
    const headline = people.people === 0
      ? '<div class="detail-people-figure">Nobody</div><div class="detail-soft">No towns inside the tropical-storm-force wind field.</div>'
      : `<div class="detail-people-figure">≈${esc(n)}</div>
         <div class="detail-soft">people in ${esc(String(people.towns.toLocaleString()))} towns inside the tropical-storm-force wind field.</div>`;

    return `${headline}
      <div class="detail-people-note">Estimate. Counts residents of towns of
      ${esc(String(POPULATION.minTownPopulation.toLocaleString()))} or more, so the real
      figure is higher — rural areas are not counted.</div>`;
  }

  /** Repaint ONLY this section, for the same reason the advisory does: a full
   *  renderBody() throws away the reader's scroll position. */
  function renderPeopleBody() {
    const host2 = bodyEl?.querySelector(
      `.detail-section[data-section="${PEOPLE_SECTION}"] .detail-section-body`
    );
    if (!host2) return;
    host2.innerHTML = peopleHtml();
    wirePeopleRetry(host2);
  }

  function wirePeopleRetry(scope) {
    for (const btn of scope.querySelectorAll('[data-retry="people"]')) {
      btn.addEventListener('click', () => {
        people = { forId: null, state: 'idle' };
        ensurePeople();
      });
    }
  }

  /** Repaint ONLY the advisory section. A full renderBody() would rebuild
   *  every section, which throws away the scroll position the reader is
   *  holding halfway down a teletype product. */
  function renderAdvisoryBody() {
    const host2 = bodyEl?.querySelector(
      `.detail-section[data-section="${ADVISORY_SECTION}"] .detail-section-body`
    );
    if (!host2) return;
    host2.innerHTML = advisoryHtml();
    wireAdvisoryRetry(host2);
  }

  function wireAdvisoryRetry(scope) {
    for (const btn of scope.querySelectorAll('[data-retry="advisory"]')) {
      btn.addEventListener('click', () => ensureAdvisory({ retry: true }));
    }
  }

  function renderBody() {
    if (!bodyEl || !storm) return;
    if (ghost) {
      /* Reduced ghost form: no home block (distance to a storm that is not
       * there is meaningless) and no layer link. */
      bodyEl.innerHTML = `
        <div class="detail-ghost-note">This storm is no longer in ${sourceLabel(storm.source)}.
        Last known information is shown below.</div>
        ${section('vitals', 'Last known', vitalsHtml())}
        ${disclaimerHtml()}`;
      wireSections();
      return;
    }
    const homeBlock = homeHtml();
    bodyEl.innerHTML = [
      /* Failures first and never collapsible — see mapProblemHtml. */
      mapProblemHtml(),
      /* "Last known" ONCE THE STORM HAS ENDED, the same relabel the ghost form
       * uses and for the same reason: every number under this header is a
       * measurement of a moment that has passed, and "Vitals" reads as present
       * tense. One word, and it stops the panel from asserting a current wind
       * for a storm nobody is measuring. */
      section('vitals', isEnded(storm) ? 'Last known' : 'Vitals', vitalsHtml()),
      homeBlock ? section('home', 'Home', homeBlock) : '',
      section('ww', 'In effect', wwHtml()),
      section('wind', 'Wind field', windHtml()),
      section(PEOPLE_SECTION, 'People in the path', peopleHtml()),
      section(ADVISORY_SECTION, 'Advisory', advisoryHtml(), { defaultCollapsed: true }),
      /* Last, always. Everything above is what the sources say; this is who
       * is saying it. */
      disclaimerHtml(),
    ].join('');
    wireSections();
    wireAdvisoryRetry(bodyEl);
    wirePeopleRetry(bodyEl);
    ensurePeople();
    /* A reader who left this section open last time gets it open — and open
     * means fetched. Without this the persisted preference renders an
     * expanded section that sits on "Loading advisory…" forever, because
     * nothing ever dispatched the fetch. */
    if (advisoryOpen()) ensureAdvisory();

    /* ALL of them, by class. There is more than one Retry on this panel now
     * — the Home block grew its own when the forecast track fails — and
     * querySelector by id bound only whichever came first in the document,
     * silently leaving the other dead.
     *
     * EXCEPT THE ADVISORY'S. It wears the same class for the same look, and
     * without the exclusion it would collect BOTH handlers: one tap would
     * refetch the map geometry as well, which is a different source, a
     * different failure, and a payload the reader did not ask for. Retry
     * means retry THIS, always. */
    for (const btn of bodyEl.querySelectorAll('.detail-retry:not([data-retry="advisory"])')) {
      btn.addEventListener('click', () => {
        if (storm) onRetryGeometry(storm);
      });
    }
  }

  function wireSections() {
    if (!bodyEl) return;
    for (const head of bodyEl.querySelectorAll('.detail-section-head')) {
      head.addEventListener('click', () => {
        const sec = head.closest('.detail-section');
        const id = sec.dataset.section;
        const next = sec.dataset.collapsed !== 'true';
        sec.dataset.collapsed = String(next);
        head.setAttribute('aria-expanded', String(!next));
        collapsed[id] = next;
        writeSections(collapsed);
        /* Expanding the advisory is what pays for it. Collapsing it does
         * nothing — the record stays cached, so re-opening is instant. */
        if (id === ADVISORY_SECTION && !next) ensureAdvisory();
      });
    }
  }

  /* ==> ONE FULL RENDER PER TURN, NOT ONE PER CALLER. <==
   *
   * Opening this panel calls `renderAll` twice in the same task: once from
   * `onEnter` when the drawer pushes the view, and again a few lines later
   * from `setGeometry({state:'loading'})` when main.js starts the geometry
   * fetch. Both rebuild the entire body — every section, every vitals row,
   * every formatted figure — and the first result is thrown away without ever
   * reaching the screen, because nothing paints between them.
   *
   * The renders are COALESCED onto a microtask rather than deferred to a
   * frame. Deferring would not help the number this is here to fix: INP runs
   * until the next paint, so work moved into a rAF callback is still counted.
   * What helps is doing it once. The microtask still runs before paint, so
   * the panel is complete in the same frame it always was — nothing on screen
   * arrives later than before.
   *
   * `storm` is re-checked inside the callback: `onLeave` or a new selection
   * can land between the schedule and the run.
   */
  let renderQueued = false;

  function renderAll() {
    if (!storm || renderQueued) return;
    renderQueued = true;
    queueMicrotask(() => {
      renderQueued = false;
      if (!storm) return;
      renderStamp();
      renderBody();
      /* The header carries the identity, so a category change has to reach the
       * drawer's chrome — not just this view's body. */
      requestChrome?.();
    });
  }

  /* --- the drawer view contract -------------------------------------------- */

  return {
    id: 'detail',
    title: 'Storm',

    /** The drawer titles this view from its argument, so the storm's name is
     *  the header rather than the word "Detail".
     *
     *  IT ASSIGNS `storm`, AND THE DRAWER CALLS IT BEFORE onEnter — that
     *  ordering is what broke the advisory (see the note on `adv` above).
     *  The assignment stays, because the header has to be able to title
     *  itself from its own argument. What changed is that nothing downstream
     *  now infers "the storm changed" by comparing against `storm`. */
    titleFor: (s) => {
      if (s && s !== storm) storm = s;
      return titleNode();
    },

    mount(el) {
      buildSkeleton(el);
      renderAll();
    },

    /** Entered with a storm — a fresh selection, or a return from Layers. */
    onEnter(s) {
      visible = true;
      /* AGAINST `enteredId`, NOT AGAINST `storm`. titleFor has already
       * assigned `storm` by the time this runs, so the old comparison was
       * dead code that looked like a guard — geo and ghost were being
       * carried across storms too, and only escaped notice because main.js
       * sets the geometry state explicitly on every selection. */
      if (s && s.id !== enteredId) {
        storm = s;
        enteredId = s.id;
        ghost = false;
        geo = { state: 'loading' };
        /* A different storm's words are not this storm's words. Dropped, and
         * the sequence bumped so a request still in flight for the previous
         * storm cannot land here. */
        adv = { phase: 'idle', rec: null, forId: null, forKey: null };
        advSeq++;
      } else if (s) {
        storm = s;
      }
      renderAll();
    },

    onLeave() {
      visible = false;
    },

    focus() {
      return null; // the drawer's back button is the right first stop here
    },

    /** The drawer hands this in at mount so the view can ask for a header
     *  re-render when its title data changes. */
    setChromeRefresh(fn) {
      requestChrome = fn;
    },

    /* --- driven by main.js ------------------------------------------------ */

    /** Poll tick / home change: refresh in place. If the selected storm has
     *  left a CLEAN feed it becomes the ghost form here — never a blank, no
     *  forced navigation (§16). A source ERROR holds the view as stale
     *  instead; the stamp bands already say so. */
    update(state) {
      if (!storm) return;
      const live = state?.storms?.find((s) => s.id === storm.id);
      if (live) {
        /* A NEW ADVISORY MAKES THE TEXT ON SCREEN WRONG, and nothing else on
         * this panel would say so — the vitals and the stamp above it repaint
         * from the new object while the product underneath keeps the old
         * forecaster's words under the new number.
         *
         * The forKey binding would catch this on its own now. The explicit
         * bump stays because it also cancels an in-flight request for the
         * superseded advisory, which the binding cannot do. */
        if (live.advisoryKey !== storm.advisoryKey) {
          adv = { phase: 'idle', rec: null, forId: null, forKey: null };
          advSeq++;
        }
        storm = live;
        ghost = false;
      } else if (state && storm.source && state.sources?.[storm.source]?.status === 'ok') {
        ghost = true;
      }
      if (visible) renderAll();
    },

    /** Geometry fetch lifecycle from main.js:
     *  {state:'loading'} | {state:'ok', bundle, lagged, held} | {state:'error', error}
     *
     *  `lagged` and `held` are DIFFERENT FACTS and both are needed. `lagged`
     *  means the geometry trails the feed by more than one advisory cadence —
     *  routine, expected, and normally silent. `held` means we asked for this
     *  advisory's geometry, the source had nothing, and the cache kept what it
     *  already had (data/cache.js). A basin change produces `held` without
     *  necessarily producing `lagged`, which is precisely why one flag could
     *  not cover both. */
    setGeometry(next) {
      geo = next;
      /* The headcount is DERIVED FROM the geometry, so new geometry always
       * invalidates it — including the loading→ok transition, which is the
       * common case and the one where a stale "Counting…" would otherwise
       * stick forever. Reset before renderAll so the rebuilt section starts
       * from idle and ensurePeople() actually re-runs rather than early-out
       * on a matching forId. */
      people = { forId: null, state: 'idle' };
      if (visible && storm) renderAll();
    },

    /** Layer state changed elsewhere. The Layers shortcut this used to keep in
     *  step is gone (2026-07-25), but the WIND FIELD section still describes
     *  whichever half of that pair is drawn, so the body is still stale after
     *  a layer change and still has to be rebuilt. */
    layersChanged() {
      if (visible && storm) renderBody();
    },

    /** Units changed in Settings. Every figure on this panel is formatted
     *  through the injected resolver, so the whole body is stale. */
    unitsChanged() {
      if (visible && storm) renderBody();
    },

    isVisible: () => visible,
    current: () => storm,
  };
}
