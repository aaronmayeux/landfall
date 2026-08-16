/**
 * view-home-setup.js — SETTING home. The dashboard that READS it is
 * ui/view-home.js (SPEC-UI §8).
 *
 * ==> THIS FILE USED TO BE THE WHOLE OF "HOME". <==
 * Opening the home FAB landed here: search, locate, drop a pin, done. The
 * only thing the app ever SAID about home — distance, closest approach — was
 * buried in the storm detail panel, three taps away and attached to a storm
 * rather than to the house.
 *
 * So home has been split in two by what it is FOR. The dashboard answers "is
 * this storm going to affect me, how badly, and when?" and owns the FAB. This
 * file is the configuration behind it, reached from an "Edit home" control in
 * the dashboard's corner and shown outright only when no home is set yet —
 * which is the one moment it is the most useful thing on screen.
 *
 * THE CENTRAL RULE OF THIS PANEL: a geocode result is a GUESS until the user
 * confirms it. Home is the reference point for every distance and every
 * closest-approach figure in the app, and a wrong home poisons all of them
 * silently — the numbers still look like numbers. So nothing here commits a
 * location without an explicit confirm, and every provisional pin is draggable.
 *
 * NEVER PROMPTS ON FIRST LAUNCH. Geolocation fires only from an explicit tap
 * on "Use my location" — a permission dialog before someone knows what the app
 * is gets denied, and iOS makes that very hard to undo (SPEC §8).
 *
 * ==> THE THREE DOORS ARE PEERS AND THE STYLING SAYS SO. <== They were once a
 * filled button, a bare text field, and an outlined button with a transparent
 * fill — three treatments, which read as a ranking that does not exist.
 * Geolocation fails for anyone who has ever denied it, search fails for anyone
 * whose road the geocoder has wrong, and the pin never fails at all. One
 * recipe, three uses; a fourth way in would get the same class and nothing
 * else. Search is a choice you OPEN rather than a field sitting open, which is
 * what makes the three genuinely identical and what keeps a keyboard from
 * covering the other two on arrival.
 *
 * ==> REMOVE HOME IS NOT IN THAT FAMILY AND IS NOT NEXT TO IT. <== It is text
 * in the error color at the very bottom, behind a rule. A destructive action
 * wearing the same clothes as the thing you came here to do is one mis-tap
 * away from being the thing you did.
 *
 * ==> COORDINATES ARE NOT THE ANSWER TO "WHERE IS HOME". <== A pin-set home
 * carried no label, so every screen printed `29.301, -94.798` forever. The
 * point is NAMED now: `data/place-resolver.js` asks the geocoder what is there
 * and the basemap whether it is water, and `lib/place-label.js` turns the pair
 * into one line. Four outcomes, never collapsed into each other. Water is a
 * description, not a warning — watching a point in the Gulf is a legitimate
 * thing to want, and nothing here treats it as a mistake.
 *
 * Three async surfaces, each with all three states (SPEC §5):
 *   search      loading / none_matched / unavailable+retry
 *   geolocation loading / denied-or-failed (with the manual fallback offered)
 *   confirm     always available, never blocked on either of the above
 *
 * A FOURTH IS DELIBERATELY NOT ONE OF THEM. Naming the point can fail and the
 * user is never blocked by it — the pin is already right, the home will work,
 * and only the caption is missing. So a failed lookup degrades to coordinates
 * and says nothing further. Turning a cosmetic miss into an error banner over
 * a hurricane map would be the loudest possible response to the smallest
 * possible problem.
 *
 * Imports: config/, lib/, data/. Never map/ — main.js wires the camera, the
 * provisional pin and the water probe in through callbacks (§12).
 */

import { GEOCODE } from '../config/constants.js';
import { createPlaceResolver } from '../data/place-resolver.js';
import { locateMe, setHome, clearHome, getHome, updateHomePlace } from '../data/home.js';
import { placeText, placeSubText, coordText, PLACE_KIND } from '../lib/place-label.js';
import { addressSearchHtml, createAddressSearch } from './home-search.js';
import { setDottedText } from './loading-dots.js';

