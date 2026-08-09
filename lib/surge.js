/**
 * surge.js — reading a Peak Storm Surge polygon: which band, which words.
 *
 * NHC's peak surge product is five nested inundation bands. Each is a polygon
 * carrying a place label and a colour class, and the colour class is the only
 * thing on the feature that says how deep the water gets.
 *
 * ==> THE BAND IS IN `popupinfo`, NOT IN `symbolid`, AND THAT IS MEASURED. <==
 * Read off the live service's own drawing info 2026-08-09, the renderer is:
 *
 *     "type": "uniqueValue",
 *     "valueExpression": "Split($feature.PopupInfo,'\"')[7]"
 *     blue -> "Up to 3 ft"   yellow -> "Up to 6 ft"   orange -> "Up to 9 ft"
 *     red  -> "Up to 12 ft"  purple -> "Above 12 ft"
 *
 * NHC splits its own `popupinfo` string on double quotes and reads the eighth
 * piece. `symbolid` is present on the layer and its renderer does not touch it.
 * An inherited note in the spec said `symbolid` carried the colour class; it is
 * corrected here, and this file reads what NHC's own map reads.
 *
 * IT DOES NOT COUNT TO SEVEN. Splitting on quotes and taking index 7 is exact
 * on the string NHC publishes today and breaks silently on any string with one
 * quote more or fewer — and the failure mode is not an error, it is a surge
 * band painted the wrong colour, which is a SPEC section 6 safety-contract bug.
 * So the colour word is FOUND rather than counted to: split on quotes, take the
 * first piece that IS one of the five words. Same answer on the published
 * string, and a shrug rather than a wrong depth on anything else.
 *
 * NO BAND IS A REAL ANSWER. A feature whose colour word cannot be read returns
 * `null` and every caller renders that as "not classified" — never as the
 * lowest band, never as a guessed colour. Better nothing than a wrong depth.
 *
 * `name` IS A PLACE, NOT A DEPTH — "Tampa Bay", "Vermilion Bay". It is shown as
 * a location label and never as a number. This has burned the HA project once.
 *
 * [VERIFY] The five colour words are confirmed off the renderer. The exact
 * `popupinfo` string is NOT: the service published zero features on 2026-08-09
 * (no active storms), so nothing has been read from a real feature. The finder
 * above is written to survive that uncertainty; the first live storm confirms
 * it or shows the words live somewhere else in the string.
 *
 * Pure. Imports config/ only.
 */

import { SURGE_RAMP } from '../config/tokens.js';

/** NHC's colour words, in the ramp's own rising order. Index into SURGE_RAMP,
 *  so the words and the legend text can never drift apart. */
const BAND_WORDS = Object.freeze(['blue', 'yellow', 'orange', 'red', 'purple']);

const WORD_INDEX = new Map(BAND_WORDS.map((w, i) => [w, i]));

/**
 * The band index (0..4) for one surge feature's properties, or null.
 * @param {object} props
 */
export function surgeBandIndex(props) {
  if (!props) return null;

  /* `popupinfo` first, because it is what NHC's own renderer reads. `snippet`
   * is checked second and costs nothing: it is the other free-text field on the
   * layer, and if NOAA ever moves the class between them a colour keeps
   * appearing rather than every band going unclassified at once. */
  for (const field of ['popupinfo', 'snippet']) {
    const raw = props[field];
    if (typeof raw !== 'string' || !raw) continue;

    for (const piece of raw.split('"')) {
      const word = piece.trim().toLowerCase();
      if (WORD_INDEX.has(word)) return WORD_INDEX.get(word);
    }
  }
  return null;
}

/**
 * One surge feature, read.
 *
 * @returns {{index:number, word:string, label:string, feet:number,
 *            color:string, name:string|null}|null}
 *   `label` is NHC's OWN legend text, verbatim ("Up to 6 ft"). Rewriting an
 *   official legend is the same class of error as curving official geometry
 *   (SPEC section 7) — the units preference adds a conversion in parentheses at
 *   render time and never replaces these words.
 */
export function readSurgeFeature(feature) {
  const props = (feature && feature.properties) || null;
  const index = surgeBandIndex(props);
  if (index == null) return null;

  const ramp = SURGE_RAMP[index];
  const name = props && typeof props.name === 'string' && props.name.trim()
    ? props.name.trim()
    : null;

  return {
    index,
    word: BAND_WORDS[index],
    label: ramp.label,
    feet: ramp.feet,
    color: ramp.color,
    /* A PLACE LABEL. Never rendered as a depth, never parsed for a number. */
    name,
  };
}

/**
 * The severest band among features — highest index wins.
 *
 * Bands are NESTED: a home inside the "Above 12 ft" polygon is usually inside
 * the four shallower ones too, because each band is drawn as everything at
 * least that deep. Taking the first hit would report 3 ft to somebody facing
 * 12, which is the one direction this must never be wrong in.
 */
export function severestSurge(features) {
  let best = null;
  for (const f of features || []) {
    const band = readSurgeFeature(f);
    if (band && (!best || band.index > best.index)) best = band;
  }
  return best;
}
