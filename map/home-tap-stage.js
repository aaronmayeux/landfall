/**
 * home-tap-stage.js — what the NEXT tap on the house glyph means.
 *
 * Tapping your own house asks one of two questions, and which one depends
 * entirely on whether you just asked the other:
 *
 *   HOUSE   "where is my house"      fly to it, close in, above the sheet
 *   PAIR    "what is coming for it"  pull back to the house AND the storm,
 *                                    exactly what the Home button does
 *
 * The first tap answers the first question and arms the second. Tapping again
 * escalates; tapping a third time drops back. Anything else that moves the
 * camera resets to HOUSE, because once you have spun the globe somewhere else
 * "take me home" is obviously the question again.
 *
 * ==> WHY THIS IS ITS OWN FILE. <== It is four lines of state and a pile of
 * reasons, and `app/views.js` is already past the size where things go in to
 * be forgotten (§12). Pulled out here it can be driven on plain node by
 * `tools/test-home-tap-stage.mjs` — the escalation and its reset are ORDERS,
 * and an order is the hardest thing in this app to notice going wrong.
 *
 * Imports: nothing. This is a state machine over map events.
 */

export const STAGE = Object.freeze({
  HOUSE: 'house',
  PAIR: 'pair',
});

/**
 * ==> THE EVENTS THAT MEAN "THE USER MOVED THE CAMERA THEMSELVES". <==
 *
 * These four, and not the obvious alternatives, for three separate reasons
 * that each cost something to learn:
 *
 * NOT `pointerdown`/`touchstart` on the container, which is what the idle
 * drift listens to. Those fire on the house tap itself — the glyph takes no
 * pointer events and the tap is resolved afterwards by the map's own click
 * handler — so the stage would be wiped a few milliseconds before the tap
 * that needs to read it. A drag, by contrast, is never a tap: MapLibre only
 * fires `dragstart` once the gesture has committed to being a drag.
 *
 * NOT MapLibre's `originalEvent` test for "was a human responsible". The
 * keyboard pans with `setCenter` and zooms with `zoomTo` (see attachKeyboard
 * in globe.js) — plain programmatic calls, indistinguishable from our own
 * flights. A keyboard user would have been locked in the second stage with no
 * way back out, which is a feature that does not exist for them (§13). Hence
 * `keydown` on the globe container, listened for directly.
 *
 * NOT `movestart`, which the idle drift fires on every frame of its rotation.
 * The drift is the app moving, not the user, and it must not silently expire
 * the escalation while somebody is deciding whether to tap again.
 *
 * The consequence worth knowing: `zoomstart` fires for OUR flights too, so
 * every other camera command in the app — selecting a storm, recentering,
 * opening a watch area — resets this for free, which is the behaviour we want
 * and did not have to write down anywhere. The price is that the house tap has
 * to record its own stage AFTER starting its flight. See `armed()`.
 */
const MAP_EVENTS = ['dragstart', 'zoomstart', 'rotatestart', 'pitchstart'];

/**
 * @param {object} map            the MapLibre map
 * @param {object}   [opts]
 * @param {HTMLElement} [opts.container]  where keydown is heard; defaults to
 *        the map's own container, which is the element attachKeyboard makes
 *        focusable and where arrow keys actually land.
 * @param {(stage: string) => void} [opts.onChange]  fired whenever the meaning
 *        of the next tap changes, so the button's label can follow it. Called
 *        only on a real change, never on a no-op reset.
 * @returns {{stage:Function, armed:Function, reset:Function, detach:Function}}
 */
export function createHomeTapStage(map, { container, onChange } = {}) {
  let stage = STAGE.HOUSE;

  const set = (next) => {
    if (next === stage) return;
    stage = next;
    onChange?.(stage);
  };

  const reset = () => set(STAGE.HOUSE);

  const target = container || map.getContainer();
  for (const e of MAP_EVENTS) map.on(e, reset);
  target.addEventListener('keydown', reset, { passive: true });

  return {
    /** What the next tap means, right now. */
    stage: () => stage,

    /**
     * Record what the tap just did, so the next one can mean the other thing.
     *
     * ==> CALL THIS AFTER STARTING THE FLIGHT, NEVER BEFORE. <== MapLibre
     * fires `zoomstart` synchronously from inside `flyTo`, and that listener
     * above resets the stage. Arming first therefore arms nothing: the flight
     * immediately wipes it and every tap stays a first tap forever. Arming
     * after is the whole trick, and it is invisible in the diff, which is why
     * `tools/test-home-tap-stage.mjs` asserts the order explicitly.
     *
     * `advance` false is the calm-day case: with no storm on the dashboard
     * there is no pair to frame, so a second tap would put the house at the
     * zoom it is already at and read as a dead button. Staying on HOUSE keeps
     * every tap meaning the one thing that is actually available, and keeps
     * the button's label from promising a stage that does not exist.
     */
    armed(advance = true) {
      set(advance ? STAGE.PAIR : STAGE.HOUSE);
    },

    /**
     * Force it back to HOUSE.
     *
     * NOT wired to the drawer closing, deliberately. Dismissing the panel does
     * not move the camera: you are still framed on your house, so "what is
     * coming for it" is still the unanswered question and the escalation is
     * still the honest next step. Escape closes AND recenters (§10), and the
     * recenter moves the camera, so that path resets through the listeners
     * above like everything else.
     */
    reset,

    detach() {
      for (const e of MAP_EVENTS) map.off(e, reset);
      target.removeEventListener('keydown', reset);
    },
  };
}
