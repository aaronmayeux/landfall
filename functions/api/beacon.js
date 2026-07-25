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

/* The GET wiring-check below reuses the probe routes' gate rather than
 * inventing a second secret. One key, one refusal shape, one thing to rotate. */
import { guardInspect } from './_inspect-guard.js';

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

/**
 * GET — "is telemetry actually wired?", and nothing else.
 *
 * ==> WHY THIS EXISTS: THE SILENCE ABOVE IS UNVERIFIABLE. <==
 * `onRequestPost` returns 204 whether it wrote a data point or dropped it on
 * the floor, because a missing binding must never cost a user anything. That
 * is the right behaviour for the app and a terrible property for setup: after
 * configuring the binding in Cloudflare there is NO WAY, from outside, to
 * tell a working telemetry pipeline from a silently discarded one. "It
 * returned 204" is not evidence.
 *
 * That is the same trap §5 is about — an absence that looks like success —
 * and it would have sat there as an assumed-good configuration nobody ever
 * checked. So the endpoint gets one honest answer, behind the SAME
 * `INSPECT_KEY` gate as the four probe routes, refusing identically (404) to
 * anyone without it. It reports whether the binding is present. It never
 * reads, queries, or returns any telemetry DATA — there is nothing here to
 * exfiltrate even with the key.
 */
export async function onRequestGet(context) {
  const denied = guardInspect(context);
  if (denied) return denied;

  const dataset = context.env?.TELEMETRY;
  const bound = !!dataset && typeof dataset.writeDataPoint === 'function';

  return new Response(
    JSON.stringify(
      {
        what: 'Landfall telemetry wiring check (SPEC §17 A5)',
        datasetBound: bound,
        meaning: bound
          ? 'The TELEMETRY binding is present. Beacons are being written.'
          : 'NO TELEMETRY BINDING. Beacons are accepted and discarded — the app is fine, but nothing is being recorded. Add an Analytics Engine binding named TELEMETRY, then redeploy.',
      },
      null,
      2
    ),
    { headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } }
  );
}

/** Anything that is not a POST or a gated GET — including the preflight a
 *  confused client might send — gets the same nothing. No CORS headers: this
 *  endpoint is same-origin by design, and advertising otherwise invites use. */
export async function onRequest() {
  return new Response(null, { status: 204 });
}
