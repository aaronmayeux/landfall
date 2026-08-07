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
  /* Imagery (Phase 7). Listed unconditionally rather than only while a
   * satellite layer is on: this panel is a licensing surface, not a live
   * legend, and a credit that appears and disappears with a toggle is a
   * credit that is missing whenever someone goes looking for it. */
  { label: 'NASA GIBS / Worldview — GOES & Himawari imagery', href: 'https://nasa-gibs.github.io/gibs-api-docs/' },
  { label: 'EUMETSAT — Meteosat imagery', href: 'https://www.eumetsat.int/' },
  { label: 'NOAA / NWS MRMS — radar', href: 'https://www.weather.gov/' },

  /* Population. GeoNames is CC BY 4.0, which makes this credit a LICENCE
   * CONDITION rather than a courtesy — the strongest kind on this list. Listed
   * unconditionally, like the imagery credits above and for the same reason:
   * a credit that appears only while a toggle is on is missing at exactly the
   * moment somebody opens this panel to check the licensing. */
  { label: 'GeoNames — town populations', href: 'https://www.geonames.org/' },

  /* Volcanoes (Phase C onward). ==> LISTED BEFORE THE LAYER IS ON SCREEN, ON
   * PURPOSE. <== Nothing renders volcanoes yet — the Deep globe is a prototype
   * and first marks are Phase E — so this is early by one measure. It is here
   * anyway for the reason stated at the top of this file: MapLibre's control
   * derived credits automatically and ours does not, which makes a MISSING
   * credit the one way this file can silently go wrong. Smithsonian GVP
   * attribution is a LICENCE REQUIREMENT, not a courtesy, and the moment to
   * satisfy it is the moment the data enters the app rather than the moment
   * somebody notices. Over-crediting costs a line; under-crediting is a
   * licence breach nobody gets an alert about. */
  {
    label: 'Smithsonian Institution — Global Volcanism Program',
    href: 'https://volcano.si.edu/',
  },
  {
    label: 'USGS Volcano Hazards Program — alert levels',
    href: 'https://www.usgs.gov/programs/VHP',
  },
  /* All nine Volcanic Ash Advisory Centres, named rather than counted — a
   * reader checking whether their national service is credited needs to find
   * its name, and "nine VAACs" answers nobody. One entry because they are one
   * WMO product issued by nine offices, and there is no single canonical URL
   * for the set; ICAO's page is the authoritative index. */
  {
    label:
      'Volcanic Ash Advisory Centres — Anchorage, Buenos Aires, Darwin, ' +
      'London, Montreal, Tokyo, Toulouse, Washington, Wellington',
    href: 'https://www.icao.int/airnavigation/IMP/Pages/Volcanic-Ash.aspx',
  },
  /* The two transports the advisories actually arrive over. Bureau of
   * Meteorology relays eight of the nine centres and NOAA's bulletin dump
   * covers Wellington; both are redistributors rather than authors, and both
   * are credited because that is where our bytes come from. */
  {
    label: 'Australian Bureau of Meteorology — ash advisory relay',
    href: 'http://www.bom.gov.au/',
  },
]);

/**
 * Mount the control into a host element.
 * @param {HTMLElement} host  #attrib-host (a fixed sibling of #globe — never
 *        a child: #globe's opacity is animated by the dive crossfade, and
 *        opacity on a parent fades everything inside it, §13).
 */
