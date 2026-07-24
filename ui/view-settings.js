/**
 * view-settings.js — the Settings view (SPEC §16).
 *
 * DELIBERATELY EMPTY, AND HONEST ABOUT IT. Settings is listed in §16 as
 * carrying the units override, light/dark, and default scope. None of those
 * are built: units resolve from locale via lib/units.js, dark is the only
 * theme, and default scope rides the storm list.
 *
 * The view exists anyway because the alternative is a control-cluster button
 * that does nothing, and a control that silently no-ops is the same class of
 * failure as a toggle that draws nothing (§5). This screen states what will
 * live here and what the app is doing in the meantime — so the answer to "how
 * do I change the units" is a sentence, not a dead end.
 *
 * It also proves the drawer's view contract with the smallest possible view:
 * mount, title, focus. When settings lands, it fills this file in rather than
 * adding a panel.
 *
 * Imports: nothing today. Units/theme facades arrive from main.js when built.
 */

export function createSettingsView({ unitSystem } = {}) {
  let host = null;

  function render() {
    if (!host) return;
    /* Name the CURRENT behaviour, not just the future one. "Units follow your
     * device" is actionable information; "coming soon" is not. */
    const units = unitSystem?.() || null;
    const unitLine = units
      ? `Units follow your device — currently ${units}.`
      : 'Units follow your device.';

    host.innerHTML = `
      <div class="drawer-body">
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
      render();
    },

    onEnter() {
      render();
    },

    /* Nothing focusable inside, so the drawer falls back to its own chrome
     * (back, or close) — which is the right next stop for a keyboard user in
     * a view with no controls. */
    focus() {
      return null;
    },
  };
}
