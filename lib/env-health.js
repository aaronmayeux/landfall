/**
 * env-health.js — the storm health paragraph (SPEC §47.8).
 *
 * A PURE FUNCTION from a parsed SHIPS run to English sentences. No DOM, no
 * network, no module state; the clock and the unit system are arguments, so
 * every sentence it can ever say is testable on plain node.
 *
 * ==> EVERY FIGURE IN EVERY SENTENCE IS COMPUTED, NEVER TYPED. <== This file
 * generates English with numbers in it, which §47.8 calls the single easiest
 * place in the app to be fluently wrong. Its own spec's worked cases were
 * hand-typed twice and wrong both times — a term quoted from a column 24 hours
 * away from the headline, a remainder counting terms that contributed nothing.
 * Everything here reads one array at one index and prints what it read.
 *
 * THE RULES IT CARRIES (all §47.8, thresholds in config ENV_HEALTH):
 *  - The verdict names the SHAPE of the whole track, never one hour of it,
 *    matched to one of five shapes; "turning" requires crossing a band
 *    boundary. Too short or too flat falls back to the single furthest hour.
 *  - Every figure in parts 2–4 is read at the one hour the verdict named.
 *    Room to grow is the lone exception and is quoted at the fix — both
 *    halves of it, current wind AND the sea's ceiling.
 *  - At most four terms are named in total and three per side, largest first;
 *    a term that rounds to zero in knots is omitted, never listed as 0. The
 *    remainder clause closes the books so the visible figures always sum to
 *    the visible headline, in either unit system (lib/units closeWindParts).
 *  - Direction comes ONLY from `V (KT) LAND` — the environment never predicts.
 *    Where land decay diverges from the over-water forecast by 10 kt or more,
 *    the coast is named so the fall never reads as the environment's doing.
 *  - The agreement sentence is REQUIRED on a neutral verdict: quiet and loud
 *    are different warnings wearing the same colour.
 *  - Times are the reader's local day and part of day, never UTC, never "+60 h".
 *  - When SHIPS is missing the paragraph is REPLACED, never dropped (§5).
 *
 * PRONOUN: always "it". Two of the spec's worked cases say "she" for storms
 * with women's names; a generator guessing gender from a name would guess
 * wrong somewhere public, and "it" is what NHC's own discussions use.
 *
 * Imports: config/, lib/ siblings only.
 */

import { ENV_HEALTH } from '../config/constants.js';
import { closeWindParts, windDelta, windUnitWord, formatWind } from './units.js';
import { formatDayPart } from './time.js';

/* ---------------------------------------------------------------------------
 * THE PLAIN-ENGLISH NAMES, §47.4. One fixed name per parser key, whatever the
 * sign — "dry air +1" is the dry-air factor helping, and the sentence around
 * it says so. The umbrella term stays "environment", one thing one name.
 * ------------------------------------------------------------------------- */
const TERM_NAME = Object.freeze({
  shear: 'shear',
  tempAloft: 'cold air aloft',
  thetaE: 'moist warm air',
  midRh: 'dry air',
  vorticity: 'spin in the surrounding air',
  divergence: 'outflow aloft',
  tempAdvection: 'warm air moving in',
  oceanHeat: 'deep warm water',
});

/** The parser's key order, which breaks magnitude ties so the same run always
 *  names the same terms. */
const KEY_ORDER = Object.freeze([
  'shear', 'tempAloft', 'thetaE', 'midRh', 'vorticity', 'divergence',
  'tempAdvection', 'oceanHeat',
]);

/** Which §47.4 band a knot value sits in: 0 tearing it down, 1 working
 *  against it, 2 neutral, 3 helping, 4 feeding it. */
function bandOf(kt) {
  const cuts = ENV_HEALTH.bandCutsKt;
  for (let i = 0; i < cuts.length; i++) if (kt < cuts[i]) return i;
  return cuts.length;
}

const NEUTRAL = 2;

/** Epoch ms of a forecast hour, off the run's own issuance. */
const hourMs = (run, hr) => Date.parse(run.issuedAt) + hr * 3600 * 1000;

/** "by early Thursday" / "by Monday afternoon" */
const at = (run, hr) => formatDayPart(hourMs(run, hr));
const dayAt = (run, hr) => formatDayPart(hourMs(run, hr), { dayOnly: true });

/** Signed figure as spoken: "+14", "−13" — a real minus sign, matching every
 *  other signed figure in the app. */
