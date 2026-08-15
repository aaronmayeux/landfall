/**
 * _ships-parse.js — raw SHIPS text to a small JSON object. §47.2, §47.4.
 *
 * A PURE FUNCTION. No network, no DOM, no clock. Text in, object out, or it
 * throws. Everything that decides anything about the environment ribbon lives
 * here, so the one place worth testing hard is one file with one entry point.
 *
 * WHY IT IS UNDER functions/ RATHER THAN lib/, which is where README puts
 * parsers. §47.7 says parsing happens in the relay and the browser receives
 * the small JSON, for a real reason: the fixed-width table is 9-10 KB per
 * storm per advisory and the numbers out of it are a fraction of that, and
 * three synoptic slots have to be tried and resolved before anyone can say a
 * run is missing (§47.2) — which is a fetch loop, not a browser's job. Putting
 * this file in lib/ would leave a working client-side SHIPS parser sitting on
 * the shipped path inviting exactly the thing the section rules out. Under
 * functions/ the browser cannot reach it. `_` is Cloudflare's not-a-route
 * marker; `tools/check-syntax.mjs` already covers these files.
 *
 * IT FAILS LOUDLY AND THAT IS THE POINT. A SHIPS file that has changed shape
 * is not a smaller answer, it is a WRONG answer — a row landing in the wrong
 * group, or a row nobody has seen being dropped, both misreport the model's
 * own accounting while looking perfectly healthy on screen. §5 forbids
 * silence; this forbids confident nonsense, which is worse. Every throw
 * carries a `code` the route turns into an honest failure the reader can see.
 *
 * EVERY NUMBER IN AND OUT OF HERE IS KNOTS (§8). Nothing converts. The reader's
 * units are applied at the moment text is drawn, and not before, because these
 * terms have to add up on screen and rounding each one independently breaks
 * that (§47.4).
 */

/* --------------------------------------------------------------------------
 * THE EIGHT TOKENS THAT ARE NOT NUMBERS.
 *
 * Measured across the whole 2026 season, 365 files (§47.2). They sit in
 * columns where a number belongs, so a parser that does not know them turns
 * them into NaN and quietly mangles a row.
 *
 *   N/A     every column past the end of a short forecast
 *   LOST    MODEL VTX, where the model loses the vortex
 *   xx.x    latitude, past the last published position
 *   xxx.x   longitude, same
 *   TROP    Storm Type — tropical
 *   SUBT    Storm Type — subtropical (ONE occurrence in the whole season)
 *   EXTP    Storm Type — extratropical
 *   DIS     dissipated, in the Atlantic-only DSHIPS block below
 *
 * ==> A NINTH TOKEN IS A HARD FAILURE, NOT A ZERO. <== This set is the whole
 * reason the sweep in tools/ships-corpus.mjs exists. If a file ever carries a
 * token this list has never seen, the honest answer is that we no longer know
 * what the file says — not a plausible number in its place.
 * ----------------------------------------------------------------------- */
const NON_NUMERIC = new Set(['N/A', 'LOST', 'xx.x', 'xxx.x', 'TROP', 'SUBT', 'EXTP', 'DIS']);

/** The Storm Type row's three real values. Anything else there is a bug. */
const STORM_TYPES = new Set(['TROP', 'SUBT', 'EXTP']);

/* --------------------------------------------------------------------------
 * THE NINETEEN CONTRIBUTION ROWS, AND WHICH GROUP EACH ONE IS IN.
 *
 * §47.4. These are the model's own per-factor accounting in knots, cumulative
 * from now, and they sum to TOTAL CHANGE. Three groups, of which ONLY THE
 * FIRST IS COLOURED:
 *
 *   env       the environment — the ribbon IS the signed sum of these
 *   headroom  how far below its own ceiling the storm sits — shown, never
 *             coloured, because it reports the storm back to itself (§47.4)
 *   storm     the storm itself and the model's bookkeeping — shown, never
 *             coloured
 *
 * THE THREE SHEAR ROWS SHARE ONE KEY on purpose. Shear is one thing to a
 * person, so it is summed and spoken of as one thing. All three are still
 * READ and PLACED — nothing is dropped, they simply land in the same bucket.
 *
 * ==> THE COUNT IS LOAD-BEARING. <== An earlier version of §47 named only
 * sixteen rows and dropped SAMPLE MEAN CHANGE, ZONAL STORM MOTION and
 * STEERING LEVEL PRES, which left the accounting short by a mean of 1.5 kt and
 * as much as 20 kt. The reconciliation assertion below is what makes that
 * class of mistake impossible to ship rather than merely unlikely.
 *
 * `key` is what goes on the wire. It is a machine name, not a display name —
 * the plain words a reader sees (dry air, cold air aloft, deep warm water) are
 * §47.8's job and are written client-side, where the sentence is written.
 * ----------------------------------------------------------------------- */
