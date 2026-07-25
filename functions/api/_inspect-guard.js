/**
 * _inspect-guard.js — the shared gate on the four /inspect routes. SPEC §17 A2.
 *
 * The leading underscore is load-bearing: Cloudflare Pages does not route
 * files whose name starts with `_`, so this is a module the inspect routes
 * import and never an endpoint of its own.
 *
 * ==> WHY THESE ROUTES ARE GATED AND NOT DELETED <==
 * The inspect routes are the standing answer to "the sandbox cannot reach
 * NOAA or GDACS" (§12, §14). They cost nothing idle, they write nothing, and
 * every time one has been used it has turned a day of guessing into ten
 * minutes of reading. They stay deployed.
 *
 * What changed on 2026-07-25 is who can drive them. Read-only is not the same
 * as harmless: an unauthenticated route that fetches upstream on demand is an
 * OPEN PROXY POINTED AT NOAA WEARING OUR USER-AGENT. §17 is explicit that
 * pointing public traffic at a public-good endpoint through our relay is a
 * different relationship than one person polling for himself, and an endpoint
 * a stranger can hammer is the worst version of it — the traffic is not even
 * ours.
 *
 * ==> 404, NOT 403, AND THE DIFFERENCE MATTERS <==
 * A 403 says "something is here and you may not have it", which is an
 * invitation. A 404 says nothing at all. The refusal is byte-identical to the
 * response for a path that was never deployed, so probing the app tells you
 * only that these routes do not exist.
 *
 * ==> THE KEY IS A PAGES ENVIRONMENT VARIABLE, NEVER A REPO FILE <==
 * `INSPECT_KEY`, set on Production AND Preview, same as MAPBOX_TOKEN (§3).
 * If it is UNSET the routes refuse EVERYTHING. That is deliberate and it is
 * the §5 shape applied to configuration: a missing key must fail closed, not
 * fall open. A guard that disables itself when misconfigured is not a guard.
 *
 * Imports: nothing. Imported by the four functions/api/<source>/inspect.js.
 */

/** Header the key may arrive in, in addition to the `key` query parameter. */
const KEY_HEADER = 'x-landfall-inspect';

/**
 * Constant-time-ish string compare.
 *
 * A plain `===` on a secret leaks its length and its matching prefix through
 * timing. That is a thin attack over the public internet against a route whose
 * worst outcome is reading NOAA's own public data — but the compare costs
 * nothing to write correctly, and writing it wrong here teaches the wrong
 * pattern for the next secret, which may not be this harmless.
 */
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * The refusal. Identical for every reason a request can be turned away —
 * unset key, missing key, wrong key — so the response distinguishes nothing.
 *
 * @returns {Response} 404, no body, no cache.
 */
export function inspectRefused() {
  return new Response(null, {
    status: 404,
    headers: { 'Cache-Control': 'no-store' },
  });
}

/**
 * Gate an inspect request.
 *
 * Call it FIRST in `onRequestGet`, before parsing parameters and before any
 * upstream fetch — the whole point is that an unauthorised caller never
 * causes an outbound request.
 *
 * @param {{request: Request, env: Record<string, unknown>}} context
 *        The Pages Function context.
 * @returns {Response|null} A 404 to return immediately, or null to proceed.
 *
 * @example
 *   export async function onRequestGet(context) {
 *     const denied = guardInspect(context);
 *     if (denied) return denied;
 *     ...
 *   }
 */
export function guardInspect(context) {
  const expected = context?.env?.INSPECT_KEY;

  /* Fail closed. An unset variable means the routes are unavailable, not
   * unprotected. */
  if (typeof expected !== 'string' || expected.length === 0) return inspectRefused();

  const url = new URL(context.request.url);
  const offered = url.searchParams.get('key') ?? context.request.headers.get(KEY_HEADER) ?? '';

  return safeEqual(offered, expected) ? null : inspectRefused();
}
