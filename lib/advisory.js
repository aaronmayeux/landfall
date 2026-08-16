/**
 * advisory.js — advisory TEXT products, parsed. Pure; no DOM, no network.
 *
 * Phase 6 step 6. Two upstreams publish the words a forecaster actually
 * wrote, in two different wrappers, and this file turns both into the same
 * plain-text shape so everything downstream is source-blind.
 *
 * WHAT WAS MEASURED, 2026-07-25, through /api/nhc/inspect and
 * /api/jtwc/inspect. None of this is recalled or inferred:
 *
 * NHC — the product arrives as `.shtml`, a 26 kB page of NOAA site furniture
 * wrapping the teletype product.
 *   - EXACTLY ONE `<pre>` in the document (tag inventory: `pre: 1`), and it
 *     holds the complete product — 2,171 characters, from the WMO header
 *     `WTPZ31 KNHC 250237` down through `$$` and the forecaster names.
 *   - The `<pre>` is BARE: `<pre>`, no class, no id. Nothing to match on but
 *     the tag, which is why the extractor takes the longest one rather than
 *     trusting a selector that does not exist.
 *   - **NOAA INJECTS LIVE LINKS INSIDE THE PRODUCT.** The rip-current
 *     paragraph contains a real `<a href='...'>hurricanes.gov/...</a>`. A
 *     naive slice of the block puts raw HTML on screen. Inner tags are
 *     stripped and their TEXT kept, because that text is the URL the
 *     forecaster wrote and dropping it would silently delete a line of the
 *     advisory.
 *   - The URL: `publicAdvisory.url` in CurrentStorms.json points at the bare
 *     slot page `/text/MIATCPEP1.shtml`, and that page served **Amanda,
 *     June 7** — a dead storm from six weeks prior — while the feed said
 *     Fausto. IT IS NOT USED. The `/text/refresh/` path is, and its
 *     timestamp segment is a CACHE-BUSTER rather than a selector: `000000`
 *     and `999999` both returned the live product.
 *
 * JTWC — plain text, and far easier.
 *   - `text/plain`, ~4 kB, 97 lines, `looksLikeHtml: false`. No wrapper at
 *     all, so there is nothing to extract; only the header to read.
 *   - The identity line is `SUBJ/TYPHOON 11W (NOUL) WARNING NR 008//`, which
 *     carries the designation, the name, and the warning number together.
 *     That line is the entire reason JTWC is reachable from a GDACS storm.
 *
 * WHY THE NAME IS THE JOIN. GDACS publishes no advisory text of its own —
 * checked in four places and recorded in functions/api/jtwc/inspect.js — but
 * it NAMES its source, and for NOUL-26 that source is JTWC. The obvious key,
 * `sourceid`, is an EMPTY STRING. What both sides do carry is the name:
 * GDACS calls it `NOUL-26`, JTWC calls it `(NOUL)`. `stormNameKey` is the
 * function that makes those the same string, and it is deliberately
 * aggressive about punctuation and the year suffix because it is matching
 * two agencies' spelling conventions, not parsing an identifier.
 *
 * Imports: nothing. This file is the bottom of the stack.
 */

/* --- shared text hygiene ---------------------------------------------------- */

/** The entities NOAA's page builder actually emits, plus numeric forms.
 *  `&amp;` is decoded LAST so `&amp;lt;` cannot round-trip into a tag. */
export function decodeEntities(s) {
  return String(s)
    .replace(/&nbsp;/gi, ' ')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => safeCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => safeCodePoint(parseInt(d, 10)))
    .replace(/&amp;/gi, '&');
}

/** A bad numeric entity must not throw and must not vanish silently — it
 *  degrades to the literal it came from. */
function safeCodePoint(n) {
  if (!Number.isFinite(n) || n < 0 || n > 0x10ffff) return '�';
  try { return String.fromCodePoint(n); } catch { return '�'; }
}

/**
 * Teletype products are fixed-width and arrive padded with trailing spaces on
 * every line, including the blank ones. Those are invisible on screen but
 * they defeat `white-space: pre-wrap` line-length reasoning and make a blank
 * line look like a line of content to a screen reader. Removed; nothing
 * readable is removed with them.
 *
 * Leading and trailing blank lines go too — the `<pre>` opens and closes with
 * them — but interior blank lines are STRUCTURE in a teletype product and are
 * left exactly as they are.
 */
