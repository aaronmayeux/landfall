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
