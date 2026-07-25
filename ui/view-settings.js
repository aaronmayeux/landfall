/**
 * view-settings.js — the Settings view (SPEC §16).
 *
 * Carries two kinds of control now:
 *   - mesh height (§9), a segmented control
 *   - the imagery disc's SIZE and EDGE FADE (§4), two sliders
 *
 * The remaining stubs (units override, light theme, default scope) still state
 * the current behaviour in words rather than showing dead toggles, for the
 * reason this file was created in the first place: a control that silently
 * no-ops is the same class of failure as a toggle that draws nothing (§5).
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
 * whole feature had to design around. The cage speaks only height and colour;
 * the words carry what those two cannot.
 */
const MESH_NOTE = Object.freeze({
  [MESH_HEIGHT.CURRENT]:
    'The globe rises over each storm where it is right now.',
  [MESH_HEIGHT.TRACK]:
    'The globe rises along each storm’s whole path — where it has been and ' +
    'where it is forecast to go. Height is wind speed, so the tallest point ' +
    'is the storm at its strongest, whether that has happened yet or not. ' +
    'The spiral always marks where it is now.',
});

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );

/** Distances read in whole kilometres. Nobody is tuning a cloud edge to the
 *  metre, and a jittering decimal under a moving thumb reads as noise. */
const km = (n) => `${Math.round(n)} km`;

/**
 * @param {object} opts
 * @param {() => string|null} opts.unitSystem
 * @param {object} opts.install  the pwa.js seam, injected by main.js so this
 *        view never imports the PWA module directly:
 *        { isInstalled, canPromptInstall, needsManualInstall,
 *          onInstallReady, requestInstall }
 */
export function createSettingsView({ unitSystem, install } = {}) {
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
   */
  function sliderRow(key, id, label, hint) {
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
        <p class="settings-note settings-soft">${esc(hint)}</p>
      </div>`;
  }

  function imageryBlock() {
    return `
      <div class="settings-block">
        <p class="settings-label">Storm imagery</p>
        ${sliderRow(
          'imageryRadiusKm',
          'set-radius',
          'Cloud radius',
          'How far the satellite picture reaches from each storm’s eye. Bigger ' +
            'catches the whole shield of a large hurricane; too big and it ' +
            'stops reading as weather on a storm.',
        )}
        ${sliderRow(
          'imageryFade',
          'set-fade',
          'Edge fade',
          'How wide the soft edge is where the picture blends into the globe. ' +
            'Push it too far and it starts eating the storm’s outer bands.',
        )}
        <div class="layer-reset-wrap">
          <button class="layer-reset" type="button" id="set-imagery-reset">
            Reset imagery to defaults
          </button>
        </div>
      </div>`;
  }

  /* --- install (§14 Phase 5) -------------------------------------------------
   *
   * The first-run nudge is a ONE-TIME chip that never comes back — by design,
   * because a hurricane app that nags is the wrong brand (ui/first-run.js).
   * That leaves anyone who dismissed it, or who arrived on a device where the
   * install event landed late, with no way to install at all. Settings is
   * where you go looking for exactly that, so the seam gets a permanent door
   * here as well. Same capability rules, same pwa.js functions — one seam, two
   * surfaces, no second install path to drift.
   *
   * FOUR STATES, and the row states which one it is rather than vanishing.
   * That is the Layers rule (§7: rows dim, they never disappear) applied here:
   * Settings is a destination you navigated to, and a missing row reads as a
   * missing feature. The one exception the nudge makes — show nothing when the
   * browser cannot install — is right for an unprompted chip and wrong for a
   * screen someone opened on purpose looking for the button.
   */
  const INSTALL_STATE = Object.freeze({
    INSTALLED: 'installed',
    READY: 'ready',
    MANUAL: 'manual',
    UNSUPPORTED: 'unsupported',
  });

  function installState() {
    if (!install) return INSTALL_STATE.UNSUPPORTED;
    if (install.isInstalled()) return INSTALL_STATE.INSTALLED;
    if (install.canPromptInstall()) return INSTALL_STATE.READY;
    if (install.needsManualInstall()) return INSTALL_STATE.MANUAL;
    return INSTALL_STATE.UNSUPPORTED;
  }

  const INSTALL_COPY = Object.freeze({
    [INSTALL_STATE.INSTALLED]:
      'Landfall is installed on this device. You’re running it from your home screen.',
    [INSTALL_STATE.READY]:
      'Adds Landfall to your home screen and runs it full screen, without the browser bar.',
    [INSTALL_STATE.MANUAL]:
      'To install: tap the Share button, then “Add to Home Screen”. Safari doesn’t let a site do this for you.',
    [INSTALL_STATE.UNSUPPORTED]:
      'This browser can’t install web apps. Chrome, Edge, or Safari on iOS can.',
  });

  function installBlock() {
    return `
      <div class="settings-block" id="set-install-block">
        <p class="settings-label">Install Landfall</p>
        <button class="layer-reset" type="button" id="set-install">Install</button>
        <p class="settings-note settings-soft" id="set-install-note"></p>
      </div>`;
  }

  /** Paint the install row from the CURRENT capability. Called by sync(), so
   *  it re-runs whenever anything else in Settings changes, and again from the
   *  install-ready subscription below — Chromium can fire that event long
   *  after this view was built. */
  function syncInstall() {
    const btn = host?.querySelector('#set-install');
    const note = host?.querySelector('#set-install-note');
    if (!btn || !note) return;

    const state = installState();
    note.textContent = INSTALL_COPY[state];

    /* Only ONE state has a button that can do anything. The rest disable it
     * rather than hide it, so the affordance stays where the user can see
     * that it exists and read why it is not available (§7). */
    const live = state === INSTALL_STATE.READY;
    btn.disabled = !live;
    btn.textContent =
      state === INSTALL_STATE.INSTALLED ? 'Installed' : 'Install';
  }

  function build() {
    if (!host || built) return;

    /* Name the CURRENT behaviour, not just the future one. "Units follow your
     * device" is actionable information; "coming soon" is not. */
    const units = unitSystem?.() || null;
    const unitLine = units
      ? `Units follow your device — currently ${esc(units)}.`
      : 'Units follow your device.';

    host.innerHTML = `
      <div class="drawer-body">
        ${meshGroup()}
        ${imageryBlock()}
        ${installBlock()}
        <p class="settings-note">${unitLine}</p>
        <p class="settings-note settings-soft">
          A manual override for units, a light theme, and a default scope will
          live here. Until then the app reads them from your device.
        </p>
      </div>`;

    built = true;
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

    const radius = settingValue('imageryRadiusKm');
    const fade = settingValue('imageryFade');

    /* The fade is stored as a FRACTION of the radius but shown in kilometres,
     * because "0.42" is not a thing anyone can picture and "378 km" is. It
     * therefore changes when the radius does, which is true and worth seeing. */
    setSlider('set-radius', radius, km(radius));
    setSlider('set-fade', fade, km(radius * fade));

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
         * accepts or declines. Re-syncing afterwards is what turns the button
         * into "Installed" on accept, or disables it with the unsupported
         * reason on decline — either way the row stops offering a dialog that
         * can no longer be shown. */
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