const ROWS = Object.freeze([
  /* The environment — the only coloured group. Ten rows, eight keys. */
  { label: 'VERTICAL SHEAR MAG', group: 'env', key: 'shear' },
  { label: 'VERTICAL SHEAR ADJ', group: 'env', key: 'shear' },
  { label: 'VERTICAL SHEAR DIR', group: 'env', key: 'shear' },
  { label: '200/250 MB TEMP.', group: 'env', key: 'tempAloft' },
  { label: 'THETA_E EXCESS', group: 'env', key: 'thetaE' },
  { label: '700-500 MB RH', group: 'env', key: 'midRh' },
  { label: '850 MB ENV VORTICITY', group: 'env', key: 'vorticity' },
  { label: '200 MB DIVERGENCE', group: 'env', key: 'divergence' },
  { label: '850-700 T ADVEC', group: 'env', key: 'tempAdvection' },
  { label: 'OCEAN HEAT CONTENT', group: 'env', key: 'oceanHeat' },

  /* Water headroom — shown, never coloured. One row. */
  { label: 'SST POTENTIAL', group: 'headroom', key: 'sstPotential' },

  /* The storm itself and the model's bookkeeping — shown, never coloured. */
  { label: 'MODEL VTX TENDENCY', group: 'storm', key: 'modelVortex' },
  { label: 'GOES PREDICTORS', group: 'storm', key: 'goes' },
  { label: 'RI POTENTIAL', group: 'storm', key: 'riPotential' },
  { label: 'PERSISTENCE', group: 'storm', key: 'persistence' },
  { label: 'DAYS FROM CLIM. PEAK', group: 'storm', key: 'daysFromPeak' },
  { label: 'SAMPLE MEAN CHANGE', group: 'storm', key: 'sampleMean' },
  { label: 'ZONAL STORM MOTION', group: 'storm', key: 'zonalMotion' },
  { label: 'STEERING LEVEL PRES', group: 'storm', key: 'steeringPressure' },
]);

/** The row the other nineteen have to add back up to. Not a contribution. */
const TOTAL_LABEL = 'TOTAL CHANGE';

/** Every label legal inside the contributions block. Anything else throws. */
const KNOWN_LABELS = new Set([...ROWS.map((r) => r.label), TOTAL_LABEL]);

/** The eight environment keys, in the order they go on the wire. */
const ENV_KEYS = Object.freeze([...new Set(ROWS.filter((r) => r.group === 'env').map((r) => r.key))]);
/** Every key, environment first, so the payload reads in group order. */
const ALL_KEYS = Object.freeze([...new Set(ROWS.map((r) => r.key))]);

/* --------------------------------------------------------------------------
 * THE RECONCILIATION TOLERANCE, IN KNOTS. §47.4.
 *
 * Each published value is rounded to a whole knot, so nineteen of them
 * accumulate slop. Across the 2026 season the residual against TOTAL CHANGE
 * was 95% inside +-2 kt and NEVER worse than +-4. Outside that window a row is
 * in the wrong group, or a row exists that §47.4 has never seen, and the
 * ribbon is misreporting the model. That is a throw, not a warning.
 * ----------------------------------------------------------------------- */
const RECONCILE_TOLERANCE_KT = 4;

/** The contributions table always covers +6 h to +168 h — sixteen columns —
 *  while the top table covers 0 to +168 h in seventeen. The mismatch is the
 *  reason §47.5's fix has no number of its own and inherits +6 h. */
