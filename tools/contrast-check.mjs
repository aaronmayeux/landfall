/**
 * contrast-check.mjs — WCAG AA gate on config/tokens.js.
 *
 * Run:  node tools/contrast-check.mjs
 * Exit: 0 if every REQUIRED pair passes, 1 if any fails.
 *
 * WHY THIS EXISTS. Light mode doubled the number of color pairs in the app,
 * and "looks fine on my monitor" is not a contrast measurement. Every pair a
 * user must actually READ is enumerated here and checked against the real
 * WCAG 2.1 relative-luminance formula, in BOTH palettes, every time.
 *
 * ---------------------------------------------------------------------------
 * TWO TIERS, AND THE LINE BETWEEN THEM IS DELIBERATE.
 *
 * REQUIRED — fails the run. Anything carrying information the user has to
 *   read or act on: body text, labels, status colors, the focus ring, control
 *   boundaries, and the halo that makes a storm glyph findable.
 *
 * ADVISORY — printed, never fails. Cartographic furniture that is quiet ON
 *   PURPOSE (§11: a border is reference, a coastline is where water meets
 *   land) and the raw severity FILLS, which WCAG's non-text rule does not
 *   reach in the way it first appears to. See SEVERITY below.
 *
 * ---------------------------------------------------------------------------
 * SEVERITY COLORS AND WHY THEY ARE NOT CHECKED AGAINST THE MAP.
 *
 * SPEC §6 fixes the Saffir-Simpson and watch/warning colors: a Cat 3 dot must
 * read the same in every theme, on every device. That contract and "make the
 * yellow darker so it passes on a pale ocean" cannot both be true.
 *
 * The resolution is the one WCAG itself points at — do not carry meaning by
 * hue alone. Every severity mark in Landfall is drawn with a HALO/STROKE in
 * the theme's ink color, and the mark is also labelled ("TD", "TS", "1".."5").
 * So what gets REQUIRED-checked is the halo against the map, and the label
 * against its own dot. The fill's job is to say WHICH severity once you have
 * found the mark; the halo's job is to make it findable. Check the halo.
 * ------------------------------------------------------------------------- */

import {
  DARK, LIGHT,
  CATEGORY_COLOR, HURRICANE_UNKNOWN_COLOR,
  WATCH_WARNING_COLOR, WIND_BAND_COLOR, SURGE_RAMP,
  MODEL_COLOR, MODEL_COLOR_LIGHT, STORM_GEO,
} from '../config/tokens.js';

/** The categories that actually get a code drawn inside their dot.
 *  `categoryDotCode` (lib/category.js) returns '' for anything without an
 *  earned Saffir-Simpson reading, so GENERIC and the unknown-strength
 *  hurricane never carry text and are not part of the code check. Checking
 *  them would fail the run over glyphs that are never drawn. */
const CODED_CATEGORIES = ['TD', 'TS', 'CAT1', 'CAT2', 'CAT3', 'CAT4', 'CAT5'];

/** Every mark whose color means a severity, including the two that sit
 *  outside the Saffir-Simpson ramp. */
const SEVERITY_MARKS = {
  ...CATEGORY_COLOR,
  HU_UNKNOWN: HURRICANE_UNKNOWN_COLOR,
};

/* --- color math ------------------------------------------------------------
 * WCAG 2.1 relative luminance, verbatim from the spec. No approximations —
 * an eyeballed sRGB curve is how a "passing" palette ships at 4.3:1.
 * ------------------------------------------------------------------------ */

function parse(color) {
  const c = String(color).trim();

  const hex = c.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hex) {
    const h = hex[1].length === 3 ? hex[1].split('').map((x) => x + x).join('') : hex[1];
    return {
      r: parseInt(h.slice(0, 2), 16),
      g: parseInt(h.slice(2, 4), 16),
      b: parseInt(h.slice(4, 6), 16),
      a: 1,
    };
  }

  const rgba = c.match(/^rgba?\(([^)]+)\)$/i);
  if (rgba) {
    const p = rgba[1].split(',').map((x) => Number(x.trim()));
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  }

  throw new Error(`contrast-check: cannot parse color "${color}"`);
}

