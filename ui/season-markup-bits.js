/**
 * season-markup-bits.js — the pieces every section of the archive's storm
 * panel is built out of. SPEC.md §12, SPEC-SEASONS-BUILD.md §57.45.
 *
 * ==> THIS IS A MOVE AND NOTHING ELSE. NO BEHAVIOUR CHANGED. <==
 * `ui/season-detail-markup.js` crossed §12's ~700-line ceiling again when
 * §57.45 added the distance rows, and `NOW.md` records `view-seasons-board.js`
 * promising this same cut on five consecutive passes and taking it later at a
 * bigger size each time. So it was taken in the pass that caused it, exactly
 * as §57.44 took the last one. A break here can only be the move.
 *
 * ==> THE SEAM IS THE LAYER EVERY RENDERER USES AND NONE OF THEM DEFINES. <==
 * Escaping, the four small formatters, the definition list and the note
 * paragraph. Nothing in here knows what a storm is; everything above it does.
 * That is the whole test of whether a thing belongs in this file.
 *
 * ==> AND `ui/season-rank-markup.js` ALREADY REACHED THROUGH THE OLD FILE FOR
 * TWO OF THEM. <== It imported `absenceHtml` and `rowsHtml` out of a module
 * otherwise full of section renderers it has nothing to do with. It imports
 * them from here now, which makes that dependency say what it is.
 *
 * ==> EVERY ONE OF THE FORMATTERS RETURNS null RATHER THAN A DASH. <== The
 * caller then omits the row entirely, which is the rule the live panel already
 * follows and the reason it never shows an empty pair. A dash is a value that
 * means nothing; no row means no claim.
 *
 * Imports lib/ and one sibling. No DOM, no network, no clock.
 */

import { formatWind } from '../lib/units.js';
/* Every "…" in this app pulses through one helper, so a waiting line reads as
 * thinking rather than as a full stop that lost its way.
 * `tools/test-loading-dots.mjs` fails the build on a stray one — it caught
 * this panel's report line, and stayed red on `main` for the whole time step 7
 * was reverted. */
import { dotted } from './loading-dots.js';


export const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ---------------------------------------------------------------------------
 * SMALL FORMATTERS
 *
 * ==> EVERY ONE OF THESE RETURNS null RATHER THAN A DASH. <== The caller then
 * omits the row entirely, which is the rule the live panel already follows and
 * the reason it never shows an empty pair. A dash is a value that means
 * nothing; no row means no claim.
 * ------------------------------------------------------------------------ */

/** UTC, always, and it says so. ==> THE STORM'S OWN TIME ZONE IS NOT
 *  KNOWABLE AND THE READER'S IS THE WRONG ONE. <== HURDAT2 is stamped in UTC;
 *  rendering an 1893 Louisiana landfall in the reader's local clock would put
 *  a Gulf hurricane ashore at a time nobody in Louisiana experienced, and
 *  worse, the offset would depend on where the reader happens to be sitting.
 *  The live app shows local time because a live storm is about the reader's
 *  next few hours. History is not. */
const UTC = new Intl.DateTimeFormat('en-US', {
  timeZone: 'UTC',
  year: 'numeric', month: 'short', day: 'numeric',
  hour: 'numeric', minute: '2-digit', hour12: true,
});

/**
 * ==> A FINITE NUMBER IS NOT NECESSARILY A DATE, AND THE DIFFERENCE USED TO BE
 * A CRASH. <== §57.50. `Number.isFinite` passes any number at all, and
 * JavaScript's clock only runs to about ±8.64e15 ms — so a stamp that is
 * arithmetically fine but out of range makes `Intl.format` throw a RangeError
 * rather than return anything. Every section of this panel formats a date
 * through here, so one corrupt stamp anywhere took the whole drawer down
 * instead of costing one row.
 *
 * Found while mutation-testing `lib/season-company.js`: breaking its day
 * arithmetic produced exactly such a stamp, and the suite died before it could
 * report which assertion had caught it. **The bug was never in the mutation.**
 * The same shape reaches production the day any upstream file carries a
 * timestamp we do not expect.
 *
 * The rule is the one this file already states for every other formatter: a
 * value that cannot be rendered returns null, and the caller omits the row.
 * No row means no claim, and the panel around it still draws.
 */
const dayValue = (ms) => (Number.isFinite(ms) && Number.isFinite(new Date(ms).getTime())
  ? new Date(ms) : null);

