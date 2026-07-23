/**
 * glyph-home.js — the house mark (SPEC §9).
 *
 * ONE definition, used in three places: the floating marker, the chevron
 * pointer's centre when home is off screen, and the provisional pin. Extracted
 * the moment it was needed twice (SPEC §12) — a house drawn separately in each
 * would drift the first time one got tweaked.
 *
 * Drawn to match the app's existing icon language exactly: 24×24 viewBox,
 * `currentColor`, stroke-width 1.7, round caps and joins. That consistency is
 * why this project does NOT pull in an icon pack — nine hand-drawn icons in
 * one style already read as a set, and a pack would mean either a CDN request
 * in the hot path (against §11's self-hosting direction) or a build step (against
 * the no-toolchain rule). Revisit at ~30 icons, and even then by copying paths
 * into this file rather than adding a dependency.
 *
 * Imports nothing. Ever.
 */

/**
 * The house, sized to a box.
 *
 * `solid` fills the body — used for the small mark inside the pointer, where a
 * pure outline at ~12 px turns to mush against a moving globe. The standalone
 * marker uses the outline form, which reads cleaner at full size and matches
 * the storm glyphs' stroked look.
 */
export function houseSvg(px, { solid = false } = {}) {
  const body = solid
    ? `<path d="M5 10.4 12 4.6l7 5.8V19a.9.9 0 0 1-.9.9H5.9A.9.9 0 0 1 5 19z"
             fill="currentColor" stroke="currentColor" stroke-width="1.7"
             stroke-linejoin="round"/>
       <path d="M10.1 19.9v-4.6h3.8v4.6" fill="none" stroke="var(--space, #05070c)"
             stroke-width="1.5" stroke-linejoin="round"/>`
    : `<path d="M4 11.2 12 4.4l8 6.8" fill="none"/>
       <path d="M6.4 9.6V19a.9.9 0 0 0 .9.9h9.4a.9.9 0 0 0 .9-.9V9.6" fill="none"/>
       <path d="M10.1 19.9v-4.8h3.8v4.8" fill="none"/>`;

  return `
<svg viewBox="0 0 24 24" width="${px}" height="${px}" fill="none"
     stroke="currentColor" stroke-width="1.7" stroke-linecap="round"
     stroke-linejoin="round" aria-hidden="true" focusable="false">
  ${body}
</svg>`;
}

/**
 * The off-screen pointer: a chevron aimed along the direction to home, with
 * the same house sitting inside it.
 *
 * The chevron carries DIRECTION and the house carries IDENTITY, and they have
 * to be separable — the whole assembly rotates to aim, but the house must stay
 * upright or it reads as a falling building. So the caller rotates only the
 * element carrying `.pointer-aim`; the house lives outside it.
 *
 * Returns two fragments rather than one blob for exactly that reason.
 */
export function pointerParts(boxPx) {
  /* The chevron rides just outside the disc, the house sits centred in it.
   * Both scale off the same box so tuning one size moves the whole assembly. */
  const housePx = Math.round(boxPx * 0.52);

  const ring = `
<svg class="pointer-ring" viewBox="0 0 24 24" width="${boxPx}" height="${boxPx}"
     aria-hidden="true" focusable="false">
  <circle cx="12" cy="12" r="10.4" fill="var(--glass-raised)"
          stroke="currentColor" stroke-width="1.4"/>
</svg>`;

  const chevron = `
<svg class="pointer-aim" viewBox="0 0 24 24" width="${boxPx}" height="${boxPx}"
     aria-hidden="true" focusable="false">
  <path d="M12 1.4 15.1 6.4 12 5 8.9 6.4 Z" fill="currentColor"
        stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>
</svg>`;

  return { ring, chevron, housePx };
}
