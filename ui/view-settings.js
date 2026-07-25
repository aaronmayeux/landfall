/**
 * view-settings.js — the Settings view (SPEC §16).
 *
 * This screen used to be deliberately empty: it existed only so the control
 * cluster's Settings button led somewhere honest, and it said in words what
 * would eventually live here.
 *
 * IT NOW CARRIES ITS FIRST REAL CONTROL — mesh height (§9): whether the cage
 * lifts over each storm's current position only, or follows its whole track.
 * The remaining stubs (units override, light theme, default scope) still state
 * the current behaviour in words rather than showing dead toggles, for the
 * reason this file was created in the first place: a control that silently
 * no-ops is the same class of failure as a toggle that draws nothing (§5).
 *
 * THE SEGMENTED CONTROL IS THE LAYERS PANEL'S, REUSED VERBATIM (`.seg-group` /
 * `.seg`, role=radiogroup/radio). Not restyled, not reimplemented — it already
 * carries the focus ring, the 44px target, the hover rules behind
 * `@media (hover: hover)`, and the ARIA the keyboard pass depends on. A second
 * segmented control here would be two things to keep in step, and one of them
 * would drift (§12).
 *
 * NO `unmount`. The drawer's contract is
 * `{ id, title, mount(host), onEnter?, onLeave?, focus? }` and it mounts a
 * view ONCE, lazily, then keeps it for the life of the app (ui/drawer.js).
 * There is no teardown to hook, so the settings subscription below is held
 * deliberately for the session rather than released in a method that would
 * never be called — dead code that LOOKS like cleanup is worse than none,
 * because the next reader trusts it.
 *
 * Imports: data/settings-prefs.js only. No map, no THREE — this view sets a
 * preference and the cage subscribes to it (main.js).
 */

import {
  MESH_HEIGHT,
  settingValue,
  settingOptions,
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

export function createSettingsView({ unitSystem } = {}) {
  let host = null;

  function meshGroup() {
    const current = settingValue('meshHeight');
    /* Options come from the STORE, not a list typed here. A control offering
     * a value `setSetting` would reject is a dead button, and the two lists
     * drifting apart is exactly how that happens. */
    const segs = settingOptions('meshHeight')
      .map(
        (v) => `
          <button class="seg" type="button" role="radio"
                  aria-checked="${String(v === current)}"
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
        <p class="settings-note settings-soft">${esc(MESH_NOTE[current] || '')}</p>
      </div>`;
  }

  function render() {
    if (!host) return;

    /* Name the CURRENT behaviour, not just the future one. "Units follow your
     * device" is actionable information; "coming soon" is not. */
    const units = unitSystem?.() || null;
    const unitLine = units
      ? `Units follow your device — currently ${esc(units)}.`
      : 'Units follow your device.';

    host.innerHTML = `
      <div class="drawer-body">
        ${meshGroup()}
        <p class="settings-note">${unitLine}</p>
        <p class="settings-note settings-soft">
          A manual override for units, a light theme, and a default scope will
          live here. Until then the app reads them from your device.
        </p>
      </div>`;
  }

  return {
    id: 'settings',
    title: 'Settings',

    mount(el) {
      host = el;

      /* ONE delegated listener on the host, bound once. Re-rendering replaces
       * the innerHTML on every change, so per-button handlers would either
       * leak or need rebinding on each pass. */
      host.addEventListener('click', (e) => {
        const btn = e.target.closest?.('[data-mesh]');
        if (!btn || !host.contains(btn)) return;
        /* The store decides what is legal; this only asks. A rejected value
         * changes nothing and the re-render below puts the control back to
         * the value actually in effect, so the UI can never show a state the
         * app is not in. */
        setSetting('meshHeight', btn.dataset.mesh);
      });

      /* Re-render on every settings change, not only our own clicks: the
       * store is the single source of truth and something else may set it.
       * Fires immediately at registration, which is what paints the view. */
      subscribeSettings(render);
    },

    onEnter() {
      render();
    },

    /** First stop is the CHOSEN segment — the one interactive thing here, and
     *  the one a keyboard user came to change. Landing on the selected option
     *  rather than the first also means Tab does not silently imply that
     *  "Current" is where you are when it is not. */
    focus() {
      return host?.querySelector('.seg[aria-checked="true"]') || null;
    },
  };
}
