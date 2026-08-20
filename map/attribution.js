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

/**
 * ==> EVERY EXTERNAL HOST THIS APP CAN REACH, AND WHAT IT OWES. <==
 *
 * The maintenance rule above is the one way this file goes silently wrong, and
 * a rule stated in a comment is the guard this project has already watched
 * fail. This table turns it into something `tools/test-attribution.mjs` can
 * check: it collects every `https://` host named in `config/constants.js` and
 * in the Pages Functions, and fails if one of them is missing from here. Add a
 * feed, and the push stops until somebody has DECIDED whether it needs a
 * credit — which is the whole job.
 *
 * A host maps to the exact `label` of the credit that covers it, or to `null`
 * with a reason. `null` means "considered, owes nothing" — it is not a skip
 * list, and a reason that is only "probably fine" is not one.
 */
export const CREDIT_HOSTS = Object.freeze({
  /* The basemap. */
  'tiles.openfreemap.org': 'OpenFreeMap',

  /* Imagery and radar. */
  'gibs.earthdata.nasa.gov': 'NASA GIBS / Worldview — GOES & Himawari imagery',
  'view.eumetsat.int': 'EUMETSAT — Meteosat imagery',
  'api.rainviewer.com': 'Weather data by RainViewer — radar',
  'tilecache.rainviewer.com': 'Weather data by RainViewer — radar',

  /* Rainfall at a point. Open-Meteo is CC BY 4.0. */
  'api.open-meteo.com': 'Open-Meteo — global rainfall forecasts',

  /* Search. Mapbox's terms require the service to be credited wherever its
   * results are shown. */
  'api.mapbox.com': 'Mapbox — address search',

  /* Government cyclone alerts, aggregated by Esri. The issuing agency is named
   * on every row in the app; this credits the aggregator that delivers them. */
  'services9.arcgis.com': 'Esri — CAP alerts feed',

  /* The storm data itself. US federal products are public domain and owe
   * nothing legally; they are credited anyway, because over-crediting costs a
   * line and this panel is where somebody goes to find out where the numbers
   * came from. GDACS is the JRC's and asks to be named. */
  'www.nhc.noaa.gov': 'NOAA — National Hurricane Center, NWS and JTWC',
  'ftp.nhc.noaa.gov': 'NOAA — National Hurricane Center, NWS and JTWC',
  'mapservices.weather.noaa.gov': 'NOAA — National Hurricane Center, NWS and JTWC',
  'api.weather.gov': 'NOAA — National Hurricane Center, NWS and JTWC',
  'www.metoc.navy.mil': 'NOAA — National Hurricane Center, NWS and JTWC',
  'www.gdacs.org': 'GDACS — European Commission Joint Research Centre',

  /* ==> NOT CREDITED, WITH THE REASON, NOT A SHRUG. <== */

  /* Ours. */
  'landfall.getgravitate.app': null,
  'landfall-relay.internal': null,

  /* Named ONLY inside `functions/api/imagery/inspect.js`, which is a diagnostic
   * route behind `_inspect-guard.js`. Nothing they serve reaches a visitor, and
   * three of the four were candidate vendors that lost — see SPEC-DATA.md §4.9
   * for why radar is single-source. If any of them is ever wired into a
   * user-facing layer, it needs a credit and this entry has to go. */
  'mesonet.agron.iastate.edu': null,
  'nowcoast.noaa.gov': null,
  'rammb-slider.cira.colostate.edu': null,
  'verif.rap.ucar.edu': null,

  /* Placeholders in test fixtures and doc comments, never fetched. */
  'example.com': null,
});

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
  /* ==> RAINVIEWER'S CREDIT IS A LICENCE CONDITION, NOT A COURTESY. <== The
   * terms require the words "Weather data by RainViewer" and a link to the
   * site, in exchange for a free service with no key and no fee. It replaced
   * the NOAA/NWS MRMS row outright in 2026-08 — radar is single-source and NOAA
   * is deleted, so leaving the old row would credit a service that no longer
   * sends us a single byte. */
  { label: 'Weather data by RainViewer — radar', href: 'https://www.rainviewer.com/' },

  /* ==> OPEN-METEO IS CC BY 4.0, AND IT WAS CREDITED IN ONLY ONE PLACE. <==
   * §48.14 discharges the licence in the rain section's provenance line, which
   * names the source beside the number it produced — the right place for a
   * reader who is looking at that number. But that line renders only when a
   * rain forecast has landed AND the global model was the one that answered
   * it, so on every other screen in the app the credit is simply absent. That
   * is exactly the condition the imagery note above rejects. Both now: the
   * provenance line stays, and the licence is also discharged here, where
   * somebody goes deliberately to check the licensing. */
  { label: 'Open-Meteo — global rainfall forecasts', href: 'https://open-meteo.com/' },

  /* Address search. Mapbox's terms require attribution wherever their
   * geocoding results are displayed. */
  { label: 'Mapbox — address search', href: 'https://www.mapbox.com/about/maps/' },

  /* ==> THE ALERT AGGREGATOR, WHICH WAS CREDITED NOWHERE AT ALL. <== The app
   * fetches live government cyclone warnings through Esri's CAP Alerts Feed
   * and shows them under a storm. The ISSUING AGENCY is named on every row —
   * that is §50.5's requirement and it is about not misattributing an alert.
   * It is not the same as crediting the service that delivers them, which had
   * simply been missed since the feed was wired. */
  { label: 'Esri — CAP alerts feed', href: 'https://www.esri.com/en-us/disaster-response/overview' },

  /* Population. GeoNames is CC BY 4.0, which makes this credit a LICENCE
   * CONDITION rather than a courtesy — the strongest kind on this list. Listed
   * unconditionally, like the imagery credits above and for the same reason:
   * a credit that appears only while a toggle is on is missing at exactly the
   * moment somebody opens this panel to check the licensing. */
  { label: 'GeoNames — town populations', href: 'https://www.geonames.org/' },

  /* ==> THE STORM DATA ITSELF, WHICH OWES NOTHING AND IS CREDITED ANYWAY. <==
   * NHC, NWS and JTWC products are US federal works in the public domain, and
   * the app already names whichever of them spoke on every storm panel (§5).
   * Neither fact makes this panel the wrong place for them: it is the surface
   * a reader opens to find out where the numbers on the screen come from, and
   * a licensing list that omits the primary source reads as an oversight. The
   * rule this file already states — over-crediting costs a line, under-
   * crediting is a licence breach nobody gets an alert about — cuts the same
   * way for a source that owes nothing. GDACS is the JRC's and asks to be
   * named, so it is the one row here that is closer to a condition. */
  { label: 'NOAA — National Hurricane Center, NWS and JTWC', href: 'https://www.nhc.noaa.gov/' },
  { label: 'GDACS — European Commission Joint Research Centre', href: 'https://www.gdacs.org/' },

  /* ==> THE VOLCANO AND ASH CREDITS WERE REMOVED 2026-08-08 BECAUSE THE DATA
   * WAS, NOT BECAUSE THE RULE CHANGED. <== Smithsonian GVP, USGS VHP, the nine
   * VAACs and the BoM relay were listed here from the moment those feeds
   * entered the app, ahead of anything rendering them, because a licence
   * condition is satisfied when the bytes arrive rather than when somebody
   * notices. Landfall is cyclone-only now and fetches none of them. The rule
   * still stands for the next feed: credit it the day it is wired, not the day
   * it ships. Over-crediting costs a line; under-crediting is a licence breach
   * nobody gets an alert about. */
]);

