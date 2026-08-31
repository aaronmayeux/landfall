/**
 * season-cut.js — how much of a finished storm has happened yet.
 * §57.23, §57.67 slice B.
 *
 * ==> THIS FILE IS THE SAME ARGUMENT `season-focus.js` MAKES NEXT DOOR, ABOUT A
 * DIFFERENT RULE. <== The tracks live in `season-tracks.js`, the dots live in
 * `season-points.js`, and a clock that cut one but not the other would be worse
 * than no clock: a track growing out from under a full set of dots reads as a
 * rendering fault rather than as time passing. Putting the arithmetic in either
 * layer would make the other import it, which is the wrong direction — they are
 * siblings sharing one rule, not a dependency.
 *
 * ==> NOTHING IN HERE DRAWS, AND NOTHING IN HERE KNOWS WHAT TIME IT IS. <== It
 * takes an answer `lib/season-clock.js` already computed and turns it into two
 * numbers a layer can use: how many dots, and how much curve. The clock owns
 * WHEN; this owns HOW MUCH; the layers own HOW IT LOOKS. That split is why
 * slice A could be proven with no browser, and it is the whole reason step 10
 * is being built in slices at all (§57.67).
 *
 * ==> THE CUT IS OPTIONAL AND ITS ABSENCE IS NOT A STATE. <== With no cut every
 * function here answers "all of it", which is byte-for-byte what the archive
 * drew before the clock existed. That is asserted rather than assumed —
 * `tools/test-season-cut.mjs` pushes a season twice, with and without, and
 * compares the two GeoJSON payloads as strings.
 *
 * Imports nothing at all. Pure arithmetic over plain objects.
 */

/**
 * The clock's answer for one storm, or `null` when the clock has nothing to
 * say about it.
 *
 * ==> A STORM MISSING FROM THE CUT DRAWS IN FULL, RATHER THAN VANISHING. <==
 * `clockFrameAt` puts EVERY ticked storm in its answer, including ones with no
 * usable fix, precisely so the roster and the globe cannot hold different
 * lengths. So a storm that is not in the cut means the two have drifted apart,
 * which is a bug — and the question is only which failure a reader gets to see.
 * A storm drawn whole while its neighbours grow is visibly odd and points
 * straight at the cause. A storm that quietly disappears is §5's silence, and
 * the reverted build of 2026-08-26 is what that looks like on a phone: an empty
 * sepia world under a roster confidently saying `4 shown`.
 *
 * @param {Map<string, object>|null} cut  storm id → the clock's state for it
 * @param {string|null|undefined} id
 * @returns {object|null}
 */
export function cutStateFor(cut, id) {
  if (!cut || typeof cut.get !== 'function' || !id) return null;
  return cut.get(id) || null;
}

/**
 * Has this storm started yet?
 *
 * ==> AN UNBORN STORM DRAWS NOTHING AT ALL — NOT A DOT AT ITS BIRTHPLACE, NOT A
 * ONE-VERTEX STUB. <== §57.67c rule 1, and it is the rule with a revert behind
 * it. §57.23's whole effect is that the globe fills up as the season runs, and
 * that only means anything if it genuinely starts empty. The 2026-08-26 build
 * handed the globe a two-point stub for every storm that had not happened, and
 * what reached glass was a sepia sphere with faint marks all over it before the
 * clock had advanced a single step.
 *
 * `absent` is in here with `unborn` for the same outcome by a different route:
 * a storm with no usable fix has nowhere to be drawn at any moment.
 *
 * @param {object|null} state
 * @returns {boolean}
 */
export function cutHidesStorm(state) {
  return Boolean(state) && (state.phase === 'unborn' || state.phase === 'absent');
}

/**
 * How many of a storm's recorded fixes have happened.
 *
 * ==> THE CLAMP IS NOT PARANOIA ABOUT A NUMBER, IT IS ABOUT TWO LISTS. <== The
 * clock counts fixes that carry a lat, a `lonU` AND a time; the tracks count
 * fixes that carry a lat and a `lonU`; the dots count fixes that carry a lat and
 * a `lon`. Three filters, and `drawnFixes` from the first is read as a position
 * in the other two. **Measured across the whole shipped archive on 2026-08-31
 * the three lists never once differ — 6,532 storms, 175,262 fixes, zero
 * disagreements** — so this clamp does nothing today and is one comparison in
 * exchange for a list that runs off its own end if step 13's second source ever
 * fills those columns differently.
 *
 * An `ended` storm answers with its whole count, which is §57.67c rule 2: the
 * trail persisting after a storm dies is the feature.
 *
 * @param {object|null} state
 * @param {number} total  how many fixes the CALLER holds
 * @returns {number}
 */