const signed = (n) => (n < 0 ? `−${Math.abs(n)}` : `+${n}`);

/**
 * The drawable environment series: [{hr, kt}], in hour order. Drawability is
 * the parser's own §47.2 answer — a wind AND a position both published.
 */
function series(run) {
  const out = [];
  for (let c = 0; c < run.hours.length; c++) {
    if (run.drawable[c]) out.push({ hr: run.hours[c], kt: run.environmentKt[c], c });
  }
  return out;
}

/** The point furthest from zero — FIRST occurrence, so the time named is when
 *  the track first gets there rather than the last moment it lingers. */
function extremeOf(pts) {
  let best = pts[0];
  for (const p of pts) if (Math.abs(p.kt) > Math.abs(best.kt)) best = p;
  return best;
}

/** The furthest point in one DIRECTION — the most negative (`side` −1) or the
 *  most positive (+1) — first occurrence, for turning shapes whose headline
 *  must sit on the side the track ends on. */
function sideExtreme(pts, side) {
  let best = pts[0];
  for (const p of pts) if (p.kt * side > best.kt * side) best = p;
  return best;
}

/* ---------------------------------------------------------------------------
 * SHAPE — §47.8's five, decided on the drawable series.
 *
 * End band against start band first: materially lower is Turning against,
 * materially higher is Turning for. Ends where it started but an interior
 * extreme crossed a boundary: a patch, bad or good by the extreme's sign.
 * Never leaves one band: Steady. The whole test is on BANDS, so drift inside
 * one band can never masquerade as a turn.
 * ------------------------------------------------------------------------- */
function shapeOf(pts) {
  const bands = pts.map((p) => bandOf(p.kt));
  const first = bands[0];
  const last = bands[bands.length - 1];
  const allSame = bands.every((b) => b === first);
  if (allSame) return 'steady';

  /* ==> THE INTERIOR EXTREME CAN OUTVOTE THE ENDPOINTS, AND GENEVIEVE IS WHY.
   * <== Her track runs neutral → tearing it down (−13) → back up to +3, which
   * lands exactly on the helping boundary — so end-vs-start alone reads a Cat 5
   * coming apart as "turning for". When the furthest hour sits on the OPPOSITE
   * side of the start from where the track ends, and crossed MORE bands
   * getting there than the end did, the story is the patch, not the finish. */
  const ex = extremeOf(pts);
  const exBand = bandOf(ex.kt);
  const exDist = Math.abs(exBand - first);
  const endDist = Math.abs(last - first);
  const opposite = (exBand - first) * (last - first) < 0;
  /* `>=`, not `>`: on a band-distance TIE the extreme still wins, because it
   * is the global furthest-from-zero point by construction — a track that
   * dips to −8 and finishes at +3 ties on bands (−8 sits exactly on a cut)
   * while the −8 is the story a reader needs told, with the +3 finish named
   * by the ending clause rather than promoted to the headline. */
  if (opposite && exDist >= endDist) return exBand < first ? 'badPatch' : 'goodPatch';

  if (last < first) return 'turningAgainst';
  if (last > first) return 'turningFor';
  return exBand < first ? 'badPatch' : 'goodPatch';
}

/** Monotone (never moving the wrong way) toward the extreme — earns
 *  "steadily" in a turning verdict. */
function monotoneTo(pts, falling) {
  for (let i = 1; i < pts.length; i++) {
    if (falling ? pts[i].kt > pts[i - 1].kt : pts[i].kt < pts[i - 1].kt) return false;
  }
  return true;
}

/* ---------------------------------------------------------------------------
 * THE FIVE PARTS
 * ------------------------------------------------------------------------- */

/**
 * Part 1 — the verdict. Returns { text, hr } where hr is the one hour every
 * figure in parts 2–4 is read at.
 */
