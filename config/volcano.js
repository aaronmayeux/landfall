/**
 * volcano.js — THE VOLCANO LAYER'S TUNING BLOCK, AND WHY IT IS NOT IN
 * `config/constants.js`.
 *
 * ===========================================================================
 * THIS IS A MOVE, NOT A REWRITE. NOTHING BELOW CHANGED VALUE.
 * ===========================================================================
 *
 * Every number, comment and derivation below arrived here verbatim out of
 * `config/constants.js`. If a value looks wrong, it was wrong there too — this
 * file is not where it was decided.
 *
 * ===========================================================================
 * THE REASON IS A MEASURED COST ON EVERY COLD LOAD OF THE CYCLONE APP.
 * ===========================================================================
 *
 * `config/constants.js` is imported by nearly every module in the app, and
 * there is no build step to shake out what a module does not use — that is
 * SPEC.md §2, deliberate, and not up for renegotiation. So a constant sitting
 * in that file is downloaded by every visitor whether or not any shipped code
 * reads it.
 *
 * This block was **1,972 lines, 113 KB raw and 42 KB gzipped — 36% of
 * `constants.js`** — and `tools/module-graph.mjs` confirms the shipped app
 * reaches 106 modules and not one of them is volcano code. Every cyclone user
 * was paying for a layer they cannot see, on the critical path, before the
 * globe drew.
 *
 * ===========================================================================
 * THE RULE THAT KEEPS IT OUT.
 * ===========================================================================
 *
 * ==> NOTHING ON THE SHIPPED CYCLONE PATH MAY IMPORT THIS FILE. <==
 *
 * The importers are the eight `lib/volcano-*.js` modules, `data/volcano-live.js`
 * and the `proto/` world, all of which are off the shipped path and reached only
 * through `proto-worlds.html`. `tools/module-graph.mjs` is the check: if this
 * filename ever appears in its output, the saving is gone and something on the
 * cyclone path grew a volcano import by accident.
 *
 * Same reason `config/worlds/deep.js` is separate, and this file deliberately
 * does NOT live inside it: that file is a world's basemap PALETTE with a
 * fourteen-key contract `tools/token-check.mjs` asserts. This is layer tuning.
 * Two concerns, two files.
 */

/* ---------------------------------------------------------------------------
 * VOLCANO — the live layer's three channels (SPEC-HAZARDS §22.2/§22.4,
 * SPEC-GLOBES §42.1). Phases C and D: this block exists BEFORE the logic that
 * reads it, per §TUNING, and every number carries what it is derived from.
 *
 * ==> THREE FEEDS AT THREE DIFFERENT AGES, SO EVERY WINDOW HERE IS PER
 * CHANNEL. <== One freshness number over the whole layer would lie in
 * whichever direction it rounded: ash advisories land in hours, the
 * Smithsonian weekly lands once a week, and USGS alert levels sit unchanged
 * for weeks at a time. Averaging those is not a simplification, it is a
 * wrong answer three ways at once.
 *
 * NOTHING HERE IS A RENDER NUMBER. Marks, sizes and colours are Phase E and
 * deliberately absent. The severity normalisation at the bottom of this block
 * is Phase D and it is NOT a render number either — it is a ranking of the
 * catalog, and what a renderer does with a 0–1 score is Phase E's decision.
 * ------------------------------------------------------------------------- */

/* ==> THE VOLCANO PALETTE IS DECLARED ONCE, ABOVE THE OBJECT, BECAUSE TWO
 * RENDERERS HAVE TO READ THE SAME HEXES AND AN OBJECT LITERAL CANNOT REFER TO
 * ITSELF. <== `VOLCANO.marks` and `VOLCANO.map3d` are two branches of one
 * frozen literal, so `map3d` cannot write `VOLCANO.marks.quietColor`. Before
 * these consts existed the mountains were `#FFFFFF` and the dots were
 * `#8FD7E6` — the same volcano in two colours depending which rung of the
 * ladder was drawing it. Aaron's call 2026-07-30 is that a mountain wears its
 * dot's colour, so there is now exactly one place each hex is written.
 *
 * ==> AND SEVERITY LIVES IN THE THIRD ONE. <== Dot RADIUS used to rank the
 * quiet tier by severity score. Radius now ranks modelled FOOTPRINT, which is
 * true information where the severity ramp was a proxy invented because a dot
 * had nothing better to say — so severity moved to lightness inside the quiet
 * hue. `quietDim` is the low end of that ramp: identical hue (190°) and
 * saturation (0.64) to `quietColor`, lightness 0.73 → 0.45. A dim cyan dot and
 * a bright cyan dot are the same colour at two strengths, which is what keeps
 * erupting gold categorically separate rather than merely further along a
 * scale.
 *
 * ==> MOUNTAINS TAKE THE FULL-STRENGTH COLOUR AND NEVER THE RAMP. <== A
 * heightfield is already shaded per vertex by its own surface normal; a second
 * lightness signal on top of that would be read as terrain, not as hazard. */
/* ==> THE VOLCANOES WEAR THE WORLD'S OWN TWO COLOURS. AARON'S CALL 2026-07-31.
 * <== Quiet takes the coastline's orchid (`DEEP_WORLD.coastGlow`) and live
 * takes the plate seam's magma orange (`DEEP_WORLD.plates.core`). Written as
 * literals rather than imported from `config/worlds/deep.js` because this
 * layer has to be able to sit on a world that has neither — the same reason
 * `farSideFade` is matched by eye rather than imported. IF THE DEEP PALETTE
 * MOVES, MOVE THESE WITH IT. */
const VOLCANO_QUIET = '#DB8EF0';
const VOLCANO_LIVE = '#FF7A1A';

