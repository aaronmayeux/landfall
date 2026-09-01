/**
 * flood-words.js (ui) — the sentences the Flooding section says on both
 * screens. SPEC §56.7.
 *
 * ==> ONE SECTION NOW CARRIES TWO COVERAGE GAPS AND EACH ONE READS AS AN
 * ALL-CLEAR IF IT IS SILENT. <== That is the §5 cost of merging `Rain`'s flood
 * alerts and `Coastal flooding` into one section, and it is the thing the
 * merge is most likely to get wrong. The two halves come from sources with
 * almost disjoint coverage:
 *
 *   NWS flood alerts   the United States, and nowhere else. No global
 *                      equivalent exists for this app to fall back to.
 *   the GDACS model    everywhere EXCEPT NHC's basins, which it declines by
 *                      design (§51.5) rather than by accident.
 *
 * So a US storm has rows and no modelled figure; a Japan typhoon has a
 * modelled figure and no rows. **Neither absence is a forecast.** A reader who
 * meets an empty half and no sentence beside it will read safety into it, and
 * getting that right in ONE place rather than two is a point in favour of the
 * merge that only pays if the sentences actually live in one place.
 *
 * ==> WHICH IS WHY THESE ARE HERE AND NOT INLINE IN TWO CONTROLLERS. <== §12's
 * rule is that a pattern used twice gets extracted BEFORE the second use, and
 * `ui/disclaimer.js` is the precedent for extracting WORDING rather than
 * markup: one source for a sentence that must not be retyped at a call site,
 * because the copy that drifts is the one nobody is looking at. A coverage
 * disclaimer that says two different things on two screens is worse than no
 * disclaimer, since a reader who has read one believes they have read both.
 *
 * ==> TWO OF THE FOUR ARE USED ON ONE SCREEN ONLY, AND THEY ARE STILL HERE.
 * <== `MODEL_NOT_THIS_BASIN` and `GDACS_PROVENANCE` are said on both;
 * `NWS_US_ONLY` and `NWS_NOT_ATTRIBUTED` are the storm drawer's alone, because
 * the home dashboard can answer both questions exactly — its rainfall payload
 * names the provider, and its rows are about the reader's own address rather
 * than a match we performed. They live here anyway so that "what does this
 * feature say when it cannot answer" is ONE FILE to read rather than a search
 * across three, which is the audit that matters and the one a §5 review does.
 * If a third surface lands, it starts from the same four sentences.
 *
 * Imports nothing. Ever — these are strings.
 */

/**
 * There are no alert rows, and that is about COVERAGE rather than about
 * safety.
 *
 * ==> IT IS SAID WHENEVER THE ROWS ARE EMPTY, NOT ONLY OUTSIDE THE UNITED
 * STATES, AND THAT IS DELIBERATE. <== The obvious design is to say it only for
 * a storm outside NWS's area — quieter, and it needs a test for "is this storm
 * somewhere NWS covers". Nothing in this project can get that test right
 * today: it is not the basin (a Central Pacific storm off Hawaii IS covered
 * and an Atlantic storm mid-ocean is not), it is not the source, and this app
 * has never had a US landfall on glass to check an answer against. A wrong
 * coverage claim is worse than a true one said once too often, so it is said
 * on every empty result and the sentence is written to be true on all of them
 * — it describes what the source covers and makes no claim about this storm.
 */
export const NWS_US_ONLY =
  'The National Weather Service issues these for the United States only, and ' +
  'there is no global equivalent — so an empty list here is not an answer for ' +
  'anywhere else.';

/**
 * There is no modelled coastal figure, and that is about COVERAGE rather than
 * about safety.
 *
 * ==> IT NAMES THE BOUNDARY AS DELIBERATE, BECAUSE IT IS (§51.5). <== The
 * global model is not asked about a storm in an NHC basin — Aaron's call,
 * 2026-08-19: NHC's own inundation forecast is the trusted product where NHC
 * publishes one, and a sub-metre figure from a model whose datum is stated
 * nowhere must not sit beside it. Worded as a gap rather than as a fault so a
 * reader does not wait for a number that is never coming, and worded without
 * the word "expected" so it cannot be read as a forecast of dry ground.
 */
export const MODEL_NOT_THIS_BASIN =
  'Coastal flooding is not modelled for storms in this basin, so there is no ' +
  'modelled figure here. That is a gap in what this app can show, not a ' +
  'forecast of no coastal flooding.';

/**
 * Whose model, and that it IS a model.
 *
 * ==> BOTH HALVES ARE LOAD-BEARING (§51.1). <== The modeller, because this is
 * not NHC and a reader comparing an American storm's feet against this storm's
 * centimetres has to be able to see they are two products. The word MODELLED,
 * because that is what this is — a simulation output, not a forecaster's
 * warning — and stating water depth at somebody's address in the same voice as
 * an official surge warning would overclaim.
 */
export const GDACS_PROVENANCE =
  'Modelled by the JRC for GDACS. This is a global model, not an official ' +
  'surge warning.';