function verdict(run, pts, sys, name) {
  const unit = windUnitWord(sys);

  /* Too short or entirely flat inside neutral: no shape to name — the single
   * furthest hour, with its time (§47.8's stated fallback). */
  const flat = pts.every((p) => bandOf(p.kt) === NEUTRAL);
  if (pts.length < ENV_HEALTH.minShapeHours) {
    const ex = extremeOf(pts);
    const peak = windDelta(ex.kt, sys);
    return {
      hr: ex.hr,
      text: `SHIPS publishes only a short window for ${name}: at its furthest ` +
        `from neutral the environment is worth ${signed(peak)} ${unit}, ${at(run, ex.hr)}.`,
    };
  }

  const shape = flat ? 'steady' : shapeOf(pts);

  /* ==> THE HEADLINE IS THE FURTHEST POINT ON THE SHAPE'S OWN SIDE. <== A
   * turning-against verdict must name how far AGAINST it goes; on a track
   * that rides +9 up before falling to −9, the global furthest-from-zero
   * point is a tie the wrong way, and "turns against it, reaching +9" is a
   * sentence at war with itself. Patches and steady keep the global extreme —
   * the patch IS the extreme. Measured on the 2026 corpus: eleven runs rise
   * to a real peak and end on the hostile side, twenty-three do the mirror. */
  const ex = shape === 'turningAgainst' ? sideExtreme(pts, -1)
    : shape === 'turningFor' ? sideExtreme(pts, 1)
      : extremeOf(pts);
  const peak = windDelta(ex.kt, sys);
  const agree = agreementClause(run, ex.c, flat || shape === 'steady');

  if (shape === 'steady') {
    /* One band all week. Neutral is the common case and carries the REQUIRED
     * agreement sentence; a steady non-neutral band is named for what it is. */
    const b = bandOf(pts[0].kt);
    const stance = b === NEUTRAL ? 'stays out of it'
      : b < NEUTRAL ? 'stays against it' : 'stays behind it';
    const most = b === NEUTRAL ? '' :
      `, worth up to ${signed(peak)} ${unit} ${at(run, ex.hr)}`;
    return { hr: ex.hr, text: `The environment ${stance} across the whole forecast${most}${agree}.` };
  }

  if (shape === 'turningAgainst') {
    /* An early stretch ABOVE neutral before the fall — 94L rides a mildly
     * helpful environment into helping-band territory for a day before it
     * turns — is part of the shape and is named, whatever band the very first
     * hour happens to sit in. */
    const helpedEarly = pts.some((p) => p.hr < ex.hr && bandOf(p.kt) > NEUTRAL);
    const startBand = bandOf(pts[0].kt);
    const opener = helpedEarly
      ? `The environment helps ${name} mildly for ${startStretch(pts, true)}, then turns against it`
      : startBand === NEUTRAL
        ? `The environment is neutral now but turns against ${name}${monotoneTo(pts, true) ? ' steadily' : ''}`
        : `The environment is already against ${name} and worsens`;
    return { hr: ex.hr, text: `${opener}, reaching ${signed(peak)} ${unit} by ${at(run, ex.hr)}${agree}.` };
  }

  if (shape === 'turningFor') {
    const startBand = bandOf(pts[0].kt);
    const dip = dipMention(run, pts);
    const opener = startBand < NEUTRAL || dip
      ? `The environment works against ${name}${dip}, then swings behind it`
      : startBand === NEUTRAL
        ? `The environment is quiet at first, then swings behind ${name}`
        : `The environment is already behind ${name} and strengthens`;
    return { hr: ex.hr, text: `${opener}, reaching ${signed(peak)} ${unit} by ${at(run, ex.hr)}${agree}.` };
  }

  if (shape === 'badPatch') {
    const hard = bandOf(ex.kt) === 0 ? ' hard' : '';
    const back = endingMention(run, pts, ex, sys);
    return {
      hr: ex.hr,
      text: `The environment turns${hard} against ${name} through ${at(run, ex.hr)}, ` +
        `costing up to ${Math.abs(peak)} ${unit}${back}${agree}.`,
    };
  }

  /* goodPatch */
  const back = endingMention(run, pts, ex, sys);
  return {
    hr: ex.hr,
    text: `The environment swings behind ${name} through ${at(run, ex.hr)}, ` +
      `worth up to ${signed(peak)} ${unit}${back}${agree}.`,
  };
}

/** "the first day" / "the first two days" — how long the opening stretch on
 *  the starting side lasts, floored to whole days (never below one). */
function startStretch(pts, positive) {
  let lastHr = pts[0].hr;
  for (const p of pts) {
    if (positive ? p.kt > 0 : p.kt < 0) lastHr = p.hr; else break;
  }
  const days = Math.max(1, Math.floor(lastHr / 24));
  return days === 1 ? 'the first day' : `the first ${['two', 'three', 'four', 'five', 'six', 'seven'][days - 2] || days} days`;
}

