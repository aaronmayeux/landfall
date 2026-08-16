/**
 * env-legend.js (ui) — the key to the environment ribbon's color. SPEC §47.11.
 *
 * ==> ONE FUNCTION, TWO SURFACES, AND THAT IS THE ENTIRE REASON THIS FILE
 * EXISTS. <== The legend appears under the Environment toggle in the Layers
 * panel and again in the Environment section of the storm drawer, because the
 * two surfaces answer different questions — "what will this switch do to my
 * map" and "what am I looking at right now" — and a reader in one of them
 * should not have to go and find the other. Two surfaces mean two chances to
 * drift, so both call this. §6's rule: any pattern used twice is extracted
 * before the second use.
 *
 * ==> THE BAR IS THE MAP'S OWN RAMP, NOT A COPY OF IT. <== The three stops
 * arrive as CSS custom properties written by `app/theme-switch.js` from the
 * SAME palette entry `lib/cone-ribbon.js` colors the cone slices from. Type
 * the hexes into the stylesheet instead and the legend is right until the
 * first retune and quietly lying afterwards — the exact failure mode
 * `tools/test-css-vars.mjs` was written for.
 *
 * ==> THE THIRD LABEL IS "BALANCED", AND IT IS NOT "NO IMPACT". <== The middle
 * of the ramp is where the environment's push and pull cancel, which is NOT
 * the same as nothing happening: §47.4 measured 21% of neutral hours carrying
 * 15 kt or more of opposed forcing — one neutral cone in five is a tug of war,
 * not a calm day. "No impact" would be a confident wrong answer about exactly
 * those storms, in a layer whose whole argument is that it reports rather than
 * scores. "Balanced" is true of both the quiet ones and the loud ones.
 *
 * ==> IT KEYS THE CONE, NOT THE TRACK. <== The line carries a floored version
 * of this ramp so it can never disappear into the sea (config/tokens.js
 * `envRampLine`), so its darkest violet is lighter than the bar's darkest end.
 * The cone is a hundred times the area and is the surface the reader is
 * actually reading; keying both would need two bars saying one thing.
 *
 * Imports: nothing. It is a string.
 */

/** The end labels and the middle. Here rather than in the markup so the two
 *  callers cannot render different words, and so a wording change is one
 *  edit. Knots are deliberately absent: §47.4 fixes the ramp domain at ±15 kt,
 *  but a reader is being told a DIRECTION here and the figures live in the
 *  drawer's grid, in the reader's own units. */
const ENDS = Object.freeze({
  lo: 'Tearing it down',
  mid: 'Balanced',
  hi: 'Feeding it',
});

/**
 * The legend, as markup.
 *
 * @param {object} [opts]
 * @param {boolean} [opts.note=true]  include the sentence explaining what the
 *        color is and what it deliberately leaves out. The drawer wants it —
 *        the reader is there to read. The Layers row does not: that panel is a
 *        list of switches being scanned, the row above already carries its own
 *        one-line description, and a paragraph inside a control is how a
 *        settings screen becomes unscannable.
 * @returns {string}
 */
export function envLegendHtml({ note = true } = {}) {
  return `
    <div class="env-legend">
      <div class="env-legend-bar" role="img"
           aria-label="Color scale: ${ENDS.lo} on the left, ${ENDS.mid} in the middle, ${ENDS.hi} on the right"></div>
      <div class="env-legend-ends" aria-hidden="true">
        <span>${ENDS.lo}</span>
        <span>${ENDS.mid}</span>
        <span>${ENDS.hi}</span>
      </div>
      ${note ? `<p class="env-legend-note">What the environment is worth to the
        storm, from SHIPS's own accounting rather than a score of ours. It
        describes the middle of the cone: SHIPS measures no left-to-right
        difference, so a whole slice is one number and never a claim that one
        edge differs from the other.</p>` : ''}
    </div>`;
}