export function cutDrawnFixes(state, total) {
  if (!state) return total;
  const n = Number.isFinite(state.drawnFixes) ? Math.floor(state.drawnFixes) : 0;
  return Math.max(0, Math.min(n, total));
}

/**
 * The head's position along a cached curve, in vertices.
 *
 * ==> IT ANSWERS IN THE CURVE'S OWN COORDINATES AND NEVER REBUILDS IT. <==
 * §57.35 fault 3. `index` comes from `smoothPathIndexed` and says which vertex
 * each recorded fix landed on; between two fixes the head slides along the
 * vertices already sitting between them. Nothing is re-splined, nothing is
 * searched, and the answer costs two array reads and a multiply.
 *
 * ==> AND THE HEAD RIDES THE CURVE RATHER THAN THE STRAIGHT LINE BETWEEN
 * FIXES. <== `lib/season-clock.js` also answers a `lon`/`lat`, interpolated
 * linearly between the two fixes either side of the moment, and that point is
 * NOT on the drawn curve — the curve bends between fixes and a straight lerp
 * does not. Cutting to the fraction of the LEG in vertex space keeps the end of
 * the trail exactly on the line the reader can see. The two answers agree at
 * every recorded fix, which is where the curve and the record touch.
 *
 * @param {Array<number>} index  fix number → vertex number
 * @param {object|null} state
 * @returns {number|null} a fractional vertex, or null for "the whole curve"
 */
export function cutVertex(index, state) {
  if (!state || !Array.isArray(index) || !index.length) return null;

  /* ==> THE `running` GUARD CHANGES NOTHING TODAY AND IS KEPT ANYWAY, WHICH IS
   * ONLY DEFENSIBLE BECAUSE IT SAYS SO. <== The same shape as slice A's
   * zero-length-leg guard (§57.67d), found the same way — by mutation, on
   * 2026-08-31. An `ended` storm's `drawnFixes` is its whole fix count, so
   * `at` is the last entry, `b` and `a` are the same vertex, and the answer is
   * the end of the curve whether this line runs or not. **Measured over 172
   * ended storms spanning 1851 to 2025: zero differences.** Deleting it leaves
   * `tools/test-season-cut.mjs` green, and no test in this repo covers it.
   *
   * It stays because it is the sentence the function is trying to say — only a
   * storm that is still going gets a PARTIAL cut — and because it becomes load
   * bearing the moment the clock's fix list and the layer's stop being the same
   * length, which is what step 13's second source could do (§57.31). */
  if (state.phase !== 'running') return null;

  /* `drawnFixes` counts the fixes at or behind the head, so the last completed
   * one is the entry before it. */
  const at = Math.max(0, Math.min(cutDrawnFixes(state, index.length) - 1, index.length - 1));
  const a = index[at];
  const b = index[Math.min(at + 1, index.length - 1)];

  const f = Number.isFinite(state.legFraction)
    ? Math.max(0, Math.min(state.legFraction, 1))
    : 0;

  return a + (b - a) * f;
}

/**
 * A cached curve, cut at the head.
 *
 * ==> THE LAST VERTEX IS INTERPOLATED RATHER THAN ROUNDED TO. <== Rounding to
 * the nearest whole vertex would make the trail advance in visible jerks on a
 * long leg: at `clockDaysPerSecond: 1` a six-hourly leg is a quarter of a real
 * second and can hold a dozen vertices, so the tip would jump several of them
 * at a time while the clock ticks smoothly underneath. One lerp per storm per
 * step is the entire cost of not doing that, and it changes nothing about the
 * cached curve.
 *
 * ==> FEWER THAN TWO COORDINATES IS NO LINE AT ALL, NOT A ONE-POINT LINE. <==
 * MapLibre rejects a `LineString` with a single coordinate, and a storm one step
 * past its first fix genuinely has nothing worth drawing. Returning null here is
 * the same answer `trackFeature` already gives a one-record storm, and
 * `season-points.js` is what puts a mark on a storm too short to be a line.
 *
 * @param {Array<Array<number>>} coords  the memoised smoothed curve
 * @param {Array<number>} index          fix number → vertex number
 * @param {object|null} state
 * @returns {Array<Array<number>>|null} the coordinates to draw, or null
 */
export function cutCurve(coords, index, state) {
  if (!Array.isArray(coords) || coords.length < 2) return null;
  if (cutHidesStorm(state)) return null;

  const v = cutVertex(index, state);
  if (v === null) return coords;

  const whole = Math.floor(v);
  const out = coords.slice(0, Math.min(whole + 1, coords.length));

  const next = coords[whole + 1];
  if (next && v > whole) {
    const head = coords[whole];
    const f = v - whole;
    out.push([head[0] + (next[0] - head[0]) * f, head[1] + (next[1] - head[1]) * f]);
  }

  return out.length < 2 ? null : out;
}