/**
 * The rows are an agency's statement about an area, and putting them under a
 * storm's name is OUR distance match and not the agency's claim. §48.21,
 * §56.3.
 *
 * ==> THE WORDING IS THE WHOLE SAFETY PROPERTY OF THE ROWS. <== An NWS flood
 * warning does not name a storm. It says *Flash Flood Warning, Hawaii in
 * Hawaii, HI* and nothing else — the hurricane sitting on top of it is
 * mentioned nowhere in the product. A stalled front can flood a county while
 * the hurricane on screen goes out to sea, and this sentence is the only thing
 * standing between "an alert is in force near the track" and "this storm's
 * flooding". It does not get trimmed for length.
 */
export const NWS_NOT_ATTRIBUTED =
  'Issued by the National Weather Service for the areas named, not attributed ' +
  'to this storm — an alert near the track may have another cause.';

/**
 * The one line `Watches and warnings` gained when flooding left it. §56.8.
 *
 * ==> FLOOD ALERTS DO NOT MOVE INTO THAT SECTION, AND THE COST IS THIS
 * SENTENCE. <== The line that holds is that `Watches and warnings` carries
 * products that NAME this storm and `Flooding` carries products that do not.
 * NHC's four — Tropical Storm and Hurricane Watch/Warning — are issued for
 * this storm, by name, in its own advisory: no attribution risk. An NWS flood
 * alert names nothing at all; it is a distance match WE performed, and in a
 * list whose other rows genuinely belong to the storm that difference would be
 * laundered into looking official.
 *
 * ==> REJECTED: ONE MERGED WARNINGS LIST. <== It would sit a Hurricane Warning
 * — this storm, named, act now — beside a Flood Warning two states away that
 * may have a different cause entirely, in one list with one look. The strong
 * row lends its authority to the weak one.
 *
 * ==> AND THE PREDICTABLE FAILURE IS A READER CONCLUDING WE MISSED IT. <==
 * Somebody who opens `Watches and warnings` during a flood and finds no flood
 * warning will not conclude "it must be filed elsewhere". They will conclude
 * the app did not see it.
 *
 * ==> IT IS UNCONDITIONAL, AND IT LIVES IN THE VIEW RATHER THAN IN
 * `ui/cap-storm.js`. <== Unconditional because the EMPTY state is exactly when
 * a reader is most likely to think something is missing, so a pointer that
 * appeared only when there were rows would be absent on the one screen that
 * needs it. In the view because that section has two halves — NHC's legend and
 * the CAP controller — and a pointer written into one of them would be missing
 * from the other half of its own section.
 *
 * ==> IT IS MARKUP, NOT A STRING, WHICH IS WHY IT IS NOT `esc`d AT ITS CALL
 * SITE. <== Every other export here is plain text a caller escapes. This one
 * carries its own element and a `<strong>`, because the section name has to be
 * findable by eye in the quietest register on the panel. Nothing in it comes
 * from a source, so there is nothing to escape.
 */
export const FLOOD_POINTER =
  '<div class="detail-cap-note">Flood alerts and coastal flooding are in the ' +
  '<strong>Flooding</strong> section below — they are not issued for a named ' +
  'storm, so they are not listed here.</div>';

/* --------------------------------------------------------------------------
 * THE DETAIL PANEL'S SENTENCES (§56.6)
 * ----------------------------------------------------------------------- */

/**
 * What a watch is, and what a warning is, in NWS's own distinction.
 *
 * ==> IT IS ONE LINE AND IT IS THE MOST USEFUL LINE ON THE PANEL FOR SOME
 * READERS. <== A Flood Watch and a Flash Flood Warning are BOTH `severity:
 * Severe` (§48.6), so nothing in the payload separates them for somebody who
 * does not already know the vocabulary — and plenty of people do not. The app
 * already leans on the distinction everywhere: the chip is a darker green for a
 * watch, the row says *in force* only for a warning, and a cluster counts as a
 * warning if it holds even one. All of that assumes a reader who knows what the
 * two words mean.
 *
 * ==> AND IT IS NWS'S OWN DEFINITION RATHER THAN A PARAPHRASE. <== "Conditions
 * are favourable" and "is occurring or imminent" are the agency's own framing
 * of watch versus warning, so this states a published distinction rather than
 * inventing one. §50.3's rule about not asserting what a source did not say
 * applies to prose as much as to a match.
 *
 * @param {boolean} watch
 */
export const watchOrWarningMeans = (watch) =>
  watch
    ? 'A watch means conditions are favourable for flooding. It has not started, and it may not.'
    : 'A warning means flooding is happening now or is about to. Act on it.';

/**
 * ==> SAID WHEN AN ALERT HAS NO SHAPE, BECAUSE OTHERWISE THE READER LOOKS FOR
 * SOMETHING THAT IS NOT THERE. <== §56.4 resolves a watch's forecast zones into
 * real boundaries, so most watches DO end up drawable — but a zone whose
 * boundary did not come back leaves an alert that is genuinely in force, listed
 * in the drawer, and invisible on the globe. A panel that said nothing would
 * leave a reader hunting the map for a shape this app cannot draw, and reading
 * its absence as an all-clear. §5: never ship silence on a failure.
 */