export const VOLCANO = Object.freeze({
  /** VAAC ash advisories — global, hourly, and ASH ONLY. */
  ash: Object.freeze({
    /** Fresh window. Advisories land in hours, so half an hour never makes a
     *  reader wait twice inside one publishing cycle. */
    freshSeconds: 30 * 60,

    /** Serve-stale ceiling on upstream failure. Six hours is several
     *  advisory cycles: long enough that a centre being briefly unreachable
     *  costs nothing, short enough that nobody reads yesterday's ash as
     *  today's. */
    staleSeconds: 6 * 60 * 60,

    /** ==> AN OLD BULLETIN IS NOT CURRENT ASH, AND THIS IS THE ONE NUMBER
     *  THAT STOPS A 2024 DRILL RENDERING AS AN ERUPTION. <== The tgftp
     *  bulletin slots are latest-only and overwritten in place, so a slot no
     *  centre has touched in months still answers 200 with whatever was last
     *  put there — measured: `fvxx02.lfpw` holds a TEST bulletin from
     *  2024-11-14 carrying `AVIATION COLOUR CODE: RED`. An ash cloud is
     *  superseded or closed within hours, so a bulletin older than a day is
     *  not evidence of ash in the air now; it means that centre has issued
     *  nothing since. Advisories past this age leave the ash channel.
     *
     *  THEY ARE COUNTED, NOT DISCARDED IN SILENCE (§5) — the payload carries
     *  `droppedStale` so a source that has quietly gone to sleep is visible
     *  instead of reading as a calm sky. */
    advisoryMaxAgeHours: 24,

    /** Exercise and test traffic, filtered on the `STATUS:` line.
     *
     *  ==> THIS FILTER IS NOT SUFFICIENT ON ITS OWN AND MUST NOT BE TRUSTED
     *  AS IF IT WERE. <== Measured: Toulouse's test bulletin carries NO
     *  `STATUS:` line at all and is a drill only by its `INFO SOURCE` and
     *  `RMK` prose. So "no STATUS line means operational" is FALSE, and the
     *  guards that actually catch that bulletin are `VOLCANO: UNKNOWN` and
     *  `advisoryMaxAgeHours` above. Three independent guards, because any one
     *  of them alone has a hole. See samples/vaac/README.md. */
    exerciseStatus: Object.freeze(['EXER', 'TEST']),

    /** Flight level to feet. FL230 is 23,000 ft — the aviation unit is
     *  hundreds of feet, and this is the ONLY machine-readable plume height
     *  either live feed publishes. Phase H's prose parser is the fallback,
     *  not the primary. */
    flightLevelToFeet: 100,
  }),

  /** USGS HANS — US observatories only, standing alert levels. */
  alerts: Object.freeze({
    /** Fresh window. HANS publishes a notice as soon as an observatory
     *  changes a level, so we poll near-real-time even though the values
     *  themselves rarely move. */
    freshSeconds: 15 * 60,

    /** Serve-stale ceiling. Matched to the ash channel: an alert level is a
     *  standing statement, so an hours-old copy of one is still true. */
    staleSeconds: 6 * 60 * 60,

    /** ==> `sent_utc` IS WHEN THE LEVEL LAST CHANGED, NOT HOW FRESH THE FEED
     *  IS. NOTHING MAY READ IT AS STALENESS. <== Measured 2026-07-30: all
     *  four elevated volcanoes carried `sent_utc` of 2026-07-09, three weeks
     *  earlier, because that is when their levels were last revised. A
     *  freshness check pointed at that field would report a perfectly healthy
     *  feed as three weeks stale, forever. Age of the ALERTS channel is the
     *  age of our fetch; `sent_utc` is content, and useful content — it is
     *  how long a volcano has been at its current level. */
    levelDateIsContentNotFreshness: true,
  }),

  /** Smithsonian GVP Weekly Volcanic Activity Report — global, every
   *  activity type, and the only one of the three that sees a lava-only
   *  eruption. Great Sitkin and Kilauea appear in no ash advisory at all. */
  weekly: Object.freeze({
    /** Fresh window. Published by 2300 UTC each Thursday, so re-asking more
     *  than a few times a day cannot find anything new. */
    freshSeconds: 6 * 60 * 60,

    /** Serve-stale ceiling. Ten days covers one entirely missed issue plus
     *  the report window itself, which already runs up to eight days behind
     *  by design. */
    staleSeconds: 10 * 24 * 60 * 60,
  }),

  /** ==> A DEAD FEED AND AN EMPTY SKY ARE DIFFERENT ANSWERS (SPEC.md §5). <==
   *  Stated as data because three channels each produce all five and the
   *  strings must not be re-derived per surface.
   *
   *  `clear` IS THE COMMON CASE ON THE ASH CHANNEL AND IT IS CORRECT. Most
   *  days there is no ash anywhere on Earth. That is a successful fetch of a
   *  quiet planet, and it must never be rendered with the wording an outage
   *  gets. Anchorage documents its own empty state in prose
   *  (`None issued by this office recently.`); the other eight do not, so the
   *  relay generates `clear` itself — which is exactly why the distinction
   *  has to be explicit rather than inferred from an empty array.
   *
   *  ==> `degraded` IS THE FIFTH STATE AND IT WAS ADDED BECAUSE ITS ABSENCE
   *  HID AN ERUPTION. <== On 2026-07-30 the ash channel reported `ok` while
   *  reading three Wellington bulletin slots — Vanuatu, Tonga and the
   *  Kermadecs, three percent of the planet — because BoM had begun refusing
   *  the relay. Etna erupted at AVIATION COLOUR CODE RED with ash to FL230 and
   *  appeared nowhere in the channel. `ok` was true about the transport and a
   *  lie about the world, and the four states could not tell those apart.
   *
   *  `degraded` means THE FETCH SUCCEEDED AND THE COVERAGE DID NOT. It must be
   *  worded as reduced coverage, never as calm and never as an outage, and the
   *  surface must name what is missing — the payload carries
   *  `coverage.centresUnreachable` for exactly that. An empty result under
   *  `degraded` is NOT `clear`: an empty read of a partial world is a smaller
   *  sky, not a quiet one. */
  state: Object.freeze({
    ok: 'ok',
    degraded: 'degraded',
    stale: 'stale',
    clear: 'clear',
    unavailable: 'unavailable',
  }),

  /** Dedupe key shape. Cross-centre duplication is real — a London advisory
   *  read `RMK: VAAC LONDON IS ISSUING THIS ADVISORY ON BEHALF OF VAAC
   *  TOULOUSE` — so the same eruption arrives twice from two centres. The
   *  key is the GVP number plus the date-time group, NOT the advisory
   *  number: advisory numbers reset per volcano per year (Etna at `2026/1`
   *  the same day Washington was at `2026/430`) and are not an event id. */
  dedupeKey: 'gvpNumber+dtg',

  /**
   * ==> SEVERITY — THREE EQUALLY-WEIGHTED CATALOG CHANNELS, NORMALISED TO
   * 0–1, AND THE RULE FOR WHAT AN ABSENT VALUE MEANS. <== SPEC-GLOBES §42.1.8.
   * Aaron's call 2026-07-30: population exposure is neither the primary
   * ranking key nor dropped — no single channel owns severity on this globe.
   *
   * ==> THIS SCORE RANKS THE QUIET AND IT IS NEVER A FILTER. <== §42.1.1:
   * what is erupting now is drawn regardless of history. Great Sitkin scores
   * 0.240 and is erupting today. Anything that uses this to decide WHETHER a
   * live eruption appears has misread it — it decides how loudly the quiet
   * context around one reads. `lib/volcano-severity.js` is the only
   * implementation; do not re-derive it at a call site.
   *
   * ==> THERE ARE TWO KINDS OF ABSENCE AND ONE TEST TELLS THEM APART. <==
   * The test is whether the volcano has an eruption record at all.
   *
   *   `ec` ABSENT IS A RECORDED ZERO, NOT A GAP. Measured against the shipped
   *   1,196-feature catalog: of the 364 with no `ec`, **zero have a `vei` and
   *   zero have a `last`**. GVP looked and recorded no Holocene eruption, so
   *   the honest substitution is 0 and the floor stops being a special case —
   *   it is simply where zero lands. A midpoint here would invent activity
   *   nobody reported, for 364 volcanoes.
   *
   *   `vei` ABSENT SPLITS ON THE SAME TEST. No `ec` either → the same 364 →
   *   zero explosivity on record. `ec` present → **162 volcanoes** that
   *   erupted and nobody sized it → a genuine unknown → the midpoint.
   *
   *   `pop30` ABSENT IS ALWAYS UNKNOWN — **35 volcanoes** with no published
   *   figure → the midpoint. `pop30 === 0` is a MEASURED zero for 214 more
   *   (correct for an Aleutian island) and must never collapse into the same
   *   value. That is SPEC.md §5's `unavailable` against `clear`, and the
   *   catalog preserves it by omitting the key rather than writing 0.
   *
   * ==> THE MIDPOINT IS EACH CHANNEL'S OWN MEDIAN, NOT A FLAT 0.5. <== A flat
   * 0.5 is only neutral if the normalised distribution happens to centre
   * there, and none of these do — on the normalised scale the medians land at
   * `ec` 0.304, `vei` 0.429, `pop30` 0.550. The median is what "no
   * information" actually means: this volcano sorts mid-pack on this channel
   * and moves nothing. Stated honestly, it is a SMALL decision — it touches
   * 192 volcanoes, changes a score by at most 0.024 out of 1.0, and moves
   * nothing more than 71 places. It is chosen because it costs nothing and
   * explains itself, not because the numbers demanded it.
   *
   * ==> THE TRANSFORM IS PER CHANNEL, AND VEI IS THE TRAP. <== `ec` (1→198,
   * median 4) and `pop30` (0→6,735,396, median 5,725) are both so skewed that
   * a linear scale puts three quarters of the catalog inside the bottom few
   * percent of the range, so both take `log1p`. **`vei` MUST NOT BE LOGGED.**
   * VEI is already a logarithmic scale — every step is ten times the ejecta —
   * so logging it again halves a real 10× difference. It is a small integer
   * that looks harmless and it is the one number here that will be got wrong.
   * Measured: log-against-linear reorders 1,106 of the 1,196 and moves one
   * volcano 518 places, which is roughly seven times the consequence of the
   * midpoint choice above.
   *
   * NO WINSORISING. Etna's 198 eruptions against a p99 of 102 looks like it
   * wants a cap, but after `log1p` p99 already sits at 0.876 — the transform
   * handles the tail, and a cap would be a constant with no measured need.
   *
   * ==> EVERY NUMBER BELOW IS MEASURED FROM
   * `assets/hazards/volcanoes-holocene.geojson` AND ASSERTED AGAINST IT. <==
   * `tools/test-volcano-severity.mjs` recomputes the maxima and the medians
   * from the shipped file and fails if they drift — the same arrangement as
   * the `VOLCANO` mirror in `functions/api/volcano/live.js` and the KV key
   * shapes. **Re-fetch the catalog, re-run that suite.**
   */
  severity: Object.freeze({
    /** Equal thirds, and "equal" means one column each. NOTE that this makes
     *  the composite two-thirds eruption HISTORY and one-third CONSEQUENCE.
     *  Checked before shipping it: `ec` and `vei` are not redundant —
     *  Pearson r on the normalised values is 0.379 over the 670 volcanoes
     *  carrying both, because how OFTEN and how BIG are different questions.
     *  If exposure should ever pull equal weight against history as a
     *  concept rather than as a column, that is 0.25 / 0.25 / 0.50 and it is
     *  a different decision from this one. */
    weights: Object.freeze({ ec: 1 / 3, vei: 1 / 3, pop30: 1 / 3 }),

    channels: Object.freeze({
      /** Confirmed eruptions on record. Present on 832 of 1,196. */
      ec: Object.freeze({
        transform: 'log1p',
        /** Etna. */
        max: 198,
        /** Not used as a midpoint — `ec` has no unknowns, only recorded
         *  zeros. Carried so the drift test has something to assert and so
         *  the skew is legible next to the transform. */
        median: 4,
        /** ==> ABSENT MEANS ZERO, NOT UNKNOWN. See the block comment. <== */
        absent: 'zero',
      }),

      /** Maximum Volcanic Explosivity Index on record. Present on 670. */
      vei: Object.freeze({
        /** ==> NOT `log1p`. VEI IS ALREADY LOGARITHMIC. <== */
        transform: 'linear',
        max: 7,
        /** Median of the 670 measured values. Every volcano carrying a `vei`
         *  also carries an `ec`, so this is the same median either way. */
        median: 3,
        /** Absent resolves on the eruption-record test: zero when there is no
         *  `ec`, the median when there is. The only channel with two cases. */
        absent: 'zero-if-no-eruption-record-else-median',
      }),

      /** People within 30 km. Present on 1,161; 214 of those a measured zero. */
      pop30: Object.freeze({
        transform: 'log1p',
        /** Tatun Volcanic Group, north of Taipei. */
        max: 6735396,
        /** Median of all 1,161 measured values, the 214 zeros included —
         *  they are part of the population an unknown is being placed
         *  against. */
        median: 5725,
        absent: 'median',
      }),
    }),
  }),

  /** The shipped catalog: 1,196 volcanoes with position, type, elevation and
   *  all three severity channels already merged. Position, name and history
   *  come from HERE and never from the live payload, which carries only what
   *  is live and joins on `n`. Not under `marks` because every phase from E to
   *  H reads the same file. */
  catalogUrl: 'assets/hazards/volcanoes-holocene.geojson',

  /** The three-feed union relay. ==> THIS IS A CLOUDFLARE FUNCTION AND IT DOES
   *  NOT EXIST ON A PLAIN STATIC SERVER. <== On a local dev server this 404s,
   *  which is not a bug to work around — it is the `unavailable` path, and it
   *  being exercised on every local refresh is how that path stays honest.
   *  What must never happen is a failed fetch here rendering as a calm globe. */
  liveUrl: '/api/volcano/live',

  /**
   * ==> MARKS — PHASE E. THE FIRST PIXELS THIS LAYER EVER DREW. <==
   * SPEC-GLOBES §42.1.1 (selection) and §42.1.4 (the two sets that are not
   * mountains). These are FLAT SYMBOLS, not the edifices §42.1 describes —
   * Phase F replaces the point cloud with the instanced geometry and these
   * numbers go with it. Marks ship before shapes on purpose: a bad phone
   * screen with both landing together has two causes and no way to separate
   * them.
   */
  marks: Object.freeze({
    /* ---- WHAT IS DRAWN ---------------------------------------------------
     * The draw set is a UNION of two things and it is never an intersection:
     *   1. everything erupting right now, regardless of history
     *   2. the quiet activity tier below, for context
     * §42.1.1 measured 6 of 22 currently-erupting volcanoes falling outside
     * the tier — Ambae, Dukono, Great Sitkin, Ibu, Lewotolok, Sabancaya.
     * Intersecting hides all six, which is SPEC.md §5 with a plausible face.
     */

    /** THE QUIET TIER, AND IT IS AN ACTIVITY RATE RATHER THAN A RECENCY FLAG.
     *  `e19` is the eruption count SINCE 1900 (present on 422 of 1,196), and
     *  `>= 10` selects exactly 128 — re-measured against the shipped catalog
     *  2026-07-30 and matching §42.1.1's shipped column. "Erupted since 1800"
     *  is the 508 figure everyone half-remembers and it is a yes/no: Etna with
     *  147 eruptions and a Chilean cone that popped once in 1847 score the
     *  same on it. */
    tierField: 'e19',
    tierMin: 10,

    /* ---- WHAT COUNTS AS ERUPTING -----------------------------------------
     * Three feeds, three blind spots (functions/api/volcano/_union.js). ANY
     * of these three is enough, because each sees eruptions the others cannot:
     *
     *   report.erupting   the weekly feed's own judgement, decided in the
     *                     relay and not by a regex here. The only channel that
     *                     sees a lava-only eruption — Great Sitkin and Kilauea
     *                     emit no ash and appear in no VAAC traffic anywhere.
     *   ash present       a VAAC advisory that survived the relay's 24-hour
     *                     staleness cut. Ash aloft IS an eruption, and this is
     *                     the only channel fresh enough to catch one that
     *                     started this morning.
     *   alert colour      US observatories only, and see the note below.
     */

    /** ==> AVIATION COLOUR CODES THAT COUNT AS ERUPTING, AND ORANGE IS A
     *  DELIBERATE OVER-INCLUSION. <== ICAO ORANGE means EITHER "eruption
     *  underway with no or minor ash" OR "heightened unrest, eruption likely",
     *  and the payload cannot tell those apart. Including it marks a restless
     *  volcano as erupting; excluding it hides an effusive one that no other
     *  channel happens to be reporting this week. The first error is visible
     *  and self-correcting on screen, the second is silent — so this errs the
     *  way §5 errs. If the erupting count reads inflated on glass, THIS is the
     *  one constant to move, and dropping 'ORANGE' is the whole change. */
    alertColoursErupting: Object.freeze(['ORANGE', 'RED']),

    /* ---- SIZE, IN CSS PIXELS ---------------------------------------------
     * FIXED SCREEN SIZE, NOT PERSPECTIVE-SCALED, and that is the one place
     * these differ from the dot field they sit in. A dot is a piece of a
     * medium and shrinks with distance because the medium does; a mark is a
     * SYMBOL, and a symbol that halves every time you pull back is invisible
     * at the space floor, which is the distance this layer most needs to read
     * from. §42.1.3's "shape grows in with zoom" is about the Phase F
     * edifices and does not apply to a flat pip.
     *
     * NOT TOUCH TARGETS YET. Nothing here is tappable in Phase E, so §DESIGN's
     * 44px floor is not in play. It arrives the moment picking does, and the
     * mark will need a hit area far larger than its ink.
     */

    /** ==> THE QUIET TIER RAMPS ACROSS THIS RANGE BY MODELLED FOOTPRINT NOW,
     *  NOT BY SEVERITY SCORE. AARON'S CALL 2026-07-30. <== A dot sized by
     *  footprint is TRUE information about the volcano under it; a dot sized by
     *  a severity score was a proxy invented because a dot had nothing better
     *  to say. Severity did not vanish with it — it lives in `glowPad` and
     *  `glowOpacity` below, in a channel that does not collide with size.
     *
     *  ==> THIS IS NOT A FOOTPRINT SCALE AND IT IS NOT `inflate` COMING BACK.
     *  <== `inflate` stretched GEOMETRY to hit a pixel target, which is what
     *  put Mauna Loa across the Big Island and what killed `fill-extrusion`
     *  before it. Nothing here touches geometry. These are the bounds of a
     *  SYMBOL, and a symbol has to be legible at a size that has nothing to do
     *  with how many metres it stands for — at the space floor one pixel is
     *  about 30 km, so true scale would draw the entire drawn set as nothing.
     *  What the ramp preserves is RANK: a bigger volcano gets a bigger dot,
     *  every time, at every zoom. */
    quietMinPx: 3.5,
    quietMaxPx: 7,
    /** Erupting is FIXED and above the quiet ceiling, because the live set is
     *  not ranked by history — §42.1.1's rule that live state outranks history
     *  everywhere the two disagree. Great Sitkin scores 0.240 and is erupting;
     *  sizing it below an idle Etna would be that rule inverted. It ignores
     *  footprint for the same reason it used to ignore severity: "which of
     *  these is going off right now" is the one question the mark must answer
     *  before any other, and a live lava dome is not less urgent than a live
     *  shield because it is smaller. */
    eruptingPx: 10,

    /** ==> THE FOOTPRINT RANGE THE QUIET RAMP SPANS, IN METRES OF MODELLED
     *  BASE DIAMETER, ON A LOG SCALE. <== Measured across the shipped catalog's
     *  1,024 drawable volcanoes: 1.0 km at the smallest, 2.7 at the 5th
     *  percentile, 17.1 at the median, 36.0 at the 95th and 108.0 for Mauna
     *  Loa. That is a hundred to one, so a linear ramp would put nine tenths of
     *  the set inside the bottom fifth of the pixel range and every dot would
     *  look the same. Log spreads it: the median lands at 0.69 of the ramp and
     *  the quartiles are visibly apart.
     *
     *  Both ends are clamps rather than limits — Mauna Loa is simply at 1.0 and
     *  a 1 km tuff cone is at 0. Widening them flattens the ramp; narrowing
     *  them saturates it. Read by `markSizeRank()` in
     *  `lib/volcano-dimensions.js`, which both the pips and the MapLibre
     *  circles call, so the two rungs of the ladder cannot rank the same
     *  volcano differently in the band where both are drawn. */
    sizeSpanM: Object.freeze([2000, 45000]),

    /** Where the hole starts in a submarine mark, as a fraction of its radius.
     *  §42.1.4: 110 volcanoes sit below sea level and a cone sticking out of
     *  the Pacific for a seamount 1,800 m down is simply false. A hollow ring
     *  is the cheapest honest treatment that is not a mountain, and it
     *  pre-figures the Phase G dimple rather than fighting it. Ahyi is
     *  erupting 55 m under water TODAY, so this is exercised from day one. */
    submarineRingInner: 0.56,

    /* ---- COLOUR ----------------------------------------------------------
     * COOL FOR QUIET, HOT FOR LIVE, AND COLOUR IS NOT THE ONLY SIGNAL — size
     * and opacity carry it too, so the pair survives being desaturated.
     */

    /** COOL CYAN, AND IT IS FREE ON THIS WORLD FOR TWO REASONS. Deep's own
     *  furniture is ultraviolet (the dot field, the land sheet) and its seams
     *  are magma orange; cyan collides with neither. And the cyan that USED to
     *  be on this globe was the coastline, which moved to orchid `#DB8EF0`
     *  when the world got its own palette — so the hue is vacant rather than
     *  borrowed. Critically, this must NOT be `DEEP.colors.dot`: 128 volcano
     *  pips in the dot field's own white are 128 pips nobody can find among
     *  90,000 dots. */
    quietColor: VOLCANO_QUIET,

    /** SATURATED GOLD, AND THE FIRST VERSION FAILED ON GLASS BY BEING TOO
     *  CAREFUL. It shipped as `#FFE9A8` — a pale cream chosen to sit off the
     *  end of the USGS MMI ramp the way `DEEP_WORLD.plates.hot` does. Reported
     *  on a phone as "white": against this world's near-white dot field at
     *  `#ECE4F8`, a desaturated cream is not a second colour, it is the same
     *  colour.
     *
     *  ==> THE MMI RAMP WAS THE WRONG CONSTRAINT TO OPTIMISE AGAINST. <==
     *  Nothing on this world draws one — §43.2 already settled that quake
     *  severity here is size and ripple strength, NEVER hue.
     *
     *  MEASURED, and the failure is in SATURATION rather than hue. The old
     *  cream was hue 45° at saturation 0.34 and luminance 0.824; the dot field
     *  is luminance 0.801. **That is 1.03:1 — the same brightness as the white
     *  dots, which is why it read as one of them.** This is 0.76 saturation at
     *  luminance 0.615. Against a near-neutral field the separating channel is
     *  saturation, not lightness, and the first version had none to spend.
     *
     *  The collision that IS real is the magma seam a volcano physically
     *  stands on, and that one is hue: seam core `#FF7A1A` is hue 25°, this is
     *  42°. 17° apart at full saturation reads where two pale tints never
     *  could. It also stops fighting the cyan tier at hue 190° — gold against
     *  cyan is a clean opposition, cream against cyan is a smudge.
     *
     *  ==> IF THIS EVER NEEDS TO MOVE, MOVE THE HUE AND KEEP THE SATURATION.
     *  <== Going pale again is exactly how it disappeared the first time. */
    eruptingColor: VOLCANO_LIVE,

    /** The quiet tier is context and recedes; the live set does not. */
    quietOpacity: 0.72,
    eruptingOpacity: 1,

    /** How much of the far hemisphere shows through the glass. Matched to
     *  `DEEP.farSideFade` by eye rather than imported, because this layer has
     *  to be able to sit on a world that has no glass at all. */
    farSideFade: 0.15,

    /** ==> SEVERITY IS A GLOW NOW. AARON'S CALL 2026-07-31, AND IT REPLACES
     *  THE LIGHTNESS RAMP RATHER THAN JOINING IT. <== Lightness shipped and
     *  FAILED ON GLASS: it ran one cyan from lightness 0.45 to 0.73 at 0.64
     *  saturation, and on a 3.5–7 px dot already drawn at `quietOpacity` 0.72
     *  the ranking was invisible on a phone. That was the risk stated when
     *  severity moved off radius, and it fired. The dim hex is deleted rather
     *  than left for a future pass to find and wonder about.
     *
     *  ==> WHY A GLOW WHEN A STROKE RING WAS THE WRITTEN FALLBACK. <== The
     *  fallback could not be taken: a hollow ring already means SUBMARINE on
     *  both rungs (`submarineRingInner`), so a second ring would put two
     *  unrelated facts in one shape. A glow adds ink OUTSIDE the mark instead
     *  of redistributing ink inside it, which is the only channel left that a
     *  4 px dot has room for — and it does it without claiming the volcano is
     *  bigger, which is `circle-radius`'s job and is why size could not take
     *  severity back.
     *
     *  ==> THE HALO IS NOT PART OF THE MARK AND MUST NOT READ AS ONE. <== It
     *  is drawn strictly outside the mark's own edge and multiplied by
     *  `1 - core`, so it can never brighten the dot's centre and turn a
     *  ranking channel into an apparent size change. If a glowing dot starts
     *  reading as a LARGER dot, this number is too high, not the pixel ramp.
     *
     *  ==> ERUPTING PINS AT FULL GLOW AND DOES NOT RANK. <== §42.1.1: live
     *  state outranks history everywhere the two disagree, so the gold set
     *  carries the maximum halo rather than a score from the catalog. It is
     *  also the cheapest honest answer to the open question of whether an
     *  erupting volcano reads as LIVE — a standing glow is not a pulse and
     *  costs no frames, so it does not step on the Phase H plume. */

    /** How far the halo reaches past the mark's own edge, as a multiple of the
     *  mark's radius, at full severity. 1.6 means the brightest quiet dot
     *  paints into a sprite 2.6x its own width. Below about 1.2 the halo is
     *  inside the mark's own soft edge and invisible; much above 2 and a dense
     *  arc turns into one continuous smear. */
    glowPad: 1.6,

    /** Peak halo alpha, at the mark's edge, before the far-side and layer
     *  fades. Deliberately under half `quietOpacity` — the halo is the
     *  quietest thing on the layer and its job is to be COUNTABLE at a glance,
     *  not legible on its own. */
    glowOpacity: 0.30,
  }),

  /**
   * ==> SHAPES — PHASE F. REAL GEOMETRY, IN GLOBE RADII, NOT SCREEN PIXELS.
   * <== SPEC-GLOBES §42.1.2 and §42.1.3. Five edifice families out of one
   * lathe geometry, bent per instance in the vertex shader; `field` is the
   * sixth family and it is deliberately not here, because it is not a
   * mountain and the mesh never draws one (§42.1.4).
   *
   * ==> THE MARKS DO NOT GO AWAY, AND THAT IS §42.1.3 RATHER THAN CAUTION.
   * <== A true-scale volcano is sub-pixel on this globe and an exaggerated one
   * is still only a couple of pixels at the space floor, where 1 px is about
   * 30 km. So the flat pip IS the from-space read and the edifice grows out of
   * it during the dive, which also converts §42.1.2's collision problem —
   * 135 legible silhouettes crowding Java, Japan and Kamchatka — into a
   * reveal: a ridge of merged peaks separating as you descend.
   *
   * ==> AND MOST OF WHAT YOU SEE IS SEEN FROM STRAIGHT ABOVE, WHICH NO
   * RENDERING CHOICE FIXES. <== On a sphere only a ring near the limb shows a
   * profile at all; the middle of the disc is looking down a volcano's throat.
   * Real geometry buys a planet whose EDGE goes lumpy as you descend, not a
   * legend you can read shapes off. That was Aaron's call 2026-07-30, made
   * knowingly: this world's argument is that it is a planet rather than a
   * diagram. Telling the six types apart is picking's job, not silhouette's.
   * If it needs walking back, the fallback is leaning the geometry toward the
   * camera — one number — rather than a rebuild.
   */
  shapes: Object.freeze({
    /** How tall the tallest volcano stands, in globe radii.
     *
     *  0.018 radii is about 115 km, which is absurd and is the point (§42.1.2:
     *  a true stratovolcano is one twentieth of a pixel here). The reference
     *  is the shipped globe's `DIVE.baseLump` — 0.012 radii, the established
     *  "reads as relief at this scale" number — taken 1.5x, because that lump
     *  is the cage's IDLE unevenness and a volcano has to read as a mountain
     *  rather than as noise. It is a look number and it is the first one to
     *  move if the planet reads spiky or flat. */
    maxHeight: 0.018,

    /* ---- THE EXAGGERATION CURVE (§42.1.3) --------------------------------
     * A SINGLE MULTIPLIER CANNOT SATISFY BOTH ENDS. At whatever factor makes
     * the 6,879 m outlier land at a sane height, the median volcano is
     * invisible. So this is the same shape the storm cage uses for wind —
     * `DIVE.sevFloorKt` / `sevPeakKt` / `sevMinLift` / `sevCurve` — with
     * elevations in place of knots. A floor so the median is visible, a
     * ceiling so the outlier is not a needle, a curve between:
     *
     *   lift = minLift + (1 - minLift) * t^curve
     *
     * ==> `elev` IS HEIGHT ABOVE SEA, NOT ABOVE THE VOLCANO'S OWN BASE, AND
     * THE CATALOG HAS NOTHING BETTER. <== Ojos del Salado reads 6,879 m
     * because it stands on a 4,000 m plateau. §42.1.2 records that baking DEM
     * footprints is rejected — hundreds of KB to render a difference nobody
     * can see — so this is knowingly the wrong quantity, used because it is
     * the only one there is and it ranks correctly far more often than not.
     */

    /** Measured against the shipped catalog 2026-07-30: the 5th percentile of
     *  the above-sea quiet tier is 354 m, so a floor here puts essentially the
     *  whole drawn set above the noise. */
    elevFloorM: 300,
    /** The tier's 95th percentile is 4,650 m and its tallest is 5,911 m; the
     *  full catalog reaches 6,879 m. Everything above this lands at full
     *  height together, which is the ceiling doing its job — the difference
     *  between the tallest and the third-tallest is not information anyone
     *  needs at this size. */
    elevPeakM: 5000,
    /** The smallest edifice still stands this fraction of full height. Same
     *  value as `DIVE.sevMinLift` and for the same reason: below it a real
     *  mountain reads as flat ground, which is SPEC.md §5 in visual form. */
    minLift: 0.16,
    /** Square root, same as `DIVE.sevCurve`. A perceptual boost that keeps
     *  rank order while lifting the crowded bottom of the range off the
     *  floor. */
    curve: 0.5,

    /* ---- WHEN THE SHAPE ARRIVES -------------------------------------------
     * In DIVE PHASE, the same 0-to-1 the fade bands use: 0 at the space floor
     * (`DIVE.zSpace`, z2.0), 1 where MapLibre owns the screen (`zHandoff`,
     * z5.0). The marks themselves leave on the node band, [0.14, 0.60].
     */

    /** Pips cross-fade to edifices across this band. Ends at p 0.18 — about
     *  z2.54 — which is comfortably before the node band's fade-out bites, so
     *  there is a real window of mountains rather than a shape that arrives
     *  just in time to disappear. Start at 0.0 rather than a little later on
     *  purpose: the space floor is exactly where 135 silhouettes would collide,
     *  and the pip is what has already been confirmed on a phone there. */
    shapeIn: Object.freeze([0.0, 0.18]),

    /** How lit the unlit face of a volcano still is. The light is fixed in
     *  VIEW space on this world (the planet turns under it — see `DEEP.lightDir`
     *  and the land sheet's shading), so a volcano's shading sweeps as it comes
     *  round the limb. At 0 the dark side is black and a mountain in shadow
     *  disappears, which on a translucent world reads as a hole. */
    ambient: 0.45,

    /* ---- THE FIVE EDIFICE FAMILIES ---------------------------------------
     * ==> RANK ORDER IS TRUE AND ABSOLUTE PROPORTION IS NOT (§42.1.2). <== A
     * shield is ALWAYS flatter than a cone. No shape here is the real shape of
     * a real mountain: real ratios are 1:5 and 1:20 and both read as a dot at
     * 3 px, so these are spread apart from reality until they separate.
     *
     *   ratio     BASE RADIUS as a multiple of height, so the full width on
     *             screen is twice this. Bigger = flatter. Rank order across the
     *             five is the one thing here that is true.
     *   flankPow  how the flank falls away. 1 is straight-sided, below 1
     *             bulges outward (round-shouldered), above 1 hollows inward.
     *   heightPow how height accumulates up the profile. 1 is a straight cone,
     *             above 1 is a broad skirt rising late, below 1 a fast rise.
     *   topR      radius of the summit as a fraction of the base. 0 is a
     *             point; a caldera needs a rim to notch.
     *   rim       where up the profile the rim sits, 0..1. 1 means no crater.
     *   notch     how far the crater floor drops below the rim, as a fraction
     *             of full height. Only the caldera has one.
     *   elongate  long-axis stretch. Only the fissure has one.
     *   narrow    short-axis squeeze, applied with `elongate`.
     *
     * ==> THE FISSURE'S LONG AXIS RUNS LOCAL EAST-WEST AND THAT IS NOT THE
     * RIFT. <== §42.1.2 says "aligned to the rift" and the catalog publishes
     * no bearing for one — no strike, no trend, nothing. Rather than invent a
     * direction per volcano, every fissure lies the same way and the shape
     * carries "this is a line of vents, not a cone" without claiming to know
     * which line. A per-volcano bearing needs a source, not a guess.
     */
    families: Object.freeze({
      /** The steep stratovolcano — 86 of the 128 quiet tier, so this is the
       *  one that decides whether the layer looks right. Slightly hollowed
       *  flanks (`flankPow` above 1) because a real stratovolcano is concave
       *  and a straight-sided cone reads as a party hat. */
      cone: Object.freeze({
        ratio: 1.2,
        flankPow: 1.25,
        heightPow: 1.0,
        topR: 0.04,
        rim: 1.0,
        notch: 0,
        elongate: 1,
        narrow: 1,
      }),
      /** Squat and round-shouldered. `flankPow` below 1 is what bulges it. */
      dome: Object.freeze({
        ratio: 1.6,
        flankPow: 0.62,
        heightPow: 0.72,
        topR: 0.06,
        rim: 1.0,
        notch: 0,
        elongate: 1,
        narrow: 1,
      }),
      /** Broad and low. The skirt is the whole read, so height accumulates
       *  late (`heightPow` above 1) — a shield that rises straight from the
       *  base is just a wide cone. */
      shield: Object.freeze({
        ratio: 4.0,
        flankPow: 1.0,
        heightPow: 1.7,
        topR: 0.1,
        rim: 1.0,
        notch: 0,
        elongate: 1,
        narrow: 1,
      }),
      /** The one family defined by what is MISSING from the top. A wide rim
       *  at 78% of the way up, then the profile turns inward and drops. The
       *  notch is deliberately deep enough to survive being 10 px tall. */
      caldera: Object.freeze({
        ratio: 2.2,
        flankPow: 1.15,
        heightPow: 1.1,
        topR: 0.55,
        rim: 0.78,
        notch: 0.42,
        elongate: 1,
        narrow: 1,
      }),
      /** A line of vents drawn as a ridge. Low, long, and thin across — the
       *  narrow axis is what stops it reading as a shield seen off-centre.
       *
       *  ==> THE RATIO IS SMALL BECAUSE `elongate` COMPOUNDS WITH IT. <== At
       *  the cone's own 2.4 the long axis came out 0.24 radii — about 1,500 km
       *  and a quarter of the way across the visible planet, which is a scar
       *  rather than a volcano. Measured on the CPU before it reached a phone;
       *  1.4 x 2.8 lands a fissure at roughly a shield's footprint end to end
       *  and a few pixels across, which is what a line of vents should look
       *  like. */
      fissure: Object.freeze({
        ratio: 1.4,
        flankPow: 1.0,
        heightPow: 1.2,
        topR: 0.12,
        rim: 1.0,
        notch: 0,
        elongate: 2.8,
        narrow: 0.42,
      }),
    }),

    /** Segments around the axis and up the profile. 16 x 8 is 256 triangles
     *  per volcano — 135 of them is 34,000 triangles in ONE draw call, which
     *  is nothing on any phone this app runs on. §42.1 is explicit that cost
     *  is not the constraint here and must not be used as an argument; these
     *  are set by where the silhouette stops getting smoother, and past 16
     *  around it does not. */
    radialSegments: 16,
    profileSegments: 8,
  }),

  /**
   * ==> THE MAP'S OWN FLAT MARK. IT IS A BRIDGE NOW, NOT A DESTINATION. <==
   *
   * **THE THREE RENDERER STOPS DEAD AT `DIVE.zHandoff`.** `proto/shell.js`
   * clears the canvas and returns at dive phase 1, and the volcano layer fades
   * out earlier still, with the dots, around z3.8. Volcanoes that vanish
   * exactly as you get close enough to see them is backwards, so MapLibre
   * carries the same marks from z2.4.
   *
   * ==> AND THE MARK NOW HANDS OFF AGAIN, TO REAL GEOMETRY. <== `map3d` below
   * draws true-scale mountains from `map3d.handoff` upward, and the circle
   * fades out underneath them. Aaron's call 2026-07-30: a dot and a mountain
   * for the same volcano at the same time is two marks for one thing.
   *
   * ==> TWO SETS KEEP THEIR CIRCLE FOREVER, AND THAT IS §42.1.4 MEETING §5.
   * <== Submarine volcanoes and volcanic fields never get an edifice, because
   * a cone for a seamount 1,800 m down or for "West Eifel Volcanic Field" is a
   * fabrication. Letting their circle fade out with everyone else's would
   * delete them from the map entirely, which is the silence rule. So the
   * fade-out below is conditional on being a mountain.
   */
  mapMarks: Object.freeze({
    /* ---- THE ZOOM LADDER --------------------------------------------------
     * The bands OVERLAP on purpose: a hard switch between two ways of drawing
     * the same volcano is a pop, and the plate seams already taught this
     * project that once.
     *
     *   Three pips + limb silhouettes   z2.0 → z3.8   (the node band)
     *   MapLibre circles                z2.4 → z7.8   (mountains, then out)
     *   MapLibre circles                z2.4 → up     (submarine and fields)
     *   Real geometry                   z7.0 → up     (mountains only)
     */
    /** Fades in under the Three pips it is taking over from. */
    circleIn: Object.freeze([2.4, 3.4]),

    /** Circle radius in screen pixels, ramped by modelled FOOTPRINT the same
     *  way the Three pips are — same `marks.sizeSpanM`, same log curve, same
     *  `markSizeRank()`. A little larger than the pips, because a circle on a
     *  basemap competes with labels and roads rather than with empty glass.
     *
     *  ==> THE TWO RUNGS MUST RANK A VOLCANO THE SAME WAY, BECAUSE BOTH ARE ON
     *  SCREEN AT ONCE FROM z2.4 TO z3.8. <== One ranking by footprint and one
     *  by severity across that overlap would show the same volcano as two
     *  different sizes at the same moment. */
    circleMinPx: 4,
    circleMaxPx: 9,
    /** Erupting is FIXED and ignores footprint, for the reason
     *  `marks.eruptingPx` states: live state outranks everything the catalog
     *  remembers, including how big the mountain is. */
    circleEruptingPx: 11,

    /** ==> THE GLOW IS A SECOND CIRCLE LAYER UNDERNEATH, NOT `circle-blur` ON
     *  THIS ONE. <== `circle-blur` softens the WHOLE circle including its
     *  core, so ranking with it would turn the high-severity dots into the
     *  fuzzy ones — a mark that is harder to locate the more it matters. A
     *  separate blurred circle beneath the crisp one adds a halo and leaves
     *  the dot alone, which is the same statement the pip shader makes in
     *  MapLibre's vocabulary. Same reason `marks.glowPad` exists there.
     *
     *  Both rungs read severity through the SAME 0..1 `sev`, so a volcano
     *  cannot glow harder as a pip than as a circle in the z2.4–3.8 band where
     *  both are drawn — the identical rule `circleMinPx` states for size. */

    /** Halo radius as a multiple of the mark's own radius, at full severity.
     *  Matches `marks.glowPad` in meaning; it is a separate number because a
     *  circle on a basemap competes with labels and roads, and the pips do
     *  not. */
    glowPad: 1.5,
    glowOpacity: 0.28,
    /** MapLibre's blur is a fraction of the circle's own radius. 1 puts the
     *  falloff across the entire halo, which is what makes it a glow rather
     *  than a soft-edged second dot. */
    glowBlur: 1,
  }),

  /**
   * ==> REAL MOUNTAINS AT MAP ZOOM (SPEC-GLOBES §42.1.4b). <==
   *
   * **WHAT KILLED THE LAST ATTEMPT AND WHY IT CANNOT HAPPEN HERE.**
   * `fill-extrusion` was rejected on glass 2026-07-30 for two reasons. The
   * first — no pitch, so it drew flat — was never a property of the technique,
   * it was a missing feature, and `tilt` below is that feature. The second was
   * that a geographic footprint cannot be a screen-constant icon: sized to
   * read at z6, Masaya's caldera spanned Managua to Granada at z10.
   *
   * **THAT SECOND ONE IS ANSWERED BY MAKING THE FOOTPRINT TRUE.** A real
   * footprint is correct at every zoom by definition — it cannot blow up,
   * because it is not being stretched to hit a pixel target. Masaya's caldera
   * comes out about 10 km across here, which is what it is. What a true
   * footprint DOES do is go small at low zoom, and that is what `inflate`
   * below manages and what the circle covers underneath.
   *
   * ==> HORIZONTAL IS TRUE. VERTICAL IS EXAGGERATED, ON PURPOSE, AND SAYING SO
   * IS THE POINT. <== A real stratovolcano is about 4.5 times wider than it is
   * tall, so at any tilt a truthful Fuji rises about a fifth of its own width
   * and reads as a low swell rather than a mountain. Vertical exaggeration is
   * the oldest convention in relief mapping and every 3D globe with dramatic
   * volcanoes on it is using some. Horizontal exaggeration is the one that put
   * a caldera across a country, and there is none here.
   */
  map3d: Object.freeze({
    /* ---- THE HANDOFF ------------------------------------------------------ */

    /** Circle out, mountains in. Overlapping, like every other handoff in this
     *  project — the two are cross-faded across this band rather than switched.
     *
     *  ==> IT STARTS AT `TILT.flatten`'s FAR END, NOT AT `DIVE.zHandoff`, AND
     *  THAT IS A COORDINATE-SYSTEM CONSTRAINT RATHER THAN A LOOK CALL. <==
     *  MapLibre is still part-way through its globe→mercator blend until
     *  z5.4, and while it is, the basemap under a mountain is on a curve the
     *  mountain is not — the geometry would sit visibly off its own volcano.
     *  It used to start at z5.0, which put the first 0.4 of the band inside
     *  that blend. The circle covers the difference, because the fade-out
     *  below reads THIS constant. */
    handoff: Object.freeze([7.0, 7.8]),

    /* ---- SIZE --------------------------------------------------------------
     * ==> THERE IS EXACTLY ONE MULTIPLIER HERE NOW, IT IS ABOUT HEIGHT, AND
     * ANYTHING THAT SCALES A FOOTPRINT MUST NOT COME BACK. <==
     *
     * `inflate` was a uniform 5x zoom-driven scale, decaying to true scale by
     * z9.5, whose job was making a distant volcano big enough to see at the
     * moment it appeared. It was deleted 2026-07-30 and the handoff moved from
     * z5.4 up to z7.0 in its place. Three things killed it:
     *
     * 1. IT LOOKED WRONG, AND HAWAII PROVED IT. Mauna Loa's true footprint is
     *    about 100 km across and the Big Island is about 130 — drawn true, the
     *    mountain very nearly IS the island, because it very nearly is. At 5x
     *    it was a grey oval several times the island's width with Hawaii
     *    floating inside it.
     * 2. IT CAUSED THE INTERPENETRATION. Clustering asks whether TRUE
     *    footprints touch, while the screen drew them five times wider. So the
     *    pairs that visibly collided were exactly the pairs the merge decided
     *    were not neighbours, and two solid cones sitting inside each other
     *    produce a depth-buffer seam that MOVES AS THE CAMERA MOVES — reported
     *    on glass as different parts being clipped from different angles.
     * 3. IT IS THE THING THAT KILLED `fill-extrusion`. §42.1.4a's whole
     *    argument is that a footprint sized to hit a pixel target is a lie
     *    that gets worse as you zoom. A decaying lie is still a lie while it
     *    decays.
     *
     * The honest version: do not draw a mountain until true scale is big
     * enough to read, and let the dots carry the band below that — which is
     * what the dots are FOR. Measured across the drawn set at true scale, a
     * median volcano is 12 px across at z5.4, 21 px at z6.2 and 36 px at z7.0.
     * Hence 7.0. The circle fade-out reads `handoff` directly, so moving this
     * one number extends the dots to meet it.
     *
     * The cost is honest and small: mountains arrive about a zoom and a half
     * later, dots last that much longer. `tools/test-volcano-map3d.mjs`
     * asserts that no horizontal scale factor exists on this object at all. */

    /** Height-only exaggeration, held at every zoom.
     *
     *  ==> 2.5 WAS A PANCAKE AT EVERY ZOOM AND THAT WAS ARITHMETIC, NOT TASTE.
     *  <== Seen from a camera tilted `TILT.maxDeg` off vertical, a cone's own
     *  circular base projects to an ellipse, and the summit only rises clear
     *  of that ellipse when `height / baseRadius > 1 / tan(tilt)`. For a cone
     *  that ratio is `vertical / families.cone.ratio`. At 2.5 over 4.5 it was
     *  0.556 against a bar of 0.700 at 55° — below it, so the summit never
     *  cleared its own footprint and every volcano read as a disc with a bump
     *  on it, at every zoom, forever. 4.0 over 4.5 is 0.889 against 0.577 at
     *  60°. `tools/test-volcano-map3d.mjs` asserts the INEQUALITY rather than
     *  either number, so moving one on glass cannot silently re-break it.
     *
     *  Above ~4 a cone starts to look like a spire, so this is at the top of
     *  its useful range and the domes are the thing to watch — their ratio is
     *  2.0, which puts them at twice as tall as they are wide. A shield stays
     *  below the bar at 0.333 and that is CORRECT: a shield is a swell.
     *  THIS IS STILL THE FIRST NUMBER TO MOVE ON GLASS. */
    vertical: 4.0,

    /** Modelled relief floor in metres, so a 90 m tuff cone is small rather
     *  than absent. Not a visibility fudge — below this the mark is doing the
     *  work anyway. */
    reliefFloor: 250,

    /* ---- UNDER THE WATER ---------------------------------------------------
     * ==> 105 SUBMARINE VOLCANOES GET REAL GEOMETRY NOW, AND THIS REVERSES A
     * RULE THAT WAS ASSERTED. <== §42.1.4 said a cone sticking out of the
     * Pacific for a seamount 1,800 m down is simply false, and it was right —
     * but the conclusion it drew, that seamounts can never be mountains, was
     * only true while there was no way to draw the sea. Aaron's call
     * 2026-07-30: build the seamount exactly like a land volcano and then draw
     * the surface of the water over the top of it. VOLCANIC FIELDS still keep
     * their flat mark forever; a field is not one mountain and never becomes
     * one, so half of §42.1.4 stands unchanged.
     */

    /** ==> THE MODELLED SEAFLOOR, IN METRES BELOW SEA LEVEL, AND IT IS THE
     *  SAME CLASS OF APPROXIMATION AS `reliefCap`. <== The catalog gives a
     *  seamount's SUMMIT depth and nothing else — no basal depth, no
     *  prominence, no bathymetry. So relief is modelled as `this − |elev|`:
     *  every seamount is taken to rise from one flat seafloor at this depth,
     *  which makes a shallow summit a tall mountain and a deep one a low rise.
     *  That is monotonic and it is the right order, and it is not a
     *  measurement.
     *
     *  3,000 m rather than the ~3,700 m global mean, because these are arc and
     *  ridge volcanoes rather than abyssal-plain ones and the crust under them
     *  is shallower. Measured against the shipped catalog: at 3,000 the median
     *  seamount models 22.5 km across against a median LAND volcano's 16.6,
     *  which is the right relationship — seamounts really are bigger. At 4,000
     *  the median jumps to 31.5 km, which is the cone family's relief cap, i.e.
     *  most of the set pinned at the ceiling and no ranking left between them.
     *
     *  A summit deeper than this floors at `reliefFloor` and models as a low
     *  bump. That is the honest answer for a volcano we are told nothing about
     *  except that its top is 5 km down. The real fix is a bathymetric lookup,
     *  which this layer does not do. */
    submarineFloorM: 3000,

    /** ==> THE SEA MOVES, AND IT IS THE ONE THING ON THIS LAYER THAT COSTS
     *  FRAMES. <== It shipped static and was judged on glass 2026-07-31:
     *  Aaron's call is a wider sheet with wave motion. That reverses the
     *  earlier "static is the whole point", which was an argument for judging
     *  the cheap version FIRST, not a finding that motion was wrong.
     *
     *  ==> IT IS A VERTEX SHADER, NOT PER-FRAME CPU REWRITES, AND THAT IS THE
     *  ONE PLACE THIS LAYER HAS A SHADER. <== Every other colour here is baked
     *  into vertex colours on the CPU because it is computed ONCE per field.
     *  A wave is computed every frame, so baking it means rewriting and
     *  re-uploading thousands of vertices per frame on a phone. The GPU does
     *  the same arithmetic for nothing. The convention this steps outside of
     *  was about not needing a shader to COLOUR a mountain; it was never a ban.
     *
     *  ==> AND IT MAKES A RESTING WORLD DRAW CONTINUOUSLY, WHICH IS A REAL
     *  COST NOBODY HAS MEASURED. <== A MapLibre custom layer only renders when
     *  MapLibre renders, so motion here means calling `triggerRepaint()` every
     *  frame — a FULL map repaint, tiles and layers and all, for a ripple.
     *  `proto/shell.js` names moving water specifically as the thing that
     *  should wait on that measurement. Aaron chose to build first and measure
     *  on glass. So the repaint is gated as tightly as it can be — visible
     *  layer, non-zero fade, at least one sheet actually built — and the
     *  `V3D` readout reports when it is running, so the cost is never
     *  invisible. If the phone gets warm, `wave.steepness: 0` turns the
     *  motion and the repaint off together without removing the sea. */
    water: Object.freeze({
      /** ==> IT WAS CYAN #153F47 UNTIL 2026-07-31, AND THE REASON IT WAS CYAN
       *  HAD ALREADY BEEN DELETED. <== The old note said "same hue as the
       *  volcano cyan". There is no volcano cyan any more — a quiet volcano
       *  wears the coastline's orchid `#DB8EF0` and a live one wears the plate
       *  seam's magma `#FF7A1A`. The sea was the last thing on this world still
       *  pointing at a palette that had been replaced, which is why it read as
       *  a teal wash laid over a violet planet.
       *
       *  ==> MEASURED, NOT PICKED. <== Every colour on Deep sits between hue
       *  260° (the ocean) and 287° (the coast glow). The old sea sat at 190° —
       *  seventy degrees outside the family, and the only thing on the globe
       *  that was. It was also THREE TIMES the luminance of the land it covered
       *  (0.0417 against 0.0146), because cyan carries far more perceived
       *  brightness than violet at the same nominal lightness. That is what
       *  made islands look like they were UNDER the water rather than standing
       *  out of it.
       *
       *  This value is hue 249° — a touch bluer than the land's 265°, which is
       *  the whole separation between sea and land inside one family — at
       *  luminance 0.0189. Composited at `opacity` over the world's own painted
       *  ocean it lands at 0.0122, just below the land's 0.0146. So the sea is
       *  a surface you can see is there, the islands read as raised, and the
       *  sheet stops fighting MapLibre's own ocean underneath it. */
      color: '#241A5C',
      opacity: 0.55,

      /** ==> CLIPPED TO THE SEAMOUNT'S OWN FOOTPRINT, NOT DRAWN ACROSS THE
       *  VIEWPORT. AARON'S CALL 2026-07-30. <== A viewport-wide ocean plane is
       *  a much larger feature: it has to depth-sort against every land
       *  mountain, and it lies on top of MapLibre's own water polygons, which
       *  is two renderers drawing one ocean at two opacities — the same
       *  composite fault already open on the plate lines and the land handoff.
       *
       *  What makes a clipped plane read as water rather than as a puddle is
       *  that it has no rim: alpha ramps to nothing over this fraction of the
       *  REACH, so the sea fades out instead of ending.
       *
       *  ==> IT IS A FRACTION OF THE RADIUS BUT IT IS SEEN AS AN AREA, AND AT
       *  0.30 THAT WAS HALF THE SHEET. <== A ramp over the outer 30% of the
       *  radius covers 51% of the disc's AREA — so more than half of what you
       *  actually looked at was gradient, which on glass reads as a teal haze
       *  rather than as water with a surface. Measured against the shipped
       *  catalog at the old `spread` of 3: a median reach of 55 km put a 17 km
       *  wide soft ring around every seamount.
       *
       *  0.15 over `spread` 2 is a 5.6 km rim on a 37 km reach — 28% of the
       *  area, which is a defined surface that still does not end in a line.
       *  ==> IT NO LONGER MATCHES `ridge.edgeFade` AND THAT IS DELIBERATE. <==
       *  A mountain's silhouette wants a soft foot; a water surface wants an
       *  edge you can see. They were the same number by inheritance, not by
       *  argument. */
      edgeFade: 0.15,

      /** ==> HOW FAR THE SEA REACHES PAST THE SEAMOUNT, AS A MULTIPLE OF ITS
       *  BASE RADIUS. AARON'S CALL 2026-07-31: TWO. <== At 1.0 the sheet ended
       *  exactly where the mountain did, and a sea the same size as the thing
       *  under it reads as a lid rather than as water — the "puddle" failure
       *  this block's `edgeFade` was already fighting, and the fade alone did
       *  not win it.
       *
       *  ==> THREE OVERSHOT, AND IT OVERSHOT IN AREA RATHER THAN IN WIDTH.
       *  <== Doubling a reach quadruples what is painted. At 3 the median sheet
       *  was 110 km across with a 19 km mountain in the middle of it, so the
       *  sea stopped being a surface around a seamount and became a wash with
       *  something under it. 2 is a 75 km sheet, which still reads as water
       *  rather than as a lid and covers 44% of the pixels.
       *
       *  It also shrinks the shore problem below without solving it: the sheets
       *  that reach a coast reach it by less. `spread` is NOT the fix for that
       *  — see `SPEC-GLOBES.md` §42.1.4c — and must not be tuned as if it were.
       *
       *  ==> IT IS WHY THE WATER NEEDS ITS OWN GRID. <== The sheet used to
       *  borrow the mountain's heightfield grid outright — same bounds, same
       *  spacing — which is exactly why it could not be wider than the
       *  mountain. Three times the reach on the mountain's own grid would also
       *  have been NINE times the vertices for a flat surface that needs
       *  almost none. `lib/volcano-ridge.js` builds it separately now.
       *
       *  ==> WATCH FOR THE THING THIS MAKES WORSE. <== A wider sheet covers
       *  more of MapLibre's OWN painted ocean, and two renderers drawing one
       *  sea at two opacities is the composite fault already open on the plate
       *  lines and the land handoff. At 1.0 it was a patch nobody would notice.
       *  At 3.0 it is the first thing to look at if the water reads as a dark
       *  blotch rather than as sea. */
      spread: 2,

      /** ==> THE SEA HAS ITS OWN CELL CEILING, AND SHARING THE RIDGE'S WAS A
       *  BUG. <== The two grids are driven by different things — terrain
       *  resolution follows the mountain's size, the sea's follows a wavelength
       *  fixed in metres — so one ceiling meant the sampling floor above was
       *  silently coarsened straight back out on every wide sheet. That is the
       *  same trap the gully measurement names: raise a resolution without
       *  raising the cap and every cluster quietly returns to where it started,
       *  with nothing reporting that it happened.
       *
       *  ==> SET FROM WHAT THE WIDEST REAL SHEET NEEDS, NOT FROM A ROUND
       *  NUMBER. <== Measured with `tools/check-water-extent.mjs` against the
       *  shipped catalog: the largest sea in the drawn tier is 116 km across
       *  (a single seamount near Samoa at roughly 29 km base radius), and
       *  carrying the shortest displacing train across it at
       *  the old displacement sampling floor took well under this. **That floor
       *  is gone** — the surface is no longer displaced — so this cap now binds
       *  on nothing in practice and is a guard against a pathological cluster
       *  rather than a working limit. 12,288 clears the widest real sheet with
       *  room and still refuses a pathological cluster. ==> IT IS DELIBERATELY
       *  NOT RE-CUT TO FIT. <== Headroom above the widest real sheet is what
       *  stops the next change to `spread` silently coarsening every sea; a cap
       *  trimmed to today's data would bind on the first thing that grows.
       *  Re-measure with that tool if `spread`, `cellsPerRadius` or the
       *  wavelengths move — a cap that silently binds is invisible in the
       *  output and shows up
       *  only as a sea that stopped moving properly. */
      maxCells: 12288,

      /** Grid resolution for the sea, in samples across one seamount's BASE
       *  radius — not across the spread. Far coarser than
       *  `ridge.cellsPerRadius` on purpose: a flat sheet needs only enough
       *  vertices to carry the alpha fade and the wave, and the wave's own
       *  shortest wavelength is what actually sets the floor. Six per base
       *  radius puts roughly four samples across the shortest crest, which is
       *  the minimum that reads as a wave rather than as a zigzag.
       *
       *
       *  ==> IT WAS BRIEFLY 8, FOR A SHORE CUT THAT IS NOW REVERTED. <== Back
       *  at 6 because nothing needs the finer grid: the replacement mask is a
       *  GPU one whose edge resolution has nothing to do with this number.
       *  Across the drawn set 6 is 29,066 water vertices at `spread` 2. */
      cellsPerRadius: 6,

      /** ==> THE WAVE. THREE CROSSED TRAINS, NOT ONE. <== A single sine reads
       *  as corrugated metal from directly above, which is the angle this map
       *  is mostly seen from. Three at different headings and wavelengths never
       *  repeat inside one footprint, which is what makes it read as sea.
       *
       *  Numbers are METRES and SECONDS, in the same real-world space the
       *  mountains are built in, so the wave scales with the map exactly as
       *  the terrain does and needs no zoom term. */
      wave: Object.freeze({
        /** ==> HOW STEEP EACH TRAIN IS, AND IT REPLACED AN AMPLITUDE IN
         *  METRES. <== `amplitudeM: 120` lived here and applied to all three
         *  trains equally, which is wrong in a way that took a render to see: a
         *  train's slope is its amplitude divided by its wavelength, so one
         *  height across wavelengths of 9000, 5200 and 2300 m made the shortest
         *  train FOUR TIMES steeper than the longest. Its peak slope alone was
         *  0.437 against the longest train's 0.112, so the finest ripple
         *  dominated every normal and the sea rendered as one corrugation with
         *  two faint ones under it.
         *
         *  This is the peak slope ONE train contributes; each train's amplitude
         *  is derived from it and its own wavelength, so all three are equally
         *  steep and a change of wavelength cannot silently change the look.
         *  Derived, never hand-tuned twice (§12).
         *
         *  ==> AND THE OLD NUMBER WAS EXAGGERATED ON TOP OF AN ARITHMETIC
         *  ERROR. <== A `slopeScale` of 4.0 sat downstream of this, set from a
         *  peak slope of 0.19 — which was ONE train's peak, not the three
         *  summed. The real sum was 0.742, or 37 degrees, and multiplying it by
         *  four rendered wave faces at 71 degrees. Everything downstream then
         *  behaved correctly on a near-vertical wall: the sheen saturated, the
         *  additive highlight blew out, and the water went opaque. **There is
         *  no exaggeration factor any more.** This number IS the slope.
         *
         *  Three trains at 0.10 peak near 0.30 combined, about 17 degrees.
         *  Zero stops the motion and the per-frame repaint together, without
         *  removing the sea. */
        steepness: 0.10,
        /** The three wavelengths, in metres. Spread wide and deliberately not
         *  multiples of each other.
         *
         *  ==> THE OLD NOTE HERE CLAIMED THIS STOPPED THE PATTERN BEATING BACK
         *  INTO A VISIBLE GRID. IT DOES NOT, AND GLASS SAID SO. <== Three sines
         *  sum to something strictly periodic whatever their ratios; awkward
         *  ratios only make the repeat LONGER, and one water sheet is not big
         *  enough for that to help. What actually breaks the lattice is
         *  `warpLengthM` / `warpAmpM` below, which bend where the trains are
         *  sampled. Do not reach for a fourth wavelength to fix a quilt. */
        lengthsM: Object.freeze([9000, 5200, 2300]),
        /** Headings of the three trains, in degrees clockwise from north.
         *  Not evenly spaced, for the same reason as the wavelengths. */
        headingsDeg: Object.freeze([20, 95, 155]),
        /** ==> METRES PER SECOND, AND THEY WERE SIX TIMES SLOWER UNTIL
         *  2026-07-31. <== The old [140, 90, 60] carried a note calling them
         *  slow on the grounds that a realistic swell crosses a footprint in
         *  under a second. That reasoning measured the wrong thing: what a
         *  person sees is not metres per second, it is PIXELS per second, and
         *  the sea is looked at from a camera where a pixel is tens of metres
         *  wide. At the zoom these sheets are actually inspected — roughly
         *  36 m per pixel — 140 m/s is under four pixels a second, which is
         *  slow enough to read as a still image with a slight crawl.
         *
         *  These put the long train near 23 px/s and the short one near 10, so
         *  the longest wave crosses its own length in about eleven seconds.
         *  ==> THE ORDERING IS NOT ARBITRARY: LONGER MUST STAY FASTER. <== Deep
         *  water waves travel as the square root of their wavelength, and a
         *  short train overtaking a long one is the single clearest way to make
         *  a sea look fake. Scale all three together.
         *
         *  ==> AND THE ON-SCREEN SPEED MOVES WITH ZOOM, BECAUSE THESE ARE REAL
         *  METRES. <== Zoomed further in the sea runs visibly faster, which is
         *  correct — it is the same water seen closer — but it means judging
         *  this number is only meaningful at a stated zoom. */
        speedMps: Object.freeze([840, 540, 360]),
        /** ==> THE SURFACE IS NEVER DISPLACED. THE WAVE IS ENTIRELY LIGHT.
         *  <== `displaceCount` and `minSamplesPerWave` lived here and are gone.
         *  The vertex shader used to raise the sheet with the two longest
         *  trains, which forced the grid to resolve a wavelength, which set a
         *  Nyquist floor, which set the vertex count. All of that was paying
         *  for a channel nobody could see: at 60 degrees of tilt a kilometre of
         *  swell on a 20 km sheet is about a pixel of vertical movement, and
         *  the surface carries no normals of its own, so displacing it produced
         *  no shading either.
         *
         *  What reads as water is the SLOPE, lit per pixel — and a slope can be
         *  differentiated out of the same sines analytically, at any resolution,
         *  on a mesh as coarse as the rim fade will tolerate. So this number
         *  survives as the amplitude the SLOPE is computed from, and the grid is
         *  now free of it entirely.
         *
         *  ==> IT IS ALSO STILL THE OFF SWITCH. <== Zero stops the motion and
         *  the per-frame repaint together, without removing the sea. */

        /** The colour a crest tints toward. Pale purplish white — hue 279°,
         *  which is the atmosphere's own hue, so the highlight reads as this
         *  world's light on the water rather than as a new colour. It is also
         *  the colour of the specular glint and the fresnel sheen, so every
         *  bright thing on this surface belongs to one light.
         *
         *  Held below the coast glow: a full crest composites to roughly 0.11
         *  luminance against the coastline's 0.41, so the coast stays the
         *  brightest structure on the map (§9 — reference outranks content). */
        crestColor: '#D6C1E1',

        /** How far toward `crestColor` a FULL crest goes, 0..1. A full crest
         *  needs all three trains peaking on the same pixel and is rare, and
         *  `crestSharpness` below makes what remains narrower still — so the
         *  sea shimmers along ribbons rather than flashing in sheets.
         *
         *  ==> IT IS THE COLOUR OF THE WAVE, NOT ITS LIGHT. <== This rides the
         *  wave's HEIGHT; `specular`, `fresnel` and `refractPx` all ride its
         *  SLOPE. If the sea looks flatly tinted rather than lit, this is the
         *  one that is too high and those three are too low. Zero leaves a
         *  body colour that is lit and refracted but never tinted. */
        crestMix: 0.35,

        /** ==> THE EXPONENT THAT TURNS A QUILT INTO WATER. <== The sum of three
         *  sines spends as much of its area near the peak as near the trough,
         *  so an unsharpened highlight is a broad soft blob and the surface
         *  reads as quilted fabric. Real water is mostly flat with narrow
         *  bright crests. Squaring the crest term buys that for one `pow`.
         *
         *  It is coupled to `crestMix` and they must move together: sharpening
         *  cuts the lit area, so `crestMix` was raised alongside it to keep the
         *  sea the same overall brightness. Raising this alone makes the sea
         *  darker, not crisper. */
        crestSharpness: 2.0,

        /** ==> THE SAMPLING GRID IS BENT, AND WITHOUT IT THE SEA IS A LATTICE.
         *  <== Three trains at fixed headings tile the plane with identical
         *  comma-shaped strokes — visible on glass as a quilt, which is the one
         *  thing water never looks like. More trains lengthen the repeat and do
         *  not remove it. Displacing WHERE each train is sampled does remove
         *  it: the crest lines wander along a long slow contour, so no two
         *  stretches look alike out of the same three sines.
         *
         *  Wavelength is longer than the longest train (9 km) so the bending
         *  itself never reads as a wave in its own right. Amplitude is a little
         *  under the shortest train (2.3 km), which is enough to scramble the
         *  lattice thoroughly.
         *
         *  ==> AMPLITUDE x WAVENUMBER MUST STAY BELOW 1. <== Above that the
         *  displacement's own gradient exceeds one, the grid folds through
         *  itself, and the result is hard pinch lines rather than texture.
         *  1800 over 26000 is 0.43. Check the product before raising either.
         *
         *  Static in world space on purpose — a drifting warp deforms the
         *  pattern as well as moving it, which reads as the sea swimming. */
        warpLengthM: 26000,
        warpAmpM: 1800,

        /* ---- THE OPTICS. Everything below turns the wave into light. ------ */

        /** ==> THE GLINT, AND IT DOES NOT KNOW WHERE THE CAMERA IS. <== The
         *  sun is `map3d.light` — the same constant the mountains bake their
         *  shading from, so the sea and the rock standing in it cannot be lit
         *  from two directions.
         *
         *  ==> THE VIEW DIRECTION WAS TAKEN OUT ON 2026-07-31, AARON'S CALL,
         *  AND IT WAS RIGHT. <== The glint used to track the camera's pitch and
         *  bearing, which is what a real specular highlight does. On a map it
         *  is wrong twice over. It made the entire sea re-pattern every time
         *  the globe was spun — *"it does this when I rotate around"* — and it
         *  put the water out of step with the mountains beside it, which have
         *  never had a view term. **Hillshading on a map is lit from a fixed
         *  direction regardless of rotation for exactly this reason**: the
         *  relief has to read the same whichever way north is pointing.
         *
         *  So the half-vector is constant, folded once on the CPU from the sun
         *  and a straight-down eye, and the glint is a pure function of the
         *  surface normal. `shininess` is the Blinn-Phong exponent: higher is a
         *  smaller, harder highlight. Under about 12 the whole sea goes milky,
         *  which is the failure that reads as fog. */
        /** ==> THE FINE DETAIL, AND IT IS A TEXTURE BECAUSE MORE SINES ARE THE
         *  WRONG ANSWER. <== Three trains give three spatial frequencies, and
         *  at the zoom these sheets are read at they are 250, 144 and 64 screen
         *  pixels. There is nothing below 64 px. That is the whole reason the
         *  sea kept rendering as bands: with no fine structure, "this pixel is
         *  bright" reduces to a condition on a smooth slope, which is a
         *  continuous contour running the width of the sheet. Adding trains
         *  costs a sin and a cos each, forever, and takes a great many before a
         *  sum of sines stops looking like one. A texture costs two lookups
         *  however much detail is in it.
         *
         *  `proto/water-noise.js` builds it at load — tiling by construction,
         *  storing SLOPE rather than a normal so it adds to the trains'
         *  gradient before either becomes a normal.
         *
         *  ==> TWO SAMPLES AT TWO SIZES, DRIFTING APART. <== One layer repeats
         *  visibly however good the noise is. Two at an awkward size ratio,
         *  scrolling on different headings at different speeds, do not — the
         *  repeat of one never lines up with the repeat of the other. Sizes are
         *  the world width of one tile in metres, both well under the shortest
         *  train's 2300 m so they are filling in beneath it rather than
         *  competing with it. */
        micro: Object.freeze({
          tileM: Object.freeze([1400, 520]),
          /** Metres per second each layer drifts, and the headings they drift
           *  on in degrees. Slower than the trains: this is surface texture
           *  being carried along, not weather of its own. */
          driftMps: Object.freeze([70, 110]),
          driftDeg: Object.freeze([55, 200]),

          /** ==> PEAK SLOPE THIS LAYER ADDS, IN THE SAME UNITS AS
           *  `wave.steepness`. <== The texture is normalised at build so its
           *  steepest slope is exactly 1, which is what lets this number mean
           *  something stable — change the octaves and it still means the same
           *  thing.
           *
           *  It is comfortably larger than one train's 0.10 on purpose: the
           *  point of this layer is that the FINE structure is what catches the
           *  light, while the trains supply the large slow shape underneath. If
           *  the sea looks like frosted glass rather than water, this is too
           *  high; if it goes back to smooth bands, too low. */
          strength: 0.22,
        }),

        specular: 0.55,
        shininess: 110,

        /** ==> HOW FAR THE SCENE UNDER THE WATER IS DISPLACED, IN SCREEN
         *  PIXELS, AT A FULL WAVE FACE. <== In pixels rather than metres so a
         *  denser phone screen does not get a weaker effect, and so the wobble
         *  is judged in the units it is seen in.
         *
         *  ==> THIS IS THE ONE THAT SELLS IT. <== Refraction is the strongest
         *  of the three cues on this map, because the camera mostly looks DOWN
         *  and looking down at water is when you see through it. If only one
         *  number here is worth tuning on glass, it is this one.
         *
         *  Above roughly 30 the seamount stops reading as a solid object under
         *  a surface and starts reading as a reflection in one. */
        refractPx: 12,
      }),

      /** ==> WHERE THE SEA STOPS, AND IT IS DECIDED BY LOOKING AT THE PICTURE
       *  MAPLIBRE ALREADY DREW. <== Three attempts asked the TILE DATA where
       *  the land was and all three failed (NOW.md carries the post-mortems).
       *  The basemap on screen is the answer already worked out: every tile
       *  stitched, every island, at exact screen resolution. So the shader
       *  copies the framebuffer under itself and asks one question per pixel —
       *  is the thing beneath me the ocean's colour or the land's?
       *
       *  ==> THE TEST IS RELATIVE, WHICH IS WHY THERE IS NO TOLERANCE IN
       *  METRES OR IN HEX HERE. <== It measures the pixel's distance to the
       *  sea colour AND to the land colour and asks which is nearer. That
       *  self-calibrates across themes and worlds: Sky's dark blue pair sit
       *  0.218 apart in unit RGB, Deep's ultraviolet pair 0.266, and the same
       *  two numbers below work for both. `tools/test-water-mask.mjs` asserts
       *  that separation for every palette, so a future recolour that brought
       *  sea and land close enough to confuse the mask fails at check time
       *  rather than being noticed on a phone. */
      shore: Object.freeze({
        /** Half-width of the ramp around the halfway point, as a fraction. 0
         *  would be a hard cut on a single pixel; MapLibre draws the ocean
         *  fill antialiased, so the shoreline pixel is already a blend of the
         *  two colours and lands mid-ramp. This widens that one pixel into a
         *  soft edge instead of a staircase.
         *
         *  ==> IT IS NOT A DISTANCE ON THE GROUND AND MUST NOT BE TUNED AS
         *  ONE. <== The `shoreFeatherCells` failure was a blur constant whose
         *  real size (~7 km) was hidden by its unit. This one is in units of
         *  "how sure am I", and its size on the ground is one screen pixel at
         *  any zoom, because it lives in the picture rather than in the world. */
        softness: 0.08,

        /** ==> A PIXEL THAT IS NEITHER SEA NOR LAND GETS NO WATER. <== If the
         *  distance to the NEARER of the two anchors exceeds this, the shader
         *  refuses to claim the pixel is sea. Nothing but the basemap is drawn
         *  beneath this layer today, so in practice this never fires — it is
         *  the guard for the day something else is (imagery, radar, a hillshade),
         *  and it fails in the safe direction: unknown means no water, never
         *  water drawn confidently over something we cannot identify.
         *
         *  0.30 in unit RGB. A blend between the sea and land colours can never
         *  be more than half the gap from the nearer of them — 0.13 at the
         *  widest palette — so a real shoreline pixel clears this with room. */
        maxDistance: 0.30,
      }),
    }),

    /* ---- LOOK ------------------------------------------------------------- */

    /** ==> A MOUNTAIN WEARS ITS DOT'S COLOUR. AARON'S CALL 2026-07-30, AND IT
     *  REPLACES THE WHITE. <== This was `#FFFFFF` — "Aaron asked for white and
     *  translucent" — while the dot handing over to it was cyan `#8FD7E6`, so
     *  one volcano changed colour halfway down the ladder. §42.1's rule that a
     *  volcano must not change colour because it changed renderer was written
     *  about the gold and was quietly broken by the quiet tier the whole time.
     *  Both hexes now come from the shared consts at the top of this block, so
     *  there is nothing left to keep in step by hand.
     *
     *  ==> THE WHITE'S ARGUMENT DIED WITH IT, AND IT IS WORTH KNOWING WHY IT
     *  WAS EVER ALLOWED. <== §42.1 bans near-white on Deep because the dot
     *  field is `#ECE4F8` and a desaturated tint next to it is not a second
     *  colour. This layer draws on a dark basemap at 100 px rather than on
     *  glass at 3.5 px, so that measurement never applied here. The cyan is not
     *  a retreat from white — it is the one colour this volcano already had.
     *
     *  ==> IT HAS NOT BEEN SEEN ON GLASS AND IT IS A REAL LOOK CHANGE. <== A
     *  translucent white mountain reads as relief; a translucent cyan one reads
     *  as a coloured object on the map. If it shouts, the number to move is
     *  `opacity`, not the hex — the hex is the whole point of the change. */
    color: VOLCANO_QUIET,
    opacity: 0.55,

    /** Erupting keeps its gold, and now it is LITERALLY the dot's gold rather
     *  than a near-miss: this was `#FFB020` against the mark's `#FFC53D`, two
     *  hexes for one thing that nobody could have told apart in a review and
     *  everybody would have seen on a phone. */
    eruptingColor: VOLCANO_LIVE,
    eruptingOpacity: 0.72,

    /** Fixed light, baked into the unit geometry's vertex colours ONCE rather
     *  than lit per frame. Every mountain here is axis-aligned and lit by the
     *  same sun, so per-instance lighting would compute the same answer 240
     *  times. Direction is [x, y, z] in the layer's own metres-up space. */
    light: Object.freeze([-0.55, -0.42, 0.72]),
    ambient: 0.42,

    /* ---- COST ------------------------------------------------------------- */

    /** Hard ceiling on drawn mountains. At z6 a screen holds a handful; this
     *  is the guard against a pathological view down the Kuril arc, not a
     *  normal-case limit. */
    maxDrawn: 240,

    /* ---- ONE RIDGE, NOT A ROW OF CONES ------------------------------------
     * ==> VOLCANOES WHOSE FOOTPRINTS INTERSECT ARE ONE SURFACE. <== A 3.5 km
     * cone models 31 km across and arc volcanoes sit 15–25 km apart, so they
     * genuinely overlap — that is the geography, not a drawing artefact.
     * Drawn as separate closed shapes they read as a smear of stamped coins
     * with a hard rim each. Sampled as one heightfield they read as a
     * cordillera: one ridge with peaks on it and a saddle between them.
     * Maths in `lib/volcano-ridge.js`, asserted by
     * `tools/test-volcano-ridge.mjs`.
     */
    ridge: Object.freeze({
      /** Multiplier on the two TRUE footprints when testing whether they
       *  intersect. 1.0 is "they actually touch". Above 1 gathers mountains
       *  that merely come close, which merges more of an arc into one ridge.
       *
       *  ==> CLUSTERING READS TRUE RADII, NEVER INFLATED ONES. <== `inflate`
       *  is a uniform zoom scale, so an inflated cluster is the same cluster
       *  seen closer. If membership changed with zoom, every mesh would have
       *  to be rebuilt mid-pinch.
       *
       *  ==> IT STAYS AT 1.0. RAISING IT INVENTS TERRAIN. <== The merge fires
       *  on few groups at true scale, because the drawn tier is the ACTIVITY
       *  tier — roughly one volcano per arc — and the dense chains that really
       *  do overlap are mostly not in it. That looks like an argument for
       *  raising this and is not: merging mountains that do not touch draws a
       *  ridge between two volcanoes with open ground between them, which is
       *  the same lie as horizontal exaggeration and the same lie that got
       *  `inflate` deleted. */
      clusterPad: 1.0,

      /** Grid samples across the SMALLEST member's base radius, so a dome
       *  sharing a ridge with a shield is still sampled finely enough to read
       *  as a dome. */
      cellsPerRadius: 10,

      /** Ceiling on one cluster's grid, after which the cell grows instead.
       *  The guard against the Kuril arc becoming one enormous mesh. */
      maxCells: 12000,

      /** Smooth-max blend width, as a fraction of the cluster's tallest peak.
       *  Where two mountains differ in height by more than this the blend
       *  returns the exact maximum, so summits keep their true height; where
       *  they are close it rounds the join by up to a quarter of this. At 0
       *  this is a plain max and the join is a visible crease. */
      saddle: 0.35,

      /** The bottom fraction of a point's own local mountain height over which
       *  opacity ramps in from nothing.
       *
       *  ==> THIS IS WHAT STOPS THEM READING AS COINS LAID ON THE MAP. <== A
       *  hard edge where geometry meets the basemap is the single strongest
       *  "this is a sticker" cue. Ramping the bottom slice lets the surface
       *  emerge from the map. Too large and the mountain looks like fog. */
      softBase: 0.18,

      /** How far in from the footprint rim, as a fraction of the base radius,
       *  opacity ramps up from nothing.
       *
       *  ==> THIS HIDES A DEFECT RATHER THAN CREATING A LOOK, AND THAT IS WHY
       *  IT EXISTS SEPARATELY FROM `softBase`. <== The mesh is trimmed at whole
       *  grid cells, so the true edge of a footprint is a STAIRCASE — reported
       *  on glass as a dashed, stair-stepped fringe along the bottom of every
       *  mountain. `softBase` did not hide it because it ramps on HEIGHT, and
       *  one cell in from the rim a tall cone already stands high enough to be
       *  clearly visible. This ramps on RADIUS instead, so the outermost ring
       *  of cells is gone regardless of how tall the mountain is.
       *
       *  At `cellsPerRadius` 10 this covers the outer 2.5 cells. It must stay
       *  comfortably larger than one cell or the staircase comes back. */
      edgeFade: 0.30,

      /** Samples used to invert `volcanoProfile()` into a radius→height table.
       *  Higher than the old lathe's 14 because a caldera's rim and notch are
       *  a small part of the profile and a coarse table rounds them off. */
      tableSteps: 48,

      /**
       * ==> NO TWO VOLCANOES ARE THE SAME MOUNTAIN. <== `volcanoProfile()` is
       * a function of radius alone, so a heightfield built from it is a
       * surface of revolution and every cone in the drawn set was literally
       * the same object — measured at ec8cf97, five different stratovolcanoes
       * reported an identical baked shade range of 0.49–0.99 to three decimal
       * places. `lib/volcano-variation.js` makes each one a function of
       * BEARING as well, seeded from its own catalog number.
       *
       * ==> AMOUNT IS THE ONE NUMBER TO JUDGE ON GLASS. EVERYTHING ELSE HERE
       * IS STRUCTURE. <== Too little (0.08) and five stratovolcanoes still
       * read as one mountain drawn five times, which is the whole problem
       * unsolved. Too much (0.45) and they read as shards rather than
       * volcanoes: the flanks go faceted because the grid runs out at about
       * five cells per lobe, and the footprint shrink below gets severe enough
       * to see on a shield.
       *
       * ==> AND IT SHRINKS MOUNTAINS, WHICH IS STATED RATHER THAN HIDDEN. <==
       * Nothing may reach past its true footprint (§42.1.4b — the mistake that
       * killed `fill-extrusion` and then `inflate`), so the modelled radius
       * becomes the WIDEST bearing rather than the uniform one and every other
       * bearing lands inside it. A varied mountain is therefore narrower on
       * average than an unvaried one. Raising a family ratio to win that back
       * would be a horizontal scale factor under a new name and is not done.
       */
      variation: Object.freeze({
        /** ==> THE DIAL. <== See above for what each end looks like. */
        amount: 0.30,

        /** How far off-centre a summit can sit, as a fraction of `amount`,
         *  in base radii. A displacement rather than a harmonic, faded to
         *  nothing at the rim, so it costs no footprint at all — which is why
         *  it carries the largest share of the character here. */
        summitOffset: 0.35,

        /** `[harmonic, weight]` around the compass. The weight multiplies
         *  `amount` to give that harmonic's amplitude in base radii.
         *
         *  ==> WHERE THIS LADDER STOPS IS SET BY THE GRID, NOT BY TASTE. <==
         *  `cellsPerRadius` 10 is about 21 samples across a mountain and
         *  therefore about 33 cells around its mid-flank, so k=7 has roughly
         *  five cells per lobe and is the finest thing that can be held
         *  without aliasing into a starfish. k=1 is deliberately absent: it is
         *  the same read as `summitOffset` and it would be paid for in
         *  footprint. Finer relief than k=7 is the gully problem, which was
         *  measured 2026-07-31 at 9x the grid and is out of scope. */
        harmonics: Object.freeze([
          Object.freeze([2, 0.55]),
          Object.freeze([3, 0.36]),
          Object.freeze([5, 0.20]),
          Object.freeze([7, 0.13]),
        ]),

        /** How far outside a crater's rim, in base radii, the outline warp
         *  fades in from nothing.
         *
         *  ==> THE ONE FAMILY WITH A CRATER CANNOT TAKE THE FLANK WARP AT THE
         *  RIM. <== Measured over the drawn tier: all 13 calderas sample their
         *  crater at exactly 11.0 grid cells, so the rim ring is 5.5 cells
         *  from axis to edge, and a warp at `amount` 0.30 moves it by ±1.6 of
         *  those cells. Rendered from the real vertex colours, the bowl is
         *  gone and the volcano reads as a lumpy hill — worse than the smooth
         *  one it replaced. So the warp starts at `spec.topR`, which already
         *  IS the rim radius, and ramps in over this. */
        craterTaper: 0.30,

        /** The most one sector of a crater rim is cut down toward its own
         *  floor, 0..1. This is the lopsided rim: the outline warp can move a
         *  rim in and out but not up and down, so a caldera came out an oval
         *  ring at one uniform height. At 1.0 the breach reaches the crater
         *  floor and the crater opens onto the flank; at 0 the rim is level
         *  all the way round, which is where this started. */
        breach: 0.55,
      }),
    }),

    /* ---- LAVA RUNS DOWNHILL, ON THE MOUNTAIN THAT IS ON SCREEN ------------
     * ==> §42.1.9 USED TO FORBID THIS AND THE PROHIBITION WAS PRICED AGAINST
     * THE WRONG DENOMINATOR. <== It was rejected on the 2026-07-31 gully
     * measurement, which asked what a finer grid costs for ALL 240 drawn
     * volcanoes: 1,073,680 nodes and ~1.2 s of blocked main thread. Lava draws
     * only on volcanoes actually erupting lava — a handful, never 240.
     * Re-measured 2026-07-31 on the same catalog and the same machine:
     *
     *   whole field  1x  126,332 nodes  620 ms   |  3x  1,073,680  1,201 ms
     *   ONE cluster  1x      441 nodes  0.1 ms   |  3x      3,721      1 ms
     *   five worst   1x   16,298 nodes    5 ms   |  3x    140,966     83 ms
     *
     * 182 of the 207 drawn meshes are a SINGLE volcano and the largest is
     * four, so refining "the erupting one" rebuilds one small self-contained
     * mesh. There is no seam to hide, because the cluster IS the mesh.
     *
     * ==> THE HARMONIC LADDER IS NOT EXTENDED TO MATCH, AND THAT IS THE WHOLE
     * REASON THIS IS SAFE. <== §43.2 caps variation at k=7 because the 1x grid
     * gives about five cells per lobe. The obvious move is to add finer
     * harmonics on the refined mountain — and it is wrong: the same volcano
     * would then be a DIFFERENT SHAPE at 1x and 3x, so it would visibly morph
     * the moment it started erupting. The ladder stays exactly where it is.
     * Refinement samples the SAME mountain more accurately, so the k=7 lobes
     * get ~15 cells each instead of ~5 and finally read as the drainages they
     * always were. Crispness changes; shape does not.
     */
    lava: Object.freeze({
      /** Grid multiplier applied to `ridge.cellsPerRadius` for a cluster that
       *  has something erupting lava in it. 3 is where the drainages stop
       *  being smeared. Measured headroom: 6x is still 5 ms for a median
       *  cluster, so this can rise on glass if the channels read soft. */
      refine: 3,

      /** Ceiling on refined clusters built in one pass. The pathological case
       *  is a lava eruption at every one of the largest clusters at once,
       *  which the five-worst row above prices at 83 ms; this is the guard
       *  against a future feed doing something stupid, not a normal limit. */
      maxRefined: 8,

      /* ---- THE FLOW IS VISCOUS, AND STEEPEST DESCENT ALONE IS THE WRONG
       * MODEL ------------------------------------------------------------
       * ==> WATER TAKES THE SHARPEST LINE DOWN. LAVA DOES NOT. <== A marble
       * released at the summit traces a thin scratchy rill that reads as a
       * rain gully, which is the failure mode this whole block exists to
       * avoid. Lava is thick: it carries momentum through a bend instead of
       * turning into it, it cuts a channel and stays in it, and it spreads
       * and piles up where the slope eases. Those three behaviours are
       * `drag`, the momentum term, and `widthGain` below.
       */

      /** Downhill acceleration per step, in metres per step² against a slope
       *  of 1. Sets how hard gravity pulls relative to the momentum already
       *  carried. */
      gravity: 42,

      /** Velocity retained each step, 0..1. THIS IS THE VISCOSITY DIAL and it
       *  is the one number to judge on glass. At 0 the flow is memoryless and
       *  becomes pure steepest descent — water. Near 1 it ignores the terrain
       *  and runs straight off the side. */
      drag: 0.82,

      /** Metres of path per integration step. Small enough that a flow cannot
       *  step across a k=7 drainage without noticing it: a mid-flank lobe is
       *  roughly 1.5 km wide on a stratovolcano. */
      stepM: 90,

      /** Hard ceiling on steps per flow, so a flow that finds a flat shelf and
       *  crawls cannot spin forever. At `stepM` 180 this is 43 km of path,
       *  comfortably past any modelled footprint. */
      maxSteps: 240,

      /** A flow stops when its speed falls under this, in metres per step.
       *
       *  ==> IT ALMOST NEVER FIRES ON A CONE, AND THAT IS WHY `reachQ` BELOW
       *  EXISTS. <== The first build relied on this alone to end a flow and it
       *  did not work: measured on Etna, the modelled slope is a near-constant
       *  0.89 from summit to foot, so a flow never slows down and all twelve
       *  ran the full 15 km to the footprint rim. Twelve flows covering an
       *  entire flank is not lava, it is a mountain painted orange. This still
       *  earns its place for shallow ground — a shield, a caldera floor, the
       *  saddle in a merged cluster — where a flow really does run out of
       *  gradient. */
      stallMps: 6,

      /* ---- HOW FAR A FLOW GETS, WHICH SLOPE ALONE WILL NOT DECIDE ---------
       * ==> A REAL FLOW STOPS BECAUSE IT RUNS OUT OF LAVA AND HEAT, NOT
       * BECAUSE THE HILL ENDS. <== Length is governed by effusion rate and
       * cooling. We have neither — no feed publishes either — so a plausible
       * fixed reach is the honest simplification, and it is stated as one
       * rather than dressed up as physics. Etna's real flows run roughly 1–7
       * km against the 15 km footprint modelled here, so a flow covering
       * something under half the flank is the right order of magnitude.
       */

      /** How far a flow runs before it stops, as a fraction of the erupting
       *  volcano's base radius. */
      reachQ: 0.42,

      /** Spread in reach between one flow and the next on the same volcano,
       *  ±this fraction. Flows of identical length read as a drawn starburst;
       *  real ones differ by a lot. Varied from the volcano's own seed and the
       *  launch index, so it is stable across reloads. */
      reachVary: 0.35,

      /** Flows launched around the crater rim. They are evenly spaced and the
       *  TERRAIN decides where they actually end up — that is the entire point
       *  of tracing. Expect them to converge: twelve launches down a k=7
       *  mountain typically settle into four or five channels, which is what a
       *  stratovolcano really does and is not something that could have been
       *  faked by drawing four ribbons.
       *
       *  ==> LAUNCHING ALL THE WAY ROUND IS ALSO THE HONEST CHOICE. <== No
       *  feed publishes which flank is erupting (§42.1.9). Lava leaving in
       *  every direction is visibly a symbol; two tongues on the north side is
       *  a claim, and it would be wrong most of the time. */
      launches: 12,

      /** Where on the profile a flow starts, as a fraction of base radius from
       *  the axis. Just outside the crater floor, so a flow begins at the rim
       *  rather than in the middle of a caldera. */
      launchQ: 0.075,

      /** How many times a stalled launch steps outward looking for slope, and
       *  how far it moves each time as a fraction of base radius. Together
       *  these reach 0.075 -> 0.275, which clears a stratovolcano's flat
       *  summit comfortably and gets most of the way across a caldera floor. */
      launchTries: 9,
      launchStep: 0.025,

      /** Half-width of the ribbon at the vent, in metres, and how much wider
       *  it gets by the toe.
       *
       *  ==> WIDTH RIDES DISTANCE, NOT SPEED, AND THE FIRST VERSION HAD IT
       *  BACKWARDS. <== Widening as the flow SLOWED was the intuitive model —
       *  lava piles up where it stops. But a flow launches from rest, so its
       *  slowest moment is the vent, and the fan appeared at the crater with
       *  the ribbon tapering to a point at the toe: exactly inverted. And on a
       *  constant-slope cone the flow never slows anyway, so the term was
       *  doing nothing at the end where it was wanted. Distance is monotonic,
       *  it is the same number the colour ramp already uses, and it cannot
       *  invert itself. Squared, so the flow stays narrow through its middle
       *  and spreads late. */
      widthM: 95,
      widthGain: 1.4,

      /* ---- THE TAPER, WHICH THE FIRST TWO WIDTH PROFILES BOTH LACKED ------
       * ==> ON GLASS THESE CAME OUT AS RECTANGULAR SLABS. <== Aaron: *"these
       * are rectangular shaped. Shouldn't they taper at the beginning and
       * ends?"* Yes, and at both ends for two different reasons — a flow
       * issues from a vent, which is a point, and it ends in a rounded lobate
       * toe rather than a square edge. A monotonic width has neither. */

      /** Fraction of the flow over which it opens out from the vent. */
      ventTaper: 0.14,
      /** Width at the vent itself as a fraction of the body width. Not zero —
       *  a zero-width first segment is a degenerate triangle and renders as a
       *  spike. */
      ventWidth: 0.35,
      /** Where along the flow the toe starts rounding off. The nose is a
       *  circular arc from here to the tip. */
      noseAt: 0.78,

      /** Metres the ribbon floats above the surface it traces. Enough to clear
       *  z-fighting against the mountain at 3x, small enough that it is not
       *  visibly hovering when the camera tilts. */
      liftM: 45,

      /* ---- COLOUR IS A TEMPERATURE RAMP, NOT ONE ORANGE -------------------
       * ==> AND IT DELIBERATELY RUNS HOTTER THAN THE PLATE SEAMS. <== `NOW.md`
       * flags that the erupting halo already collides with the magma orange of
       * `DEEP_WORLD.plates.core`. Incandescence is a temperature series —
       * white-hot at the vent through yellow and orange to a dull red crust at
       * the toe — so the ramp both looks like what lava is and puts the bright
       * end well clear of the seams. Fixed, like the Saffir-Simpson colours:
       * this is what hot looks like, not a theme. */
      /* ==> AND THE FIRST RAMP WAS THE SAME ORANGE AS THE MOUNTAIN. <== The
       * erupting edifice is `VOLCANO_LIVE` `#FF7A1A`; the old mid-tone here
       * was `#FF9A1F`. Those are the same colour. Lava was being drawn in the
       * exact hue of the ground it runs on, so there was no figure and no
       * ground and the flows read as glowing panels rather than as streams —
       * which is most of why Aaron's first look was *"this doesn't look like
       * streams of lava."*
       *
       * ==> THE FIX SEPARATES AT BOTH ENDS, NOT ONE. <== Brighter at the vent
       * ALONE is not enough on a mountain this saturated. So the flow now runs
       * white-hot, through a yellow well above the edifice in both brightness
       * and hue, down to a near-black crust well BELOW it. The mountain sits
       * between the two ends of its own lava, which is both what separates
       * them and what real cooling looks like.
       *
       * The alternative fix is to cool the erupting edifice instead. That is
       * the better answer if these still fight on glass, but the gold is
       * Aaron's approved look and is not changed without him. */
      vent: '#FFF8E0',
      mid: '#FFC24A',
      toe: '#4A0E06',

      /** How far along a flow, 0..1, the ramp reaches each stop. The crust
       *  wins quickly — real lava is dark within a short distance of the vent
       *  and only the cracks stay bright. */
      midAt: 0.30,

      /* ---- THE CRAWL ------------------------------------------------------
       * ==> IT RIDES A REPAINT ALREADY PAID FOR, AND ONLY WHERE ONE EXISTS.
       * <== At map zoom the sea already calls `triggerRepaint()` every frame,
       * so a moving flow adds a shader and no new frame. On a land volcano
       * with no seamount in the cluster there is no sea, and the lava becomes
       * the thing asking for the frame — which is stated here rather than
       * discovered on a battery. */

      /** Non-zero means lava animates, and therefore asks MapLibre for a frame
       *  every frame. THE SINGLE SWITCH: setting this to 0 stops the pulse and
       *  the repaint together, rather than leaving a still flow quietly costing
       *  a redraw. The speed itself is `pulseSpeed`. */
      crawlHz: 0.11,

      /* ---- THE MEANDER ----------------------------------------------------
       * ==> A TRACED FLOW ON OUR MOUNTAIN IS TOO STRAIGHT, AND THAT IS THE
       * MOUNTAIN'S FAULT RATHER THAN THE TRACER'S. <== §43.2 caps bearing
       * variation at k=7, so steepest descent down it is very nearly a
       * straight radial line. Aaron on glass: *"it needs more wiggle."*
       *
       * ==> THIS IS THE ONE OPENLY DECORATIVE TERM IN THE LAVA MODEL. <==
       * Everything else is the terrain deciding where lava goes. This is a
       * seeded wander laid on top, because the terrain has no detail at this
       * scale to decide with. It is flagged rather than buried, and if real
       * elevation data ever lands it should be the first thing deleted. */

      /** Peak bend applied per step, in radians. */
      meander: 0.075,
      /** Metres of travel per radian of the meander wave. Larger is lazier. */
      meanderM: 620,

      /* ---- THE PULSE THAT TRACKS THE PATH ---------------------------------
       * ==> THE SAME CONSTRUCTION AS THE PLATE SEAMS' SHIMMER, ON PURPOSE.
       * <== `proto/world-deep.js` SEAM_FRAG. Aaron asked for it by pointing at
       * that effect. Riding a per-vertex DISTANCE is what makes it travel
       * rather than blink; two untidy frequencies stop it reading as a
       * metronome; sharp crests over long troughs keep most of the flow at
       * crust temperature with bright surges moving through. */

      /** How far a surge lifts the flow toward vent white, 0..1. */
      pulse: 0.85,
      /** Radians per metre along the flow. At 0.0016 a crest sits about every
       *  3.9 km, so a typical flow carries one or two at a time. */
      pulseScale: 0.0016,
      /** Radians per second — a surge travels about 900 m/s of flow length,
       *  which is FAST for lava and correct for reading as a pulse of heat
       *  rather than as the rock itself sliding. */
      pulseSpeed: 1.45,
      /** Crest sharpness. Higher spends more of the flow dark between surges. */
      pulseSharp: 2.6,

      /** ==> STREAKS ACROSS THE WIDTH, WHICH IS WHAT MAKES THEM RUN
       *  LENGTHWISE. <== The first build had `bands`, counted ALONG the flow,
       *  and drew rungs at right angles to travel — a barber pole. Cracks in a
       *  real flow run WITH the direction of travel, because that is the
       *  direction the crust is being pulled apart. Varying on the cross-flow
       *  coordinate is what produces that; varying on distance cannot. */
      streaks: 2.2,

      /** How much the bright channel and the cracks lift the crust, 0..1. */
      glow: 0.55,

      /** How far the edges darken toward chilled rock, 0..1. ==> THIS IS WHAT
       *  STOPS A RIBBON READING AS A PANEL. <== A flow chills against cold
       *  ground at its margins and builds dark levees; a panel is uniformly
       *  bright right up to a hard border, which is exactly what the first
       *  build looked like. */
      levee: 0.62,
    }),

    /* ---- REAL-WORLD PROPORTIONS (SPEC-GLOBES §42.1.4b) --------------------- *
     * ==> THESE ARE NOT `shapes.families.ratio` AND MUST NOT BE MERGED WITH
     * IT. <== That table is deliberately UNREAL — §42.1.2 spreads the ratios
     * apart so six silhouettes separate at 3 px on the globe. This table is
     * deliberately REAL, because at map zoom there is room for the truth. The
     * two tables describe the same five families at two scales and they
     * disagree on purpose.
     *
     *   ratio      base RADIUS ÷ relief. A stratovolcano is ~4.5.
     *   reliefCap  metres. `elev` is height above SEA, not above the volcano's
     *              own base (§42.1.2), so Ojos del Salado reads 6,879 m while
     *              standing on a 4,000 m plateau. Without a cap it becomes a
     *              7 km spire. The cap is the tallest relief that family
     *              plausibly has, and it is an approximation stated as one —
     *              real prominence needs a DEM lookup this layer does not do.
     *
     * The SILHOUETTE parameters — flankPow, heightPow, topR, rim, notch,
     * elongate, narrow — are NOT repeated here. They come from
     * `shapes.families` and `volcanoProfile()`, so a caldera notches the same
     * way in both renderers and there is one place to change it.
     */
    /* ---- THE ASH COLUMN, AND ITS HEIGHT IS PUBLISHED RATHER THAN INVENTED --
     * ==> THE ONE NUMBER THAT MAKES THIS A DATA LAYER INSTEAD OF DECORATION.
     * <== A VAAC advisory states the top of the ash cloud as a flight level,
     * and the bulletin also states the volcano's own elevation, so the height
     * of the column above the ground is a subtraction of two published figures
     * and never a guess. `lib/volcano-plume.js` owns that arithmetic.
     *
     * ==> AND THE REAL RANGE IS A THIRD OF WHAT §42.1.5 ASSUMED. <== Measured
     * across all ten active advisories on 2026-07-31:
     *
     *   Telica 1,098 m · Lewotobi 1,040 · Semeru 915 · Purace 836 · Ibu 777
     *   Reventador 705 · Dukono 556 · Santa Maria 522 · Fuego 468 · Sabancaya 441
     *
     * So 0.4–1.1 km, which means **the plume is usually SHORTER than the
     * mountain it stands on.** Every number below is sized against that, not
     * against the 1–3 km the weekly report's prose suggested.
     *
     * ==> THERE IS NO SPACE-TIER PLUME AND THERE MUST NOT BE ONE. <== 1 px is
     * about 30 km on the space globe, so a 1 km column is a thirtieth of a
     * pixel. Drawing one there means inventing a size. The erupting halo
     * already holds that slot.
     */
    plume: Object.freeze({
      /** ==> THE PLUME READS THE MOUNTAINS' OWN EXAGGERATION AND THEN ONE DIAL
       *  ON TOP. <== §42.1.5 requires column and edifice to stay in proportion;
       *  multiplying `map3d.vertical` rather than carrying an independent
       *  number makes that arithmetic instead of discipline. 1.0 means a plume
       *  is stretched exactly as much as the mountain under it. */
      exaggerationRatio: 1.0,

      /** How many quads in the stack. Twelve is enough that the soft edges
       *  overlap into a continuous column at the sizes §42.1.5 measures
       *  (~9 px at z7, 37 at z9) and few enough that twenty simultaneous
       *  eruptions are 240 quads — nothing, next to a 130,000-node terrain. */
      puffs: 12,

      /** Half-width of the lowest puff, metres. A vent is not a point: Dukono's
       *  crater is roughly 400 m across, so the column leaves the ground at
       *  something like this width rather than at zero. */
      ventWidthM: 220,
      /** Half-width at the top as a multiple of `ventWidthM`. A rising plume
       *  spreads as it entrains air; 3.2 gives the flared silhouette every
       *  photograph of an ash column has without reaching the umbrella cloud,
       *  which is a stratospheric feature these 0.4–1.1 km plumes never make. */
      spread: 3.2,

      /** ==> A PLUME WITH NO PUBLISHED HEIGHT IS DRAWN AS A LOW PUFF THAT
       *  VISIBLY REFUSES TO STATE ONE, AND THIS IS THE HEIGHT OF THAT REFUSAL.
       *  <== §42.1.5's binding honesty rule. 300 m is deliberately BELOW the
       *  smallest measured real plume (441 m), so an untopped puff can never be
       *  mistaken for a small stated one. */
      unknownM: 300,
      /** ==> AND IT LOSES ITS TOP. <== The stated columns taper to a rounded
       *  cap; this one is cut off flat and fades out, so "we do not know how
       *  high this goes" is legible in the SHAPE rather than only in a tooltip
       *  nobody opens. */
      unknownTopFade: 0.55,

      /** Floor on a stated height, metres. The subtraction can land at or below
       *  zero when a centre's elevation and its flight level disagree — a real
       *  arithmetic outcome, not a parse failure. Clamping keeps it visible and
       *  small rather than inverted or absent, and the clamp is counted. */
      minM: 120,

      /** ==> THE COLUMN IS ASH, SO IT IS GREY, AND IT IS THE ONE THING ON THIS
       *  WORLD THAT IS NOT ONE OF THE TWO HOUSE COLOURS. <== Everything else
       *  wears the coastline's orchid or the plate seam's magma orange. Ash is
       *  neither: a grey-brown column against an orange mountain is exactly the
       *  figure-and-ground separation the lava ramp had to be stretched to get,
       *  and here it is free. Dark at the vent where the cloud is dense,
       *  paler at the top where it is thinning out. */
      base: '#4A423E',
      top: '#B9AFA6',
      /** Peak opacity, at the vent. The column must not hide the mountain it
       *  stands on — a plume is translucent in every photograph and an opaque
       *  one would read as a solid grey finger. */
      opacity: 0.42,
      /** How fast the puffs fade going up, as an exponent on the 0–1 rise.
       *  Above 1 the fade is slow at first and quick near the top, which is
       *  what a dissipating cloud does. */
      fadePow: 1.6,

      /** ==> THE COLUMN LEANS, AND UNTIL H3 IT LEANS NOWHERE. <== The bulletin
       *  states drift outright (`MOV NE 05KT`) and nothing parses it yet, so
       *  every column here rises straight up — §42.1.5's honest null. This is
       *  the lean in metres per metre of rise that the parsed bearing will
       *  drive; it exists now so the geometry is already built to take it. */
      driftPerRise: 0.0,

      /** ==> NON-ZERO MEANS THE PLUME ANIMATES, AND THEREFORE ASKS MAPLIBRE FOR
       *  A FRAME. <== Same contract as `lava.crawlHz` and for a sharper reason:
       *  §42.1.5 argued a plume is free because the sea repaints anyway, and
       *  that argument only holds where there IS a sea. Most erupting volcanoes
       *  are on dry land with no seamount in their cluster, so on those the
       *  plume is the ONLY thing asking. Setting this to 0 stops the boil and
       *  stops the asking together; `status()` reports the repaint either way.
       *  0.055 Hz is one slow roll every eighteen seconds — a plume that
       *  visibly churns is a campfire, not a 1 km ash column seen from 50 km. */
      boilHz: 0.055,
      /** How far a puff wanders sideways as it boils, as a fraction of its own
       *  width. Small: the movement should be a suggestion of life, never a
       *  wobble that reads as a broken transform. */
      boilAmp: 0.16,
    }),

    families: Object.freeze({
      /** Fuji is 3.8 km above sea on a ~30 km base; Etna ~3.4 km on ~35 km.
       *  4.5 lands both within about 15%. */
      cone: Object.freeze({ ratio: 4.5, reliefCap: 3500 }),
      /** Steep and small — a lava dome is 1–2 km across and a few hundred
       *  metres tall. The only family whose real ratio is near the globe's. */
      dome: Object.freeze({ ratio: 2.0, reliefCap: 800 }),
      /** Mauna Loa is ~100 km across for 4.2 km above sea. This is the family
       *  where true proportion is most startling, and it is correct. */
      shield: Object.freeze({ ratio: 12.0, reliefCap: 4500 }),
      /** Mostly a hole. Masaya comes out ~10 km across, which is what it is —
       *  the number that broke `fill-extrusion` is 10 km here, not 45. */
      caldera: Object.freeze({ ratio: 8.0, reliefCap: 2000 }),
      /** `elongate`/`narrow` from `shapes.families` stretch this into a ridge,
       *  so the ratio is the SHORT axis and compounds with them. */
      fissure: Object.freeze({ ratio: 5.0, reliefCap: 1500 }),
    }),
  }),
});
