/**
 * rain-storm.js (ui) — the Rainfall section of the storm detail drawer.
 * SPEC §48.2, §48.9, §48.17.
 *
 * TWO BLOCKS, TWO SOURCES, TWO QUESTIONS, ONE SECTION.
 *
 *   WHAT NHC SAYS   the advisory's rainfall paragraph, rewrapped, in NHC's own
 *                   words. A range across an AREA. NHC storms only.
 *   AT YOUR HOUSE   a gridded point forecast for the reader's home, from the
 *                   same record the home drawer's Rain section shows. A single
 *                   number for a POINT. Every storm, every basin.
 *
 * ==> THE SECOND BLOCK IS WHY THIS SECTION IS WORTH OPENING OUTSIDE NHC'S
 * BASINS. <== Before §48.17 a GDACS storm's Rainfall section said "not
 * published for storms in this basin" and stopped — a section whose entire
 * content was an apology. The point forecast covers the planet, so the answer
 * to "how much rain am I getting" no longer depends on which agency happens to
 * be tracking the storm.
 *
 * A SELF-CONTAINED CONTROLLER, because `ui/view-storm-detail.js` is past §12's
 * file ceiling and only takes seams now — a section row, an ensure, a wire and
 * a repaint. Everything with weight is here: the fetch state machine, the four
 * states, the retry, the HTML. Same shape as `ui/env-health.js`, deliberately,
 * because the next section to land should have an obvious thing to copy.
 *
 * ==> IT SHOWS THE PARAGRAPH AND IT NEVER REWRITES IT. <== §48.2. NHC's range
 * IS the forecast; a summary of it would be a second opinion nobody asked for,
 * and a number extracted from it is a number that can disagree with NHC. This
 * file extracts nothing. That is also why there is no arithmetic in it and no
 * test of arithmetic behind it — `lib/advisory.js` finds the block, and finding
 * it is the whole job.
 *
 * ==> IT COSTS THE ADVISORY FETCH, AND THAT IS A REAL CHANGE. <== §48.2 says
 * "no new network", which is true of the SOURCE — this is the same product the
 * Advisory section already downloads. It is not true of the TIMING. The
 * Advisory section is collapsed by default and fetches on expand, so a reader
 * who never opens it never paid; an open-by-default Rainfall section means one
 * advisory page per storm opened. Measured: 30,712 bytes for Lala. It is
 * cached per advisory key and shared with the Advisory section, so opening
 * that afterwards is free — but the first storm drawer of a session now costs
 * 30 KB it did not cost before. That is the price of §48.1's complaint, which
 * is that rainfall currently sits where nobody opens it.
 *
 * ==> THE HOUSE FIGURE IS THE HOME DRAWER'S OWN RECORD, NOT A SECOND FETCH.
 * <== `data/rainfall.js` holds exactly one answer, keyed by the rounded home
 * coordinates, and both surfaces read it. Fetching independently here would
 * have cost nothing in bytes and everything in trust: the two calls can land
 * either side of a grid update, and an app showing 2.9 in on one screen and
 * 3.2 in on another is an app the reader stops believing. One record, one
 * number, everywhere.
 *
 * ==> IT PUTS §48.10'S TWO DISAGREEING NUMBERS ON ONE SCREEN, DELIBERATELY.
 * <== That section calls the disagreement the one real design risk in §48: the
 * advisory says 8 to 12 inches across eastern Maui, the grid at Kahului says
 * 2.91, both are right, and a reader meeting them on two different screens
 * concludes the app is broken. Splitting them across screens never fixed that,
 * it only made it slower to notice. Here they are adjacent, each under a
 * heading naming what it is a forecast FOR, with one line between them saying
 * why they differ.
 *
 * ==> AND THE HOUSE FIGURE IS NOT ATTRIBUTED TO THE STORM. <== A gridded QPF is
 * all rain from all causes. Wording it as "this storm will bring" would be a
 * claim the source does not make and cannot support — a stalled front can put
 * four inches on a house while the hurricane on screen goes out to sea. The
 * note says so in one short sentence rather than leaving the position of the
 * block to imply it.
 *
 * ==> BOUND TO THE STORM IT BELONGS TO. <== `forId`/`forKey`, exactly the
 * advisory record's fix for a real on-glass bug: a record that infers "did the
 * storm change?" from call ordering shows the previous storm's words under the
 * next storm's name. The house block is bound the same way, to the home
 * coordinates rather than to the storm.
 *
 * Imports: lib/ and ui/ siblings, never data/ — the fetch arrives injected (§12).
 */