export function utcStamp(ms) {
  const d = dayValue(ms);
  if (!d) return null;
  return `${UTC.format(d)} UTC`;
}

const UTC_DAY = new Intl.DateTimeFormat('en-US', {
  timeZone: 'UTC', year: 'numeric', month: 'short', day: 'numeric',
});

export function utcDay(ms) {
  const d = dayValue(ms);
  if (!d) return null;
  return UTC_DAY.format(d);
}

/** `23.1, -75.1` → `23.1°N 75.1°W`. Hemisphere letters rather than signs,
 *  because a minus sign in front of a longitude is a programmer's convention
 *  and this panel is read by a person. */
export function coords(lat, lon) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const ns = lat >= 0 ? 'N' : 'S';
  const ew = lon >= 0 ? 'E' : 'W';
  return `${Math.abs(lat).toFixed(1)}°${ns} ${Math.abs(lon).toFixed(1)}°${ew}`;
}

/**
 * Hours as a phrase a person would say.
 *
 * Days once it is past a day, because "138 hours at hurricane strength" is a
 * number the reader has to divide, and the thing they want to know is that it
 * was most of a week.
 */
export function spanWords(hours) {
  if (!Number.isFinite(hours) || hours <= 0) return null;
  if (hours < 24) {
    const h = Math.round(hours);
    return `${h} hour${h === 1 ? '' : 's'}`;
  }
  const days = hours / 24;
  const whole = Math.floor(days);
  const rest = Math.round(hours - whole * 24);
  if (rest === 0) return `${whole} day${whole === 1 ? '' : 's'}`;
  return `${whole} day${whole === 1 ? '' : 's'}, ${rest} hour${rest === 1 ? '' : 's'}`;
}

/** Wind in the reader's units with the knots beside it, the same shape the
 *  live Vitals row uses — knots are the number the record is actually in, and
 *  a reader comparing against NOAA's own page needs to see it. */
export function windWords(kt, system) {
  if (!Number.isFinite(kt)) return null;
  return `${formatWind(kt, system)} (${Math.round(kt)} kt)`;
}

/* ---------------------------------------------------------------------------
 * ROWS
 * ------------------------------------------------------------------------ */

/**
 * A definition list, or '' when there is nothing to say.
 *
 * ==> ROWS ARRIVE AS PAIRS AND THE VALUE IS ESCAPED HERE. <== The same rule
 * and the same reason as the live panel's `detail-vitals`: a row never hands
 * over raw HTML, so a storm name reaching this one refactor from now cannot
 * be treated as markup.
 *
 * ==> A ROW MUST HAVE A LABEL, AND THIS FUNCTION DOES NOT ENFORCE IT ON
 * PURPOSE. <== §57.55. The filter below drops a row on its VALUE being
 * empty and never looks at the key, which is how a full sentence pushed as
 * `['', 'That meets…']` ended up rendered inside the value column on 945
 * storms. The fix went to the call site, because a label-less pair is a
 * programming mistake rather than a data state, and dropping it here would
 * turn a visible layout fault into content that silently vanishes — the one
 * thing this app never does. The guard is a suite sweep instead:
 * `tools/test-season-detail.mjs` renders every storm-facing renderer and
 * fails on an empty `<dt>`.
 */
export function rowsHtml(rows) {
  const real = (rows || []).filter(([, v]) => v != null && v !== '');
  if (!real.length) return '';
  return `<dl class="detail-vitals">${real
    .map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`)
    .join('')}</dl>`;
}

/**
 * A §57.25 rule 2 sentence — the record is silent and here is why. Styled as
 * a note rather than as an error, because it is neither a failure nor a
 * warning: it is a fact about 1851.
 *
 * ==> THE DOTS ARE APPLIED HERE, AFTER THE ESCAPE, AND THAT ORDER IS THE
 * WHOLE POINT. <== The first version of this panel called
 * `absenceHtml(dotted('Checking…'))`, which handed a `<span class="dots">` to
 * `esc()` — so the waiting line would have rendered with visible angle
 * brackets on screen. It was never seen, because step 7 was reverted before
 * anybody opened the panel. Doing it in here means no call site can get the
 * order wrong, and `loading-dots.js`'s own rule makes it safe: escaping never
 * produces a `…`, and a trailing `…` in this app means "still working" and
 * nothing else.
 */
export function absenceHtml(text) {
  return text ? `<p class="detail-note">${dotted(esc(text))}</p>` : '';
}
