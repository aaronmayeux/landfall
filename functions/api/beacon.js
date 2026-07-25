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
 * ==> WHY ANALYTICS ENGINE WAS CHOSEN, AND THE CAVEAT THAT BIT <==
 * It binds directly to a Pages Function, is queryable with SQL, and adds NO
 * VENDOR — §17 rejected Firebase partly to avoid exactly that. It is also
 * write-only from here, so this endpoint cannot read anything back out.
 *
 * **The published "100k data points/day free" figure describes the QUOTA, not
 * the ACCESS.** Using it needs an account entitlement that is separate from
 * any plan tier and is not self-serve — the dashboard shows a Create Dataset
 * button and no enable toggle, and creating a dataset does NOT grant it.
 * Read a pricing page as an answer about cost, never as an answer about
 * whether you can turn the thing on.
 *
 * ==> THE BINDING IS OPTIONAL. WITHOUT IT, BEACONS GO TO THE CONSOLE. <==
 * Deliberate, and the opposite of the inspect guard's fail-closed rule
 * (functions/api/_inspect-guard.js) — because the risk runs the other way. A
 * missing telemetry binding must never cost a user anything; telemetry is
 * diagnostics, and diagnostics that can degrade the product are worse than no
 * diagnostics. A missing INSPECT_KEY locks the door; a missing dataset just
 * changes where the note is written.
 *
 * THAT PRINCIPLE WAS TESTED ON DAY ONE AND HELD. An Analytics Engine binding
 * to an account without the entitlement FAILS THE WHOLE FUNCTION DEPLOY —
 * every /api/ route, not just this file — and the entitlement is not
 * self-serve. Landfall's ability to ship a fix during a storm cannot depend
 * on a support ticket for a diagnostics feature, so the binding is optional
 * and the console is the fallback.
 *
 * Binding: `TELEMETRY` — an Analytics Engine dataset, configured in the Pages
 * project. OPTIONAL. Do NOT add it unless the account actually has the
 * Analytics Engine entitlement; a binding to an unentitled product blocks
 * every deploy. Without it, beacons go to the Worker console.
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
    const hasDataset = !!dataset && typeof dataset.writeDataPoint === 'function';

    /* NO EARLY RETURN WHEN THE BINDING IS ABSENT. Both sinks are chosen
     * per-event in the loop below; the console one needs no binding at all. */

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
       * is no spread and no pass-through of the parsed object. This one
       * object feeds BOTH sinks, so they can never disagree about what was
       * recorded. */
      const row = {
        kind,
        app,
        country,
        source: oneOf(e?.source, SOURCES),
        status: oneOf(e?.status, STATUSES),
        message: str(e?.message, MAX_STR),
        stack: str(e?.stack, MAX_STACK),
        reason: str(e?.reason, MAX_STR),
        standalone,
      };

      if (hasDataset) {
        dataset.writeDataPoint({
          /* Blobs: the strings. Order is the schema — Analytics Engine
           * columns are positional (blob1, blob2, ...), so APPEND ONLY.
           * Reordering these silently reinterprets every row already
           * written. */
          blobs: [
            row.kind,     // blob1
            row.app,      // blob2
            row.country,  // blob3
            row.source,   // blob4
            row.status,   // blob5
            row.message,  // blob6
            row.stack,    // blob7
            row.reason,   // blob8
          ],
          doubles: [row.standalone],
          /* The index is what queries group by cheaply. Kind is the right
           * grain: "how many source failures in the last hour" is the
           * question this endpoint exists to answer. */
          indexes: [row.kind],
        });
      } else {
        /* ==> THE CONSOLE IS THE FALLBACK SINK, AND IT NEEDS NO BINDING. <==
         *
         * Analytics Engine turned out to require an ACCOUNT ENTITLEMENT that
         * is not self-serve: the dashboard offers only "Create Dataset" and
         * no enable toggle, and a binding to an unentitled product FAILS THE
         * ENTIRE FUNCTION DEPLOY — every /api/ route with it, not just this
         * one. Landfall cannot have its ability to ship a fix during a storm
         * depend on a support ticket for a diagnostics feature.
         *
         * So the binding became OPTIONAL rather than required. `console.log`
         * reaches Cloudflare's real-time Worker logs with zero configuration,
         * which answers the actual question — "is it broken for anyone other
         * than Aaron" — well enough to be worth having today. It does not
         * retain history, which is the real cost and exactly what Analytics
         * Engine would buy back if the entitlement ever arrives.
         *
         * ONE PREFIX, so the logs are filterable. Same privacy contract as
         * everything else here: this logs `row`, which was rebuilt field by
         * field from an allowlist, never the caller's own object. */
        console.log('[landfall-telemetry] ' + JSON.stringify(row));
      }
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
        sink: bound ? 'analytics-engine' : 'console',
        meaning: bound
          ? 'The TELEMETRY binding is present. Beacons are written to Analytics Engine and are queryable historically.'
          : 'No TELEMETRY binding — this is a SUPPORTED state, not a fault. Beacons are written to the Worker console instead, visible in Cloudflare real-time logs (filter on [landfall-telemetry]). Nothing is lost in the moment; only history is. Analytics Engine needs an account entitlement that is not self-serve.',
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