/** " briefly on Sunday" — an early against-dip inside a Turning-for track,
 *  named by the day its own extreme lands on. Empty when there is no dip. */
function dipMention(run, pts) {
  const neg = pts.filter((p) => bandOf(p.kt) < NEUTRAL);
  if (!neg.length) return '';
  const worst = extremeOf(neg);
  return ` briefly on ${dayAt(run, worst.hr)}`;
}

/**
 * How a patch ENDS — and it does not always end back where it started.
 *
 * ==> TWO MORE SHAPES LIVE HERE, MEASURED BEFORE THEY WERE ADDED. <== Across
 * the 2026 corpus, 34 runs in 337 — one in ten — cross from one side of
 * neutral to the other: eleven ride a helpful peak and end on the hostile
 * side, twenty-three do the mirror. A closing clause that always said "eases
 * back to neutral" hid the ending on every one of them, which is a sentence
 * lying by omission about the half of the track nearest the reader's future.
 * So the clause is computed from where the track actually finishes:
 *   - back inside neutral → "then eases back to neutral by <time>"
 *   - across to the OTHER side → "then turns against it, reaching −N by
 *     <time>" (or the mirror), the reversal named with its own figure and its
 *     own time, read at the ending side's furthest post-peak hour.
 */
function endingMention(run, pts, ex, sys) {
  const after = pts.filter((p) => p.hr > ex.hr);
  if (!after.length) return '';
  const endBand = bandOf(after[after.length - 1].kt);
  const unit = windUnitWord(sys);

  /* Crossed to the other side — but only MATERIALLY. A track that ends one
   * knot over a cut point has grazed a boundary, not reversed; "swings behind
   * it" on a +3 finish overstates a rounding-sized fact. The ending-side
   * extreme has to clear the ±3 side test with the hysteresis to spare, or
   * the ending is described as a return to neutral, which is what a graze is. */
  const exSide = Math.sign(ex.kt);
  const rev = sideExtreme(after, -exSide);
  if ((endBand - NEUTRAL) * exSide < 0 &&
    Math.abs(rev.kt) >= ENV_HEALTH.sideKt + ENV_HEALTH.reversalHysteresisKt) {
    const v = windDelta(rev.kt, sys);
    return exSide < 0
      ? `, then swings behind it, reaching ${signed(v)} ${unit} by ${at(run, rev.hr)}`
      : `, then turns against it, reaching ${signed(v)} ${unit} by ${at(run, rev.hr)}`;
  }

  /* Ends back inside neutral: the first post-peak neutral hour. */
  for (const p of after) {
    if (bandOf(p.kt) === NEUTRAL) {
      const dir = ex.kt < 0 ? 'eases back to neutral' : 'settles back to neutral';
      return `, then ${dir} by ${at(run, p.hr)}`;
    }
  }
  return '';
}

/**
 * The agreement clause — REQUIRED wording on a neutral verdict (§47.4), a
 * light texture clause otherwise. Push and pull are the parser's own sums over
 * the eight environment keys, shear already merged.
 */
function agreementClause(run, c, neutralVerdict) {
  const push = run.pushKt[c];
  const pull = Math.abs(run.pullKt[c]);
  const activity = push + pull;
  const net = Math.abs(run.environmentKt[c]);

  if (neutralVerdict) {
    /* One neutral hour in five is 15 kt or more cancelling out — the loud kind
     * — and "nothing much is acting on it" and "a great deal is acting on it
     * in both directions" are different warnings in the same colour. */
    if (activity >= ENV_HEALTH.loudKt) {
      return ` — not because nothing is happening, but because a great deal is ` +
        `pulling in both directions and cancelling out`;
    }
    if (activity < ENV_HEALTH.quietKt) return ` — nothing much is acting on it`;
    return ` — a little push and pull, cancelling out`;
  }

  if (activity === 0) return '';
  const ratio = net / activity;
  if (ratio >= ENV_HEALTH.agreeHi && activity >= ENV_HEALTH.quietKt) {
    return `, and nearly everything is pulling the same way`;
  }
  if (ratio <= ENV_HEALTH.agreeLo && push >= ENV_HEALTH.sideKt && pull >= ENV_HEALTH.sideKt) {
    return `, though not everything agrees`;
  }
  return '';
}

/**
 * Parts 2 and 3 — what is working against it and for it, named largest first,
 * with the closing remainder that makes the visible figures sum to the visible
 * headline. One sentence covering both sides, shaped by dominance.
 */
