/**
 * /api/beacon — where lib/telemetry.js sends what it saw. SPEC §17 A5.
 *
 * ==> THIS IS A PUBLIC WRITE ENDPOINT, AND IT IS TREATED LIKE ONE. <==
 * Every other route in this app either reads upstream or is gated. This one
 * accepts a POST from anybody on the internet, which makes it the softest
 * surface Landfall exposes. Two consequences run through the whole file:
 *
 * 1. NOTHING IS TRUSTED AND NOTHING IS PASSED THROUGH. The body is not
 *    stored, not echoed, and not forwarded. It is REBUILT field by field
 *    from a fixed allowlist, with every value clipped and coerced. A field
 *    the app does not send cannot reach the data store even if it arrives —
 *    which is the enforcement behind telemetry.js's privacy contract, since
 *    a client is only ever the first half of that promise.
 *
 * 2. IT ALWAYS RETURNS 204, whatever happened. A malformed body, an oversized
 *    body, a body from a script that is not Landfall: all 204, all dropped
 *    silently. An error response is a signal, and a signal is a thing to
 *    probe against. There is nothing here worth telling a caller.
 *
 * ==> WHY ANALYTICS ENGINE AND NOT A DATABASE <==
 * It binds directly to a Pages Function, the free tier is 100k writes/day
 * (far beyond anything this app will produce at the current sample rate), it
 * is queryable with SQL, and it adds NO VENDOR — §17 rejected Firebase partly
 * to avoid exactly that. It is also write-only from here, so this endpoint
 * cannot be used to read anything back out.
 *
 * ==> IF THE BINDING IS MISSING, THIS DOES NOTHING, QUIETLY. <==
 * Deliberate, and the opposite of the inspect guard's fail-closed rule
 * (functions/api/_inspect-guard.js) — because the risk runs the other way. A
 * missing telemetry binding must never cost a user anything; telemetry is
 * diagnostics, and diagnostics that can degrade the product are worse than no
 * diagnostics. A missing INSPECT_KEY locks the door; a missing dataset just
 * drops the note.
 *
 * Binding: `TELEMETRY` — an Analytics Engine dataset, configured in the Pages
 * project. Set it up in the dashboard; there is no repo file for it.
 */

/** Hard ceiling on the request body. Anything larger is not our client. */
const MAX_BODY_BYTES = 8 * 1024;

/** The only event kinds that exist. Anything else is dropped, not stored. */
const KINDS = new Set(['error', 'rejection', 'source']);

/** The only sources that exist (§4). */
const SOURCES = new Set(['nhc', 'gdacs']);

/** The §5 three states, plus the loading state the store starts in. */
const STATUSES = new Set(['ok', 'unavailable', 'loading', 'none_matched', 'clear']);

/** Events accepted from a single beacon. The client caps at 20; this is the
 *  independent server-side version of that limit, because the client's word
 *  for it is worth nothing here. */
const MAX_EVENTS = 20;

const MAX_STR = 300;
const MAX_STACK = 600;

/** Coerce to a trimmed, capped string. Never throws, never returns null. */
function str(value, max) {
  if (typeof value !== 'string') return '';
  return value.slice(0, max);
}

/** Accept a value only if it is in the allowlist; otherwise the empty string.
 *  Unknown values are DISCARDED rather than stored-as-seen: an open string
 *  field is how arbitrary caller-controlled data gets into a dataset. */
function oneOf(value, allowed) {
  return typeof value === 'string' && allowed.has(value) ? value : '';
}

export async function onRequestPost(context) {
  /* Nothing below may throw out of this function. A 500 from a telemetry
   * endpoint is noise in the Workers log about a request that did not
   * matter. */
  try {
    const dataset = context.env?.TELEMETRY;
    /* No binding configured: accept and drop. See the header. */
    if (!dataset || typeof dataset.writeDataPoint !== 'function') {
      return new Response(null, { status: 204 });
    }

    const raw = await context.request.text();
    if (!raw || raw.length > MAX_BODY_BYTES) {
      return new Response(null, { status: 204 });
    }

    let body;
    try {
      body = JSON.parse(raw);
    } catch {
      return new Response(null, { status: 204 });
    }

    const events = Array.isArray(body?.events) ? body.events.slice(0, MAX_EVENTS) : [];
    if (!events.length) return new Response(null, { status: 204 });

    const app = str(body?.app, 32);
    const standalone = body?.standalone === true ? 1 : 0;

    /* Country comes from Cloudflare's own edge, NOT from the client, and it
     * is the coarsest geography there is. It is here because "the app is down
     * in one country" is a materially different alert from "the app is down",
     * and it cannot identify anybody.
     *
     * NOTHING FINER IS EVER ADDED HERE. No city, no region, no colo, no IP —
     * see lib/telemetry.js's contract. Colo in particular looks harmless and
     * is a near-neighbourhood in a small country. */
    const country = str(context.request.cf?.country, 2);

    for (const e of events) {
      const kind = oneOf(e?.k, KINDS);
      if (!kind) continue; // unknown kind: dropped entirely

      /* REBUILT, NOT FORWARDED. Every field is named here explicitly; there
       * is no spread and no pass-through of the parsed object. */
      dataset.writeDataPoint({
        /* Blobs: the strings. Order is the schema — Analytics Engine columns
         * are positional (blob1, blob2, ...), so APPEND ONLY. Reordering
         * these silently reinterprets every row already written. */
        blobs: [
          kind,                                    // blob1
          app,                                     // blob2
          country,                                 // blob3
          oneOf(e?.source, SOURCES),               // blob4
          oneOf(e?.status, STATUSES),              // blob5
          str(e?.message, MAX_STR),                // blob6
          str(e?.stack, MAX_STACK),                // blob7
          str(e?.reason, MAX_STR),                 // blob8
        ],
        doubles: [standalone],
        /* The index is what queries group by cheaply. Kind is the right
         * grain: "how many source failures in the last hour" is the question
         * this endpoint exists to answer. */
        indexes: [kind],
      });
    }

    return new Response(null, { status: 204 });
  } catch {
    return new Response(null, { status: 204 });
  }
}

/** Anything that is not a POST — including the preflight a confused client
 *  might send — gets the same nothing. No CORS headers: this endpoint is
 *  same-origin by design, and advertising otherwise invites use. */
export async function onRequest() {
  return new Response(null, { status: 204 });
}
