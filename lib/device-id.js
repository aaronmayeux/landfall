/**
 * device-id.js — the anonymous device number. SPEC-OPS §17 A5.
 *
 * ============================================================================
 * ==> THIS FILE REVERSES A RULE THAT WAS WRITTEN DOWN AS ABSOLUTE. READ THIS
 *     BEFORE YOU TOUCH IT. <==
 * ============================================================================
 * lib/telemetry.js said, in its own header, "no user id, no session id, NO
 * CROSS-VISIT IDENTIFIER". That line was true from launch until 2026-08-05.
 * It is not true any more, and the reason is written here rather than left to
 * be inferred from the code:
 *
 * WITHOUT THIS, THE TELEMETRY TABLE CANNOT COUNT PEOPLE. Every row was an
 * island. 267 visits could have been 267 strangers or one person opening the
 * app 267 times, and nothing in the data could tell those apart — which meant
 * the two questions actually being asked of it ("does anyone use this" and
 * "does anyone COME BACK") had no answer at all. Aaron approved adding this
 * on 2026-08-05 with that cost understood.
 *
 * ==> WHAT IT IS, EXACTLY <==
 * 64 bits from the system random number generator, made once, kept in
 * localStorage, sent with the session summary. That is the whole thing.
 *
 * ==> WHAT IT IS NOT, AND EVERY LINE OF THIS MATTERS <==
 * - NOT DERIVED FROM THE DEVICE. Nothing is hashed, measured, or read off the
 *   hardware to make it. A fingerprint would follow a person across a site
 *   wipe, across browsers, and to other people's sites. A random number
 *   cannot: it is a number we made up and handed to ourselves.
 * - NOT A NAME, AND NOT JOINABLE TO ONE. There is no account system to join
 *   it to and no field in the schema that carries a person.
 * - NOT PERSISTENT AGAINST THE USER'S WISHES. Clearing site data deletes it
 *   and the next visit is a brand new device. That is the reset, it needs no
 *   UI of its own, and it is the same gesture that already clears home.
 * - NOT ON ERROR OR SOURCE EVENTS. It rides the envelope, and the envelope is
 *   only worth reading on the once-per-visit session row. See telemetry.js.
 *
 * ==> IT IS STILL PERSONAL DATA, AND SAYING OTHERWISE WOULD BE THE LIE. <==
 * A stable per-device number is exactly what a regulator means by an online
 * identifier, whether or not a name is attached. SPEC-OPS already carries that
 * honest note about the five device-characteristic columns; this field joins
 * them under the same note and the same escape hatch. If the call is ever
 * reversed: delete this file, drop the `device` column, and the rest of the
 * table stands up unchanged.
 *
 * HOME COORDINATES STILL NEVER LEAVE THE DEVICE. That half of the contract is
 * untouched, is the half stated to users in the settings drawer, and
 * tools/privacy-check.mjs still proves it on every run.
 *
 * ==> IT CANNOT BREAK THE APP. <==
 * Same contract as telemetry.js and perf.js. Every path is wrapped. Safari
 * private mode throws on localStorage; an old browser may have no
 * `crypto.getRandomValues`. Both cases return the empty string, the beacon
 * simply carries no device, and that visit is counted the way every visit was
 * counted before today. A diagnostics field is never worth an exception.
 *
 * ==> Math.random() IS NOT A FALLBACK HERE, DELIBERATELY. <==
 * It is seeded per browsing context and is not required to be unique across
 * devices; a fallback that quietly hands the same number to several phones
 * would UNDERCOUNT while looking like it worked, which is the one failure
 * this field must not have. No random source means no number.
 *
 * Imports: config/ only. Imported by lib/telemetry.js only.
 */

import { STORAGE_KEY, TELEMETRY } from '../config/constants.js';

/** Read once per page load and reused. localStorage is synchronous and this
 *  is read on the flush path, which runs while the phone is being put away. */
let cached = null;

/** Exactly what the server will accept. Anything else is treated as absent
 *  and replaced — a hand-edited or truncated value must not be reported. */
const SHAPE = new RegExp(`^[0-9a-f]{${TELEMETRY.deviceIdHexChars}}$`);

/** Make a new one. Returns '' if this browser has no usable random source. */
function mint() {
  try {
    const bytes = new Uint8Array(TELEMETRY.deviceIdHexChars / 2);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    return '';
  }
}

/**
 * The device number for this browser, or '' if one cannot be made or kept.
 *
 * Read-then-write, and the write is allowed to fail on its own: a browser
 * that hands back a value but refuses to store one (private mode, full quota)
 * still gets a number for the length of this page load, and the visit is
 * counted as its own device. Overcounting a private-mode visitor is the right
 * way to be wrong here — the alternative is silently merging every private
 * window on earth into one very busy device.
 *
 * @returns {string} 16 lowercase hex characters, or ''.
 */
export function deviceId() {
  try {
    if (cached !== null) return cached;

    let value = '';
    try {
      value = localStorage.getItem(STORAGE_KEY.device) || '';
    } catch {
      /* no store to read; fall through to minting a per-load number */
    }

    if (!SHAPE.test(value)) {
      value = mint();
      if (value) {
        try {
          localStorage.setItem(STORAGE_KEY.device, value);
        } catch {
          /* cannot persist; the number is still valid for this load */
        }
      }
    }

    cached = value;
    return cached;
  } catch {
    cached = '';
    return cached;
  }
}