function termsSentence(run, hr, sys) {
  const c = run.hours.indexOf(hr);
  const unit = windUnitWord(sys);

  /* Every non-zero term at THIS hour, ranked by magnitude, ties by key order
   * — the ranking the four acceptance cases demonstrate. */
  const all = KEY_ORDER
    .map((key) => ({ key, kt: run.terms[key][c] }))
    .filter((t) => t.kt !== 0)
    .sort((a, b) => Math.abs(b.kt) - Math.abs(a.kt) ||
      KEY_ORDER.indexOf(a.key) - KEY_ORDER.indexOf(b.key));

  if (!all.length) return `No single factor is worth anything at that hour.`;

  /* Top four overall, at most three per side. */
  const named = [];
  let pos = 0, neg = 0;
  for (const t of all) {
    if (named.length >= ENV_HEALTH.namedTermsMax) break;
    if (t.kt > 0 && pos >= ENV_HEALTH.namedPerSideMax) continue;
    if (t.kt < 0 && neg >= ENV_HEALTH.namedPerSideMax) continue;
    named.push(t);
    if (t.kt > 0) pos++; else neg++;
  }

  const closed = closeWindParts(run.environmentKt[c], named.map((t) => t.kt), sys);
  const display = named.map((t, i) => ({ ...t, v: closed.named[i] }));
  const against = display.filter((t) => t.kt < 0);
  const forIt = display.filter((t) => t.kt > 0);
  const omitted = all.length - named.length;

  /* The closing clause — stated so the reader never finds figures that do not
   * sum. Omitted when the named terms close on their own. */
  let closing = '';
  if (closed.remainder !== 0) {
    const n = omitted === 0 ? 'rounding'
      : omitted === 1 ? 'a smaller term and rounding'
        : `${['two', 'three', 'four', 'five', 'six', 'seven'][omitted - 2] || omitted} smaller terms and rounding`;
    const verb = closed.remainder < 0 ? `take back ${Math.abs(closed.remainder)}`
      : `add the last ${closed.remainder}`;
    closing = `, and ${n} ${verb}`;
  }

  /* Dominance shapes the opener. The hostile and helpful sides swap roles
   * depending on which one the headline is on. */
  const netKt = run.environmentKt[c];
  const top = all[0];
  const topShare = netKt !== 0 && Math.sign(top.kt) === Math.sign(netKt)
    ? Math.abs(top.kt) / Math.abs(netKt) : 0;
  const lead = display.find((t) => t.key === top.key);

  const list = (ts) => {
    const parts = ts.map((t) => `${TERM_NAME[t.key]} ${signed(t.v)}`);
    if (parts.length <= 1) return parts.join('');
    return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
  };

  const otherSide = (main) => {
    const side = main === 'against' ? forIt : against;
    if (!side.length) return '';
    const word = main === 'against' ? 'in its favour' : 'working against it';
    if (side.length === 1) {
      return `; the only thing ${word} is ${TERM_NAME[side[0].key]}, worth ${signed(side[0].v)}`;
    }
    return `; ${word}: ${list(side)}`;
  };

  if (lead && topShare >= ENV_HEALTH.dominantHi) {
    const main = lead.kt < 0 ? 'against' : 'for';
    const rest = (main === 'against' ? against : forIt).filter((t) => t !== lead);
    const withRest = rest.length ? `, with ${list(rest)} beside it` : '';
    return `${cap(TERM_NAME[lead.key])} is almost the entire story at ${signed(lead.v)} ${unit}` +
      `${withRest}${otherSide(main)}${closing}.`;
  }

  if (lead && topShare >= ENV_HEALTH.dominantLo && Math.abs(top.kt) >= ENV_HEALTH.sideKt) {
    const main = lead.kt < 0 ? 'against' : 'for';
    const rest = (main === 'against' ? against : forIt).filter((t) => t !== lead);
    const role = main === 'against'
      ? `is the biggest problem, costing ${Math.abs(lead.v)} ${unit} on its own`
      : `does most of the work, worth ${signed(lead.v)} ${unit} on its own`;
    const withRest = rest.length ? `, with ${list(rest)}` : '';
    return `${cap(TERM_NAME[lead.key])} ${role}${withRest}${otherSide(main)}${closing}.`;
  }

  /* Nothing dominates: plain list, larger side first. */
  const mainSide = Math.abs(sumKt(against)) >= Math.abs(sumKt(forIt)) ? 'against' : 'for';
  const first = mainSide === 'against' ? against : forIt;
  const firstWord = mainSide === 'against' ? 'working against it' : 'in its favour';
  const head = first.length ? `${firstWord}: ${list(first)}` : '';
  return `Nothing dominates — ${head}${otherSide(mainSide)}${closing}.`;
}

