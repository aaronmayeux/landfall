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
 * ==> THE SINK IS D1, AND ANALYTICS ENGINE IS NOT COMING BACK <==
 * Analytics Engine was the original design (§17) and it failed on day one:
 * it needs an ACCOUNT ENTITLEMENT that is separate from any plan tier and is
 * not self-serve. The dashboard offers a Create Dataset button and no enable
 * toggle, and creating a dataset does NOT grant it. Worse, a binding to an
 * unentitled product FAILS THE WHOLE FUNCTION DEPLOY — every /api/ route, not
 * just this file.
 *
 * **The published "100k data points/day free" figure described the QUOTA, not
 * the ACCESS.** Read a pricing page as an answer about cost, never as an
 * answer about whether you can turn the thing on. That mistake has now been
 * made twice on this project; the note stays here so it is not made a third
 * time.
 *
 * D1 replaces it because it needs no entitlement, runs on the free plan, and
 * — the part that matters — CAN BE QUERIED. The console fallback below loses
 * history the moment the log scrolls, which was always its real cost. Rows in
 * a database are readable a week later, which is when most of these questions
 * actually get asked. Still no vendor: §17 rejected Firebase partly to avoid
 * exactly that, and D1 is the same account this app already runs in.
 *
 * ==> THE BINDING IS OPTIONAL. WITHOUT IT, BEACONS GO TO THE CONSOLE. <==
 * Deliberate, and the opposite of the inspect guard's fail-closed rule
 * (functions/api/_inspect-guard.js) — because the risk runs the other way. A
 * missing telemetry binding must never cost a user anything; telemetry is
 * diagnostics, and diagnostics that can degrade the product are worse than no
 * diagnostics. A missing INSPECT_KEY locks the door; a missing database just
 * changes where the note is written.
 *
 * THAT PRINCIPLE IS WHY THIS FILE COULD SHIP BEFORE THE BINDING EXISTED. The
 * D1 code path deploys safely against an account with no binding at all and
 * simply keeps logging to the console until one is added. Landfall's ability
 * to ship a fix during a storm cannot depend on a diagnostics feature being
 * configured first.
 *
 * Binding: `TELEMETRY_DB` — a D1 database, configured in the Pages project
 * dashboard (Settings > Bindings > D1 database bindings). OPTIONAL.
 *
 * NOT configured via wrangler.toml, deliberately: adding a Wrangler config
 * file makes it the SOURCE OF TRUTH for the whole Pages project and turns the
 * dashboard read-only, which would put INSPECT_KEY and MAPBOX_TOKEN at risk.
 * A diagnostics binding is not worth that blast radius.
 *
 * Schema lives in functions/api/_telemetry-store.js. Tables: `events` (one
 * row per error/rejection) and `source_rollup` (a per-minute counter, because
 * source transitions are global and would otherwise flood).
 */

/* The GET wiring-check below reuses the probe routes' gate rather than
 * inventing a second secret. One key, one refusal shape, one thing to rotate. */
import { guardInspect } from './_inspect-guard.js';
import { writeTelemetry } from './_telemetry-store.js';

/** Hard ceiling on the request body. Anything larger is not our client. */
const MAX_BODY_BYTES = 8 * 1024;

/** The only event kinds that exist. Anything else is dropped, not stored. */
const KINDS = new Set(['error', 'rejection', 'source', 'session']);

/* ---------------------------------------------------------------------------
 * THE SESSION SUMMARY'S ALLOWLIST
 *
 * ==> A WIDE EVENT IS THE EASIEST PLACE TO SMUGGLE A FIELD, so it gets the
 * strictest treatment in this file. Thirty-odd values arrive from an
 * untrusted POST; every one of them is either a member of a fixed enum or a
 * clamped non-negative integer, and anything not named below never reaches
 * the database no matter what the client sends.
 *
 * The client caps and coerces these too (lib/perf.js). That is not
 * duplication — the client's word is worth nothing here, and this is the gate
 * that actually holds.
 * ------------------------------------------------------------------------- */

/** Fields whose value must be one of a small fixed set. Anything else becomes
 *  the empty string rather than being stored as seen — an open string column
 *  is how arbitrary caller-controlled data gets into a dataset. */
const SESSION_ENUMS = Object.freeze({
  platform: new Set(['ios', 'android', 'macos', 'windows', 'linux', 'other']),
  engine: new Set(['blink', 'gecko', 'webkit', 'other']),
  nav_type: new Set(['navigate', 'reload', 'back_forward', 'prerender']),
  conn_type: new Set(['slow-2g', '2g', '3g', '4g']),
});

/** Fields stored as non-negative integers. */
const SESSION_NUMS = Object.freeze([
  'transfer_bytes', 'sw_controlled',
  'ttfb_ms', 'fcp_ms', 'lcp_ms', 'dcl_ms', 'load_ms',
  't_globe_ms', 't_data_ms', 't_storms_ms',
  'longtask_n', 'longtask_ms', 'worst_event_ms', 'webgl_lost',
  'conn_rtt', 'conn_down', 'save_data',
  'screen_w', 'screen_h', 'dpr', 'mem_gb', 'cores',
  'storm_select', 'advisory_open', 'layer_toggle', 'layer_pair', 'layer_reset',
  'model_toggle', 'recenter', 'home_set', 'retry',
  'hidden_at_start', 'first_hidden_ms',
]);