/**
 * @param {object} opts
 * @param {(lonlat:{lon,lat}, opts?:{zoom?:number}) => void} opts.onPreview
 *        Fly the camera and show a PROVISIONAL pin. Not a commit.
 * @param {() => ({lon,lat}|null)} opts.getProvisional
 *        Current provisional pin position — it moves when the user drags it,
 *        so the view must read it at confirm time rather than trusting its own
 *        copy from when the result was picked.
 * @param {() => void} opts.onCancelPreview      Clear the provisional pin.
 * @param {(home) => void} opts.onCommit         Home is now real.
 * @param {() => void} opts.onDone               Close the drawer (home is set).
 * @param {() => ({lon,lat}|null)} opts.getViewCenter
 *        Where the camera is pointed right now — the drop-a-pin path puts the
 *        pin there. Injected rather than read from the map, because ui/ never
 *        imports map/ (§12).
 * @param {(lonlat:{lon,lat}) => Promise<'water'|'land'|'unknown'>} [opts.probeWater]
 *        Ask the basemap whether this point is on water. Injected for the same
 *        reason. Absent or failing, everything still works — the answer is
 *        `unknown` and the label falls back to coordinates.
 */
export function createHomeSetupView({
  onPreview,
  getProvisional,
  onCancelPreview,
  onCommit,
  onDone,
  getViewCenter,
  probeWater,
}) {
  let host = null;
  let visible = false;
  let pending = null; // the candidate awaiting confirmation

  /** Teardown for anything subscribed outside this view's own DOM. DOM
   *  listeners die with the elements; a subscription to a module-level
   *  publisher does not, and would keep this view alive after destroy(). */
  const unwire = [];

  /** Set once we have tried to name an older home that was stored without a
   *  place. One attempt per session: it costs a billed lookup, it is entirely
   *  cosmetic, and retrying it on every render would turn a nicety into a
   *  loop. */
  let backfilled = false;

  function buildSkeleton(hostEl) {
    host = hostEl;
    host.innerHTML = `
    <div class="drawer-body">
      <!-- WHERE HOME IS NOW. A plain labelled line, NOT a bordered box — it
           used to carry the same fill, border and radius as the buttons under
           it and read as a fourth button. It is a statement of fact; the
           controls are below it. -->
      <section class="home-now" data-hidden="true">
        <p class="home-kicker">Your home</p>
        <p class="home-now-place"></p>
        <p class="home-now-coords"></p>
      </section>

      <div class="home-setup">
        <p class="home-lede"></p>

        <!-- THREE PEERS. Same fill, same border, same shape, same weight.
             Whichever one a person reaches for first is the right one for
             them, and the panel has no opinion about which that is. -->
        <ul class="home-choices" role="list">
          <li class="home-choice-item">
            <button class="home-choice" type="button" data-choice="locate">
              <span class="home-choice-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"
                     stroke-linecap="round" stroke-linejoin="round">
                  <circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2.4"/>
                  <path d="M12 1v3M12 20v3M1 12h3M20 12h3"/>
                </svg>
              </span>
              <span class="home-choice-text">
                <span class="home-choice-title">Use my location</span>
                <span class="home-choice-sub">Fastest. Your phone will ask permission.</span>
              </span>
            </button>
            <p class="home-locate-error" role="alert" data-hidden="true"></p>
          </li>

${addressSearchHtml()}

          <li class="home-choice-item">
            <!-- THE DOOR THAT ALWAYS WORKS. Geolocation needs permission,
                 search needs the address to be findable, and neither helps
                 someone who lives down a road the geocoder puts in the wrong
                 parish. This one needs no permission and no network. -->
            <button class="home-choice" type="button" data-choice="pin">
              <span class="home-choice-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"
                     stroke-linecap="round" stroke-linejoin="round">
                  <path d="M12 21s6-5.7 6-10a6 6 0 1 0-12 0c0 4.3 6 10 6 10Z"/>
                  <circle cx="12" cy="11" r="2.2"/>
                </svg>
              </span>
              <span class="home-choice-text">
                <span class="home-choice-title">Drop a pin on the globe</span>
                <span class="home-choice-sub">Puts a pin where you're looking. Drag it anywhere.</span>
              </span>
            </button>
          </li>
        </ul>
      </div>

      <div class="home-confirm" data-hidden="true">
        <p class="home-kicker">Set home here?</p>
        <p class="home-confirm-label"></p>
        <p class="home-confirm-coords"></p>
        <p class="home-confirm-hint"></p>
        <div class="home-confirm-actions">
          <button class="home-confirm-yes" type="button">Set as home</button>
          <button class="home-confirm-no" type="button">Cancel</button>
        </div>
      </div>

      <!-- LAST, AND ON ITS OWN. Below every way of setting a home, behind a
           rule, in the error color, as text rather than as a filled control.
           It is reachable in one tap and impossible to mistake for one of the
           three above it. -->
      <div class="home-danger" data-hidden="true">
        <button class="home-clear" type="button">Remove home</button>
      </div>
    </div>
  `;
    wire();
  }

  const $ = (sel) => host?.querySelector(sel);

  /* Elements are LOOKED UP ON ACCESS rather than captured at build time.
   * The view mounts lazily — the searcher's callback and the home
   * subscription can both fire before this view has ever been shown, and a
   * captured reference would be null forever. Every consumer below is
   * null-guarded, so an early fire is a no-op instead of a crash. */
  const el = {
    get nowBox() { return $('.home-now'); },
    get nowPlace() { return $('.home-now-place'); },
    get nowCoords() { return $('.home-now-coords'); },
    get dangerBox() { return $('.home-danger'); },
    get lede() { return $('.home-lede'); },
    get setupBox() { return $('.home-setup'); },
    get locateBtn() { return $('.home-choice[data-choice="locate"]'); },
    get locateError() { return $('.home-locate-error'); },
    get dropBtn() { return $('.home-choice[data-choice="pin"]'); },
    get confirmBox() { return $('.home-confirm'); },
    get confirmLabel() { return $('.home-confirm-label'); },
    get confirmCoords() { return $('.home-confirm-coords'); },
    get confirmHint() { return $('.home-confirm-hint'); },
  };

  const show = (elm, on) => {
    if (elm) elm.dataset.hidden = String(!on);
  };

  const escHtml = (t) =>
    String(t).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /** Was this a REFUSAL rather than a failure? A timeout or a position-
   *  unavailable error is worth retrying and must not be answered with
   *  permission instructions — that would send someone into Settings to fix a
   *  setting that was never wrong. `locateMe` maps the codes to human text, so
   *  the shape of the message is what is left to test; a `code` is passed
   *  through where the platform gives one. */
  const isDenied = (err) =>
    err?.code === 1 || /denied|permission/i.test(err?.message || '');

  /** The actual tap path, per platform, plus the door that needs no
   *  permission. `standalone` on navigator is iOS Safari's own marker —
   *  capability, never a user-agent parse (§10). */
  function deniedHelpHtml() {
    const ios = 'standalone' in window.navigator;
    const steps = ios
      ? 'On iPhone: open Settings, tap Apps, then Safari, then Location, and ' +
        'set it to Ask or Allow. If you installed Landfall to your home ' +
        'screen, look for Landfall in the Settings app instead.'
      : 'Open the site settings for this page — the icon at the left of the ' +
        'address bar — and set Location to Allow, then try again.';
    return `${escHtml(steps)} <b>Or skip it entirely: drop a pin on the globe.</b>`;
  }

  /** Same to within the tolerance the drag handler already uses. */
  const samePoint = (a, b) =>
    !!a && !!b &&
    Math.abs(a.lon - b.lon) <= 1e-6 && Math.abs(a.lat - b.lat) <= 1e-6;

  /* --- naming a point -------------------------------------------------------
   * The racing, aborting and debouncing all live in data/place-resolver.js.
   * What is left here is the only part that is this view's business: WHERE an
   * answer goes when it lands.
   *
   * ==> IT GOES TO TWO PLACES, ON PURPOSE. <== To the confirm step, if the
   * user is still looking at it; and to the stored home, if they have already
   * committed. Both, neither, or either can be true by the time an answer
   * arrives, so both are attempted and both are guarded on the point still
   * matching. `updateHomePlace` refuses to write onto a home at different
   * coordinates, which is what makes committing before the name arrives safe
   * rather than lucky.
   * ---------------------------------------------------------------------- */

  const namer = createPlaceResolver({
    probeWater,
    onResolved: (at, resolved) => {
      if (pending && samePoint(pending, at)) {
        pending.label = resolved.label;
        pending.place = resolved.place;
        pending.resolving = false;
        renderConfirm();
      }
      updateHomePlace({ lon: at.lon, lat: at.lat, ...resolved });
      renderCurrent();
    },
  });

  /** Mark the pending candidate as mid-lookup so the confirm step can say so,
   *  then ask. `now` for a point the user just chose, debounced for a pin they
   *  are still dragging. */
  function nameIt(at, { now = false } = {}) {
    if (pending && samePoint(pending, at)) {
      pending.resolving = true;
      renderConfirm();
    }
    if (now) namer.resolve(at);
    else namer.soon(at);
  }

  /* --- search ---------------------------------------------------------------
   * The whole sub-flow — markup, debounce, three response states, arrow-key
   * navigation and the keyboard dance — lives in ui/home-search.js. All this
   * view does is say what happens when a result is chosen.
   * ---------------------------------------------------------------------- */

  const search = createAddressSearch({ onPick: (r) => pick(r) });

  /* --- pick → preview → confirm --------------------------------------------
   *
   * ==> `pick` LIVED INSIDE wire() ONCE AND THAT WAS A LIVE BUG <==
   *
   * When the event listeners were gathered into `wire()`, `pick` was swallowed
   * into that function's scope along with them. `renderResults()` sits OUTSIDE
   * wire() and calls `pick(r)` from each result button, so every tap on a
   * search result threw `ReferenceError: pick is not defined` — into the
   * console, where nobody using a phone would ever see it. From the outside it
   * looked exactly like the app ignoring the tap: results listed, nothing
   * happened, no way to set a home by address at all.
   *
   * Diagnosed on the live site 2026-07-25. It is declared here, at the view's
   * own scope, alongside everything else that both the searcher callback and
   * the listeners need to reach. Keep it here.
   * ---------------------------------------------------------------------- */

  /** What the confirm step says about the pending point. It reads from the
   *  same formatter the dashboard and the current-home line use, so the place
   *  a user confirms is worded identically to the place they end up with — a
   *  confirm step the next screen contradicts is worse than one that says
   *  nothing at all. */
  function renderConfirm() {
    if (!pending || !el.confirmLabel) return;

    if (pending.resolving) {
      setDottedText(el.confirmLabel, 'Finding this place…');
    } else {
      el.confirmLabel.textContent = placeText(pending);
    }
    el.confirmLabel.title = pending.label || coordText(pending);

    const sub = pending.resolving ? coordText(pending) : placeSubText(pending);
    if (el.confirmCoords) {
      el.confirmCoords.textContent = sub;
      show(el.confirmCoords, Boolean(sub));
    }

    /* THE HINT ANSWERS "is this right?", and what makes it right differs. A
     * low-confidence result needs dragging; open water is a normal answer that
     * some people are choosing on purpose and must not be nagged about. */
    let hint;
    let tone = 'quiet';
    if (pending.lowConfidence) {
      hint = 'This is approximate. Drag the pin on the globe to place it exactly, then set it as home.';
      tone = 'warn';
    } else if (pending.place === PLACE_KIND.water) {
      hint = 'This spot is over water. That’s fine — drag the pin if you meant somewhere else.';
    } else {
      hint = 'Check the pin on the globe. Drag it if it’s not quite right.';
    }
    el.confirmHint.textContent = hint;
    el.confirmHint.dataset.tone = tone;
  }

  /**
   * @param {object} result   {lon, lat, label, lowConfidence, source}
   * @param {object} [opts]
   * @param {boolean} [opts.keepZoom]  Leave the camera's zoom alone. A dropped
   *        pin sits at the middle of the view the user framed, so pulling the
   *        camera to a fixed "confirm zoom" would move the ground out from
   *        under the thing they just placed. A geocode result is somewhere
   *        else entirely and does want the zoom.
   */
  function pick(result, { keepZoom = false } = {}) {
    namer.cancel();

    pending = {
      ...result,
      source: result.source || 'address',
      /* A forward search already handed back a name it is confident in, so
       * there is nothing to look up and nothing to pay for. Every other path
       * arrives nameless. */
      place: result.label ? PLACE_KIND.named : null,
      resolving: false,
    };

    onPreview?.(
      { lon: result.lon, lat: result.lat },
      {
        ...(keepZoom ? {} : { zoom: GEOCODE.confirmZoom }),
        /* THE LABEL FOLLOWS THE PIN. Once it has been dragged this is no
         * longer the address that was searched for, and commit() already
         * refuses to store the old label in that case — so the confirm step
         * must stop showing it too, or the user reads a street name, taps
         * "Set as home", and gets a home with no label at all.
         *
         * DRAGGING IS ALSO WHAT MAKES A SEARCHED ADDRESS NEED A LOOKUP: the
         * pin is now somewhere the geocoder never named, so the name has to be
         * asked for again from the new point. */
        onMove: (p) => {
          if (!pending) return;
          const moved =
            Math.abs(p.lon - pending.lon) > 1e-6 ||
            Math.abs(p.lat - pending.lat) > 1e-6;
          if (!moved) return;

          pending.lon = p.lon;
          pending.lat = p.lat;
          pending.label = null;
          pending.place = null;
          pending.lowConfidence = true;
          pending.source = 'pin';
          renderConfirm();
          nameIt({ lon: p.lon, lat: p.lat });
        },
      }
    );

    /* Collapse the search box on the way into confirm. Leaving a keyboard up
     * over the two buttons the user now has to reach is the same bug this
     * whole rebuild is about, arriving one screen later. */
    if (search.isOpen()) search.close();

    renderConfirm();
    show(el.setupBox, false);
    show(el.dangerBox, false);
    show(el.confirmBox, true);
    $('.home-confirm-yes')?.focus();

    if (!pending.label) nameIt({ lon: result.lon, lat: result.lat }, { now: true });
  }

  /**
   * Drop a pin at the middle of the current view and go straight to confirm.
   *
   * NO ZOOM CHANGE, deliberately. The user framed this view; the pin belongs
   * where they are looking, and yanking the camera to a "confirm zoom" would
   * move the ground out from under the pin they just asked for. It is marked
   * `lowConfidence` because a view centre is a guess by definition — which is
   * what makes the confirm copy tell them to drag it.
   */
  function dropPin() {
    const c = getViewCenter?.();
    if (!c || !Number.isFinite(c.lon) || !Number.isFinite(c.lat)) return;
    pick(
      {
        lon: c.lon,
        lat: c.lat,
        /* NO LABEL to start with. A dropped pin is not an address and
         * inventing one ("Dropped pin") would put a made-up name where the app
         * elsewhere prints a real place. The reverse lookup kicked off by
         * pick() is what fills this in with something true. */
        label: null,
        lowConfidence: true,
        source: 'pin',
      },
      { keepZoom: true }
    );
  }

  /* Listeners bind at MOUNT, not at construction — the elements do not exist
   * until the drawer hands this view its host. */
  function wire() {
  search.mount(host);

  /* --- drop a pin --------------------------------------------------------- */

  el.dropBtn.addEventListener('click', dropPin);

  /* --- geolocation -------------------------------------------------------- */

  el.locateBtn.addEventListener('click', async () => {
    show(el.locateError, false);
    el.locateBtn.disabled = true;
    el.locateBtn.dataset.loading = 'true';
    try {
      const pos = await locateMe();
      pick({
        lon: pos.lon,
        lat: pos.lat,
        /* ==> NO LONGER LABELLED "My location". <== That was a description of
         * how the point was obtained, printed where a place name belongs, and
         * it stayed on the dashboard forever afterwards saying nothing about
         * where home actually is. Nameless, so pick() looks it up like every
         * other pin and the user ends up with the name of their town. */
        label: null,
        /* A GPS fix is still confirmed. Phones report accuracy in the tens of
         * metres outdoors and the hundreds indoors, and the user is the only
         * one who knows which they just got. */
        lowConfidence: pos.accuracyM > 100,
        source: 'geolocation',
      });
    } catch (err) {
      /* The message is already human — locateMe() maps the raw
       * GeolocationPositionError codes so no raw error text reaches here.
       *
       * A DENIAL IS NOT A DEAD END, and it was being presented as one.
       * "Location permission was denied" is true and completely unactionable:
       * the user cannot re-grant it from this page, because once Safari or
       * Chrome has recorded a denial for an origin the browser stops even
       * asking. So the message is followed by the actual tap path.
       *
       * WE CANNOT OPEN iOS SETTINGS FOR THEM. There is no URL scheme a web
       * page is allowed to use for that — `App-Prefs:` was closed to web
       * content years ago, and anything claiming otherwise is describing a
       * native app. Directions are the whole of what is possible, so the
       * directions had better be right.
       *
       * And the last line is the real answer: the drop-a-pin door needs no
       * permission at all, and it is one row below this message. */
      el.locateError.innerHTML =
        `<span>${escHtml(err.message)}</span>` +
        (isDenied(err) ? `<span class="home-locate-help">${deniedHelpHtml()}</span>` : '');
      show(el.locateError, true);
    } finally {
      el.locateBtn.disabled = false;
      delete el.locateBtn.dataset.loading;
    }
  });

  $('.home-confirm-yes').addEventListener('click', () => {
    if (!pending) return;
    /* Read the pin's CURRENT position, not the geocoded one — the user may
     * have dragged it, and the drag is the whole point of the confirm step. */
    const p = getProvisional?.() || { lon: pending.lon, lat: pending.lat };
    const dragged =
      Math.abs(p.lon - pending.lon) > 1e-6 || Math.abs(p.lat - pending.lat) > 1e-6;

    const home = setHome({
      lon: p.lon,
      lat: p.lat,
      /* A dragged pin is no longer the place that was named. Keeping the old
       * label would tell the user their home is somewhere it isn't. */
      label: dragged ? null : pending.label,
      place: dragged ? null : pending.place,
      source: dragged ? 'pin' : pending.source,
    });

    /* COMMITTED WITHOUT WAITING FOR A NAME, and that is deliberate — see
     * `updateHomePlace` in data/home.js. A lookup already in flight for this
     * exact point will patch the name in when it lands; if the pin moved under
     * us in the last instant, a fresh one starts here. */
    const committed = { lon: p.lon, lat: p.lat };
    pending = null;
    if (dragged) nameIt(committed, { now: true });

    onCancelPreview?.();
    onCommit?.(home);
    renderCurrent();
    /* Home is set — the job this view exists for is done, so leave. Closing
     * the drawer rather than sitting on a completed form is the difference
     * between a setup flow and a screen you have to dismiss yourself. */
    onDone?.();
  });

  $('.home-confirm-no').addEventListener('click', () => {
    namer.cancel();
    pending = null;
    onCancelPreview?.();
    show(el.confirmBox, false);
    show(el.setupBox, true);
    renderCurrent();
    el.locateBtn.focus();
  });

  /* --- remove home -------------------------------------------------------- */

  $('.home-clear').addEventListener('click', () => {
    clearHome();
    backfilled = false;
    renderCurrent();
    /* Focus lands on the first way to set a new one, because the control that
     * was just used no longer exists — leaving focus on a removed button drops
     * a keyboard user back at the top of the document. */
    el.locateBtn.focus();
  });
  }

  function renderCurrent() {
    if (!host) return;
    const h = getHome();

    if (h) {
      const text = placeText(h);
      const sub = placeSubText(h);
      el.nowPlace.textContent = text;
      el.nowPlace.title = text;
      el.nowCoords.textContent = sub;
      show(el.nowCoords, Boolean(sub));
      show(el.nowBox, true);
      show(el.dangerBox, !pending);
      el.lede.textContent = 'Move it somewhere else:';

      /* ==> BACKFILL AN OLDER HOME, ONCE. <== Homes set before this existed
       * carry no `place` and, if they came from a pin, no label either — so
       * they print coordinates forever with no way to improve. This is the one
       * screen where fixing that costs the user nothing and is obviously
       * relevant, so it happens here rather than on the dashboard, where an
       * unbidden billed lookup would run every time somebody checked a
       * storm. */
      if (!backfilled && !h.place && !h.label) {
        backfilled = true;
        nameIt({ lon: h.lon, lat: h.lat }, { now: true });
      }
    } else {
      show(el.nowBox, false);
      show(el.nowCoords, false);
      show(el.dangerBox, false);
      el.lede.textContent =
        'Landfall measures everything from one point. Pick whichever way is easiest:';
    }
  }

  /* --- the drawer view contract -------------------------------------------- */

  return {
    id: 'home-setup',
    /* "Edit home" and not "Home". The drawer's back button names the view it
     * returns TO, so a view titled "Home" here would give the dashboard a
     * back button reading "Back to Home" while standing on Home. */
    title: 'Edit home',

    mount(hostEl) {
      buildSkeleton(hostEl);
      renderCurrent();
    },

    onEnter() {
      visible = true;
      search.close();
      show(el.confirmBox, false);
      show(el.setupBox, true);
      renderCurrent();
    },

    onLeave() {
      visible = false;
      /* Leaving with an unconfirmed pin on screen would be a lie — it looks
       * like a home that was never set. Clear it. */
      namer.cancel();
      if (pending) {
        pending = null;
        onCancelPreview?.();
      }
      search.reset(); // cancel anything in flight
    },

    /** ==> THE ONE-LINE FIX FOR THE KEYBOARD OPENING BY ITSELF. <== This used
     *  to nominate the search input, so the drawer focused it on arrival and a
     *  phone threw a keyboard over the rest of the panel before anything had
     *  been read. It now nominates the first CHOICE: a keyboard user still
     *  lands on the actions rather than on the back button, and nothing opens
     *  until it is asked to. */
    focus() {
      return el.locateBtn;
    },

    refresh: renderCurrent,
    isVisible: () => visible,
    destroy: () => {
      namer.cancel();
      search.destroy();
      for (const off of unwire.splice(0)) off();
    },
  };
}