export const FLOOD_NOT_DRAWN =
  'This alert is in force, but the agency did not publish a boundary we could ' +
  'draw, so it does not appear on the globe.';

/**
 * WHERE THE PAST-RAINFALL FIGURE CAME FROM. §56.14.
 *
 * ==> IT IS A MODEL, NOT A RAIN GAUGE, AND THIS SENTENCE IS THE ONLY THING
 * STOPPING THE FIGURE OVERCLAIMING. <== §56.14 names this as the single most
 * likely thing in the feature to get wrong, and the reason is that a wrong
 * version looks identical: Open-Meteo's past hours are model and reanalysis
 * output, not a reading from an instrument near the reader's house, and "3.1
 * in fell" and "about 3.1 in is estimated to have fallen" carry the same
 * number with completely different warrants behind them. A reader deciding
 * whether the ground is already saturated is entitled to know which one they
 * are looking at.
 *
 * ==> AND IT NAMES THE PROVIDER FOR A SECOND REASON: THE SEAM. <== On an
 * American house the FORECAST half of this screen comes from the National
 * Weather Service and this figure does not — NWS publishes no matching
 * observed series (§56.14), so the past comes from one source at every point
 * on Earth. That is deliberate and more consistent than a figure that exists
 * in some countries and not others, but it means two numbers on one screen
 * have two different authors. Saying so is cheaper than a reader discovering
 * it by finding they disagree.
 */
export const PAST_RAIN_PROVENANCE =
  'Estimated by Open-Meteo’s global model, not measured at a nearby gauge.';

/**
 * The past-rainfall window in words. §56.14.
 *
 * ==> IT NAMES THE HOURS ACTUALLY COVERED, NEVER THE WINDOW ASKED FOR. <== The
 * same rule §48.11 applies at the forward end, and it bites here for a
 * measured reason: Open-Meteo prepends WHOLE UTC DAYS, so how far back the
 * series really reaches swings through the UTC day. A last-good payload can
 * also age until only part of the window is left. Saying "the last 48 hours"
 * over thirty hours of data is a claim about a period nobody has numbers for.
 *
 * ==> ROUNDED TO WHOLE DAYS ONLY WHEN IT IS ONE. <== "the last 2 days" and
 * "the last 48 hours" are the same fact, and the second is what a forecast
 * office says. Below a day the hours are the whole figure.
 */
export const pastWindowWords = (hours) => {
  const h = Math.round(Number(hours) || 0);
  if (h <= 0) return null;
  if (h === 1) return 'the last hour';
  if (h === 24) return 'the last 24 hours';
  return `the last ${h} hours`;
};

/**
 * Whose forecast the surge rows are, and what the depths are measured FROM.
 *
 * ==> THE DATUM IS THE HALF THAT CANNOT BE LEFT OUT. <== "5 ft" means five feet
 * of water standing on top of normally dry ground, not a five-foot tide and not
 * a sea level. A reader who takes it for a tide height concludes their raised
 * house is fine. NHC says "above ground level" on its own legend for exactly
 * this reason, so the phrase is theirs and it is kept.
 *
 * ==> AND IT NAMES THE FORECASTER, LIKE `GDACS_PROVENANCE` DOES. <== Both
 * products can be on screen in one session, one in feet and one in metres, and
 * the reader has to be able to see they are two different organisations
 * answering two different questions rather than one answer disagreeing with
 * itself.
 */
export const NHC_SURGE_PROVENANCE =
  'Peak storm surge forecast by the National Hurricane Center, in feet above ' +
  'ground level.';

/**
 * NHC has nothing out for this storm, and that is an ANSWER rather than a gap.
 *
 * ==> IT IS THE COMMON CASE AND IT IS STILL SAID OUT LOUD (§5). <== The Peak
 * Storm Surge product exists only while a US surge forecast is in effect, which
 * for most storms in most weeks it is not. Saying nothing here leaves an empty
 * space that reads identically to the failure below it — and telling those two
 * apart is the entire reason this section exists.
 *
 * ==> WORDED AS NHC'S SILENCE, NOT AS DRY GROUND. <== "No surge is forecast"
 * would be us making a forecast. What we know is narrower: nobody has published
 * one. A storm can be hours from a coast with the product not yet issued.
 */
export const NHC_SURGE_NONE =
  'The National Hurricane Center has no peak storm surge forecast out for ' +
  'this storm.';

/**
 * The fetch failed. ==> THE ONE STATE THAT MUST NEVER LOOK LIKE THE ONE ABOVE.
 * <== On 2026-09-01 this layer drew nothing on a coast under a live Storm Surge
 * Warning and said nothing either, because a coastal reach carries no per-row
 * status of its own. An unmarked shoreline reads as "no surge forecast"; this
 * sentence is the difference between that and "no answer".
 */
export const NHC_SURGE_UNAVAILABLE =
  'The peak storm surge forecast didn’t load, so the coast may be unmarked. ' +
  'That is not a forecast of no surge.';