export function tidyProductText(s) {
  return String(s)
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/, ''))
    .join('\n')
    .replace(/^\n+/, '')
    .replace(/\n+$/, '');
}

/* --- NHC ------------------------------------------------------------------- */

/** Minimum plausible product length. A `<pre>` holding a dozen characters is
 *  a layout artefact, not an advisory, and rendering it would be the §5
 *  failure — an empty panel that looks like an answer. */
const MIN_PRODUCT_CHARS = 200;

/**
 * The teletype product out of an NHC `.shtml` page.
 *
 * Takes the LONGEST `<pre>` rather than the first. There is exactly one today
 * (measured), so the two are the same block — but if NOAA's template ever
 * grows a second, a decorative one, "first" picks by document order and
 * "longest" picks by which one is the advisory. Only one of those two is
 * reasoning about the thing we actually want.
 *
 * @param {string} html
 * @returns {{text: string, chars: number} | null} null when there is no
 *   product here at all — which the caller must render as a NAMED failure,
 *   never as an empty section.
 */
export function extractNhcProduct(html) {
  if (typeof html !== 'string' || !html) return null;

  let best = null;
  for (const m of html.matchAll(/<pre\b[^>]*>([\s\S]*?)<\/pre\s*>/gi)) {
    if (!best || m[1].length > best.length) best = m[1];
  }
  if (best == null) return null;

  /* Inner tags out, their TEXT kept — the injected rip-current anchor's text
   * is the URL the forecaster wrote. `<br>` becomes a newline first so a
   * template change from newlines to breaks degrades to correct wrapping
   * rather than to one run-on paragraph. */
  const text = tidyProductText(
    decodeEntities(
      best
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<[^>]*>/g, '')
    )
  );

  if (text.length < MIN_PRODUCT_CHARS) return null;
  return { text, chars: text.length };
}

/**
 * The advisory number as the product itself states it.
 *
 * Reported SEPARATELY from the storm feed's `advNum` on purpose. The two
 * disagreeing is real information — it means the text is from a different
 * cycle than the vitals above it, which is exactly the geometry-lag case §16
 * already handles with its own line. Returning null here is fine and common;
 * the caller falls back to the feed's number and says where it came from.
 *
 * Handles the intermediate form: "Advisory Number 12A".
 */
export function nhcAdvisoryNumber(text) {
  const m = String(text || '').match(/Advisory\s+Number\s+(\d+[A-Z]?)/i);
  return m ? m[1] : null;
}

/**
 * Does this NHC public advisory declare itself the LAST one on the system?
 *
 * ==> THIS IS THE ONLY DEFINITIVE END-OF-STORM SIGNAL NHC PUBLISHES. <==
 * `CurrentStorms.json` carries no final-advisory flag at any depth — that is
 * recorded in data/nhc.js and it is still true. What it does carry is a link to
 * this text, and the text says so outright. Everything else the app could
 * reach for (the storm leaving the list, a bin flushing to zero features, an
 * age crossing a threshold) is INFERENCE. This is a statement.
 *
 * TWO MARKERS, EITHER ONE SUFFICIENT, both CONFIRMED verbatim on a live
 * product 2026-07-28 — Post-Tropical Cyclone Imelda, AL092025, Advisory 24:
 *
 *   ...THIS IS THE FINAL NHC ADVISORY...          ← the headline block
 *   This is the last public advisory issued by     ← under NEXT ADVISORY,
 *   the National Hurricane Center on this system.     wrapped across lines
 *
 * WHY BOTH, AND WHY `\s+` BETWEEN EVERY WORD. NHC's text products are
 * hard-wrapped at ~70 columns, so any phrase long enough to be unambiguous is
 * long enough to contain a newline, and WHERE that newline falls moves with the
 * storm's name. Matching on a single-space literal would work on the fixture
 * and fail on the next storm whose name is two characters longer. The headline
 * form is short enough to survive on its own line, which is why it is worth
 * having as a second door.
 *
 * WHAT THIS DOES NOT MEAN. Not that the storm dissipated. Imelda's final
 * advisory described "a large and powerful system" with 75 mph winds crossing
 * the central Atlantic — NHC stopped writing about her because she became
 * extratropical and belongs to another desk, not because she went away. Every
 * string in lib/lifecycle.js is written to say only what this actually proves:
 * the agency has stopped issuing advisories.
 *
 * A FAILED FETCH MUST NEVER REACH THIS FUNCTION. `false` here means "this text
 * does not declare an ending", and an empty string returns `false` honestly.
 * Callers are responsible for not confusing that with "we could not read the
 * text" — data/lifecycle.js only ever asks this about a clean read.
 */
