/**
 * near-home-standing.js — the one sentence the archive door earns its place with.
 * SPEC-SEASONS-BUILD.md §57.19, §57.35 fault 4, §57.30 step 9.
 *
 * *"143 storms have passed within 120 mi since 1851. The last was 2024."*
 *
 * ==> IT REPLACES THE DOOR'S SECOND LINE RATHER THAN ADDING A ROW. <== The
 * archive door already carries a subtitle stating the archive's SCOPE — *"Every
 * storm since 1851"* — which is there to answer "why would I press this". This
 * answers the same question with the reader's own house in it, which is
 * strictly better, and it costs no height, no new element and no change to the
 * dashboard's layout. §57.19 calls the standing line the hook; this is the slot
 * the hook was always for.
 *
 * ==> IT IS A FILE OF ITS OWN TO KEEP THE DYNAMIC IMPORT IN ONE NAMED PLACE.
 * <== §57.35 fault 4: nothing about the archive may reach the boot path, and
 * `ui/seasons-door.js` is the single exception because it imports nothing at
 * all. Putting `await import('../data/near-home-index.js')` inside
 * `ui/view-home.js` would work and would bury the one rule that keeps a
 * megabyte away from every visitor inside an 1,800-line file. Here it is the
 * subject of the module.
 *
 * ==> AND IT WAITS. <== `SEASONS.nearHomeIndexDelayMs` after the dashboard has
 * drawn. The pass behind this reads 0.94 MB and walks 84,365 track segments, to
 * fill in one line at the foot of a screen nobody has scrolled to yet. Starting
 * it during boot would put that in front of the storm the reader opened the app
 * for.
 *
 * ==> A FAILURE CHANGES NOTHING ON SCREEN. <== §57.35 FIX 8's surviving
 * sentence, and this is the file it governs. The door keeps the words it
 * already had, which are true. What must never happen is the door reporting
 * zero, because *"no storm has ever come near you"* and *"we could not work it
 * out"* are different facts and confusing them is the §5 failure this whole
 * feature is most exposed to. The only road to a sentence here runs through
 * `state === 'ok'`.
 *
 * Imports config/ and lib/ statically; `data/` dynamically, which is the point.
 * No DOM: it hands back a string and the caller decides what to do with it.
 */

import { SEASONS } from '../config/constants.js';
import {
  radiusToNm, rangeFor, standingCount, standingSentence,
} from '../lib/near-home-words.js';

/** Once per page load. The index itself is cached per house across visits
 *  (`data/near-home-index.js`), but a second dashboard render must not queue a
 *  second timer behind the first — `ui/view-home.js` re-renders on every poll. */
let started = false;

/**
 * Work out the standing line, eventually, and hand it back once.
 *
 * @param {object} opts
 * @param {() => ({lon:number,lat:number}|null)} opts.home    read at fire time,
 *   not at call time — the reader may set a home in the seconds this waits.
 * @param {() => string} opts.system                          units preference
 * @param {(sentence:string) => void} opts.onLine             called at most once
 * @param {number} [opts.delayMs]                             test seam
 */
export function startStandingLine({ home, system, onLine, delayMs = SEASONS.nearHomeIndexDelayMs }) {
  if (started) return;
  started = true;

  setTimeout(async () => {
    const here = home?.();
    /* No house, no question. Nothing is fetched and nothing is said — the door
     * keeps its scope line, which is the right subtitle for a reader the app
     * cannot place. */
    if (!Number.isFinite(here?.lon) || !Number.isFinite(here?.lat)) return;

    let out;
    try {
      const { ensureIndex } = await import('../data/near-home-index.js');
      out = await ensureIndex(here);
    } catch (err) {
      /* Console rather than screen: this is a hook that failed, not an answer
       * the reader asked for. A door apologising for a question nobody put is
       * worse than a door that simply says what it always said. */
      console.warn('[landfall] the near-home index could not be built:', err);
      return;
    }

    if (out?.state !== 'ok') {
      if (out?.reason) console.warn('[landfall] no near-home line:', out.reason);
      return;
    }

    const sys = system?.();
    const r = rangeFor(sys);
    const { count, lastYear } = standingCount(out.index, radiusToNm(r.default, sys));

    onLine?.(standingSentence({
      count,
      lastYear,
      radius: r.default,
      unit: r.unit,
      firstSeason: out.firstSeason,
    }));
  }, delayMs);
}

/** For the suite, which runs several cases in one process. Never called by the
 *  app: a page load is the only reset production has. */
export function __reset() {
  started = false;
}