const sumKt = (ts) => ts.reduce((a, t) => a + t.kt, 0);

/**
 * Part 4 — room and structure, the two numbers the colour deliberately leaves
 * out. The ceiling pair is read AT THE FIX — both halves from the same column
 * — and the headroom and structure figures at the verdict hour.
 */
function roomSentence(run, hr, sys, name) {
  const c = run.hours.indexOf(hr);
  const unit = windUnitWord(sys);
  const structKt = run.stormKt[c];
  const struct = windDelta(structKt, sys);
  const structBit = struct === 0 ? ''
    : struct < 0
      ? `its own structure costs ${Math.abs(struct)} ${unit}`
      : `its own structure adds ${struct} ${unit}`;

  /* No published ceiling: say the half that exists rather than inventing the
   * other (§5). The whole 2026 corpus publishes it, so this is a guard. */
  if (run.potIntNowKt == null || run.currentWindKt == null) {
    return structBit ? `${cap(structBit)}.` : '';
  }

  const cur = formatWind(run.currentWindKt, sys);      // "35 mph"
  const ceil = formatWind(run.potIntNowKt, sys);
  const ratio = run.currentWindKt / run.potIntNowKt;
  const headroom = windDelta(run.headroomKt[c], sys);
  const withStruct = structBit ? `, and ${structBit}` : '';

  if (ratio >= ENV_HEALTH.roomNearRatio) {
    return `Even now there is some room left — ${cur} over water that could hold ` +
      `${ceil}${withStruct}.`;
  }
  if (ratio >= ENV_HEALTH.roomFarRatio) {
    return `${name} is fairly close to its ceiling — ${cur} over water that could ` +
      `hold ${ceil} — so there is less room to grow${withStruct}.`;
  }
  /* A long way below the ceiling. Whether that room is being USED comes from
   * the published forecast, never from the environment (§47.8). */
  const risingKt = lastDrawableVLand(run) - run.currentWindKt;
  if (risingKt > 0) {
    return `What carries it anyway is room: a ${cur} system sitting over water that ` +
      `could hold ${ceil} is a long way below its ceiling, and that alone is worth ` +
      `${signed(headroom)} ${unit}${withStruct}.`;
  }
  return `The sea under it could hold a ${ceil} storm and ${name} is only doing ` +
    `${cur.split(' ')[0]}, so there is no shortage of fuel — it simply cannot use it` +
    `${withStruct}.`;
}

/** V (KT) LAND at the last drawable hour — the wind figure the bottom line
 *  quotes, matched to the ground the ribbon actually paints. */
function lastDrawableVLand(run) {
  for (let c = run.hours.length - 1; c >= 0; c--) {
    if (run.drawable[c]) return run.vLandKt[c];
  }
  return run.currentWindKt;
}
function lastDrawableHr(run) {
  for (let c = run.hours.length - 1; c >= 0; c--) {
    if (run.drawable[c]) return run.hours[c];
  }
  return null;
}

/**
 * Part 5 — the bottom line: the PUBLISHED intensity forecast in plain words.
 * Direction comes only from `V (KT) LAND`; the environment and the forecast
 * are allowed to disagree, and the clauses exist to keep that honest.
 */