export function isNhcFinalAdvisory(text) {
  const s = String(text || '');
  return (
    /THIS\s+IS\s+THE\s+FINAL\s+NHC\s+ADVISORY/i.test(s) ||
    /THIS\s+IS\s+THE\s+LAST\s+PUBLIC\s+ADVISORY\s+ISSUED\s+BY/i.test(s)
  );
}

/* --- JTWC ------------------------------------------------------------------ */

/**
 * Does this JTWC warning declare itself the FINAL one on the system?
 *
 * CONFIRMED verbatim on a live product 2026-07-28 — Typhoon 26W (Mangkhut),
 * Warning NR 039:
 *
 *   THIS IS THE FINAL WARNING ON THIS SYSTEM BY THE JOINT TYPHOON WRNCEN
 *   PEARL HARBOR HI.
 *
 * Matched only as far as "ON THIS SYSTEM" and no further. The tail names the
 * issuing centre, and JTWC's warnings are also issued under other centre
 * strings — pinning the match to "PEARL HARBOR" would silently stop detecting
 * the end of a storm the day that byline changed, which is a failure that looks
 * exactly like no storms ever ending.
 *
 * `\s+` between every word for the same wrapping reason as the NHC form: these
 * are fixed-width teletype products and the line break lands wherever the
 * sentence runs out of columns.
 *
 * ==> THIS REGEX IS MIRRORED IN functions/api/jtwc/storms.js AND HAS TO BE. <==
 * A Pages Function runs in its own workerd runtime and cannot import the app
 * bundle (§3), and the relay is where every active warning's text is already in
 * hand — so that is the only place this can be asked for free. Both copies are
 * exported and tools/test-advisory.mjs asserts they agree on the same corpus,
 * which is the same guard `parseSubject` next door already carries. A copy
 * nobody checks is how the two drift; a copy with a test that fails when they
 * disagree is just a copy.
 */
export function isJtwcFinalWarning(text) {
  return /THIS\s+IS\s+THE\s+FINAL\s+WARNING\s+ON\s+THIS\s+SYSTEM/i.test(
    String(text || '')
  );
}

/**
 * The identity line of a JTWC warning.
 *
 *   SUBJ/TYPHOON 11W (NOUL) WARNING NR 008//
 *   SUBJ/TROPICAL DEPRESSION 12W WARNING NR 001//     ← unnamed, no parens
 *
 * The unnamed form is why `name` is nullable rather than required. A
 * depression gets a number before it gets a name, and a parser that demanded
 * the parentheses would drop exactly the storms that are still forming.
 *
 * @returns {{kind: string, designation: string, name: string|null,
 *            warningNumber: string|null} | null}
 */
