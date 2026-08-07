/**
 * plate-line.js — TUNING FOR THE PLATE-BOUNDARY SEAMS AND THEIR NAMES.
 *
 * A verbatim move out of `config/constants.js`. No value changed.
 *
 * Same reason as `config/volcano.js`: `constants.js` is imported by nearly
 * every module, there is no build step to shake out an unused import
 * (SPEC.md §2), and this block is 223 lines and 13 KB that only the Deep
 * prototype reads. It was on the cyclone critical path via `map/style.js`,
 * which no longer imports it -- the layer builders moved to
 * `map/style-plates.js` and took this with them.
 *
 * Readers: `map/style-plates.js` and `lib/plate-lines.js`. Neither is on the
 * shipped path; `tools/module-graph.mjs` is the check.
 */

/**
 * PLATE BOUNDARIES (lib/plate-lines.js) — the curve, the names, and the ranking.
 *
 * A SEPARATE BLOCK FROM `TRACK_LINE`, THOUGH IT USES THAT MODULE'S CURVE. The
 * spline itself is shared (§12 — one smoothing implementation, not two), but
 * every number describing WHAT is being smoothed is different: a storm track is
 * one path of a few dozen fixes redrawn every few minutes, and this is 241 fixed
 * boundaries totalling 6,292 vertices, loaded once and never updated. Borrowing
 * TRACK_LINE's budget would size the plate network against a hurricane.
 */