function bottomLine(run, verdictHr, sys) {
  const hr = lastDrawableHr(run);
  if (hr == null) return '';
  const c = run.hours.indexOf(hr);
  const from = formatWind(run.currentWindKt, sys);
  const to = formatWind(run.vLandKt[c], sys);
  const when = at(run, hr);
  const deltaKt = run.vLandKt[c] - run.currentWindKt;

  /* Land decay: where the two forecasts diverge materially at any drawable
   * hour, the coast is doing work the contribution table never accounts for,
   * and the fall must not read as the environment's (§47.4). */
  let landGap = 0;
  for (let i = 0; i < run.hours.length; i++) {
    if (!run.drawable[i]) continue;
    if (run.vNoLandKt[i] != null && run.vLandKt[i] != null) {
      landGap = Math.max(landGap, run.vNoLandKt[i] - run.vLandKt[i]);
    }
  }

  const envPeakKt = extremeOf(series(run)).kt;
  const envAgainst = envPeakKt <= -ENV_HEALTH.sideKt;
  const envFor = envPeakKt >= ENV_HEALTH.sideKt;

  let clause = '';
  if (landGap >= ENV_HEALTH.landGapKt && deltaKt < 0) {
    clause = ` — and that is the land tearing it down, not the environment`;
  } else if (deltaKt >= ENV_HEALTH.sideKt && envAgainst) {
    clause = `, so the environment slows it rather than stopping it`;
  } else if (deltaKt <= -ENV_HEALTH.sideKt && envFor) {
    clause = `, so the environment is not what brings it down`;
  } else if (deltaKt <= -ENV_HEALTH.sideKt && envAgainst &&
    Math.abs(deltaKt) >= ENV_HEALTH.decayShareRatio * Math.abs(envPeakKt)) {
    clause = `, so the environment and its own decay are pulling the same way`;
  }

  if (Math.abs(deltaKt) < ENV_HEALTH.sideKt) {
    return `SHIPS holds it near ${from} through ${when}${clause}.`;
  }
  if (deltaKt > 0) {
    return `SHIPS has it reaching ${to} by ${when}${clause}.`;
  }
  return `SHIPS has it falling from ${from} to ${to} by ${when}${clause}.`;
}

/* ---------------------------------------------------------------------------
 * THE ENTRY POINT
 * ------------------------------------------------------------------------- */

/**
 * envHealth — the whole paragraph, or its stated replacement.
 *
 * @param {object|null} result  data/ships.js's four-state answer
 *   ({status, run}), or null when nothing has been fetched.
 * @param {{system?: string, stormName?: string}} opts
 * @returns {{kind:'paragraph', sentences:string[]} |
 *           {kind:'replaced', text:string, retryable:boolean}}
 *
 * REPLACED, NEVER DROPPED (§5). Each absence says which absence it is, in the
 * words §47.9 already uses for the layer row, so the two surfaces never tell
 * two stories about the same missing file.
 */
export function envHealth(result, { system = null, stormName = null } = {}) {
  const replaced = (text, retryable = false) => ({ kind: 'replaced', text, retryable });

  if (!result) return replaced('Environment data has not been checked yet.');
  if (result.status === 'basin') {
    return replaced('Not published for storms in this basin — SHIPS covers the Atlantic and the East and Central Pacific.');
  }
  if (result.status === 'no_run') {
    return replaced('No SHIPS run published for this storm yet. A fresh system gets advisories before its first run.');
  }
  if (result.status === 'unavailable') {
    return replaced('Environment data unavailable.', true);
  }
  const run = result.run;
  if (!run) return replaced('Environment data unavailable.', true);

  const pts = series(run);
  if (!pts.length) {
    return replaced('This run publishes no forecast track to colour, so there is nothing to measure the environment against.');
  }

  /* The app's own name for the storm wins over the file's header — the file
   * says INVEST where the list says 94L, and the drawer must not call the
   * storm two things on one screen. */
  const name = titleCase(stormName || run.name);
  const sentences = [];
  const v = verdict(run, pts, system, name);
  sentences.push(v.text);
  sentences.push(termsSentence(run, v.hr, system));
  const room = roomSentence(run, v.hr, system, name);
  if (room) sentences.push(room);
  const bottom = bottomLine(run, v.hr, system);
  if (bottom) sentences.push(bottom);

  /* §47.6's fourth case: a healthy run whose positions stop short of its
   * winds. Said out loud rather than letting the ribbon end unexplained. */
  if (run.lastPositionHr != null && run.lastWindHr != null &&
    run.lastPositionHr < run.lastWindHr) {
    sentences.push('The environment is only published for part of the forecast track.');
  }

  return { kind: 'paragraph', sentences };
}

/** "HERNAN" → "Hernan"; invests stay as published ("94L" would arrive as
 *  "INVEST" — the parser's name field — which reads fine title-cased). */
function titleCase(s) {
  if (!s) return 'This storm';
  return s.split(/\s+/).map((w) =>
    /^\d/.test(w) ? w : w[0].toUpperCase() + w.slice(1).toLowerCase()
  ).join(' ');
}
const cap = (s) => s[0].toUpperCase() + s.slice(1);
