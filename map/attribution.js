/**
 * attribution.js — OUR attribution control (SPEC §9, §11).
 *
 * A licensing requirement, rendered the app's own way: a 24 px "i" that is
 * always visible, and a small glass panel that opens on tap. Closed at rest,
 * because attribution must be REACHABLE at all times — it does not have to be
 * asserted on arrival.
 *
 * WHY WE DO NOT USE MapLibre's AttributionControl. It cannot be made to start
 * collapsed from outside. There is no `collapsed` option (the docs are
 * explicit that it "is expanded by default, regardless of map width"), and it
 * re-expands itself from several handlers: `_updateAttributions()` calls
 * `_updateCompact()` on styledata, sourcedata and terrain, and tiles stream
 * in for a while after load, so the expand path keeps firing. It also owns a
 * native <details> whose `open` state the browser toggles independently.
 * Anything we add is a third actor in that race — measured live, our JS ran
 * successfully and was overwritten moments later, and each successive attempt
 * to hold the state made the tap count worse (one tap became three).
 *
 * Six attempts went into that before this file existed. At ~40 lines with no
 * state machine to fight, ours is smaller than the workarounds were.
 *
 * ==> THE TRADE, AND THE ONE MAINTENANCE RULE <==
 * MapLibre's control derived credits from the style's sources automatically.
 * THIS ONE DOES NOT. If the basemap tile source ever changes, the CREDITS
 * BELOW MUST BE UPDATED BY HAND. Today's source is OpenFreeMap serving the
 * OpenMapTiles schema (§11); flipping `TILES.useR2` back to the Protomaps
 * archive would need Protomaps' attribution added here. This is a deliberate
 * decision recorded in the spec, not a value that drifts on its own — but it
 * is the one way this file can silently go wrong.
 *
 * Imports: nothing. main.js/globe.js mounts it into #attrib-host.
 */

/** The credits. See the maintenance rule above before editing. */
const CREDITS = Object.freeze([
  { label: 'OpenStreetMap contributors', href: 'https://www.openstreetmap.org/copyright' },
  { label: 'OpenFreeMap', href: 'https://openfreemap.org/' },
]);

/**
 * Mount the control into a host element.
 * @param {HTMLElement} host  #attrib-host (a fixed sibling of #globe — never
 *        a child: #globe's opacity is animated by the dive crossfade, and
 *        opacity on a parent fades everything inside it, §13).
 */
export function createAttribution(host) {
  if (!host) return null;

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'attrib-toggle';
  toggle.setAttribute('aria-label', 'Map credits');
  toggle.setAttribute('aria-expanded', 'false');
  /* Hand-drawn to match every other icon in the app: 24x24 viewBox,
   * currentColor, stroke-width 1.7, round caps (§9 — no icon pack). */
  toggle.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"
         stroke-linecap="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9"/>
      <path d="M12 11v5"/>
      <path d="M12 7.6v.2"/>
    </svg>`;

  const panel = document.createElement('div');
  panel.className = 'attrib-panel';
  panel.dataset.open = 'false';
  panel.id = 'attrib-panel';
  panel.innerHTML =
    '© ' +
    CREDITS.map(
      (c) =>
        `<a href="${c.href}" target="_blank" rel="noopener noreferrer">${c.label}</a>`
    ).join(', © ');

  toggle.setAttribute('aria-controls', panel.id);

  host.appendChild(panel);
  host.appendChild(toggle);

  let open = false;
  const setOpen = (next) => {
    open = next;
    panel.dataset.open = String(open);
    toggle.setAttribute('aria-expanded', String(open));
  };

  toggle.addEventListener('click', (e) => {
    /* The host sits over the map; without this the tap also falls through as
     * a map click and closes the drawer (main.js treats empty-ocean clicks as
     * a dismiss). */
    e.stopPropagation();
    setOpen(!open);
  });

  /* Tapping anywhere else dismisses it — the same gesture that closes every
   * other transient surface in the app. Capture phase so it runs before the
   * map's own click handling. */
  document.addEventListener(
    'click',
    (e) => {
      if (open && !host.contains(e.target)) setOpen(false);
    },
    true
  );

  /* Escape closes it. NOT registered through attachEscape(): that contract is
   * about the drawer and the camera (§10), and this panel must not consume an
   * Escape that the user meant for either. It only acts when it is open, and
   * only then stops the event. */
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && open) {
      e.stopPropagation();
      setOpen(false);
      toggle.focus();
    }
  });

  return {
    isOpen: () => open,
    close: () => setOpen(false),
  };
}