import { advisoryRainfall } from '../lib/advisory.js';
import { houseRainScope, rainSummary } from '../lib/rainfall.js';
import { formatClockDay } from '../lib/time.js';
import { DOTS } from './loading-dots.js';
import { floodAlertRows } from './rain-alerts.js';

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const RAIN_SECTION = 'rainfall';

/**
 * @param {object} deps injected by ui/view-storm-detail.js (§12 — ui/ never
 *   imports data/).
 * @param {(storm:object, opts?:object)=>Promise<object>} deps.loadAdvisory
 *   the SAME facade the Advisory section uses, so both read one cached record
 *   and can never show two different advisories for one storm.
 * @param {{ loadRainfall:Function, retryRainfall:Function }} [deps.rain]
 *   the SAME facade `ui/rain-home.js` is handed, for the reason in the header:
 *   one record, one number on both surfaces. Absent means the house block does
 *   not render at all — the older detail suites construct this view with the
 *   deps they needed at the time, and an unwired section that throws takes the
 *   whole drawer down during a hurricane.
 * @param {{ get:()=>object|null, rangeNm:(storm:object)=>({distanceNm:number|null,
 *   approachNm:number|null}) }} [deps.house] the home, and how near this storm
 *   comes to it. Asked fresh on every render rather than captured: the reader
 *   can move their pin with the drawer open, and the forecast track lands
 *   after the first paint.
 * @param {()=>string|null} [deps.units] the resolved unit system, so this
 *   figure and the home drawer's are never in two different systems.
 * @param {()=>number} [deps.now] the clock, injectable for the same reason
 *   `ui/view-home.js` injects one: this block filters flood alerts by their
 *   expiry, and an expiry check against `Date.now()` can only be tested during
 *   an actual flood warning. The one captured set of live alerts this project
 *   has is from August, so the suite has to be able to stand there.
 */
