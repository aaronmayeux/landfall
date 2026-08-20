/**
 * view-settings.js — the Settings view (SPEC §16).
 *
 * Seven blocks, in this order and the order is deliberate: install, theme,
 * units, mesh height, globe drift, satellite imagery, about. **Globe-shape controls
 * come before globe-motion ones** — mesh height changes what the planet IS, and
 * drift changes what it is doing, so the one that alters the picture sits
 * above the one that animates it. `build()` is the only place that order
 * exists; every block is self-contained and wired by element id, so moving a
 * line there cannot change behaviour.
 *
 * The controls themselves: two segmented (theme, mesh height), one switch plus
 * four sliders (drift speed and delay, imagery radius and fade), and two blocks
 * that are prose plus a button (install, about).
 *
 * THE SEGMENTED CONTROL IS THE LAYERS PANEL'S, REUSED VERBATIM (`.seg-group` /
 * `.seg`, role=radiogroup/radio), and so is `.layer-reset`. Not restyled, not
 * reimplemented — they already carry the focus ring, the 44px target, the hover
 * rules behind `@media (hover: hover)`, and the ARIA the keyboard pass depends
 * on. A second copy here would be two things to keep in step, and one of them
 * would drift (§12).
 *
 * ==> WHY THIS VIEW NO LONGER REBUILDS ITSELF ON EVERY CHANGE <==
 *
 * It used to re-run `innerHTML` from the store on every settings event, which
 * is fine for buttons and FATAL for a slider: replacing the DOM mid-drag
 * destroys the element the finger is holding, so the drag dies on the first
 * value it produces. The markup is now built ONCE and `sync()` updates values,
 * labels and ARIA in place. Same single source of truth, same "the store
 * decides and the view follows" contract — it just stopped throwing the
 * furniture out to move a chair.
 *
 * `sync()` also never writes back to the control the user is currently holding.
 * The value would be identical (the input's `step` matches the store's), but
 * assigning `.value` mid-gesture is how sliders get sticky on iOS.
 *
 * ==> THE SLIDERS REQUIRE A THUMB GRAB. <==
 *
 * A press on the bare track does nothing. This view is a tall scroller and a
 * range input commits a value on the press itself, so scrolling past a slider
 * was changing it. `ui/slider-grab.js` owns that rule and this view just arms
 * it on its host; the guard is delegated, so it covers all four sliders and
 * any added later. Keyboard operation is untouched.
 *
 * NO `unmount`. The drawer's contract is
 * `{ id, title, mount(host), onEnter?, onLeave?, focus? }` and it mounts a
 * view ONCE, lazily, then keeps it for the life of the app (ui/drawer.js).
 * There is no teardown to hook, so the settings subscription below is held
 * deliberately for the session rather than released in a method that would
 * never be called — dead code that LOOKS like cleanup is worse than none.
 *
 * Imports: data/settings-prefs.js only. No map, no THREE — this view sets a
 * preference and the map subscribes to it (main.js).
 */

import {
  MESH_HEIGHT,
  resetSetting,
  settingDefault,
  settingValue,
  settingOptions,
  settingRange,
  setSetting,
  subscribeSettings,
} from '../data/settings-prefs.js';
import { UNITS } from '../config/constants.js';
import { THEME } from '../config/theme.js';
import { formatDistance, systemFromLocale } from '../lib/units.js';
import { requireThumbGrab } from './slider-grab.js';
/* One source for the wording — see ui/disclaimer.js's header on why this text
 * is imported and never retyped at a call site (§17 A1). */
import { DISCLAIMER } from './disclaimer.js';

/** Label per mesh-height value. */
const MESH_LABEL = Object.freeze({
  [MESH_HEIGHT.CURRENT]: 'Current',
  [MESH_HEIGHT.TRACK]: 'Full track',
});

/**
 * One sentence per value, describing what the globe will actually do.
 *
 * THESE ARE NOT DECORATION. "Full track" does not tell you the ridge covers
 * the FORECAST as well as the past, and someone assuming it meant history
 * alone would read a forecast peak as a measured one — the §5 failure this
 * whole feature had to design around. The cage speaks only height and color;
 * the words carry what those two cannot.
 */