export const PLATE_LINE = Object.freeze({
  /** ==> STEP 1: CHAIN. Two segments that meet end to end are one boundary. <==
   *
   *  PB2002 publishes the Mid-Atlantic Ridge's Africa-South America boundary as
   *  THREE features (173, 45 and 40 vertices) that abut. Splining them
   *  separately leaves a corner at each joint, and labelling them separately puts
   *  three copies of AFRICA down one ridge. Chained, it is one curve and one
   *  label.
   *
   *  Endpoints within this many degrees are the same point. PB2002's segments
   *  share exact coordinates where they meet, so this only has to beat float
   *  noise in a JSON round trip — the same reasoning and nearly the same value as
   *  `TRACK_LINE.joinEpsDeg`. Loose enough to be useless as a gap-bridger, which
   *  is deliberate: joining across a real gap would invent boundary. */
  chainEpsDeg: 1e-6,

  /** ==> STEP 2: SIMPLIFY, AND THIS IS THE ONE THAT MOVES PUBLISHED VERTICES.
   *  <== Degrees, fed to `simplifyPath` (Douglas-Peucker), so it is also the
   *  guaranteed maximum deviation from the published line.
   *
   *  WHY IT EXISTS: mid-ocean ridges arrive as staircases. Measured on the
   *  Mid-Atlantic Ridge, the MEDIAN turn between consecutive published segments
   *  is 83.8° and 106 of 171 turns are steeper than 70°, with steps about 0.5°
   *  long. A spline through those points rounds each corner and still draws a
   *  staircase, which is exactly what it looked like on glass.
   *
   *  WHAT IT COSTS, MEASURED ACROSS THE WHOLE FILE at this value: 6,213 chained
   *  vertices down to about 2,100, and turns steeper than 70° down from 930 to
   *  single figures.
   *
   *  ==> THE DEVIATION IS TWICE THIS NUMBER, NOT THIS NUMBER. <== Douglas-Peucker
   *  guarantees every point stays within the tolerance of the CHORDS it keeps —
   *  and then the spline bows away from those chords by about as much again.
   *  Measured end to end, published vertex to nearest drawn seam, the worst case
   *  across the whole file is 1.20°, which is roughly 133 km and exactly 2.0x the
   *  tolerance. That ratio is asserted in `tools/test-plate-lines.mjs` so raising
   *  this constant cannot quietly double a distance nobody restated. The first
   *  version of this comment claimed 0.6° and was wrong by a factor of two.
   *
   *  ==> AND SOME OF THOSE RIGHT ANGLES ARE REAL GEOLOGY, NOT ARTEFACTS. <== A
   *  mid-ocean ridge genuinely is a staircase: spreading segments offset by
   *  transform faults, meeting at close to 90°. So this is not purely artefact
   *  removal — it is a deliberate decision to draw the TREND of a boundary
   *  rather than its segment-by-segment structure, taken on Aaron's call
   *  2026-07-30 because the staircase read as a rendering fault rather than as
   *  tectonics. It is defensible on the data too (§5 applied to cartography:
   *  PB2002 lines are a generalised interpretation of zones tens of kilometres
   *  across, so 67 km is inside the shrug the source already carries) but the
   *  honest statement is that this is a LOOK choice with a number attached.
   *  Lower it toward 0.2 to keep more structure; the staircase comes back. */
  simplifyToleranceDeg: 0.6,

  /** ==> STEP 3: SPLINE. Curve samples per surviving leg. <==
   *
   *  MUCH HIGHER THAN IT WAS, AND THE SIMPLIFY PASS IS WHY. `smoothPath` spends
   *  its budget evenly across legs, so this is a density rather than a total. At
   *  6,292 unsimplified vertices, 5 samples a leg was plenty because the legs
   *  were half a degree long. After simplification the legs are several degrees
   *  long and 5 samples across one of them is visibly faceted at close zoom.
   *
   *  The two passes together are CHEAPER than the old single pass: about 930
   *  legs at 12 samples is roughly 11,000 vertices against 28,000 before, and
   *  the line is smoother because the vertices are spent where the curve
   *  actually bends. */
  samplesPerLeg: 12,

  /** Vertex ceiling per chained boundary, applied on top of `samplesPerLeg`, so
   *  one very long chain cannot take the layer to itself. */
  maxVerticesPerBoundary: 1600,

  /* --- THE LABELS --------------------------------------------------------- *
   *
   * ==> THE TWO NAMES ARE PAIRED AT A SHARED ANCHOR, NOT SCATTERED ALONG THE
   * SEAM. <== First pass placed each side's label independently and repeated it
   * every `symbol-spacing` pixels, which gave five AFRICAs down one ridge and no
   * relationship between the two sides — you had to hunt for the other name.
   *
   * Now `lib/plate-lines.js` picks ANCHOR points along each chained boundary and
   * emits, per anchor, one short window of the curve displaced to each side. The
   * layers use `symbol-placement: 'line-center'`, which places exactly ONE label
   * per feature at its centre — so both names land at the same point along the
   * seam, on opposite sides of it, and read as a pair in one glance.
   *
   * ==> AND THE THREE BANDS DO THREE JOBS AT ONCE, WHICH IS WHY THEY ARE ONE
   * TABLE. <== Everything about a label's placement is in degrees on the ground
   * while the thing you are trying to hold steady is PIXELS, so all three
   * numbers have to move together with zoom. Bands are how a static geometry
   * approximates that (see `lib/plate-lines.js` for why the pixel-constant
   * mechanism, `text-offset`, cannot be used at all).
   *
   *   offsetDeg  how far off the seam the name sits. TARGET IS ABOUT 10-30 px
   *              across the band; at 512*2^zoom/360 px per degree, that is what
   *              picks these values. Bigger and the name floats unattached.
   *   windowDeg  length of the curve fragment the label rides. MUST hold the
   *              longest name at that zoom or MapLibre drops it silently —
   *              "NORTH AMERICA" is about 125 px at `SIZE.plateLabelPx`, so each
   *              window is sized to clear that at its band's LOW end. Too long
   *              is harmless, because `line-center` uses the middle.
   *              ==> AND IT NEEDS REAL HEADROOM, NOT JUST ENOUGH. <== The
   *              displaced copy on the INSIDE of a bend is shorter than the seam
   *              it came from, and on a tight bend it is much shorter. Sized to
   *              exactly fit, the inner label of a pair vanishes on curves while
   *              its partner survives — seen on the Mid-Atlantic Ridge, where
   *              AFRICA was labelled and NORTH AMERICA opposite it was not, which
   *              is worse than neither: it reads as a fact about that plate.
   *   anchorDeg  spacing between anchors. THE DENSITY DIAL, and the one most
   *              likely to want moving. Sized so a long seam gets about one pair
   *              per screen width at that band. A boundary SHORTER than this still
   *              gets exactly one anchor at its midpoint, so no boundary is ever
   *              nameless — which also means this dial cannot reduce the count
   *              below one pair per visible seam. A small plate with four
   *              boundaries in view is therefore named four times, once per seam.
   *              That is the design (each seam names both its own sides) and it is
   *              the remaining source of repetition; fixing it would mean labelling
   *              a plate's AREA rather than its seams, which is a different
   *              feature. Raised 60/20/5 -> 95/34/9 on Aaron's report of too many
   *              copies at once.
   *   until      the zoom at which this band hands over to the next. ==> ONE
   *              NUMBER PER HANDOVER, STATED ONCE. <== It was a `from`/`to` pair
   *              per band, which describes each boundary TWICE — and the two
   *              copies promptly disagreed: the outgoing band faded out around its
   *              own `to` while the incoming one faded in around its own `from`,
   *              0.2 apart, so at z3.75 the two summed to 1.12 and every plate
   *              name was drawn one and a bit times. A shared edge written twice
   *              is a shared edge that drifts. The last band has no `until`; it
   *              runs to the top of the zoom range.
   *
   * NONE OF THE TWELVE NUMBERS BELOW HAS BEEN SEEN ON A PHONE. */
  labelBands: Object.freeze([
    Object.freeze({ id: 'far', offsetDeg: 1.1, windowDeg: 26, anchorDeg: 95, until: 4.0 }),
    Object.freeze({ id: 'mid', offsetDeg: 0.4, windowDeg: 10, anchorDeg: 34, until: 5.5 }),
    Object.freeze({ id: 'near', offsetDeg: 0.11, windowDeg: 3.6, anchorDeg: 9 }),
  ]),

  /** How wide each handover is, in zoom levels. The fade is centred on the shared
   *  `until`, so the outgoing band's fall and the incoming band's rise are the
   *  SAME interval and complement exactly — one band's worth of label at every
   *  zoom, never 1.12 of one. Asserted in `tools/test-world-basemap.mjs`. */
  bandOverlap: 0.3,

  /** Vertex spacing along a label window, degrees. The window is thinned to this
   *  before it is displaced: text bends along a much coarser curve than the
   *  magma line is drawn from, and six windows per anchor at full spline
   *  resolution would cost more than the seams themselves. Scaled per band from
   *  its own `windowDeg`, so a 2.4° window is not sampled like an 18° one. */
  labelSpacingFraction: 0.05,

  /** THE TIER LADDER. A plate's tier comes from the total length of all its
   *  boundaries (degrees, latitude-corrected), and the tier decides how early
   *  its name is allowed on screen.
   *
   *  ==> THIS EXISTS BECAUSE UNRANKED LABELS ARE WORSE THAN NO LABELS. <== All
   *  fifty-two plates competing at the planet band means MapLibre's collision
   *  pass throws away almost everything, and which survivors you get is an
   *  accident of placement order. Ranked, the big seven own the low zooms and
   *  the fragments arrive when there is room for them.
   *
   *  THE THRESHOLDS ARE READ OFF THE DATA, not chosen. Measured: Pacific 665°,
   *  Eurasia 600, Antarctica 593, North America 574, Africa 410, Australia 378,
   *  South America 363 — then a gap to Somalia at 222. So 300 cuts exactly where
   *  the data already has a step. 60 is the second step, admitting the plates
   *  with a recognisable shape and leaving the true fragments in tier 3.
   *
   *  A boundary takes the BETTER of its two plates' tiers, so the Cocos-Nazca
   *  ridge is not held back to tier 3 by whichever side is smaller. */
  tierMajorDeg: 300,
  tierMinorDeg: 60,

  /** Zoom each tier's names begin, and the fade width. Tier 1 starts as early
   *  as any basemap text can: MapLibre is fully transparent below `DIVE.zSpace`
   *  and only materially visible a little above it, so this is a floor imposed
   *  by the crossfade rather than a look call. Names from space would need the
   *  Three globe to draw text, which it cannot — decided 2026-07-30, nameless
   *  from space is the wanted behaviour, not a gap to close. */
  tierIn: Object.freeze({ 1: 2.5, 2: 3.6, 3: 4.8 }),
  tierFade: 0.6,

  /** How much of the local radius of curvature the sideways displacement may
   *  use, on the INSIDE of a bend. Offset a curve inward by more than its own
   *  radius and the copy turns inside out; at 0.6 there is comfortable margin,
   *  and the visible effect is that names hug the seam a little more tightly
   *  through tight bends, which is not a bad look. Raise it toward 1 and cusps
   *  come back on small plates. */
  curvatureSafety: 0.6,

  /** The sharpest bend a label may sit on, degrees per glyph. MapLibre's own
   *  guard against text laid around a hairpin, where consecutive glyphs fan out
   *  and stop reading as a word. Its default is 45; a label window is short,
   *  splined and simplified, so it can be looser than default without going
   *  illegible. */
  labelMaxAngle: 55,

  /** Floor on cos(latitude) when taking a perpendicular or measuring length.
   *  Antarctic boundaries run near 60°S where cos is 0.5, so this never binds
   *  on today's file — it is here so a source that reaches the pole degrades to
   *  a squashed offset rather than a division by nothing. Same value and same
   *  reasoning as `TRACK_LINE.minCosLat`. */
  minCosLat: 0.05,
});
