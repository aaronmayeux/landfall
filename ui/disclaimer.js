/**
 * disclaimer.js — "Landfall is not an official source." SPEC §17 A1.
 *
 * ==> WHY THIS FILE EXISTS AT ALL <==
 * Until 2026-07-25 the app contained NO statement anywhere that it is
 * unofficial. Grepped: zero hits. A stranger arriving on a shared link saw a
 * globe with real cones, real Saffir-Simpson colors and real watch/warning
 * paint, and nothing telling them this is not the National Hurricane Center.
 *
 * That is §5's rule one level up. The whole app is built so that absence
 * never reads as safety — a dead feed must never render as "All Clear". A
 * missing disclaimer is the same failure applied to the app itself: silence
 * about provenance reads as authority.
 *
 * ==> ONE SOURCE FOR THE WORDING, AND THAT IS THE POINT OF THE MODULE <==
 * The strings live here and every surface imports them. A disclaimer that is
 * retyped per surface drifts, and the day the wording matters is the day
 * three versions of it disagree. Same argument as tokens (§9): one file
 * changes it everywhere.
 *
 * ==> WHERE IT APPEARS, AND WHY NOT AS A BLOCKING MODAL <==
 * Two surfaces, deliberately:
 *
 * 1. ONCE, ON FIRST RUN — an acknowledgement, not a hint. It has NO dismiss
 *    X and does not time out: the only way past it is the button that says
 *    you have read it. That is the difference between this and the two
 *    nudges beside it, which are advice and are freely dismissible.
 *
 *    It is NOT a full-screen modal over the opening animation. §9 says the
 *    entry moment belongs to the globe, and a wall of text on arrival is
 *    what makes people close a link. It is a bottom-anchored strip: the
 *    globe stays visible and interactive behind it, and the acknowledgement
 *    is still explicit. That is the honest resolution of the tension, not a
 *    dodge — the text is unmissable, the app is not held hostage.
 *
 * 2. PERMANENTLY, in Settings/About — reachable forever, asserted once. (Not
 *    the credits pill: that thing animates its width off a measurement of its
 *    own single-line label, and four lines of wrapped text break it. §17
 *    records the six attempts that bought that behaviour.)
 *
 * 3. THE PLACE IT MATTERS MOST — the storm detail panel footer, BUILT
 *    2026-07-26. That is the screen where somebody reads a forecast and
 *    DECIDES SOMETHING, so a provenance line there is worth more than either
 *    surface above, which both sit at the moment of arrival instead. It uses
 *    `DISCLAIMER.short` plus a real link to the NHC — "always follow the
 *    National Hurricane Center" with no way to get there is advice without a
 *    door. Owned by `ui/view-storm-detail.js`; measured at five widths by
 *    `tools/detail-disclaimer-check.mjs`.
 *
 * Plain language, no legalese — §1's layman's-terms rule governs this text
 * more than anything else in the app. "Landfall is not an official source"
 * beats any sentence containing "warranty".
 *
 * Imports: config/ only. Owns its own chip; borrows nudge.css's styling
 * language via the shared `.nudge` classes.
 */

import { STORAGE_KEY } from '../config/constants.js';

/**
 * The canonical wording. Frozen because a disclaimer edited at a call site
 * is a disclaimer that says different things in different places.
 */