const CONTRIB_COLUMNS = 16;
const TOP_COLUMNS = 17;

/** Thrown by everything here. `code` is what the route reports; `detail` is
 *  for a human reading a log, never for a reader's screen (§5 — the client is
 *  the layer with the context to write a sentence). */
export class ShipsParseError extends Error {
  constructor(code, detail) {
    super(`${code}: ${detail}`);
    this.name = 'ShipsParseError';
    this.code = code;
    this.detail = detail;
  }
}

const fail = (code, detail) => {
  throw new ShipsParseError(code, detail);
};

/**
 * One token to a number, or to null where the file says there is nothing.
 *
 * The eight known sentinels become null. A token that is neither a number nor
 * one of the eight is the ninth token, and it stops the parse.
 */
function toNumber(token, where) {
  if (NON_NUMERIC.has(token)) return null;
  if (!/^[-+]?(\d+\.?\d*|\.\d+)$/.test(token)) {
    fail('ships_unknown_token', `${JSON.stringify(token)} in ${where}`);
  }
  /* `+ 0` normalises the negative zeros this file is full of — `-0.` is a real
   * published value and `-0` in JSON output is noise. */
  return parseFloat(token) + 0;
}

/**
 * A row of the TOP table, by label, as an array of TOP_COLUMNS tokens.
 *
 * ==> THE FIRST MATCH, ALWAYS. <== Every Atlantic file carries a SECOND
 * `TIME (HR)` row inside the DSHIPS eyewall-replacement block near the bottom,
 * and it is a different table with different meaning. A label lookup that
 * takes the last match, or any match, reads the wrong one on all 60 Atlantic
 * files in the season. Both the column-0 anchor and `find` guard this: the
 * second row is indented, and `find` stops at the first hit regardless.
 */
function topRow(lines, label) {
  const line = lines.find((l) => l.startsWith(label));
  if (line === undefined) fail('ships_missing_row', label);
  const tokens = line.slice(label.length).trim().split(/\s+/);
  if (tokens.length !== TOP_COLUMNS) {
    fail('ships_bad_columns', `${label} has ${tokens.length}, expected ${TOP_COLUMNS}`);
  }
  return tokens;
}

/** `AL942026` -> `invest`. 80-89 are internal test systems that appear out of
 *  season; 90-99 are invests and get full, real SHIPS runs (§47.2). */
function classifyNumber(n) {
  if (n >= 80 && n <= 89) return 'test';
  if (n >= 90 && n <= 99) return 'invest';
  return 'storm';
}

/**
 * The header star-line: name, storm id, date and synoptic hour.
 *
 * ==> THE BASIN COMES FROM THE ID, NEVER FROM THE HEADER TEXT. <== Lala's file
 * is headed `EAST PACIFIC` while her id is `CP012026` (§47.2). The banner line
 * two rows above this one is decoration; the id is the truth, and this
 * function deliberately never looks at the banner.
 */
function parseHeader(text) {
  const m = /^\s*\*\s+(\S.*?)\s\s+([A-Z]{2})(\d{2})(\d{4})\s+(\d\d)\/(\d\d)\/(\d\d)\s+(\d\d) UTC/m.exec(
    text
  );
  if (!m) fail('ships_no_header', 'no storm identity line');
  const [, name, basin, number, year, month, day, , hour] = m;
  return {
    name: name.trim(),
    id: `${basin}${number}${year}`,
    /* The filename form, which carries a TWO-digit year: the app holds
     * `ep082026`, the file is `EP0826`. Getting this wrong yields a 404 that
     * is indistinguishable from "this storm has no SHIPS run" (§47.2). */
    stormId: `${basin}${number}${year.slice(2)}`,
    basin,
    kind: classifyNumber(Number(number)),
    /* The year comes from the id, not from the two-digit date — a season is
     * named by its year and the date field cannot tell 2026 from 1926. */
    issuedAt: `${year}-${month}-${day}T${hour}:00:00.000Z`,
    synoptic: `${year.slice(2)}${month}${day}${hour}`,
  };
}

/** The storm's position and strength right now, from the file's own summary
 *  line rather than from column 0 of the table — the two agree, and this line
 *  is the one that states it as a fact rather than as a forecast at zero. */
