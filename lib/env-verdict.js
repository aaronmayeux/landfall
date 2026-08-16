/**
 * env-verdict.js — the shape of the whole track, said in one sentence.
 * SPEC §47.8.
 *
 * ==> THE VERDICT NAMES THE SHAPE, NEVER ONE HOUR. <== The most important rule
 * in §47.8 and the easiest to get wrong. The cone already draws the shape —
 * dark here, brighter there — and this sentence's job is to name it. Quoting
 * the last hour summarised a Cat 5 coming apart as "helping"; quoting the
 * worst hour announced half a quiet season as "working against it". Seven
 * shapes, each measured on the 2026 corpus before it was added.
 *
 * It also decides THE HOUR every figure in the paragraph and the grid is read
 * at, which is why it returns one — mixing hours inside one paragraph is how an
 * early draft quoted a term from +120 h under a headline taken from +36 h.
 *
 * Pure. Extracted from lib/env-health.js at §12's ceiling; imports env-series
 * and nothing else in this feature.
 */

import { ENV_HEALTH } from '../config/constants.js';
import { windDelta, windUnitWord } from './units.js';
import {
  NEUTRAL, at, bandOf, dayAt, extremeOf, sideExtreme, signed,
} from './env-series.js';

/* ---------------------------------------------------------------------------
 * SHAPE — §47.8's five, decided on the drawable series.
 *
 * End band against start band first: materially lower is Turning against,
 * materially higher is Turning for. Ends where it started but an interior
 * extreme crossed a boundary: a patch, bad or good by the extreme's sign.
 * Never leaves one band: Steady. The whole test is on BANDS, so drift inside
 * one band can never masquerade as a turn.
 * ------------------------------------------------------------------------- */
export function shapeOf(pts) {
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
export function verdict(run, pts, sys, name) {
  const unit = windUnitWord(sys);

  /* Too short or entirely flat inside neutral: no shape to name — the single
   * furthest hour, with its time (§47.8's stated fallback). */
  const flat = pts.every((p) => bandOf(p.kt) === NEUTRAL);
  if (pts.length < ENV_HEALTH.minShapeHours) {
    const ex = extremeOf(pts);
    const peak = windDelta(ex.kt, sys);
    return {
      hr: ex.hr,
      text: `Only a short window is published for ${name}: at its furthest ` +
        `from even the environment is worth ${signed(peak)} ${unit}, ${at(run, ex.hr)}.`,
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
        ? `The environment is about even now but turns against ${name}${monotoneTo(pts, true) ? ' steadily' : ''}`
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
      const dir = ex.kt < 0 ? 'eases back to about even' : 'settles back to about even';
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
  /* ==> ON A NON-NEUTRAL VERDICT THERE IS NO CLAUSE, AND THAT IS A DELETION,
   * NOT AN OVERSIGHT. <== It used to append "and nearly everything is pulling
   * the same way" or "though not everything agrees", and both were a vaguer
   * version of the sentence immediately after them. The next sentence names
   * the other side by name — "Nothing at all is working in its favor", "The
   * only thing working in its favor is warm moist air" — which is the same
   * fact, concrete, and one sentence later. Kept, the two read as a
   * contradiction: a verdict ending "everything is pulling the same way"
   * followed by a sentence ending "with nothing helping" sounds like two
   * different claims to anyone who has not read §47.4.
   *
   * The neutral case below is different and stays REQUIRED: there the other
   * side is not small, it is exactly equal, and nothing else in the paragraph
   * can tell a quiet environment from a tug of war. */
  if (!neutralVerdict) return '';

  const push = run.pushKt[c];
  const pull = Math.abs(run.pullKt[c]);
  const activity = push + pull;

  {
    /* One neutral hour in five is 15 kt or more cancelling out — the loud kind
     * — and "nothing much is acting on it" and "a great deal is acting on it
     * in both directions" are different warnings in the same color. */
    if (activity >= ENV_HEALTH.loudKt) {
      return ` — not because nothing is happening, but because a great deal is ` +
        `pulling in both directions and cancelling out`;
    }
    if (activity < ENV_HEALTH.quietKt) return ` — nothing much is acting on it`;
    return ` — a little push and pull, cancelling out`;
  }

  return '';
}