export function createRainStorm({
  loadAdvisory, rain = null, house = null, flood = null, units = null,
  now = () => Date.now(),
}) {
  let state = { phase: 'idle', rec: null, forId: null, forKey: null };
  let seq = 0;

  /* The house block's own record and its own sequence number. SEPARATE from
   * the advisory's above, because the two are about different things and
   * arrive at different times — one is keyed by advisory, one by coordinates,
   * and folding them into one state object would mean a new advisory
   * discarding a perfectly good rainfall answer for a house that has not
   * moved. */
  let houseState = { phase: 'idle', result: null, forKey: null };
  let houseSeq = 0;

  const isCurrent = (storm) =>
    !!storm && state.forId === storm.id && state.forKey === storm.advisoryKey;

  /** Home identity, the coordinates and not the label — the same key
   *  `ui/rain-home.js` uses, and for the same reason: a reader can rename a pin
   *  without moving it, and move it without renaming it. */
  const homeKeyOf = (home) =>
    home && Number.isFinite(home.lat) ? `${home.lat},${home.lon}` : null;

  /** How much of the house block this storm earns — `'full'`, `'alerts'` or
   *  `'none'` (§48.20). ONE gate, asked by every function below, so the block
   *  can never be fetched in a state where it would not be drawn.
   *
   *  ==> TWO TIERS, BECAUSE A FLOOD WARNING IS NOT THE STORM'S. <== The figure
   *  needs the storm's weather to actually reach the house; the warning is an
   *  agency's statement about the reader's own address and is true whichever
   *  storm they tapped. See `houseRainScope`. */
  function houseScope(storm) {
    if (!rain?.loadRainfall || !house?.get || !storm) return 'none';
    const home = house.get();
    if (!home || !Number.isFinite(home.lat)) return 'none';
    return houseRainScope(house.rangeNm?.(storm) || {});
  }

  /** The home this block is about, or null when this storm earns nothing. */
  function houseTarget(storm) {
    if (houseScope(storm) === 'none') return null;
    return house.get();
  }

  /**
   * Flood alerts in force inside this storm's forecast cone. §48.21.
   *
   * ==> THE WORDING IS THE WHOLE SAFETY PROPERTY OF THIS BLOCK. <== An NWS
   * flood warning does not name a storm. It says *Flash Flood Warning, Hawaii
   * in Hawaii, HI* and nothing else — the hurricane sitting on top of it is
   * mentioned nowhere in the product. So every row here is this app asserting
   * a connection the source never made, which is exactly what §50.3 forbids
   * for the CAP list: **a geographic match is not a causal claim.** What is
   * claimed is the weakest true thing — *inside the forecast cone* — and it is
   * a statement about two shapes, verifiable from the shapes. It must never
   * become "this storm's flooding", and a stalled front can flood a county
   * while the hurricane goes out to sea.
   *
   * ==> `no_cone` AND `none_matched` BOTH PRODUCE AN EMPTY LIST AND MUST NOT
   * READ THE SAME. <== §5. A storm with no published cone has nothing to test
   * against; a storm whose cone was tested and held nothing is a real
   * all-clear. This is the distinction this feature is most likely to lose.
   */
  function floodBlock(storm) {
    if (!flood?.summaryFor || !storm) return '';
    const out = flood.summaryFor(storm);
    if (!out) return '';

    const head = `<div class="detail-rain-flood">
      <div class="detail-kicker">Flood alerts nearby</div>`;
    const wrap = (inner) => `${head}${inner}</div>`;

    if (out.state === 'loading') {
      return wrap(`<p class="detail-soft">Checking flood alerts${DOTS}</p>`);
    }

    if (out.state === 'unavailable') {
      /* NEVER an all-clear. The list not loading and nothing being in force
       * are opposite facts that look identical on screen. */
      return wrap(`<p class="detail-soft">Flood alerts couldn’t be checked.
        <button class="detail-retry" type="button" data-retry="flood">Retry</button></p>`);
    }

    if (out.state === 'no_cone') {
      /* ==> IT SAYS WHY, AND IT DOES NOT SAY “NONE”. <== No cone means nothing
       * to test alerts against. Saying "no flood alerts nearby" here would be
       * an all-clear derived from our own missing geometry. */
      return wrap(`<p class="detail-soft">This storm has no published forecast
        cone, so flood alerts can’t be matched to it.</p>`);
    }

    if (out.state === 'none_matched') {
      /* A REAL ANSWER: the cone was measured and nothing falls inside it. */
      return wrap(`<p class="detail-soft">No flood alerts are in force inside
        this storm’s forecast cone.</p>`);
    }

    /* ==> THE COUNT OF ALERTS IS NOT THE COUNT OF SHAPES, AND BOTH GET SAID.
     * <== A watch is issued by forecast zone and carries no polygon, so the map
     * cannot draw it. A sentence claiming nineteen are on the globe while
     * eleven are drawn is §5 with a map under it. */
    const n = out.total;
    const noun = n === 1 ? 'flood alert is' : 'flood alerts are';
    const undrawn = n - out.drawable;
    const drawNote = undrawn > 0
      ? ` ${undrawn === 1 ? 'One is' : `${undrawn} are`} issued by zone and
          ${undrawn === 1 ? 'has' : 'have'} no shape to draw on the map.`
      : '';

    return wrap(`<p class="detail-rain-para"><strong>${n} ${noun}</strong> in force
        inside this storm’s forecast cone.${drawNote}</p>
      ${floodAlertRows(out.alerts)}
      <p class="detail-rain-note">Issued by the National Weather Service for the
        areas named, not attributed to this storm — an alert inside the cone may
        have another cause.</p>`);
  }

  /** The section body's inner HTML for the current state. Pure of the DOM. */
  function html(storm) {
    if (!storm) return '';
    /* ORDER IS LOAD-BEARING, in one narrow way: `advisoryBlock` sets
     * `drewRange` for the block below it, which needs to know whether there is
     * an area range on screen to compare against. Computed once, by whoever
     * decided it, rather than asked again with the same input — two answers to
     * one question is how they start disagreeing. */
    const range = advisoryBlock(storm);
    return `${range}${houseBlock(storm)}${floodBlock(storm)}`;
  }

  /** Whether `advisoryBlock` put an area range on screen in THIS render. Read
   *  only by `houseBlock`, which runs immediately after it. */
  let drewRange = false;

  /** What NHC says — a range across an area, in NHC's words. */
  function advisoryBlock(storm) {
    drewRange = false;
    /* ==> A GDACS STORM IS ANSWERED WITHOUT A FETCH. <== NHC publishes the
     * rainfall paragraph; JTWC's warnings carry no equivalent labelled block.
     * The sentence is WORD FOR WORD §47.6's, so a reader who meets both
     * Environment and Rainfall outside NHC's basins learns one sentence rather
     * than two. Since §48.17 it is no longer the whole section — the house
     * block below it answers for every basin — so it now reads as one source
     * declining rather than as the app having nothing. */
    if (storm.source !== 'nhc') {
      return `<div class="detail-soft">Not published for storms in this basin.</div>`;
    }

    if (!isCurrent(storm) || state.phase === 'idle' || state.phase === 'loading') {
      return `<div class="detail-soft">Checking the advisory${DOTS}</div>`;
    }

    const rec = state.rec || { state: 'unavailable' };

    if (rec.state !== 'ok' || !rec.text) {
      /* The advisory itself did not arrive. That is a real failure with a real
       * recovery, and it is worded as OUR problem rather than as a fact about
       * the storm's rain. */
      if (rec.state === 'unsupported') {
        return `<div class="detail-soft">Not published for storms in this basin.</div>`;
      }
      return `<div class="detail-soft">The advisory didn’t load, so there is no
        rainfall forecast to show.
        <button class="detail-retry" type="button" data-retry="rainfall">Retry</button></div>`;
    }

    const out = advisoryRainfall(rec.text);

    if (out.state === 'no_hazards') {
      /* ==> `None.` IS A REAL ANSWER (§48.2). <== A storm with no land threat
       * is not a storm whose rainfall failed to load, and the two must not
       * render the same. */
      return `<div class="detail-soft">NHC lists no land hazards for this storm.</div>`;
    }
    if (out.state !== 'ok') {
      /* The advisory arrived and carries no rainfall section. Rare, and stated
       * as a fact about this advisory rather than as an error — the reader can
       * open the Advisory section below and see for themselves. */
      return `<div class="detail-soft">This advisory has no rainfall section.</div>`;
    }

    drewRange = true;

    /* NHC's own paragraphs, one element each. Rewrapped, because a teletype
     * product is hard-wrapped at ~68 columns and rendering those newlines gives
     * a ragged column on a phone (§48.2). */
    return out.paragraphs
      .map((p) => `<p class="detail-rain-para">${esc(p)}</p>`)
      .join('') +
      `<p class="detail-rain-note">In the National Hurricane Center’s own words,
        from the current public advisory.</p>`;
  }

  /**
   * At your house — a point forecast, from the home drawer's own record.
   * §48.17.
   *
   * ==> IT RENDERS NOTHING AT ALL IN THREE CASES AND THAT IS NOT §5'S SILENCE.
   * <== §5 governs a SOURCE that failed and must say so. These are three
   * questions nobody asked: there is no home set, the feature is not wired into
   * this view, or the storm is on the other side of the planet. A heading over
   * an explanation of why a reader with no home pin has no house forecast is
   * noise on the one screen where noise costs the most.
   *
   * Every state where a source WAS asked is written out below, loading and
   * failure included.
   */
  function houseBlock(storm) {
    const scope = houseScope(storm);
    if (scope === 'none') return '';
    const home = house.get();
    if (!home) return '';

    const head = `<div class="detail-rain-house">
      <div class="detail-kicker">At your house</div>`;
    const close = '</div>';
    const wrap = (inner) => `${head}${inner}${close}`;

    /* ==> THE WARNINGS-ONLY TIER (§48.20). <== This storm is in the reader's
     * world but its weather does not reach the house, so there is no rainfall
     * figure to print under its name — and a flood warning in force is still
     * an agency's statement about the reader's own address, true whichever
     * storm they happened to tap. Everything that would imply the storm caused
     * it stays off: no total, no peak, no provenance line.
     *
     * ==> AND IT RENDERS NOTHING WHEN THERE IS NOTHING TO SAY. <== A heading
     * over "no flood warnings are in force" on a storm that misses the house
     * is noise on the screen where noise costs the most, and §5 does not
     * require announcing the absence of a hazard nobody asked about. What §5
     * DOES require is that an UNKNOWN never reads as an all-clear, so a failed
     * alerts hop still gets its sentence. */
    if (scope === 'alerts') {
      if (houseState.forKey !== homeKeyOf(home) ||
          houseState.phase === 'idle' || houseState.phase === 'loading') return '';

      const res = houseState.result || {};
      if (res.status !== 'ok') return '';

      const out = rainSummary(res.payload, { system: units?.() ?? null, now: now() });
      const rows = floodAlertRows(out.alerts);
      /* Only NWS knows about warnings at all; the global model publishes none
       * and says so on the full tier. Repeating "not published here" under a
       * storm that misses would be an apology for an absence nobody noticed. */
      const unknown = res.payload?.alerts == null && out.provider?.name !== 'open-meteo'
        ? `<p class="detail-rain-note">Flood warnings could not be checked just now.</p>`
        : '';
      if (!rows && !unknown) return '';

      /* ==> WHY THE NUMBER IS NOT HERE, BUT ONLY WHEN WE MEASURED IT. <== On a
       * `misses` verdict the wind fields were published and walked, so this is
       * a fact. Reached by distance alone it is not — nobody published a field
       * — and claiming it would be inventing an all-clear (§5). */
      const why = house.rangeNm?.(storm)?.reach === 'misses'
        ? `<p class="detail-rain-note">This storm's wind field is not forecast to
            reach your house, so there is no rainfall figure for it here. Your
            own forecast is on the home screen.</p>`
        : '';

      return wrap(`${rows}${unknown}${why}`);
    }

    if (houseState.forKey !== homeKeyOf(home) ||
        houseState.phase === 'idle' || houseState.phase === 'loading') {
      return wrap(`<p class="detail-soft">Checking the forecast for your house${DOTS}</p>`);
    }

    const res = houseState.result || { status: 'unavailable' };

    if (res.status === 'not_covered') {
      /* Rare since the global model landed (§48.14) — it means BOTH sources
       * declined for this point. A fact about the place, so no Retry: a button
       * that cannot work is worse than none. */
      return wrap(`<p class="detail-soft">No rainfall forecast for this location.</p>`);
    }

    if (res.status !== 'ok') {
      /* THE BUTTON IS ITS OWN ELEMENT rather than a word inside the sentence,
       * for the reason the home section gives: a 44px control (§10) set inline
       * in a paragraph pushes its line apart and reads as a bad wrap.
       *
       * `data-retry="rain-house"` and not `rain` — `ui/view-storm-detail.js`
       * binds every `.detail-retry` on the panel by class, and two buttons
       * answering to one selector is how one of them silently stops working. */
      return wrap(`<p class="detail-soft">The forecast for your house didn’t load.
        <button class="detail-retry" type="button" data-retry="rain-house">Retry</button></p>`);
    }

    const out = rainSummary(res.payload, { system: units?.() ?? null, now: now() });

    if (out.state === 'lapsed') {
      /* ==> RAN OUT IS NOT DRY (§48.19). <== Every hour in the held payload has
       * already passed, so there is nothing left to total. "No meaningful rain
       * expected" here would be an all-clear built out of an absence, which is
       * §5 with a storm's name over it. Retryable — a stale last-good copy is
       * exactly what this looks like. */
      return wrap(`<p class="detail-soft">This rainfall forecast has run out — every
        hour in it has already passed.
        <button class="detail-retry" type="button" data-retry="rain-house">Retry</button></p>`);
    }

    if (out.state !== 'ok') {
      /* The payload arrived and could not be read — an unrecognised unit, or a
       * series with nothing readable in it (§48.4). Ours, and NOT retryable:
       * asking again returns the same bytes. */
      return wrap(`<p class="detail-soft">The forecast for your house came back in a
        form this app could not read.</p>`);
    }

    /* ==> A WARNING IN FORCE OUTRANKS ANY FORECAST AND RENDERS ABOVE IT. <==
     * §48.6. A total is what MIGHT happen; a Flash Flood Warning is what IS
     * happening.
     *
     * ==> THIS BLOCK SHIPPED WITHOUT THEM AND THAT WAS A REAL BUG. <== The
     * reasoning was that the dashboard already showed them and the app must
     * not say things twice. It is not said twice: `In effect` carries NHC's
     * hurricane and tropical-storm products, and `Local agency alerts` asks
     * its upstream for Cyclone, Typhoon, Hurricane, Tropical and Storm Surge
     * — flood is in none of them. So a reader who taps a storm during a
     * hurricane and never opens the dashboard saw a rainfall total and no
     * warning at all, on the screen most likely to be the only one they open.
     * That is §5's silence with a number in front of it. */
    const alerts = floodAlertRows(out.alerts);

    /* ==> `alerts: null` MEANS TWO OPPOSITE THINGS AND GETS TWO OPPOSITE
     * SENTENCES (§48.16). <== From NWS it means the alerts hop failed while
     * the grid succeeded — what is in force is UNKNOWN, which is not "nothing
     * in force" and must not render as silence. From the global model it means
     * there is no flood-warning source for this place at all, which is durable;
     * "could not be checked just now" there invites a reader to wait for an
     * answer that is never coming. */
    const alertsUnknown = res.payload?.alerts != null
      ? ''
      : out.provider?.name === 'open-meteo'
        ? `<p class="detail-rain-note">Flood warnings aren’t published for this
            location — this is a rainfall forecast only.</p>`
        : `<p class="detail-rain-note">Flood warnings could not be checked just now.</p>`;

    const through = out.throughWords ? ` through ${esc(out.throughWords)}` : '';

    /* NEGLIGIBLE RAIN IS WORDS, NOT A NUMBER (§48.8). `0.01 in` reads as a
     * malfunction; said plainly it reads as a forecast. */
    const line = out.negligible
      ? `<p class="detail-rain-para">No meaningful rain expected${through}.</p>`
      : `<p class="detail-rain-para"><strong>About ${esc(out.totalText)}</strong>
          expected${through}.</p>`;

    /* The heaviest block, only when one dominates. On this screen it is the
     * sentence that separates a flood from a wet week.
     *
     * ==> IT NAMES WHEN, AND IT SHIPPED WITHOUT THAT. <== The time was cut for
     * brevity on a phone and that was the wrong half to cut: "three inches in
     * six hours" is a fact, "three inches in six hours starting Saturday noon"
     * is something a reader can act on. Same sentence the dashboard writes. */
    const peak = out.peak
      ? `<p class="detail-rain-para">The heaviest ${esc(out.peak.lengthWords)} bring about
          ${esc(out.peak.text)}, from ${esc(formatClockDay(out.peak.startMs))}.</p>`
      : '';

    /* ==> WHOSE FORECAST, FOR WHAT POINT, AND FROM WHAT CAUSE. <== §48.12's
     * provenance line, plus the sentence §48.17 adds: a gridded total is all
     * rain from every cause, and a figure sitting under a storm's name will be
     * read as that storm's doing unless it says otherwise. */
    const where = out.provider?.name === 'open-meteo'
      ? (Number.isFinite(out.provider.gridLat)
        ? `Open-Meteo, nearest model point
           ${out.provider.gridLat.toFixed(2)}, ${out.provider.gridLon.toFixed(2)}.`
        : 'From Open-Meteo.')
      : out.place
        ? `National Weather Service, nearest point ${esc(out.place)}.`
        : 'From the National Weather Service.';

    /* ==> THE ONE LINE THAT DEFUSES §48.10, AND ONLY WHEN BOTH ARE ON SCREEN.
     * <== Said under a GDACS storm, where there is no advisory range to
     * compare against, it would explain a disagreement the reader cannot see.
     * `advisoryRainfall` is not re-run for this — the block above has already
     * decided, and asking the same question twice is how two answers drift. */
    const compare = drewRange
      ? `<p class="detail-rain-note">The figures above are for the heaviest band
          across a whole area; this one is for a single point, so the two can
          differ and both be right.</p>`
      : '';

    /* WARNINGS FIRST, ALWAYS — then what is in doubt about them, then the
     * forecast they outrank. */
    return wrap(`${alerts}${alertsUnknown}${line}${peak}${compare}
      <p class="detail-rain-note">${where} Total rain from all causes, not this
        storm alone.</p>`);
  }

  /**
   * Dispatch the advisory fetch if what we hold is not this storm's.
   *
   * Cheap to call on every render — the guard makes it idempotent, and
   * data/advisory.js's own cache makes a re-dispatch after stepping back to a
   * seen storm instant.
   */
  async function ensure(storm, repaint) {
    ensureHouse(storm, repaint);
    if (!storm || storm.source !== 'nhc' || !storm.advisoryKey) return;
    if (isCurrent(storm) && state.phase !== 'idle') return;
    const mySeq = ++seq;
    state = { phase: 'loading', rec: null, forId: storm.id, forKey: storm.advisoryKey };
    const rec = await loadAdvisory(storm);
    if (mySeq !== seq) return; // a newer storm took over mid-flight
    state = { phase: 'done', rec, forId: storm.id, forKey: storm.advisoryKey };
    repaint?.();
  }

  /**
   * Dispatch the house forecast if what we hold is not this home's. §48.17.
   *
   * ==> IT COSTS A REQUEST THIS PANEL DID NOT MAKE BEFORE, AND ONLY ONE. <==
   * `data/rainfall.js` holds one answer for `RAIN.clientTtlMs`, so a reader who
   * has already opened the home dashboard pays nothing here, and a reader who
   * opens six storm drawers in a row pays once. What is genuinely new is a
   * reader who never opens the dashboard at all: for them this is one small
   * JSON fetch per fifteen minutes, gated on a home being set AND the storm
   * being near it, which is the narrowest gate this feature could have and
   * still exist.
   *
   * The gate is `houseTarget`, the same one the renderer asks — so this can
   * never fetch for a state the block would not draw.
   */
  async function ensureHouse(storm, repaint) {
    const home = houseTarget(storm);
    if (!home) return;
    const key = homeKeyOf(home);
    if (houseState.forKey === key && houseState.phase !== 'idle') return;
    const mySeq = ++houseSeq;
    houseState = { phase: 'loading', result: null, forKey: key };
    const result = await rain.loadRainfall(home);
    if (mySeq !== houseSeq) return; // the home moved mid-flight
    houseState = { phase: 'done', result, forKey: key };
    repaint?.();
  }

  /** Bind the retry inside an already-rendered body. `data-retry` scopes the
   *  button so the geometry retry binding in the host view never collects it. */
  function wire(bodyEl, storm, repaint) {
    wireHouse(bodyEl, storm, repaint);
    wireFlood(bodyEl, repaint);
    const btn = bodyEl?.querySelector?.('[data-retry="rainfall"]');
    if (!btn) return;
    btn.addEventListener('click', async () => {
      if (!storm) return;
      const mySeq = ++seq;
      state = { phase: 'loading', rec: null, forId: storm.id, forKey: storm.advisoryKey };
      repaint?.();
      const rec = await loadAdvisory(storm, { retry: true });
      if (mySeq !== seq) return;
      state = { phase: 'done', rec, forId: storm.id, forKey: storm.advisoryKey };
      repaint?.();
    });
  }

  /** The house block's own Retry. It EVICTS before refetching — `retryRainfall`
   *  is the facade that does — so a cached failure can never be the answer to a
   *  press. Without that the button would look like it worked and change
   *  nothing, which is the worst of both. */
  function wireHouse(bodyEl, storm, repaint) {
    const btn = bodyEl?.querySelector?.('[data-retry="rain-house"]');
    if (!btn || !rain?.retryRainfall) return;
    btn.addEventListener('click', async () => {
      const home = houseTarget(storm);
      if (!home) return;
      const mySeq = ++houseSeq;
      houseState = { phase: 'loading', result: null, forKey: homeKeyOf(home) };
      repaint?.();
      const result = await rain.retryRainfall(home);
      if (mySeq !== houseSeq) return;
      houseState = { phase: 'done', result, forKey: homeKeyOf(home) };
      repaint?.();
    });
  }

  /** The flood block's own Retry (§48.21).
   *
   *  `data-retry="flood"` and not `rainfall` — `ui/view-storm-detail.js` binds
   *  every `.detail-retry` on the panel by class, and three buttons answering
   *  to one selector is how two of them silently stop working.
   *
   *  ==> IT IS THE ONLY THING IN THIS BLOCK ALLOWED TO REACH THE NETWORK. <==
   *  The block otherwise reports what the app already holds; the map layer's
   *  toggle owns the fetch. A press here is a reader explicitly asking. */
  function wireFlood(bodyEl, repaint) {
    const btn = bodyEl?.querySelector?.('[data-retry="flood"]');
    if (!btn || !flood?.retry) return;
    btn.addEventListener('click', async () => {
      await flood.retry();
      repaint?.();
    });
  }

  return { html, ensure, wire };
}