export function createAttribution(host) {
  if (!host) return null;

  /* ONE ELEMENT, not a button plus a panel. The pill grows from a circle to
   * fit its label; a panel opening behind a button read as two objects
   * stacked rather than one thing expanding. */
  const pill = document.createElement('button');
  pill.type = 'button';
  pill.className = 'attrib';
  pill.setAttribute('aria-label', 'Map credits');
  pill.setAttribute('aria-expanded', 'false');

  const icon = document.createElement('span');
  icon.className = 'attrib-icon';
  /* ==> ONE CIRCLE, NOT TWO. <== This used to draw a `<circle r="9">` inside
   * the pill — which is itself a bordered circle — and then fit an "i" inside
   * that. Two nested rings, and the letter that carries the meaning ended up
   * about three pixels tall in secondary grey. On glass Aaron could not tell
   * there was a letter there at all. The pill IS the circle; the glyph only has
   * to be the letter, so it gets the whole box.
   *
   * OPTICALLY CENTRED, NOT GEOMETRICALLY. A lowercase "i" carries its weight
   * low — the stem is most of the ink and the tittle is a dot — so a glyph
   * centred on the viewBox reads as sitting high. The stem runs 10.5 -> 19 and
   * the dot sits at 6.5 against a 24 box, which puts the visual mass on the
   * centre line. Hand-drawn to match every other icon in the app: 24x24
   * viewBox, currentColor, round caps (§9 — no icon pack). */
  icon.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6"
         stroke-linecap="round" aria-hidden="true">
      <path d="M12 10.5v8.5"/>
      <path d="M12 6.4v.2"/>
    </svg>`;

  const label = document.createElement('span');
  label.className = 'attrib-label';
  label.innerHTML =
    '© ' +
    CREDITS.map(
      (c) =>
        `<a href="${c.href}" target="_blank" rel="noopener noreferrer">${c.label}</a>`
    ).join(', © ');

  pill.appendChild(icon);
  pill.appendChild(label);
  host.appendChild(pill);

  /* The pill ships CLOSED, so the links start inert. Applied here rather than
   * left to the first setOpen() call — until something toggles it, the initial
   * DOM is the state the user actually meets. */
  label.inert = true;
  for (const a of label.querySelectorAll('a')) a.tabIndex = -1;

  let open = false;

  /** Width is measured from the CONTENT, never hardcoded — a hand-set width
   *  drifts the moment the credits or the font change, which is §12's
   *  "derive, never hand-tune twice" applied to one number.
   *
   *  Measured as icon box + label's own width, NOT via the pill's
   *  scrollWidth: the pill carries `overflow: hidden` and an explicit width
   *  while collapsed, and a clipped element's scrollWidth cannot be relied on
   *  to report the full content extent. The label is unclipped, so its
   *  offsetWidth is the honest number.
   *
   *  Returns null when the element has not been laid out yet (offsetWidth 0
   *  in the same task as insertion, §13) — the caller then falls back to
   *  `auto`, which renders correctly and merely skips the animation. */
  const expandedWidth = () => {
    const iconW = icon.offsetWidth;
    const labelW = label.offsetWidth;
    if (!iconW || !labelW) return null;
    return `${iconW + labelW}px`;
  };

  const setOpen = (next) => {
    open = next;
    pill.setAttribute('aria-expanded', String(open));
    /* ==> A CLOSED PILL'S LINKS ARE INERT, NOT MERELY INVISIBLE. <==
     * They sit at opacity 0 and are clipped by the pill's overflow, and neither
     * of those removes an element from the tab order or from hit-testing.
     * Aaron found both halves on glass: tabbing past the pill walked through
     * five credit links that were not on screen, and a tap on the circle came
     * back with weather.gov — the last credit in the list.
     *
     * `inert` does the whole job in one attribute: no focus, no clicks, no
     * screen reader. Supported everywhere we run; `tabIndex` is set alongside
     * it as the belt-and-braces for anything that ignores it, because a
     * keyboard trap in an invisible control is the exact scar SPEC §13 records
     * from the closed panel. */
    for (const a of label.querySelectorAll('a')) {
      a.tabIndex = open ? 0 : -1;
    }
    label.inert = !open;
    if (!open) {
      pill.style.width = '';
      return;
    }
    /* An explicit px width is what makes the transition animate at all —
     * `auto` is not an interpolatable value. If the measurement is not
     * available yet, `auto` still shows the credits correctly; a missing
     * animation beats a pill that will not open. */
    pill.style.width = expandedWidth() || 'auto';
  };

  pill.addEventListener('click', (e) => {
    /* A tap on a credit link opens the link; it must not also collapse the
     * pill out from under the finger. */
    if (e.target.closest('a')) {
      e.stopPropagation();
      return;
    }
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
   * about the drawer and the camera (§10), and this pill must not consume an
   * Escape the user meant for either. It acts only when open, and only then
   * stops the event. */
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && open) {
      e.stopPropagation();
      setOpen(false);
      pill.focus();
    }
  });

  /* A resize can change the rendered text width (font fallback, zoom), so an
   * open pill re-measures rather than holding a stale px value. */
  window.addEventListener('resize', () => {
    if (open) pill.style.width = expandedWidth();
  });

  return {
    isOpen: () => open,
    close: () => setOpen(false),
  };
}
