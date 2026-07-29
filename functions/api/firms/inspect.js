/**
 * /api/firms/inspect — is the NASA FIRMS key configured, and does NASA accept it?
 *
 * Guarded by `_inspect-guard.js` like the other four inspect routes: no key,
 * wrong key, or unset `INSPECT_KEY` all get a byte-identical 404 (§17 A2).
 *
 * ==> WHY THIS EXISTS BEFORE ANY FIRE CODE DOES. <==
 * `FIRMS_MAP_KEY` is a Pages environment variable, set by hand in a dashboard.
 * Three things can be wrong with it and they need completely different fixes:
 * it can be MISSING, it can be PRESENT BUT NOT VISIBLE TO THIS BUILD, or it can
 * be present and REJECTED BY NASA. "The fire layer is empty" looks the same in
 * all three cases, and guessing between them from a blank map is exactly the
 * §5 failure this project keeps writing down.
 *
 * ==> AN ENV CHECK ALONE WOULD BE A CHECK THAT CANNOT FAIL THE WAY IT BREAKS.
 * Reporting `set: true` proves the string exists, not that it works. A typo'd
 * or expired key is a perfectly good string. So this ASKS NASA, using their
 * own key-status endpoint, which is the cheapest possible call — it returns
 * quota status and no fire data at all.
 *
 * Measured behaviour of that endpoint (2026-07-29), which is why the mapping
 * below is what it is:
 *   no key / bad key  -> HTTP 403, text/html, "MAP_KEY is invalid or your have
 *                        exceeded your transaction/time limit."
 *   bad key on /api/area/csv/... -> HTTP 400, "Invalid MAP_KEY."
 * Note NASA conflates "invalid" and "over quota" into ONE message. We cannot
 * tell those apart from here and this route does not pretend to — it reports
 * what NASA said rather than inventing a diagnosis.
 *
 * ==> IT NEVER RETURNS THE KEY, OR ANY PART OF IT. <==
 * Length and a boolean only. An inspect route is gated, not secret-safe: the
 * gate is one shared key that lives in a dashboard, and a diagnostic that
 * echoes a credential turns one leaked key into two.
 *
 * Imports: ../_inspect-guard.js only.
 */

import { guardInspect } from '../_inspect-guard.js';

/** NASA's own key-status probe. Returns quota state, never fire data — so this
 *  costs the account nothing meaningful and can be called freely. */
const STATUS_URL = 'https://firms.modaps.eosdis.nasa.gov/mapserver/mapkey_status/';

/* NASA rejects a bare curl on some FIRMS paths, and a relay should identify
 * itself anyway — the same courtesy §23.2 makes mandatory for api.weather.gov. */
const USER_AGENT = 'landfall.getgravitate.app (andy@getgravitate.app)';

const json = (body, status = 200) =>
  new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });

export async function onRequestGet(context) {
  const refused = guardInspect(context);
  if (refused) return refused;

  const key = context.env.FIRMS_MAP_KEY;

  if (!key) {
    /* MISSING, or present on the project but not on THIS BUILD. Those are
     * indistinguishable from inside the running Function, and the second is
     * the more likely one right after somebody adds the variable: a Pages
     * environment variable only reaches builds made AFTER it was saved.
     * Saying so here is the difference between a two-minute fix and an
     * evening — it has already cost one on this project, for a D1 binding. */
    return json({
      configured: false,
      verdict: 'FIRMS_MAP_KEY is not visible to this build.',
      hint:
        'Set it in Pages > Settings > Environment variables on BOTH Production ' +
        'and Preview, then force a NEW build — an existing deployment never ' +
        'picks up a variable added after it was built.',
    });
  }

  let upstream;
  try {
    const res = await fetch(`${STATUS_URL}?MAP_KEY=${encodeURIComponent(key)}`, {
      headers: { 'User-Agent': USER_AGENT },
    });
    /* Body is text/html on failure and small either way; read it as text and
     * hand back a trimmed copy so a future unknown state is still legible
     * rather than being flattened into our own guess. */
    const body = (await res.text()).slice(0, 400);
    upstream = { status: res.status, body };
  } catch (err) {
    return json({
      configured: true,
      keyLength: key.length,
      verdict: 'Could not reach NASA at all — this says nothing about the key.',
      detail: String(err?.message || err),
    });
  }

  const ok = upstream.status === 200;
  return json({
    configured: true,
    keyLength: key.length,
    accepted: ok,
    verdict: ok
      ? 'NASA accepted the key. The fire relay has what it needs.'
      : 'The key is set but NASA rejected it. NASA reports "invalid" and ' +
        '"over quota" with the same message, so this is one or the other.',
    upstream,
  });
}