function parseCurrent(text) {
  const m = /CURRENT MAX WIND \(KT\):\s*([-\d.]+)\.?\s+LAT, LON:\s*([-\d.]+)\s+([-\d.]+)/.exec(text);
  if (!m) fail('ships_no_current', 'no CURRENT MAX WIND line');
  return {
    currentWindKt: parseFloat(m[1]),
    currentLat: parseFloat(m[2]),
    currentLon: westToSigned(parseFloat(m[3])),
  };
}

/** SHIPS publishes longitude as degrees WEST, positive. The app wants signed
 *  degrees east. A Central Pacific storm can be published past 180 W, which
 *  wraps rather than clamping. */
function westToSigned(degreesWest) {
  if (degreesWest === null || !Number.isFinite(degreesWest)) return null;
  const lon = -degreesWest;
  return lon < -180 ? lon + 360 : lon;
}

/** The last forecast hour at which a column carries a real value, or null if
 *  it never does. Not simply "the count", because a gap in the middle would
 *  make a count a lie — measured across the season the truncation is always
 *  trailing, and this stays honest if that ever stops being true. */
function lastHourWith(hours, values) {
  for (let c = values.length - 1; c >= 0; c--) if (values[c] !== null) return hours[c];
  return null;
}

/**
 * The contributions block: nineteen factor rows and TOTAL CHANGE.
 *
 * Returns a Map of label to sixteen numbers. Every label is checked against
 * §47.4's list — an unknown one means the file has changed shape and we are
 * about to misreport it, so it stops here.
 */
function parseContributions(lines) {
  const start = lines.findIndex((l) => /INDIVIDUAL CONTRIBUTIONS TO INTENSITY CHANGE/.test(l));
  if (start < 0) fail('ships_no_contributions', 'no contributions block');

  const rows = new Map();
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    /* The block ends at its first blank line. Everything below is the RI
     * matrix, the annular index and — in the Atlantic — the eyewall block,
     * none of which this layer reads. */
    if (rows.size > 0 && !line.trim()) break;
    /* Two leading spaces, a label, two or more spaces, then a signed number.
     * The block's own column header and its dashed rules do not match this and
     * are skipped without being named, which is deliberate: they carry no
     * label to check and inventing one would put furniture in the tally. */
    const m = /^ {2}(\S.*?) {2,}(-?\d.*)$/.exec(line);
    if (!m) continue;
    const label = m[1];
    if (!KNOWN_LABELS.has(label)) {
      fail('ships_unknown_row', `${JSON.stringify(label)} is not one of §47.4's nineteen`);
    }
    if (rows.has(label)) fail('ships_duplicate_row', label);
    const tokens = m[2].trim().split(/\s+/);
    if (tokens.length !== CONTRIB_COLUMNS) {
      fail('ships_bad_columns', `${label} has ${tokens.length}, expected ${CONTRIB_COLUMNS}`);
    }
    rows.set(
      label,
      tokens.map((t, c) => {
        const v = toNumber(t, `${label} column ${c}`);
        /* The contributions table has no sentinels in it anywhere in the 2026
         * season — it is whole knots all the way to +168 h even past the end
         * of the forecast, where it is zeros. A null here would mean a row we
         * cannot add up, which is the same failure as a missing row. */
        if (v === null) fail('ships_null_contribution', `${label} column ${c} is ${t}`);
        return v;
      })
    );
  }

  for (const label of KNOWN_LABELS) {
    if (!rows.has(label)) fail('ships_missing_row', label);
  }
  return rows;
}

/**
 * parseShips — the whole job. Raw SHIPS text in, small object out.
 *
 * Throws `ShipsParseError` rather than returning a partial answer. There is no
 * middle outcome on purpose: a half-parsed environment is a wrong environment.
 */
