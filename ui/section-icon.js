/**
 * section-icon.js — the one icon set used by every section heading in the app.
 *
 * ==> THE ICON IS BESIDE THE LABEL, NEVER INSTEAD OF IT. <== A pin, a gauge and
 * a wind arrow are not a shared vocabulary — the reader has to learn this app's
 * meaning for each one, and a heading nobody can read is a section nobody can
 * skip past. What the icons buy is SCANNING: on a screen of stacked blocks of
 * text, a shape at the left edge of each heading is what the eye uses to find
 * its place, and that works whether or not the reader ever decodes the shape.
 *
 * ==> WHY IT IS A FILE AND NOT A PRIVATE HELPER. <== It was seven paths and an
 * `iconSvg` inside `ui/view-home.js`, and `sectHead` was already being PASSED
 * AS AN ARGUMENT into `ui/countdown-home.js` so a second file could draw one.
 * That is the shape of a module that has not been extracted yet. The storm
 * panel was the second caller, and the rule is that a pattern used twice gets
 * extracted BEFORE the second use.
 *
 * ==> ONE NAME, ONE SHAPE, BOTH DRAWERS. <== Wind field on the storm panel and
 * How strong on Home are the same idea, so they take the same glyph. Anything
 * else teaches the reader that the shapes mean nothing.
 *
 * Stroke-only, 24-box, `currentColor` — so a heading and its icon can never
 * drift apart in color. `aria-hidden` on every one, because the words beside
 * them are already the accessible name and "image, pin, Where it is" is noise
 * on the one surface that cannot afford it.
 *
 * Sized by CSS (`.sect-ico` in ui/panels.css), never by an attribute, so one
 * rule moves every heading icon in the app at once. That is the difference
 * between this and `map/glyph-home.js`, which draws at an explicit pixel size
 * because it lands on the globe rather than in a line of text.
 *
 * Imports nothing. Ever.
 */

/**
 * The set, in one place.
 *
 * NAMED FOR THE IDEA, NOT THE PICTURE. `flood` rather than `waves`, so a later
 * pass can redraw the shape without every caller becoming a lie. That rule
 * earned its keep on 2026-08-22: `surge` was replaced by three stacked waves
 * and not one call site had to change, because no call site had ever named a
 * crest.
 */