/** The credit labels, for the check. Exported rather than re-parsed out of the
 *  source, so the test reads the same array the pill renders. */
export const CREDIT_LABELS = Object.freeze(CREDITS.map((c) => c.label));

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
   * ==> AND IT IS AN ITALIC SERIF "i" NOW, NOT A STRAIGHT STROKE. <== The
   * previous glyph was two round-capped strokes — a vertical bar and a dot —
   * which is the app's icon language and reads as a bar, not as a letter. The
   * information "i" is a typographic mark everywhere else in the world and it
   * is recognised as one because of the slant and the serifs. Aaron's call,
   * 2026-08-20.
   *
   * ==> DRAWN AS PATHS, NOT SET AS TEXT. <== An `<text>` node with
   * `font-style: italic` would be a real serif face and would be one line
   * instead of five — and it would be a DIFFERENT letter on every platform,
   * because it resolves through whatever each device calls `serif`, with its
   * own widths and its own baseline. A glyph that is 20px tall in a 28px
   * circle cannot afford to be optically centred on one phone and off on
   * another. These coordinates render identically everywhere.
   *
   * THE CONSTRUCTION, so it can be adjusted rather than redrawn: the stem is a
   * parallelogram slanted 0.2 to the right per unit of height, the two slabs
   * are its serifs — the top one extends LEFT only, as an entry stroke does,
   * the foot extends both ways — and the tittle sits above and right, on the
   * slant the stem would follow if it kept going. Filled, not stroked, because
   * a stroked parallelogram fattens at the corners.
   *
   * OPTICALLY CENTRED, NOT GEOMETRICALLY. Most of the ink is the stem, so the
   * ink's bounding box (which includes a wide foot serif and a small dot) is
   * not what the eye centres on. Verified by rendering, not by arithmetic. */
  icon.innerHTML = `
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M11.9 9.8 L13.8 9.8 L11.9 18.3 L10.0 18.3 Z"/>
      <path d="M9.9 9.8 L14.0 9.8 L14.0 10.95 L9.9 10.95 Z"/>
      <path d="M8.2 17.2 L14.0 17.2 L14.0 18.3 L8.2 18.3 Z"/>
      <circle cx="14.0" cy="6.9" r="1.25"/>
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
   * DOM is the state the user actually meets. Same for the host's stacking
   * flag: a missing attribute and `data-open="false"` style the same, but only
   * one of them says so. */
  host.dataset.open = 'false';
  label.inert = true;
  for (const a of label.querySelectorAll('a')) a.tabIndex = -1;

  let open = false;

  /** The pill's open size, measured from the CONTENT, never hardcoded — a
   *  hand-set number drifts the moment the credits or the font change, which
   *  is §12's "derive, never hand-tune twice" applied to a box.
   *
   *  Measured from the LABEL, not from the pill's scroll size: the pill
   *  carries an explicit width and height while collapsed, and a clipped
   *  element's scroll extents cannot be relied on to report its content. The
   *  label is unclipped in the layout sense — `clip-path` hides it without
   *  changing its box — so its own offsets are the honest numbers, and they
   *  already account for the wrap, because its `max-width` applies whether the
   *  pill is open or shut.
   *
   *  Returns null when the element has not been laid out yet (offsets 0 in the
   *  same task as insertion, §13) — the caller then falls back to `auto`,
   *  which renders correctly and merely skips the animation. */
  const expandedBox = () => {
    const iconW = icon.offsetWidth;
    const iconH = icon.offsetHeight;
    const labelW = label.offsetWidth;
    const labelH = label.offsetHeight;
    if (!iconW || !iconH || !labelW || !labelH || !chrome) return null;
    return {
      w: `${iconW + labelW + chrome.w}px`,
      h: `${Math.max(iconH, labelH) + chrome.h}px`,
    };
  };

  /** ==> WHAT THE BORDER COSTS, DERIVED ONCE RATHER THAN TYPED. <== The pill
   *  is `border-box`, so its border counts inside both dimensions, and an
   *  earlier version simply added icon + label and came up 2px short — which
   *  the label's right padding absorbed, so nothing looked wrong and the text
   *  sat fractionally tight.
   *
   *  A CLOSED PILL IS THE ONLY THING THAT CAN ANSWER IT. Closed, its box is
   *  the icon plus its border by construction, so the difference IS the
   *  border. Open, the pill is already the size being computed and the
   *  subtraction is circular. Captured on the first open and kept. */
  let chrome = null;
  const captureChrome = () => {
    if (chrome || open) return;
    const iconW = icon.offsetWidth;
    const iconH = icon.offsetHeight;
    if (!iconW || !iconH) return;
    chrome = {
      w: Math.max(0, pill.offsetWidth - iconW),
      h: Math.max(0, pill.offsetHeight - iconH),
    };
  };

  const setOpen = (next) => {
    captureChrome();
    open = next;
    pill.setAttribute('aria-expanded', String(open));
    /* The host, not the pill, carries the stacking flag: z-index applies to
     * the positioned element, and the pill's own z-index would be resolved
     * inside the host's stacking context and lift nothing. */
    host.dataset.open = String(open);
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
      pill.style.height = '';
      return;
    }
    /* Explicit px values are what make the transition animate at all —
     * `auto` is not an interpolatable value. If the measurement is not
     * available yet, `auto` still shows the credits correctly; a missing
     * animation beats a pill that will not open. */
    const box = expandedBox();
    pill.style.width = box ? box.w : 'auto';
    pill.style.height = box ? box.h : 'auto';
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

  /* A resize changes both the rendered text width (font fallback, zoom) AND
   * how many lines it wraps to — the label's cap is a `vw` expression, so a
   * rotation from portrait to landscape can turn four lines into two. An open
   * pill re-measures rather than holding a stale box. */
  window.addEventListener('resize', () => {
    if (!open) return;
    const box = expandedBox();
    pill.style.width = box ? box.w : 'auto';
    pill.style.height = box ? box.h : 'auto';
  });

  return {
    isOpen: () => open,
    close: () => setOpen(false),
  };
}