export function parseShips(text) {
  if (typeof text !== 'string' || text.length < 1000) {
    fail('ships_not_text', `body is ${typeof text}, ${text?.length ?? 0} chars`);
  }
  const lines = text.split(/\r?\n/);

  const header = parseHeader(text);
  const current = parseCurrent(text);

  /* The top table. Only the rows this layer uses are read: the two intensity
   * forecasts §47.8 quotes, the storm type, and the positions the ribbon is
   * drawn along. The rest of the table — SST, shear speed, potential intensity
   * — is the RAW environment, and the ribbon deliberately reports the model's
   * accounting of it instead (§47.4), so reading it here would be carrying
   * bytes to the phone that nothing draws. */
  const timeTokens = topRow(lines, 'TIME (HR)');
  const hoursAll = timeTokens.map((t, c) => toNumber(t, `TIME (HR) column ${c}`));
  const vNoLandAll = topRow(lines, 'V (KT) NO LAND').map((t, c) => toNumber(t, `V (KT) NO LAND ${c}`));
  const vLandAll = topRow(lines, 'V (KT) LAND').map((t, c) => toNumber(t, `V (KT) LAND ${c}`));
  const typeAll = topRow(lines, 'Storm Type');
  const latAll = topRow(lines, 'LAT (DEG N)').map((t, c) => toNumber(t, `LAT (DEG N) ${c}`));
  const lonAll = topRow(lines, 'LONG(DEG W)').map((t, c) => toNumber(t, `LONG(DEG W) ${c}`));

  /* ==> ONE EXCEPTION TO "THE RAW ENVIRONMENT STAYS OFF THE WIRE", AND ONLY AT
   * HOUR 0. <== §47.8's room-to-grow sentence pairs the storm's current wind
   * with the sea's ceiling — "a 29 mph system over water that could hold
   * 158 mph" — and BOTH halves are read at the fix, because pairing now's wind
   * with a ceiling five days down the track once produced a sentence about two
   * different moments (§47.8). The ceiling is `POT. INT.` at hour 0; the rest
   * of the row stays unread for the same reason the rest of the raw table
   * does. The whole row is still validated token-by-token, like Storm Type is,
   * because an unrecognised token anywhere in a row we read means the file has
   * changed shape. */
  const potIntAll = topRow(lines, 'POT. INT. (KT)').map((t, c) =>
    toNumber(t, `POT. INT. (KT) column ${c}`)
  );
  const potIntNowKt = potIntAll[0];

  const rows = parseContributions(lines);

  /* The two tables are joined BY FORECAST HOUR, never by column position. The
   * top table starts at 0 and the contributions at +6, so the offset is one
   * today — but the join is written against the hour so a file that ever
   * changed its columns would come out wrong-shaped and loud rather than
   * silently shifted by one slice. */
  const hours = hoursAll.slice(1);
  if (hours.length !== CONTRIB_COLUMNS || hours.some((h) => h === null)) {
    fail('ships_bad_columns', `TIME (HR) does not line up with the contributions block`);
  }

  const terms = {};
  for (const key of ALL_KEYS) terms[key] = new Array(CONTRIB_COLUMNS).fill(0);
  for (const row of ROWS) {
    const values = rows.get(row.label);
    for (let c = 0; c < CONTRIB_COLUMNS; c++) terms[row.key][c] += values[c];
  }

  const totalChangeKt = rows.get(TOTAL_LABEL);
  const environmentKt = [];
  const headroomKt = [];
  const stormKt = [];
  const residualKt = [];
  const pushKt = [];
  const pullKt = [];

  for (let c = 0; c < CONTRIB_COLUMNS; c++) {
    let env = 0;
    let headroom = 0;
    let storm = 0;
    for (const row of ROWS) {
      const v = rows.get(row.label)[c];
      if (row.group === 'env') env += v;
      else if (row.group === 'headroom') headroom += v;
      else storm += v;
    }

    /* ==> THE RECONCILIATION. AN ASSERTION, NOT A COMMENT. <== §47.4. The
     * three groups must add back to TOTAL CHANGE at every forecast hour of
     * every file. Outside +-4 kt, a row is in the wrong group or a row exists
     * that this file has never met, and the number about to colour a cone is
     * not the model's. */
    const residual = totalChangeKt[c] - (env + headroom + storm);
    if (Math.abs(residual) > RECONCILE_TOLERANCE_KT) {
      fail(
        'ships_reconcile',
        `+${hours[c]} h: groups sum to ${env + headroom + storm}, TOTAL CHANGE says ` +
          `${totalChangeKt[c]}, residual ${residual} kt exceeds +-${RECONCILE_TOLERANCE_KT}`
      );
    }

    /* Push and pull, for §47.8's agreement sentence — which is REQUIRED, not
     * optional, because a net near zero can mean nothing is happening or a
     * great deal is happening in both directions at once, and one neutral hour
     * in five is the loud kind. Computed over the eight ENVIRONMENT keys after
     * the three shear rows are merged, because shear is one thing to a reader
     * and counting its three rows separately would inflate both sides of a
     * fight the reader sees as one. */
    let push = 0;
    let pull = 0;
    for (const key of ENV_KEYS) {
      const v = terms[key][c];
      if (v > 0) push += v;
      else pull += v;
    }

    environmentKt.push(env);
    headroomKt.push(headroom);
    stormKt.push(storm);
    residualKt.push(residual);
    pushKt.push(push);
    pullKt.push(pull);
  }

  /* Storm type. TROP survives inside the drawable window on 2.7% of hours —
   * SHIPS keeps publishing an environment for a system that is no longer
   * tropical — so this is carried rather than used to truncate anything. */
  /* THE WHOLE ROW IS CHECKED BEFORE HOUR 0 IS DROPPED. Validating only the
   * columns this layer keeps would let an unrecognised token sit in column 0
   * unnoticed — and an unrecognised token anywhere in a row we read means the
   * file has changed, which is a fact about the file rather than about the
   * column it happened to land in. */
  const stormType = typeAll
    .map((t, c) => {
      if (t === 'N/A') return null;
      if (!STORM_TYPES.has(t)) {
        fail('ships_unknown_token', `${JSON.stringify(t)} in Storm Type column ${c}`);
      }
      return t;
    })
    .slice(1);

  const lat = latAll.slice(1);
  const lon = lonAll.slice(1).map(westToSigned);
  const vNoLand = vNoLandAll.slice(1);
  const vLand = vLandAll.slice(1);

  /* ==> WINDS AND POSITIONS TRUNCATE INDEPENDENTLY AND EITHER CAN COME FIRST.
   * <== 209 files in the season publish winds past the last position, 57
   * publish positions past the last wind (§47.2). So drawability is decided
   * per hour against BOTH, not by taking whichever end came first and calling
   * it the length of the file. Twenty-three files have no position past hour 0
   * at all while publishing winds to +120 h — a perfectly healthy file with
   * nothing to paint, which §47.6 says out loud rather than drawing a bare
   * cone. */
  const drawable = hours.map(
    (_, c) => lat[c] !== null && lon[c] !== null && vNoLand[c] !== null
  );

  /* ==> THE TWO ENDS ARE REPORTED SEPARATELY, AND THAT IS NOT REDUNDANT. <==
   * `drawable` above applies §47.2's rule — both, or nothing. But §47.10's own
   * fixture note for EP9326 was measured against POSITIONS ONLY, and the two
   * rules disagree on that file by 22 kt: its position runs to +120 h while
   * its wind stops at +84 h, and the -52 kt the section calls the season's
   * most hostile drawable hour sits in that gap. One of the two is wrong and
   * the answer is a product call, not a parser's. Carrying both ends means
   * changing the rule later is one line in the layer and no re-parse, rather
   * than a second pass through this file. */
  const lastWindHr = lastHourWith(hours, vNoLand);
  const lastPositionHr = lastHourWith(hours, lat);

  return {
    ...header,
    ...current,
    hours,
    drawable,
    drawableHours: drawable.filter(Boolean).length,
    lastWindHr,
    lastPositionHr,
    potIntNowKt,
    environmentKt,
    headroomKt,
    stormKt,
    totalChangeKt,
    residualKt,
    pushKt,
    pullKt,
    terms,
    vNoLandKt: vNoLand,
    vLandKt: vLand,
    stormType,
    lat,
    lon,
  };
}

/** Exported for the tests, which assert the group split is what §47.4 says
 *  rather than merely what this file happens to do today. */
export const SHIPS_ROWS = ROWS;
export const SHIPS_ENV_KEYS = ENV_KEYS;
export const SHIPS_RECONCILE_TOLERANCE_KT = RECONCILE_TOLERANCE_KT;