const MESH_NOTE = Object.freeze({
  [MESH_HEIGHT.CURRENT]:
    'The globe rises in one peak over each storm’s current position. Height ' +
    'is the wind speed at this moment, so the tallest storm on the globe is ' +
    'the strongest.',
  [MESH_HEIGHT.TRACK]:
    'The globe rises along each storm’s whole path — every position it has ' +
    'been given, back to the first, and the full five-day forecast ahead. ' +
    'Height is wind speed, so the tallest point is the storm at its ' +
    'strongest, whether that has happened yet or not. The spiral always ' +
    'marks where it is now.',
});

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );

/**
 * Slider distances IN THE USER'S UNITS.
 *
 * This was hardcoded `km` — on an American phone the whole app read in miles
 * and these two readouts alone read in kilometres, which is the one place a
 * unit label is guaranteed to be misread because nothing beside it disagrees.
 *
 * The VALUES stay metric: `imageryRadiusKm` is a real kilometre figure the
 * imagery request is built from, and converting the stored number would be the
 * rounding drift lib/units.js exists to prevent. Converted at render only,
 * like every other measurement in the app.
 *
 * NM is the app's storage unit for distance, so km goes through it rather than
 * calling a second conversion path into existence.
 */
const KM_PER_NM = 1.852;
const distanceKm = (km, system) => formatDistance(km / KM_PER_NM, system);

/**
 * @param {object} opts
 * @param {() => string|null} opts.resolvedUnits  what AUTO currently resolves
 *        to, used to format the slider readouts in the user's own units
 * @param {object} opts.install  the pwa.js seam, injected by main.js so this
 *        view never imports the PWA module directly:
 *        { isInstalled, canPromptInstall, needsManualInstall,
 *          onInstallReady, requestInstall }
 */