/** Composite a possibly-translucent color over an opaque one. A glass panel's
 *  text does not sit on `rgba(255,255,255,0.9)` — it sits on that color ALREADY
 *  MIXED with whatever is behind it, which for Landfall is the globe. Checking
 *  against the unmixed value overstates the contrast every time. */
function over(fg, bg) {
  const f = parse(fg);
  const b = parse(bg);
  if (f.a >= 1) return f;
  return {
    r: f.r * f.a + b.r * (1 - f.a),
    g: f.g * f.a + b.g * (1 - f.a),
    b: f.b * f.a + b.b * (1 - f.a),
    a: 1,
  };
}

function luminance(c) {
  const ch = (v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * ch(c.r) + 0.7152 * ch(c.g) + 0.0722 * ch(c.b);
}

/** Contrast ratio between a foreground and an opaque backdrop.
 *  Both are composited over `base` first, so translucent glass and translucent
 *  text (`dim`) are measured as they actually appear. */
function ratio(fg, bg, base) {
  const backdrop = over(bg, base);
  const front = over(fg, rgbToHex(backdrop));
  const a = luminance(front);
  const b = luminance(backdrop);
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

const rgbToHex = (c) =>
  '#' + [c.r, c.g, c.b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');

/* --- thresholds ---------------------------------------------------------- */

const AA_TEXT = 4.5;   // 1.4.3 — body text
const AA_LARGE = 3.0;  // 1.4.3 — >=18.66px bold or >=24px
const AA_NONTEXT = 3.0; // 1.4.11 — UI components, focus indicators, graphics

/* Model guidance has a FLOOR and no ceiling, and the missing ceiling is a
 * decision rather than an omission.
 *
 * A first pass gated the top end too, reasoning that guidance must stay
 * quieter than the official past track. The numbers said otherwise: the DARK
 * theme has always run 3.6-6.5:1 — a bright cyan on a near-black ocean is
 * inherently high-contrast — and it reads correctly on glass, because what
 * makes guidance recede there is its WIDTH, its DASH, its 0.7 opacity and its
 * position under the official tracks (§7, §13). Contrast is not the channel
 * carrying the grammar, so gating it would have failed a shipped, confirmed
 * design to satisfy a rule invented at the checker. The comparison is printed
 * as ADVISORY instead. */
const GUIDANCE_MIN = 2.2;

/* --- the pairs -------------------------------------------------------------
 * `base` is what the panel itself floats over: the globe. Ocean is the honest
 * worst case for a panel backdrop — land is lighter in light mode and darker
 * in dark mode, so ocean is the one that squeezes the glass composite hardest
 * in the direction that hurts.
 * ------------------------------------------------------------------------ */

function requiredPairs(P) {
  const base = P.ocean;
  const glass = P.glass;
  const raised = P.glassRaised;

  return [
    /* --- panel text ----------------------------------------------------- */
    ['body text on glass',            P.textPrimary,   glass,  base, AA_TEXT],
    ['secondary text on glass',       P.textSecondary, glass,  base, AA_TEXT],
    ['muted text on glass',           P.textMuted,     glass,  base, AA_TEXT],
    ['body text on raised glass',     P.textPrimary,   raised, base, AA_TEXT],
    ['secondary text on raised',      P.textSecondary, raised, base, AA_TEXT],
    ['muted text on raised',          P.textMuted,     raised, base, AA_TEXT],

    /* --- status vocabulary. These are words the user reads to learn that
     * something is wrong, so they are TEXT, not decoration. ---------------- */
    ['error text on glass',           P.error,         glass,  base, AA_TEXT],
    ['stale text on glass',           P.stale,         glass,  base, AA_TEXT],
    ['ok text on glass',              P.ok,            glass,  base, AA_TEXT],
    ['error text on raised',          P.error,         raised, base, AA_TEXT],
    ['stale text on raised',          P.stale,         raised, base, AA_TEXT],

    /* --- controls --------------------------------------------------------- */
    ['focus ring on glass',           P.focusRing,     glass,  base, AA_NONTEXT],
    ['focus ring on raised glass',    P.focusRing,     raised, base, AA_NONTEXT],
    ['focus ring on the globe',       P.focusRing,     base,   base, AA_NONTEXT],

    /* THE EDGE, NOT THE FILL, is what 1.4.11 asks for here: "visual
     * information required to identify... states" at 3:1 against ADJACENT
     * colors. A chosen segment is identified by its hairline edge (plus
     * weight, plus aria-checked); the fill is reinforcement. The fill's
     * number is printed in ADVISORY so a change that flattens it is still
     * visible, but the edge is the pair that gates the run. */
    ['chosen segment edge vs group',  P.segActiveEdge, raised, base, AA_NONTEXT],
    ['body text on chosen segment',   P.textPrimary,   P.segActive, base, AA_TEXT],
    /* ==> THE EDGE, NOT THE FILL, AND THIS PAIR MOVED ON PURPOSE. <==
     *
     * This used to measure `installCta` against the panel, which forced the
     * light theme to carry a dark amber fill and made the CTA two different
     * colors in the two themes. The fill is now dark mode's #F0B23C in BOTH,
     * and `installCtaEdge` draws the boundary — the same reading 1.4.11 already
     * gets applied to the chosen segment three lines up: a control is
     * identified by its edge, its fill is reinforcement. The fill's number is
     * printed in ADVISORY so a change that flattens it is still visible, but
     * the edge is the pair that gates the run.
     *
     * The heading is a REQUIREMENT rather than advisory because it is the one
     * place this amber is used as words. `#F0B23C` as text on a white panel is
     * about 1.6:1, so without this row the light theme could quietly ship an
     * unreadable heading and pass. */
    ['install button edge vs raised glass', P.installCtaEdge, raised, base, AA_NONTEXT],
    ['install button label',          P.installCtaInk, P.installCta, base, AA_TEXT],
    ['install heading on raised glass', P.installCtaEdge, raised, base, AA_TEXT],

    /* --- ghosts and disabled rows still have to be READ, just quietly ----- */
    ['dim text on raised glass',      P.dim,           raised, base, AA_LARGE],

    /* --- the map's own text -----------------------------------------------
     * A map label is drawn WITH A HALO, and the halo is the backdrop that
     * decides legibility — not the terrain underneath, which changes pixel to
     * pixel and which the halo exists precisely to hide. So the pair that
     * matters is text-against-its-own-halo.
     *
     * The halo-against-terrain number is NOT a requirement and is printed in
     * ADVISORY instead. In the dark theme the storm-name halo IS the ocean
     * color, which is correct: over water the label needs no outline at all,
     * and over land the halo is what carves it out. Requiring the halo to
     * contrast with the ocean would have demanded an outline around text that
     * is already sitting on its own background. */
    /* ==> THE X IS THE ENTIRE STATEMENT THAT A STORM IS OVER, so it is a
     * REQUIRED pair and not an advisory one. Its dot is the one mark in the app
     * whose fill flips with the theme — bone at night, dark neutral in daylight
     * — so its ink flips too, and a future palette edit that moves one without
     * the other puts a drawn-and-invisible mark on the map. Measured against
     * the disc itself, which is the only thing behind it: the layer carries no
     * halo because the dot IS the backdrop. */
    ['ended-storm X on its own dot',    P.geo.endedMark,  P.stormEnded,        P.stormEnded,         AA_TEXT],

    ['storm name vs its halo',          P.textSecondary,  P.geo.stormLabelHalo, P.geo.stormLabelHalo, AA_TEXT],
    ['forecast time label vs its halo', P.geo.labelColor, P.geo.labelHalo,      P.geo.labelHalo,      AA_TEXT],

    /* --- the two lines a storm is actually read against ------------------- */
    ['coastline vs the ocean',        P.coastGlow,     P.ocean, P.ocean, AA_NONTEXT],
    ['forecast track over the ocean', P.geo.trackForecast, P.ocean, P.ocean, AA_NONTEXT],
    ['forecast track over land',      P.geo.trackForecast, P.land,  P.land,  AA_NONTEXT],
    ['cone outline over the ocean',   P.geo.coneLine,  P.ocean, P.ocean, AA_NONTEXT],
  ];
}

/**
 * SEVERITY FINDABILITY — the §6 contract expressed as something measurable.
 *
 * The rule is NOT "the fill must clear 3:1", because that would demand a
 * themeable severity color and §6 forbids one. The rule is the one WCAG
 * actually states: the MARK must be distinguishable from its background. A
 * mark is a fill inside a halo, so it is distinguishable if EITHER carries
 * the separation.
 *
 * And that is exactly how the two themes work, from opposite directions:
 *   - dark theme: a bright Cat 1 yellow on a near-black ocean. The FILL does it.
 *   - light theme: the same yellow on a pale daytime ocean, where the fill has
 *     almost no luminance difference. The dark HALO does it.
 *
 * One rule, both themes, and the fixed colors stay fixed.
 */
function findabilityPairs(P) {
  const rows = [];

  /* Two marks, each with its own outline: the storm glyph wears `glyphHalo`,
   * the forecast dot wears `pointStroke`. Same rule applied to each. */
  const marks = [
    ['glyph', P.geo.glyphHalo],
    ['dot', P.geo.pointStroke],
  ];

  for (const surface of ['ocean', 'land']) {
    const where = surface === 'ocean' ? 'the ocean' : 'land';
    for (const [markName, outline] of marks) {
      for (const [name, fill] of Object.entries(SEVERITY_MARKS)) {
        rows.push([
          `${name} ${markName} findable over ${where}`,
          Math.max(ratio(fill, P[surface], P[surface]),
                   ratio(outline, P[surface], P[surface])),
          AA_NONTEXT,
        ]);
      }
    }
  }
  return rows;
}

/**
 * MODEL GUIDANCE — the one check with a CEILING as well as a floor.
 *
 * Guidance lines are the only §6-adjacent color that is themed (see the block
 * in config/tokens.js). They have no halo and cannot have one, so the hue
 * itself has to clear the surface — and the dark set measured 1.00:1 against
 * the daylight ocean, which is not "washed out" but literally the same
 * luminance as the sea.
 *
 * ==> AND THEY MUST STAY QUIETER THAN THE PAST TRACK. <==
 * §7's line grammar is the whole reason this layer is thin and dashed: a raw
 * model run must never wear NHC's authority. Forecast track 8.50 : past track
 * 3.31 : guidance below that. A future "fix" that darkens these until they
 * pass 4.5:1 would win contrast and lose the grammar, and nothing else in the
 * repo would notice. So the ceiling is checked too.
 *
 * COMPOSITED AT THE LAYER'S OWN OPACITY, because that is what reaches the eye.
 * Reading the raw hex overstates every one of these by roughly a third.
 */
function modelGuidancePairs(P, isLightTheme) {
  const table = isLightTheme ? MODEL_COLOR_LIGHT : MODEL_COLOR;
  const alpha = STORM_GEO.modelLineOpacity;
  /* `parse` takes rgba(), not an 8-digit hex — so the layer opacity is
   * expressed the way the checker already understands. */
  const withAlpha = (hex) => {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${n >> 16 & 255}, ${n >> 8 & 255}, ${n & 255}, ${alpha})`;
  };

  const rows = [];
  const seen = new Set();
  for (const [tech, hex] of Object.entries(table)) {
    if (seen.has(hex)) continue;      // TVCN/HCCA and the reused TCGP hues
    seen.add(hex);
    for (const surface of ['ocean', 'land']) {
      rows.push([
        `guidance ${tech} legible over ${surface === 'ocean' ? 'the ocean' : 'land'}`,
        ratio(withAlpha(hex), P[surface], P[surface]),
        GUIDANCE_MIN,
      ]);
    }
  }
  return rows;
}

/** The code drawn INSIDE a forecast dot, against every fill it can land on.
 *  Small text, so the full 4.5:1 applies — and the worst case is the one that
 *  decides, not the average. */
function codeInkPairs(P) {
  return CODED_CATEGORIES.map((name) => [
    `code "${name}" ink on its own dot`,
    ratio(P.geo.pointCodeColor, CATEGORY_COLOR[name], CATEGORY_COLOR[name]),
    AA_TEXT,
  ]);
}

function advisoryPairs(P) {
  const out = [
    /* §11 furniture: quiet by design. Listed so a change that makes them
     * INVISIBLE (the #26496D graticule incident) shows up as a number. */
    ['national border vs land',   P.adminCountry, P.land,  P.land],
    ['state border vs land',      P.adminState,   P.land,  P.land],
    ['country name over land',    P.textCountry,  P.land,  P.land],
    /* No separate state-name row: state names now use `textPlace` and the
     * ocean halo, so the two city rows below cover them exactly. */
    ['city name over land',       P.textPlace,    P.land,  P.land],
    ['city name over the ocean',  P.textPlace,    P.ocean, P.ocean],
    ['major graticule vs ocean',  P.graticuleMajor, P.ocean, P.ocean],
    ['cage at rest vs the ocean', P.mesh,         P.ocean, P.ocean],
    ['cage node vs the ocean',    P.node,         P.ocean, P.ocean],
    ['land vs ocean',             P.land,         P.ocean, P.ocean],
    ['past track over the ocean', P.geo.trackPast, P.ocean, P.ocean],
    ['chosen segment FILL vs its group', P.segActive, P.glassRaised, P.ocean],
    /* Same reading as the segment above: the switch carries a `glassBorder`
     * edge and its state is thumb position + weight + aria-checked, so the
     * track fill is reinforcement and advisory. Printed so a future edit that
     * flattens ON into OFF is visible rather than silent. */
    ['switch ON track vs OFF track', P.switchOn, P.glassRaised, P.ocean],
    ['switch ON thumb on its track', P.textPrimary, P.switchOn, P.ocean],
    /* The first dot's white ring against the water, printed and NOT required.
     * It is low in the light theme by construction — white on a pale sea — and
     * that is accepted: the ring's job is to differ from its NEIGHBOURS, every
     * one of which wears a near-black ring, not to clear a bar against the
     * terrain. A dark backing disc was tried for one commit to raise this
     * number and read as a black-ringed dot on glass; the note in
     * map/layers/points-forecast.js says why it is not coming back, and making
     * this a REQUIRED pair is exactly what would force the ring dark. */
    ['first-point ring vs the ocean', P.geo.pointStrokeFirst, P.ocean, P.ocean],
    ['first-point ring vs an ordinary ring', P.geo.pointStrokeFirst, P.geo.pointStroke, P.ocean],
    ['install button FILL vs its panel', P.installCta, P.glassRaised, P.ocean],
    ['storm name vs the bare ocean (halo does the work)',
      P.textSecondary, P.ocean, P.ocean],
    ['storm name halo vs land (0 = halo IS the ocean, by design)',
      P.geo.stormLabelHalo, P.land, P.land],
    ['forecast time halo vs the ocean',
      P.geo.labelHalo, P.ocean, P.ocean],
    ['3D coastline vs 3D land',   P.coast3d,      P.land3d, P.land3d],
    ['outage cage vs the ocean',  P.meshMuted,    P.ocean, P.ocean],
  ];

  /* Severity FILLS against both surfaces. Advisory by the reasoning in the
   * header — the halo is what carries findability. A number well under 3
   * here is expected and fine; a number under 1.3 means the fill has stopped
   * being TELLABLE from the map at all, which is worth a human look. */
  for (const [name, c] of Object.entries(CATEGORY_COLOR)) {
    out.push([`category ${name} fill vs the ocean`, c, P.ocean, P.ocean]);
  }
  for (const [name, c] of Object.entries(WATCH_WARNING_COLOR)) {
    out.push([`watch/warning ${name} vs the ocean`, c, P.ocean, P.ocean]);
  }
  for (const [name, c] of Object.entries(WIND_BAND_COLOR)) {
    out.push([`wind band ${name} vs the ocean`, c, P.ocean, P.ocean]);
  }
  for (const s of SURGE_RAMP) {
    out.push([`surge "${s.label}" vs land`, s.color, P.land, P.land]);
  }
  return out;
}

/** The §6 promise, checked as a promise: every severity color must stay
 *  TELLABLE FROM ITS NEIGHBOUR in the ramp. Theme-independent — these colors
 *  do not change — so it runs once, not per palette. */
function rampSeparation() {
  const ramp = Object.entries(CATEGORY_COLOR);
  const rows = [];
  for (let i = 1; i < ramp.length; i++) {
    const [na, a] = ramp[i - 1];
    const [nb, b] = ramp[i];
    rows.push([`${na} vs ${nb}`, ratio(a, b, b)]);
  }
  return rows;
}

/* --- run ------------------------------------------------------------------ */

const fmt = (n) => n.toFixed(2).padStart(6);
let failures = 0;

for (const [themeName, P] of [['DARK', DARK], ['LIGHT', LIGHT]]) {
  console.log(`\n=== ${themeName} ${'='.repeat(60 - themeName.length)}`);

  console.log('\n  REQUIRED');
  const rows = [
    ...requiredPairs(P).map(([label, fg, bg, base, min]) => [label, ratio(fg, bg, base), min]),
    ...findabilityPairs(P),
    ...codeInkPairs(P),
    ...modelGuidancePairs(P, P === LIGHT),
  ];
  for (const [label, r, min] of rows) {
    const pass = r >= min;
    if (!pass) failures++;
    console.log(`  ${pass ? 'ok  ' : 'FAIL'} ${fmt(r)}:1  (need ${min.toFixed(1)})  ${label}`);
  }

  console.log('\n  ADVISORY (never fails — quiet by design)');
  for (const [label, fg, bg, base] of advisoryPairs(P)) {
    console.log(`       ${fmt(ratio(fg, bg, base))}:1  ${label}`);
  }
  /* The grammar comparison the REQUIRED gate deliberately does NOT enforce —
   * see the note on GUIDANCE_MIN. Printed so that anyone darkening guidance
   * can see what it is doing to §7's ordering before they ship it. */
  console.log(
    `       ${fmt(ratio(P.geo.trackForecast, P.ocean, P.ocean))}:1  ` +
    `[grammar] forecast track over the ocean — must stay the loudest`
  );
  console.log(
    `       ${fmt(ratio(P.geo.trackPast, P.ocean, P.ocean))}:1  ` +
    `[grammar] past track over the ocean — guidance should sit under this`
  );
}

console.log(`\n=== SEVERITY RAMP SEPARATION (theme-independent) ${'='.repeat(15)}`);
for (const [label, r] of rampSeparation()) {
  console.log(`       ${fmt(r)}:1  ${label}`);
}

console.log('');
if (failures) {
  console.error(`${failures} REQUIRED pair(s) below WCAG AA.`);
  process.exit(1);
}
console.log('All required pairs meet WCAG AA.');