export function parseJtwcWarning(text) {
  const s = String(text || '');
  const m = s.match(
    /SUBJ\/\s*([A-Z][A-Z '.-]*?)\s+(\d{2}[A-Z])\s*(?:\(([^)]*)\))?\s*WARNING\s+NR\s*(\d+)/i
  );
  if (!m) return null;
  const name = m[3] ? m[3].trim() : null;
  return {
    kind: m[1].trim(),
    designation: m[2].toUpperCase(),
    name: name || null,
    warningNumber: m[4] || null,
  };
}

/* --- the join -------------------------------------------------------------- */

/**
 * A storm name reduced to something two agencies can agree on.
 *
 * GDACS writes `NOUL-26`; JTWC writes `NOUL`; NHC writes `Noul`. The year
 * suffix is GDACS's own disambiguator and means nothing to anyone else, so it
 * goes — but ONLY when it is a trailing `-` plus digits, so a genuine
 * hyphenated name survives.
 *
 * Everything that is not a letter is dropped afterwards. That is blunt on
 * purpose: this is a spelling reconciliation between two human-maintained
 * bulletins, not an id lookup, and the failure mode of being too strict
 * (no advisory text for a storm that has one) is worse than the failure mode
 * of being too loose (two storms would have to share a name, in the same
 * season, in JTWC's active list, to collide).
 */
export function stormNameKey(name) {
  return String(name || '')
    .replace(/-\d+\s*$/, '')
    .toUpperCase()
    .replace(/[^A-Z]/g, '');
}

/**
 * Find the JTWC index entry for a storm name, or null.
 *
 * Returns null rather than a best guess. A wrong advisory is worse than no
 * advisory — it is the one failure on this panel that could send someone the
 * wrong way — so an unmatched name is `none_matched`, which the panel states
 * plainly (§5).
 */
/**
 * The same matcher under a source-neutral name.
 *
 * It only ever reads `.name` off each entry, so it was never JTWC-specific —
 * and model tracks now match GDACS names against TCGP's storm list with it.
 * Exported as an alias rather than renamed so the advisory call sites, their
 * comments and their tests all keep saying what they mean.
 */
export const matchStormByName = (index, stormName) => matchJtwcStorm(index, stormName);

export function matchJtwcStorm(index, stormName) {
  const key = stormNameKey(stormName);
  if (!key || !Array.isArray(index)) return null;

  const exact = index.find((e) => {
    const k = stormNameKey(e.name);
    return k && k === key;
  });
  if (exact) return exact;

  /* ONE BOUNDED FALLBACK, for a case that has not been seen but would fail
   * silently and wrongly if it ever arrived.
   *
   * data/gdacs.js prefers `eventname` ("FAUSTO-26"), which keys cleanly. Its
   * fallback field is `name` — "Tropical Cyclone FAUSTO-26" — and that keys
   * to TROPICALCYCLONEFAUSTO, which matches nothing. The panel would then
   * say "JTWC has no current warning under this storm's name" about a storm
   * JTWC is actively warning on. That is a §5 false claim, not a missing
   * feature, and it is the failure mode this whole file is arranged against.
   *
   * So: a JTWC name is accepted when it is a SUFFIX of the storm's key, which
   * is what a descriptive prefix produces and nothing else does. Guarded at
   * four characters because a two-letter suffix would start matching storms
   * to each other, and requiring uniqueness because an ambiguous match is
   * exactly as bad as a wrong one.
   */
  const candidates = index.filter((e) => {
    const k = stormNameKey(e.name);
    return k.length >= 4 && key.endsWith(k);
  });
  return candidates.length === 1 ? candidates[0] : null;
}

/* --- HAZARDS AFFECTING LAND ------------------------------------------------
 *
 * §48.2. Every NHC Public Advisory carries this block, and its subsections are
 * introduced by an all-caps label and a colon at the start of a line. Measured
 * labels across the captured products: WIND, RAINFALL, STORM SURGE, SURF, and
 * — on Ida, which §48.2 does not mention — TORNADOES.
 *
 * ==> THE PARAGRAPH IS FOUND AND SHOWN, NEVER REWRITTEN. <== The same rule
 * surge follows: NHC's range IS the forecast, and a summary of it would be a
 * second opinion nobody asked for. Nothing below extracts a number, classifies
 * a severity, or shortens a sentence. The whole job is to find the block, stop
 * at the next label, and hand back words.
 * ------------------------------------------------------------------------- */

const HAZARDS_HEADING = 'HAZARDS AFFECTING LAND';

/** A teletype section underline: a line of nothing but dashes. It is what
 *  separates one major heading from the next, and it is the only reliable
 *  boundary in the product — the headings themselves are ordinary capitals. */
const RULE_LINE = /^-{3,}\s*$/;

/** A subsection label: capitals and spaces, then a colon, at line start.
 *  `RAINFALL:` and `STORM SURGE:` both match; a wrapped sentence beginning
 *  with a place name does not, because it has no colon. */
const LABEL_LINE = /^([A-Z][A-Z0-9 ()/'.-]*):/;

/** Paragraphs that are plumbing rather than forecast, stripped from the end of
 *  the rainfall block (§48.2). Both are measured as present on Lala: a pointer
 *  at the rainfall graphic, and a pointer at the WPC storm summary. Matched on
 *  their opening words rather than on "starts with For a", which would
 *  eventually eat a real forecast sentence. */
const POINTER_PARAGRAPH = [
  /^For a complete depiction\b/i,
  /^For a list of rainfall observations\b/i,
];

/**
 * The HAZARDS AFFECTING LAND block, as raw lines.
 *
 * @returns {string|null} the block's contents without its heading or
 *   underline, or null when the product has no such block at all.
 */
export function hazardsBlock(text) {
  const lines = String(text || '').split('\n');
  const start = lines.findIndex((l) => l.trim() === HAZARDS_HEADING);
  if (start < 0) return null;

  /* Skip the heading and its underline. The underline is optional here on
   * purpose: a template that stops drawing it must not take the block with it. */
  let i = start + 1;
  if (RULE_LINE.test(lines[i] || '')) i++;

  /* ==> THE BLOCK ENDS AT THE NEXT HEADING, WHICH IS THE LINE ABOVE THE NEXT
   * UNDERLINE. <== There is no closing marker, and the next heading is not
   * distinguishable from the capitalised lines inside the block — but its
   * underline is. `$$` closes the product when nothing follows. */
  const end = (() => {
    for (let j = i; j < lines.length; j++) {
      if (RULE_LINE.test(lines[j])) return Math.max(i, j - 1);
      if (lines[j].trim() === '$$') return j;
    }
    return lines.length;
  })();

  return lines.slice(i, end).join('\n').trim();
}

/**
 * Teletype text → paragraphs, rewrapped.
 *
 * Products are hard-wrapped at roughly 68 columns, so a paragraph arrives with
 * newlines mid-sentence and rendering it verbatim gives a ragged column on a
 * phone. A BLANK LINE IS A REAL PARAGRAPH BREAK and is kept — and "blank"
 * means whitespace-only, because NHC's own products separate paragraphs with a
 * line holding a single space as often as with an empty one.
 */
export function rewrapProduct(text) {
  return String(text || '')
    .split('\n')
    .reduce((paras, line) => {
      if (!line.trim()) paras.push([]);
      else (paras[paras.length - 1] || paras[paras.push([]) - 1]).push(line.trim());
      return paras;
    }, [[]])
    .map((lines) => lines.join(' ').trim())
    .filter(Boolean);
}

/**
 * The rainfall forecast out of an advisory (§48.2).
 *
 * ==> `None.` IS A REAL ANSWER AND IT MUST SURVIVE. <== A storm with no land
 * threat publishes the hazards heading followed by exactly that, with no
 * labelled subsections at all. A storm whose advisory failed to load looks
 * identical to a caller who only checks for the absence of a RAINFALL label,
 * and the two must never render the same sentence.
 *
 * @returns {{state:'ok', paragraphs:string[]} |
 *           {state:'no_hazards'} |
 *           {state:'no_rainfall'} |
 *           {state:'no_block'}}
 */
export function advisoryRainfall(text) {
  const block = hazardsBlock(text);
  if (block == null) return { state: 'no_block' };
  if (/^none\.?$/i.test(block.trim())) return { state: 'no_hazards' };

  const lines = block.split('\n');
  const at = lines.findIndex((l) => (LABEL_LINE.exec(l) || [])[1] === 'RAINFALL');
  if (at < 0) return { state: 'no_rainfall' };

  /* Stop at the next label, whatever it is. Enumerating the labels that can
   * follow rainfall would mean a new one — and there has already been one this
   * file did not expect — silently joins the rainfall paragraph. */
  let end = lines.length;
  for (let j = at + 1; j < lines.length; j++) {
    if (LABEL_LINE.test(lines[j])) { end = j; break; }
  }

  const body = [lines[at].replace(LABEL_LINE, '').trimStart(), ...lines.slice(at + 1, end)]
    .join('\n');

  const paragraphs = rewrapProduct(body)
    .filter((p) => !POINTER_PARAGRAPH.some((re) => re.test(p)));

  return paragraphs.length ? { state: 'ok', paragraphs } : { state: 'no_rainfall' };
}