/**
 * One cut trail, chopped into pieces at the vertices given.
 *
 * ==> THIS EXISTS BECAUSE A MAPLIBRE LINE CARRIES EXACTLY ONE COLOUR, AND
 * §57.67a CALL 3 ASKS FOR SEVERAL. <== A track coloured at the correct
 * timestamps is not one feature wearing a gradient — `line-gradient` cannot be
 * driven per feature, so one storm's ramp would be every storm's ramp. It is
 * several features, each a stretch of track that held one grade, and this is
 * the arithmetic that cuts them.
 *
 * ==> EVERY PIECE SHARES ITS END VERTEX WITH THE NEXT ONE'S START. <== The
 * obvious spelling — slice `[a, b)` then `[b, c)` — leaves a gap the exact
 * width of one leg between two colours, which at a category change is precisely
 * where the reader is looking. Sharing the vertex means the two lines meet
 * under their round caps and the change reads as a change rather than as a
 * hole.
 *
 * ==> A BOUNDARY PAST THE END OF THE CUT IS NOT AN ERROR, IT IS THE ORDINARY
 * CASE. <== The boundaries are a whole storm's grade changes and the trail is
 * however much of it has happened, so most of them are still in the future for
 * most of a run. They are clamped and dropped here rather than filtered by
 * every caller.
 *
 * ==> AND EVERY PIECE SAYS WHICH BOUNDARY OPENED IT, WHICH IS THE ONLY REASON
 * THIS RETURNS OBJECTS. <== The caller holds one colour per boundary and has to
 * put the right one on the right piece. Counting pieces would not do it: a
 * boundary can be dropped for landing on the vertex before it, so piece three
 * is not always boundary three. `from` is the position in `at` of the boundary
 * this piece starts at, and `-1` means it starts at the beginning of the trail.
 *
 * @param {Array<Array<number>>} coords  the cut trail, from `cutCurve`
 * @param {Array<number>} at             vertex numbers to cut at, ascending
 * @returns {Array<{coords:Array<Array<number>>, from:number}>} one entry per
 *   piece. A piece with fewer than two coordinates is dropped rather than
 *   emitted — MapLibre rejects a one-coordinate `LineString`, the same rule
 *   `cutCurve` follows.
 */
export function cutSegments(coords, at) {
  if (!Array.isArray(coords) || coords.length < 2) return [];
  if (!Array.isArray(at) || !at.length) return [{ coords, from: -1 }];

  const last = coords.length - 1;
  const stops = [];
  for (let i = 0; i < at.length; i++) {
    const v = at[i];
    if (!Number.isFinite(v)) continue;
    const n = Math.floor(v);
    /* 0 and the final vertex are the ends of the whole trail rather than cuts
     * inside it. Past the end is the ordinary case — see above.
     *
     * ==> THE `>= last` HALF CHANGES NO ANSWER TODAY AND IS KEPT ANYWAY, WHICH
     * IS ONLY DEFENSIBLE BECAUSE IT SAYS SO. <== The same shape as slice A's
     * zero-length-leg guard and slice B's `running` guard, found the same way —
     * by mutation, on 2026-08-31. A stop past the end slices to the end anyway
     * and leaves a tail of one vertex, which is dropped, so the pieces come out
     * identical. Deleting it leaves every suite green and no test in this repo
     * covers it. It stays because it is what the sentence means — a cut is
     * INSIDE a line — and because without it a playing season builds and throws
     * away a slice per unreached grade per storm on every step, which is most of
     * them for most of a run. */
    if (n <= 0 || n >= last) continue;
    /* NOT ADVANCING is treated the same as repeating, and one comparison covers
     * two different things: two grade changes that landed on the same vertex —
     * a pair of short legs on a long track — and a caller that handed the list
     * in the wrong order, which would otherwise slice backwards and emit empty
     * pieces silently. The FIRST of two boundaries on one vertex is the one
     * that draws, and the second is invisible either way: the piece between
     * them is zero vertices long.
     */
    if (stops.length && n <= stops[stops.length - 1].v) continue;
    stops.push({ v: n, from: i });
  }
  if (!stops.length) return [{ coords, from: -1 }];

  const out = [];
  let from = 0;
  let opened = -1;
  for (const stop of stops) {
    const piece = coords.slice(from, stop.v + 1);
    if (piece.length >= 2) out.push({ coords: piece, from: opened });
    from = stop.v;
    opened = stop.from;
  }
  const tail = coords.slice(from);
  if (tail.length >= 2) out.push({ coords: tail, from: opened });
  return out;
}