/** Ceiling on any session number.
 *
 *  Sized as one hour in milliseconds, because the largest legitimate value
 *  here is a page timing and nothing in this app is honestly slower than
 *  that. It exists so a hostile or broken client cannot poison an average
 *  with a number the size of a galaxy. */
const MAX_SESSION_NUM = 3600000;

/** Coerce to a clamped non-negative integer. Never throws, never returns
 *  NaN, never returns null — the database columns are NOT NULL and 0 is the
 *  honest value for "this browser did not report it". */
function num(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(Math.round(n), MAX_SESSION_NUM);
}

/**
 * Rebuild a session summary from the allowlist above.
 *
 * REBUILT, NOT FORWARDED — the same rule as every other row in this file.
 * `app`, `country` and `standalone` come from the envelope and the edge, not
 * from the event body.
 */
function buildSession(e, app, country, standalone) {
  const row = { kind: 'session', app, country, standalone };
  for (const key of Object.keys(SESSION_ENUMS)) {
    row[key] = oneOf(e?.[key], SESSION_ENUMS[key]);
  }
  for (const key of SESSION_NUMS) {
    row[key] = num(e?.[key]);
  }
  return row;
}

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
    const db = context.env?.TELEMETRY_DB;
    const hasDb = !!db && typeof db.prepare === 'function';

    /* NO EARLY RETURN WHEN THE BINDING IS ABSENT. The sink is chosen after
     * the rows are built; the console one needs no binding at all. */

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

    /* Built first, written after. Collecting the whole beacon before touching
     * a sink is what lets the D1 path go out as ONE batched transaction
     * instead of a write per event, and it keeps the allowlist logic below
     * completely ignorant of where the rows end up. */
    const rows = [];

    for (const e of events) {
      const kind = oneOf(e?.k, KINDS);
      if (!kind) continue; // unknown kind: dropped entirely

      /* The session summary is a different shape from the other three — wide,
       * numeric, and once per visit — so it gets its own builder rather than
       * being forced through the error/source field set. Same rule applies:
       * every field named explicitly, nothing passed through. */
      if (kind === 'session') {
        rows.push(buildSession(e, app, country, standalone));
        continue;
      }

      /* REBUILT, NOT FORWARDED. Every field is named here explicitly; there
       * is no spread and no pass-through of the parsed object. This one
       * object feeds BOTH sinks, so they can never disagree about what was
       * recorded. */
      rows.push({
        kind,
        app,
        country,
        source: oneOf(e?.source, SOURCES),
        status: oneOf(e?.status, STATUSES),
        message: str(e?.message, MAX_STR),
        stack: str(e?.stack, MAX_STACK),
        reason: str(e?.reason, MAX_STR),
        standalone,
      });
    }

    if (rows.length) {
      if (hasDb) {
        /* ==> waitUntil, NEVER await. <==
         * The 204 goes out first and the write lands after the response is
         * already on the wire. A slow or failing database therefore cannot
         * become a slow beacon — which matters because this endpoint is
         * called from `visibilitychange`, on a phone that is being put away.
         * Awaiting here would hold a user's request open for a diagnostics
         * write, exactly the cost telemetry is not allowed to impose.
         *
         * ONE server timestamp for the whole beacon, taken here rather than
         * inside the store, so every event in a single flush shares a rollup
         * bucket. Client clocks are never trusted for this. */
        context.waitUntil(writeTelemetry(db, rows, Math.floor(Date.now() / 1000)));
      } else {
        /* ==> THE CONSOLE IS THE FALLBACK SINK, AND IT NEEDS NO BINDING. <==
         *
         * This is the state the app ships in until a `TELEMETRY_DB` binding
         * is added in the Pages dashboard, and it is a SUPPORTED state, not a
         * fault. `console.log` reaches Cloudflare's real-time Worker logs with
         * zero configuration, which answers the actual question — "is it
         * broken for anyone other than Aaron" — well enough to be worth
         * having. What it cannot do is RETAIN: the log has no history and no
         * query, and buying that back is the entire reason the D1 path above
         * exists.
         *
         * ONE PREFIX, so the logs are filterable. Same privacy contract as
         * everything else here: these rows were rebuilt field by field from
         * an allowlist, never the caller's own object. */
        for (const row of rows) {
          console.log('[landfall-telemetry] ' + JSON.stringify(row));
        }
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

  const db = context.env?.TELEMETRY_DB;
  const bound = !!db && typeof db.prepare === 'function';

  return new Response(
    JSON.stringify(
      {
        what: 'Landfall telemetry wiring check (SPEC §17 A5)',
        databaseBound: bound,
        sink: bound ? 'd1' : 'console',
        meaning: bound
          ? 'The TELEMETRY_DB binding is present. Beacons are written to D1 and are queryable historically: errors and rejections land one row each in `events`, and source transitions increment a per-minute counter in `source_rollup`.'
          : 'No TELEMETRY_DB binding — this is a SUPPORTED state, not a fault. Beacons are written to the Worker console instead, visible in Cloudflare real-time logs (filter on [landfall-telemetry]). Nothing is lost in the moment; only history is. Add a D1 binding named TELEMETRY_DB in the Pages project (Settings > Bindings) and redeploy to start retaining.',
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