export function createSettingsView({ resolvedUnits, install } = {}) {
  let host = null;
  let built = false;

  /* --- markup, built once ---------------------------------------------------- */

  function meshGroup() {
    /* Options come from the STORE, not a list typed here. A control offering
     * a value `setSetting` would reject is a dead button, and the two lists
     * drifting apart is exactly how that happens. */
    const segs = settingOptions('meshHeight')
      .map(
        (v) => `
          <button class="seg" type="button" role="radio"
                  aria-checked="false"
                  data-mesh="${esc(v)}">
            ${esc(MESH_LABEL[v] || v)}
          </button>`
      )
      .join('');

    return `
      <div class="settings-block">
        <p class="settings-label" id="lbl-mesh">Mesh height</p>
        <div class="seg-group" role="radiogroup" aria-labelledby="lbl-mesh">
          ${segs}
        </div>
        <p class="settings-note settings-soft" id="note-mesh"></p>
      </div>`;
  }

  /**
   * One slider row. Bounds come from the store, never typed here — same rule
   * the segmented control follows, for the same reason.
   *
   * The readout lives in the LABEL, not beside the thumb, so it is announced
   * with the control and does not move while the thumb does.
   *
   * NO EXPLANATORY LINE. Each of these carried a sentence describing what the
   * setting did, and all four came out on 2026-07-25. A slider with a name, a
   * live figure in real units, and a globe visibly responding underneath it is
   * already explaining itself better than prose can — the prose was
   * restating the label at four times the height. The MESH note stays, because
   * that control's two options differ in a way the words carry and the picture
   * does not (a forecast peak looks identical to a measured one).
   */
  function sliderRow(key, id, label) {
    const r = settingRange(key);
    if (!r) return '';
    return `
      <div class="slider-row">
        <label class="slider-label" for="${id}">
          <span>${esc(label)}</span>
          <span class="slider-value" id="${id}-val"></span>
        </label>
        <input class="slider" type="range" id="${id}" data-setting="${esc(key)}"
               min="${r.min}" max="${r.max}" step="${r.step}">
      </div>`;
  }

  /** The units control. AUTOMATIC IS LAST, matching Theme below: both groups
   *  put the explicit choices first and "follow my device" at the end, so the
   *  rightmost button means the same thing in both. Ordering, not default —
   *  `units` still falls back to AUTO (data/settings-prefs.js), the same way
   *  `theme` falls back to DARK while sitting first. */
  function unitsBlock() {
    const segs = [
      [UNITS.IMPERIAL, 'Miles / mph'],
      [UNITS.METRIC, 'km / km/h'],
      [UNITS.AUTO, 'Automatic'],
    ]
      .map(
        ([v, label]) => `
          <button class="seg" type="button" role="radio" aria-checked="false"
                  data-units="${esc(v)}">${esc(label)}</button>`
      )
      .join('');
    return `
      <div class="settings-block">
        <p class="settings-label" id="lbl-units">Units</p>
        <div class="seg-group" role="radiogroup" aria-labelledby="lbl-units">
          ${segs}
        </div>
      </div>`;
  }

  /**
   * Theme.
   *
   * DARK IS FIRST AND IS THE DEFAULT, which is not the usual ordering — most
   * apps lead with "system". Landfall is a night-sky globe (SPEC §9): dark is
   * what the app looks like, not a mode of it, and someone opening a shared
   * link during a storm should land on that. "Match my device" is a real
   * choice, just not the leading one.
   *
   * Same segmented-control shape as Units, and deliberately so — a second
   * pattern for the same job is the thing §12 says to extract, not invent.
   */
  function themeBlock() {
    const segs = [
      [THEME.DARK, 'Dark'],
      [THEME.LIGHT, 'Light'],
      [THEME.AUTO, 'Automatic'],
    ]
      .map(
        ([v, label]) => `
          <button class="seg" type="button" role="radio" aria-checked="false"
                  data-theme-pref="${esc(v)}">${esc(label)}</button>`
      )
      .join('');
    return `
      <div class="settings-block">
        <p class="settings-label" id="lbl-theme">Theme</p>
        <div class="seg-group" role="radiogroup" aria-labelledby="lbl-theme">
          ${segs}
        </div>
      </div>`;
  }

  /**
   * Idle rotation: a toggle plus two sliders that only mean anything when it
   * is on.
   *
   * THEY DISAPPEAR WHEN IT IS OFF, and that is a deliberate exception to §7's
   * "rows dim, they never disappear" — which is a rule about LAYER rows, where
   * a missing toggle is indistinguishable from a missing feature and the user
   * has no way to know what they are not being shown. Nothing is hidden here:
   * the switch that brings them back is the line directly above the gap, it is
   * plainly off, and turning it on is the whole of the recovery. Dimming
   * instead leaves two dead controls occupying a third of the block for a
   * setting the user just switched off on purpose.
   */
  function rotateBlock() {
    return `
      <div class="settings-block">
        <p class="settings-label">Globe drift</p>
        <button class="layer-row layer-row-toggle switch-row" type="button"
                role="switch" aria-checked="false" id="set-autorotate">
          <span class="layer-row-text">
            <span class="layer-row-label">Rotate when idle</span>
          </span>
          <span class="switch-track" aria-hidden="true"></span>
        </button>
        <div id="set-rotate-detail">
          ${sliderRow('autoRotateSpeed', 'set-rot-speed', 'Speed')}
          ${sliderRow('autoRotateDelaySec', 'set-rot-delay', 'Starts after')}
        </div>
      </div>`;
  }

  function imageryBlock() {
    return `
      <div class="settings-block">
        <!-- ==> "SATELLITE", NOT "STORM". <== Both sliders below feed
             map/imagery.js, which draws the satellite disc and nothing else.
             Radar has been its own file since Wave 6 (map/radar-layer.js) and
             reads neither value — it is a tile pyramid with no disc, no radius
             and no edge to fade. The old heading promised control over a layer
             these sliders cannot touch. -->
        <p class="settings-label">Satellite imagery</p>
        ${sliderRow('imageryRadiusKm', 'set-radius', 'Cloud radius')}
        ${sliderRow('imageryFade', 'set-fade', 'Edge fade')}
        <div class="layer-reset-wrap">
          <button class="layer-reset" type="button" id="set-imagery-reset">
            Reset satellite imagery to defaults
          </button>
        </div>
      </div>`;
  }

  /* --- install (§14 Phase 5) -------------------------------------------------
   *
   * The first-run nudge is a ONE-TIME chip that never comes back — by design,
   * because a hurricane app that nags is the wrong brand (ui/first-run.js).
   * That leaves anyone who dismissed it with no way to install at all.
   * Settings is where you go looking for exactly that, so the seam gets a
   * permanent door here as well. Same pwa.js functions — one seam, two
   * surfaces, no second install path to drift.
   *
   * ==> IT USED TO SAY "THIS BROWSER CAN'T INSTALL WEB APPS" AND THAT WAS A LIE.
   *
   * The first version had four states and derived the last one by elimination:
   * no captured Chromium prompt, no iOS marker, therefore no capability. On
   * Chrome for macOS — which installs PWAs perfectly well — `beforeinstallprompt`
   * simply had not fired, and the row confidently announced the browser could
   * not do the thing the browser can do. Aaron hit it on his own machine.
   *
   * THE RULE THIS EARNS, and it is the §5 rule in a new costume: **absence of a
   * signal is not evidence of absence of a capability.** `beforeinstallprompt`
   * is a notification that Chrome is WILLING to show a dialog right now. It
   * does not fire when the app is already installed, it does not fire on every
   * load, and there is no API anywhere that answers "could this browser
   * install me". Reading "no event yet" as "cannot install" is the same shape
   * of error as reading a dead feed as an all-clear.
   *
   * So the row never claims incapability. Three honest states:
   *
   *   INSTALLED  we can actually detect this (display-mode / navigator.standalone).
   *              The whole block is removed — nothing to offer.
   *   READY      a prompt is captured. A real button that opens the real dialog.
   *   MANUAL     everything else. Not "you can't" — HERE IS HOW, with the tap
   *              path for whichever platform we can detect. If the prompt
   *              lands later the subscription upgrades the row in place.
   * ------------------------------------------------------------------------- */

  const INSTALL_STATE = Object.freeze({
    INSTALLED: 'installed',
    READY: 'ready',
    MANUAL: 'manual',
  });

  function installState() {
    if (!install || install.isInstalled()) return INSTALL_STATE.INSTALLED;
    if (install.canPromptInstall()) return INSTALL_STATE.READY;
    return INSTALL_STATE.MANUAL;
  }

  /**
   * Which set of directions to show when there is no prompt to replay.
   *
   * CAPABILITY AND SHAPE, NEVER A USER-AGENT PARSE (§10). `standalone` on
   * navigator exists only in iOS Safari and is the platform's own marker.
   * Touch-plus-no-standalone is Android-shaped. Everything else is treated as
   * a desktop browser, which is the safe guess: the desktop instructions point
   * at a menu, and pointing someone at a menu they do not have costs them one
   * confused look, while telling them they cannot install costs them the
   * feature.
   */
  function manualPlatform() {
    if ('standalone' in window.navigator) return 'ios';
    if (navigator.maxTouchPoints > 0) return 'android';
    return 'desktop';
  }

  /**
   * The three-dot menu glyph, drawn inline so a step can POINT AT THE BUTTON
   * rather than describe it. On iOS the control genuinely has no name printed
   * anywhere — "the three dot menu" is a description of a picture, and showing
   * the picture is shorter and less ambiguous than any sentence about it.
   *
   * Filled dots rather than the app's usual 1.7 stroke: at this size a stroked
   * ring reads as a smudge, and this has to be recognisable inline in a line
   * of text.
   */
  const MENU_GLYPH =
    '<svg class="install-glyph" viewBox="0 0 24 24" aria-hidden="true">' +
    '<circle cx="5.5" cy="12" r="1.9" fill="currentColor"/>' +
    '<circle cx="12" cy="12" r="1.9" fill="currentColor"/>' +
    '<circle cx="18.5" cy="12" r="1.9" fill="currentColor"/></svg>';

  /** Real numbered steps, because "add it to your home screen" is not
   *  instructions — the iOS path in particular is genuinely hard to find, and
   *  the Share button is not where anyone looks first.
   *
   *  `{MENU}` is substituted AFTER escaping, so the step text stays ordinary
   *  data that cannot inject markup while still carrying one trusted glyph. */
  const MANUAL_STEPS = Object.freeze({
    ios: [
      'Open {MENU} and tap Share.',
      'Scroll down the list of actions.',
      'Tap “Add to Home Screen”, then Add.',
    ],
    android: [
      'Tap the ⋮ menu at the top right of the browser.',
      'Tap “Add to Home screen” or “Install app”.',
      'Confirm.',
    ],
    desktop: [
      'Look for the install icon at the right-hand end of the address bar — a screen with a downward arrow.',
      'If it is not there, open the ⋮ menu, then Cast, Save and Share, then “Install page as app”.',
      'Confirm. Landfall opens in its own window from then on.',
    ],
  });

  const MANUAL_LEAD = Object.freeze({
    ios: 'Safari does not let a website install itself, so this is by hand:',
    android: 'Your browser has not offered the install dialog. By hand:',
    desktop: 'Your browser has not offered the install dialog. By hand:',
  });

  function installBlock() {
    return `<div class="settings-block install-block" id="set-install-block"></div>`;
  }

  /* --- about / disclaimer (SPEC §17 A1) --------------------------------------
   *
   * THE PERMANENT SURFACE. The first-run strip (ui/disclaimer.js) is shown
   * once and acknowledged; this is where it lives forever afterwards, so a
   * user who wants to check what they are looking at can find it.
   *
   * ==> DELIBERATE DEVIATION FROM §17 A1, WHICH SAID THE CREDITS PANEL. <==
   * The credits pill (map/attribution.js) is a single-line element that
   * ANIMATES ITS WIDTH from a measurement of its own label. A wrapped
   * multi-line paragraph inside it breaks that measurement, and that file's
   * header records six attempts spent getting its open/close behaviour to
   * hold. Rebuilding it into a panel to host four lines of text is a large
   * change to hard-won code for a placement nobody asked for.
   *
   * Settings is the better surface anyway: it is where people already look
   * for "what is this", it is where the install door already lives, and it
   * is reachable by tap, click and keyboard like every other row (§10).
   * The credits pill keeps doing its one job — licensing.
   *
   * Last in the drawer body, deliberately. It is reference, not a control,
   * and putting it above the settings would make the panel open on a
   * paragraph of text.
   */
  function aboutBlock() {
    return `
      <div class="settings-block about-block">
        <p class="settings-label">About Landfall</p>
        <p class="settings-note about-disclaimer">${DISCLAIMER.full}</p>
        <p class="settings-note">
          <a class="about-link" href="${DISCLAIMER.officialUrl}"
             target="_blank" rel="noopener noreferrer">${DISCLAIMER.officialLabel}</a>
        </p>
        <p class="settings-note settings-soft">
          Your home location is stored on this device only. It is never sent
          anywhere. Landfall does record anonymous usage and speed
          information, tagged with a random number for this browser so repeat
          visits can be counted. There is no account and no name attached.
          Clearing this site's data erases the number.
        </p>
      </div>`;
  }

  /** Paint the install block from the CURRENT capability. Called by sync(), and
   *  again from the install-ready subscription — Chromium can fire that event
   *  long after this view was built. */
  function syncInstall() {
    const box = host?.querySelector('#set-install-block');
    if (!box) return;

    const state = installState();

    /* GONE ONCE INSTALLED. Every other row in this app dims rather than
     * disappears, and this is the one honest exception: a dimmed "Installed"
     * button is a permanent piece of furniture offering an action that can
     * never be taken again, on the one screen the user opened to change
     * something. There is nothing to recover and nothing to explain. */
    if (state === INSTALL_STATE.INSTALLED) {
      box.hidden = true;
      box.innerHTML = '';
      return;
    }
    box.hidden = false;

    if (state === INSTALL_STATE.READY) {
      box.innerHTML = `
        <button class="install-cta" type="button" id="set-install">
          Install Landfall
        </button>
        <p class="settings-note settings-soft">
          Adds Landfall to your home screen and runs it full screen, without the
          browser bar. It keeps working on a bad connection.
        </p>`;
      return;
    }

    const platform = manualPlatform();
    const steps = MANUAL_STEPS[platform]
      /* Escape FIRST, then substitute the glyph. The other order would let any
       * future step text smuggle markup through the placeholder. */
      .map((t) => `<li>${esc(t).replace('{MENU}', MENU_GLYPH)}</li>`)
      .join('');
    box.innerHTML = `
      <p class="install-heading">Install Landfall</p>
      <p class="settings-note settings-soft">${esc(MANUAL_LEAD[platform])}</p>
      <ol class="install-steps">${steps}</ol>
      <p class="settings-note settings-soft">
        Once installed it runs full screen without the browser bar, and keeps
        working on a bad connection.
      </p>`;
  }

  function build() {
    if (!host || built) return;

    host.innerHTML = `
      <div class="drawer-body">
        ${installBlock()}
        ${themeBlock()}
        ${unitsBlock()}
        ${meshGroup()}
        ${rotateBlock()}
        ${imageryBlock()}
        ${aboutBlock()}
      </div>`;

    built = true;
    /* BEFORE wire(). The guard listens in the capture phase and wire()'s
     * `input` handler listens in the bubble phase on this same element, so
     * the guard is guaranteed to run first regardless of order — but reading
     * "refuse the bad ones, then handle the good ones" top to bottom is worth
     * the one line of ordering. */
    requireThumbGrab(host);
    wire();
  }

  /* --- state -> DOM, in place ------------------------------------------------ */

  function sync() {
    if (!host || !built) return;

    const mesh = settingValue('meshHeight');
    for (const btn of host.querySelectorAll('[data-mesh]')) {
      btn.setAttribute('aria-checked', String(btn.dataset.mesh === mesh));
    }
    const note = host.querySelector('#note-mesh');
    if (note) note.textContent = MESH_NOTE[mesh] || '';

    const themePref = settingValue('theme');
    for (const btn of host.querySelectorAll('[data-theme-pref]')) {
      btn.setAttribute('aria-checked', String(btn.dataset.themePref === themePref));
    }

    /* UNITS BEFORE THE SLIDERS — the two slider readouts below are formatted
     * in whatever this resolves to, so reading it after them would paint one
     * frame in the old system every time the user changes it. */
    const unitPref = settingValue('units');
    const system = unitPref === UNITS.AUTO ? resolvedUnits?.() || systemFromLocale() : unitPref;
    for (const btn of host.querySelectorAll('[data-units]')) {
      btn.setAttribute('aria-checked', String(btn.dataset.units === unitPref));
    }

    /* --- globe drift --- */
    const rotOn = settingValue('autoRotate');
    const rotBtn = host.querySelector('#set-autorotate');
    if (rotBtn) rotBtn.setAttribute('aria-checked', String(rotOn));
    const rotDetail = host.querySelector('#set-rotate-detail');
    /* `hidden` is what takes them out of the tab order AND the accessibility
     * tree. The inputs are ALSO disabled: `hidden` is one attribute away from
     * being overridden by a stray `display` rule, and a focusable control you
     * cannot see is the keyboard trap this project keeps re-learning (§13).
     * Belt and braces on the cheap side of a bug that is expensive to notice. */
    if (rotDetail) {
      rotDetail.hidden = !rotOn;
      for (const el of rotDetail.querySelectorAll('input')) el.disabled = !rotOn;
    }
    const speed = settingValue('autoRotateSpeed');
    const delay = settingValue('autoRotateDelaySec');
    setSlider('set-rot-speed', speed, `${speed.toFixed(1)}°/s`);
    setSlider('set-rot-delay', delay, `${Math.round(delay)} s`);

    const radius = settingValue('imageryRadiusKm');
    const fade = settingValue('imageryFade');

    /* The fade is stored as a FRACTION of the radius but shown in kilometres,
     * because "0.42" is not a thing anyone can picture and "378 km" is. It
     * therefore changes when the radius does, which is true and worth seeing. */
    setSlider('set-radius', radius, distanceKm(radius, system));
    setSlider('set-fade', fade, distanceKm(radius * fade, system));

    const reset = host.querySelector('#set-imagery-reset');
    if (reset) reset.disabled = imageryIsDefault();

    syncInstall();
  }

  function setSlider(id, value, text) {
    const el = host.querySelector(`#${id}`);
    if (el && el !== document.activeElement) el.value = String(value);
    if (el) {
      /* The visible readout is the accessible one too. Without this a screen
       * reader announces the raw fraction for the fade slider, which is the
       * one number the sighted UI deliberately never shows. */
      el.setAttribute('aria-valuetext', text);
    }
    const out = host.querySelector(`#${id}-val`);
    if (out) out.textContent = text;
  }

  /** True when both imagery sliders sit at their shipped defaults, so the
   *  Reset button can be honestly disabled rather than being a button that
   *  does nothing (§5, same rule as the Layers reset). The defaults are ASKED
   *  FOR, never typed here — a second copy is a second thing to keep in step. */
  const IMAGERY_KEYS = ['imageryRadiusKm', 'imageryFade'];
  function imageryIsDefault() {
    return IMAGERY_KEYS.every((k) => settingValue(k) === settingDefault(k));
  }

  /* --- events ---------------------------------------------------------------- */

  function wire() {
    /* ONE delegated listener per event type on the host. The markup is built
     * once now, so per-element handlers would be safe — but delegation keeps
     * the wiring in one readable place and survives any future rebuild. */
    host.addEventListener('click', (e) => {
      const themeBtn = e.target.closest?.('[data-theme-pref]');
      if (themeBtn && host.contains(themeBtn)) {
        setSetting('theme', themeBtn.dataset.themePref);
        return;
      }
      const units = e.target.closest?.('[data-units]');
      if (units && host.contains(units)) {
        setSetting('units', units.dataset.units);
        return;
      }
      if (e.target.closest?.('#set-autorotate')) {
        setSetting('autoRotate', settingValue('autoRotate') !== true);
        return;
      }
      const btn = e.target.closest?.('[data-mesh]');
      if (btn && host.contains(btn)) {
        /* The store decides what is legal; this only asks. A rejected value
         * changes nothing and `sync()` puts the control back to the value
         * actually in effect, so the UI can never show a state the app is not
         * in. */
        setSetting('meshHeight', btn.dataset.mesh);
        return;
      }
      if (e.target.closest?.('#set-imagery-reset')) {
        for (const k of IMAGERY_KEYS) resetSetting(k);
        return;
      }
      if (e.target.closest?.('#set-install')) {
        /* The captured prompt is SINGLE-USE and is spent whether the user
         * accepts or declines. Re-syncing afterwards either removes the block
         * (accepted → installed) or falls back to the manual steps, which are
         * now the honest answer rather than a dead button. */
        install?.requestInstall?.().then(syncInstall, syncInstall);
      }
    });

    /* `input`, not `change`: the readout has to track the thumb, and on a
     * phone `change` does not fire until the finger lifts. The COST of each
     * event is handled downstream — main.js debounces the repaint, and a fade
     * change never touches the network at all. */
    host.addEventListener('input', (e) => {
      const el = e.target.closest?.('input[data-setting]');
      if (!el || !host.contains(el)) return;
      setSetting(el.dataset.setting, Number(el.value));
    });
  }

  return {
    id: 'settings',
    title: 'Settings',

    mount(el) {
      host = el;
      build();
      /* Re-sync on every settings change, not only our own input: the store is
       * the single source of truth and something else may set it. Fires
       * immediately at registration, which is what paints the current values
       * into the controls built above. */
      subscribeSettings(sync);
      /* Chromium's `beforeinstallprompt` can land minutes after boot, and this
       * view may already be built and sitting on the "can't install" copy when
       * it does. Same fire-on-subscribe contract as every other subscription
       * in the app, so this also paints the initial state. */
      install?.onInstallReady?.(syncInstall);
    },

    onEnter() {
      build();
      sync();
    },

    /** First stop is the CHOSEN segment — the one a keyboard user came to
     *  change. Landing on the selected option rather than the first also means
     *  Tab does not silently imply "Current" is where you are when it is not.
     *  Range inputs are natively arrow-key operable, so the sliders need
     *  nothing beyond being in the tab order. */
    focus() {
      return host?.querySelector('.seg[aria-checked="true"]') || null;
    },
  };
}