export const ICON_PATH = Object.freeze({
  /* Where it is — a map pin. */
  pin: '<path d="M12 21s7-5.4 7-11a7 7 0 1 0-14 0c0 5.6 7 11 7 11Z"/><circle cx="12" cy="10" r="2.5"/>',
  /* How strong / Wind field — the wind glyph, three trailing streams. */
  wind: '<path d="M3 8h10a3 3 0 1 0-3-3"/><path d="M3 12h14a3 3 0 1 1-3 3"/><path d="M3 16h7"/>',
  /* Rain / Rainfall — a cloud with fall lines under it. */
  rain: '<path d="M7 15.5a4 4 0 0 1 .5-7.97 5 5 0 0 1 9.4 1.02A3.5 3.5 0 0 1 17 15.5Z"/>' +
    '<path d="M9 18.5 8 21M13 18.5 12 21M17 18.5 16 21"/>',
  /* Timeline — a clock, because every row on it is a time. */
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  /* Vitals — a gauge needle. */
  gauge: '<path d="M4.5 17a8.5 8.5 0 1 1 15 0"/><path d="M12 17l4-5"/>',
  /* Flooding — three stacked waves. Water where it should not be, whether it
   * came off the sky or off the sea; §56.7 merged those two into one section
   * and this is its one mark.
   *
   * ==> IT REPLACED `surge`, WHICH WAS A CREST OVER A LEVEL LINE. <== That
   * shape existed for one job its own comment named: separating `Coastal
   * flooding` from `Rain` at a glance while scrolling. `Coastal flooding` is
   * not a section any more, so the job is gone and the mark went with it.
   * There is exactly one water glyph in this app now, which is the point —
   * two would teach a reader that the difference between them means
   * something, and §56.7's whole finding is that it does not.
   *
   * ==> DELIBERATELY NOT THE RAIN CLOUD WITH MORE DROPS. <== Rain and
   * Flooding sit adjacent on both screens and the icon is what separates them
   * while scrolling. A cloud is weather arriving; these are the ground
   * already under water.
   *
   * ==> AND THE MAP WILL DRAW THE SAME PATH, NOT A REDRAWN ONE (§56.10). <==
   * `map.addImage` wants pixels, so Phase 5 strokes THESE strings onto a
   * canvas rather than authoring a second wave somewhere else. Tap a wave on
   * the globe and the panel that opens is headed with the same wave — one
   * continuous thought instead of two unrelated marks. That is why the shape
   * is centred on the 24-box (x 4 to 20) rather than inheriting `surge`'s
   * off-centre 3-to-19 span: an icon that is going to be rasterised has to be
   * balanced inside its own box, where a heading glyph could get away with a
   * lean. */
  flood: '<path d="M4 7c2 0 2-1.5 4-1.5S10 7 12 7s2-1.5 4-1.5S18 7 20 7"/>' +
    '<path d="M4 12c2 0 2-1.5 4-1.5S10 12 12 12s2-1.5 4-1.5S18 12 20 12"/>' +
    '<path d="M4 17c2 0 2-1.5 4-1.5S10 17 12 17s2-1.5 4-1.5S18 17 20 17"/>',
  /* The closest pass, on Home — and the Home section on the storm panel, which
   * carries the same two figures (distance now, closest approach next) and so
   * takes the same mark rather than a house of its own. A house would say
   * "your home"; both of these sections are about the DISTANCE to it. */
  target: '<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2"/>' +
    '<path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>',

  /* --- added for the storm panel ---------------------------------------- */

  /* Watches and warnings — the warning triangle. The one shape in this set
   * with a meaning the reader already owns before opening the app, which is
   * exactly why it is spent here and nowhere else. */
  alert: '<path d="M12 4.2 21 19.5H3Z"/><path d="M12 10v4"/><path d="M12 17.1v.1"/>',
  /* Environment — a thermometer. The section reads sea temperature, shear and
   * moisture; the temperature is the one a reader recognises as a picture, and
   * a stem-and-bulb survives being drawn 16 pixels tall where a wind-shear
   * diagram would not. */
  thermo: '<path d="M14 14.2V6a2 2 0 1 0-4 0v8.2a4 4 0 1 0 4 0Z"/><path d="M12 10.5v5.2"/>',
  /* People in the path — two figures, the near one whole and the far one
   * partly behind it. A single figure reads as "you"; this section is about
   * a population. */
  people: '<circle cx="9" cy="8" r="3"/><path d="M3.5 19a5.5 5.5 0 0 1 11 0"/>' +
    '<path d="M16 5.6a3 3 0 0 1 0 4.8"/><path d="M17.5 14.2A5.5 5.5 0 0 1 20.5 19"/>',
  /* Advisory — a page of text. The only section on the panel whose content is
   * somebody else's document rather than our reading of it, and the icon is
   * the one place that distinction is made at a glance. */
  doc: '<path d="M6 3.5h7.5L18 8v12.5H6Z"/><path d="M13.5 3.5V8H18"/>' +
    '<path d="M9 12.5h6M9 16h4"/>',
});

/**
 * One icon, as inline SVG. An unknown name returns an empty string rather than
 * throwing — a heading with no icon is a cosmetic loss, and a heading that
 * takes the whole drawer down with it is not.
 */
export function iconSvg(name) {
  const d = ICON_PATH[name];
  if (!d) return '';
  return `<svg class="sect-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
}

/**
 * The same icon as RAW PATH DATA — the `d` strings with the markup stripped,
 * ready for `new Path2D(d)` on a canvas.
 *
 * ==> THIS EXISTS SO THE GLOBE CAN STROKE THE SAME SHAPE AS THE HEADING RATHER
 * THAN A SECOND COPY OF IT. <== `SPEC-UI.md` §56.10 committed to it in as many
 * words when the flood waves were drawn: *the same path data, not a redrawn
 * one*. Tap a wave on the globe and the panel that opens is headed with the
 * same wave. **Slice B shipped a plain rounded square instead and nobody
 * noticed until Aaron saw it on a phone** — the fix is this function, not a
 * second set of coordinates in `map/`.
 *
 * ==> IT IS THE ONE EDGE FROM `map/` INTO `ui/`, AND IT IS DELIBERATE. <== No
 * file in `ui/` imports from `map/`, so there is no cycle (§12). The
 * alternative — moving the whole set into `config/` — is a file move touching
 * every heading in the app, and doing it in the same pass as a visual fix is
 * exactly the mixing this project keeps out of its commits. If a third caller
 * ever appears, that move is the right answer and this comment is the pointer.
 *
 * ==> AND IT PARSES THE MARKUP RATHER THAN STORING THE `d` STRINGS TWICE. <==
 * Two arrays that have to stay in step is the drift this file's whole existence
 * argues against. The set above stays the single source; this reads it.
 *
 * @param {string} name
 * @returns {string[]} one `d` string per subpath, empty for an unknown name.
 */
export function iconPathData(name) {
  const markup = ICON_PATH[name];
  if (!markup) return [];
  return [...markup.matchAll(/\sd="([^"]+)"/g)].map((m) => m[1]);
}