export const DISCLAIMER = Object.freeze({
  /** First-run acknowledgement. Two sentences: what this is, what to do.
   *
   * ==> [APPROVE] THE SOURCE LIST CHANGED, AND IT HAD TO <==
   * This named "the National Hurricane Center and GDACS" exactly. Model
   * guidance for the West Pacific, North Indian and Southern Hemisphere now
   * comes from a third place — UCAR's Tropical Cyclone Guidance Project
   * (§15) — so the specific list became a false statement the moment that
   * shipped.
   *
   * IT IS DELIBERATELY NOT A LONGER LIST. Naming three sources here invites
   * naming the fourth, and this sentence exists to say "not official, follow
   * the NHC", not to be an attribution manifest. It now says what KIND of
   * data this is, which stays true as sources come and go. The one named
   * agency is the one a reader should act on, which is the whole point of
   * the sentence.
   *
   * THE TEST FOR ANY FUTURE EDIT: does this sentence stay true if a source
   * is added or dropped? The old one did not. */
  full:
    'Landfall is not an official source. It shows public forecast data from ' +
    'weather agencies and research centers, and it can be wrong, late, or ' +
    'unavailable. For decisions about your safety, always follow the ' +
    'National Hurricane Center and your local emergency management.',

  /** One line, for a surface that has no room for the full text. */
  short:
    'Unofficial. Always follow the National Hurricane Center and local ' +
    'emergency management.',

  /** The button. "I understand" and not "OK" — it names what was agreed. */
  acknowledge: 'I understand',

  /** Where to go. Kept beside the text so the two never drift apart. */
  officialUrl: 'https://www.nhc.noaa.gov/',
  officialLabel: 'National Hurricane Center',
});

/* --- persisted flag -------------------------------------------------------
 * Shares `STORAGE_KEY.firstRun` with the two nudges rather than taking a key
 * of its own. Same read-once/write-on-change shape, no subscribers, no
 * validated value set — so §12's extract-on-third-prefs-store counter still
 * stands at two and this does not trip it.
 */

function readFlags() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY.firstRun)) || {};
  } catch {
    return {};
  }
}

function writeAcknowledged() {
  try {
    localStorage.setItem(
      STORAGE_KEY.firstRun,
      JSON.stringify({ ...readFlags(), disclaimerAck: true })
    );
  } catch {
    /* Storage unavailable (private mode, quota). The strip reappears next
     * visit. Mildly repetitive; never wrong — and erring toward showing a
     * safety notice twice is the correct direction to fail. */
  }
}

/** @returns {boolean} Whether the user has already acknowledged. */
export function disclaimerAcknowledged() {
  return readFlags().disclaimerAck === true;
}

/* --- the strip ------------------------------------------------------------ */

/**
 * Show the first-run acknowledgement, if it has not been given.
 *
 * @param {object} deps
 * @param {HTMLElement} deps.host - #nudge-host, shared with the nudges.
 * @param {() => void} [deps.onAcknowledged] - called after it is dismissed,
 *        so the caller can release whatever it was holding back (the home
 *        nudge waits on this — two chips stacked on arrival is noise).
 * @returns {boolean} true if the strip was shown.
 */
export function showDisclaimer({ host, onAcknowledged }) {
  if (!host || disclaimerAcknowledged()) {
    onAcknowledged?.();
    return false;
  }

  const strip = document.createElement('div');
  /* Borrows `.nudge`'s glass language so it reads as part of the app rather
   * than a browser dialog, plus a modifier for the things that differ:
   * wider, taller, text wraps to several lines. */
  strip.className = 'nudge nudge-disclaimer';
  strip.dataset.visible = 'false';
  /* NOT aria-live: this is not an announcement that happened, it is a thing
   * to read and act on. A group with a label lets a screen reader treat it
   * as the object it is. */
  strip.setAttribute('role', 'group');
  strip.setAttribute('aria-label', 'Before you start');

  const text = document.createElement('p');
  text.className = 'nudge-text';
  text.textContent = DISCLAIMER.full;
  strip.appendChild(text);

  const act = document.createElement('button');
  act.type = 'button';
  act.className = 'nudge-action';
  act.textContent = DISCLAIMER.acknowledge;
  strip.appendChild(act);

  /* NO DISMISS X, deliberately — see the header. The nudges beside this one
   * are advice and can be waved away; this one is the thing the app has to
   * have said before it shows anybody a cone. */

  act.addEventListener('click', () => {
    writeAcknowledged();
    strip.dataset.visible = 'false';
    setTimeout(() => strip.remove(), 400);
    onAcknowledged?.();
  });

  host.appendChild(strip);
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      strip.dataset.visible = 'true';
      /* Focus the button, not the strip: a keyboard user lands directly on
       * the only action, and the visible focus ring (§10) shows where they
       * are. Not focused on a touch device's first paint — `preventScroll`
       * keeps it from yanking the layout. */
      act.focus({ preventScroll: true });
    })
  );

  return true;
}
