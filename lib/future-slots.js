/**
 * future-slots.js — "keep history, drop the future", in one place.
 *
 * ==> WHY THIS IS ITS OWN FILE <==
 * This rule was born inside lib/silence.js and belonged there while silence
 * was the only reason to apply it. §5's ended state is the second reason: a
 * storm whose agency has issued its final bulletin has exactly the same
 * problem a silent storm does — a cone and a watch stripe on screen that are
 * claims about a future nobody is publishing any more.
 *
 * The project rule is that a pattern used twice gets extracted BEFORE the
 * second use. There is a sharper reason than tidiness here: two copies of this
 * list can drift, and a drifted copy means a storm that hides its cone when it
 * goes quiet and keeps it when it dies — an inconsistency in the one direction
 * §5 cares about, discovered by a user rather than by us.
 *
 * ==> THE RULE <==
 * `pastTrack` and `pastPoints` are RECORDS. A day-old record of where a storm
 * has been is still true, and a week-old one is still true. The cone, the
 * forecast track, the forecast points, model guidance, the wind field and any
 * watch/warning stripe are all CLAIMS about now or next, and neither a silent
 * publisher nor a finished storm supports making them.
 *
 * Pure functions. No DOM, ever. No imports.
 */

/** The slots that make a claim about NOW or NEXT.
 *
 *  ==> `windSwath` IS ON THIS LIST, AND IT WAS NOT UNTIL 2026-08-08. <==
 *
 *  It was kept, for six weeks, on the stated grounds that the swath says
 *  "these are the winds this storm has ALREADY laid down", which would stay
 *  true however long the silence ran. That sentence was written against NHC's
 *  shape and never checked against the feed it was protecting.
 *
 *  MEASURED, live, on DOLPHIN-26 (GDACS event 1001297 episode 51, raw
 *  geometry pulled 2026-08-08): the published `60 km/h` swath spans
 *  112.66-178.33 E. Dolphin's past track ends at 178.3 E and its FORECAST
 *  track runs west to 114.8 E — so the swath covers both, by construction.
 *  GDACS publishes one merged corridor per threshold across the whole event,
 *  analysis and projection together, and there is nothing in the polygon that
 *  says where one ends and the other begins. NHC's is the same shape for the
 *  same reason: `buildFullTrack` sweeps the past, current AND forecast tiers
 *  into one envelope.
 *
 *  So the swath cannot be clipped back to history — only kept whole or
 *  dropped whole. Dropped, because a corridor that includes five days of
 *  forecast wind coverage, drawn beside a hidden cone, is the confident-future
 *  problem this file exists to remove, arriving through the one slot that was
 *  trusted not to have one.
 *
 *  THE COST IS REAL AND IT IS ACCEPTED. A storm whose forecast bands were all
 *  degenerate — KUJIRA-26 measured the same day, every band a zero-area
 *  placeholder — has a swath that genuinely IS past-only, and it goes too. We
 *  cannot prove which case we are holding from the polygon alone, and the app
 *  fails closed everywhere else it cannot prove something (§6).
 *
 *  `watchWarning` is here for a sharper reason than tidiness. Those are live
 *  government orders, and an expired evacuation stripe painted as current is
 *  the most dangerous thing this app could draw. */
export const FUTURE_SLOTS = Object.freeze([
  'cone',
  'forecastTrack',
  'forecastPoints',
  'watchWarning',
  'modelTracks',
  'windCurrent',
  'windSwath',
]);

/** An emptied slot. `none` rather than `unavailable`: nothing failed, and a
 *  layer row reporting a fault it did not have would send someone hunting a
 *  dead endpoint. */
const EMPTY_SLOT = Object.freeze({ status: 'none', fc: null, error: null });

/**
 * A bundle with every forward-looking slot emptied, plus `forecast` cleared so
 * the closest-approach maths has nothing to run on.
 *
 * A SHALLOW COPY, never a mutation — the same rule main.js follows for model
 * tracks, and for the same reason: the bundle is a cached object shared with
 * the ambient collections and the cage's ridge builder, so writing into it
 * would strip a storm everywhere it is held, permanently, including after a
 * fresh advisory arrives and brings it back to life.
 *
 * `stamp` is deliberately preserved. The panel still needs to say which
 * advisory the surviving past track came from.
 */
export function withoutFuture(bundle) {
  if (!bundle || !bundle.layers) return bundle;
  const layers = { ...bundle.layers };
  for (const key of FUTURE_SLOTS) {
    if (key in layers) layers[key] = EMPTY_SLOT;
  }
  return { ...bundle, layers, forecast: [] };
}
