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
 * The off-screen pointer: an arrowhead with the house behind it, both sitting
 * on the imaginary line running from the house THROUGH the arrow to the real
 * home location.
 *
 * NO ENCLOSING CIRCLE. The first pass wrapped this in a ring, and on glass the
 * ring read as a separate object from the marks inside it — three elements that
 * looked scattered rather than one indicator. Without it the two marks are
 * unambiguously one thing pointing one way.
 *
 * THE GEOMETRY THAT MATTERS: the arrow is nearest home, the house sits on the
 * OPPOSITE side of the arrow from home. Read outward — house, then arrow, then
 * (off screen) home. That ordering is what makes the indicator legible without
 * a label: the house says "this is your home" and the arrow says "it is that
 * way." Reversing them would put the house between the viewer and the direction
 * it is claiming.
 *
 * Returned as SEPARATE fragments because they carry different transforms: the
 * arrow rotates to aim, the house must stay upright (a rotated house reads as a
 * falling building). The caller positions both along the axis.
 */
export function pointerParts(boxPx) {
  /* The house is the identity mark and carries most of the meaning, so it is
   * the larger of the two. The arrow only has to say "that way". */
  const housePx = Math.round(boxPx * 0.82);
  const arrowPx = Math.round(boxPx * 0.46);

  /* Arrowhead pointing UP at rest (toward -Y), so a rotation of 0 means
   * "toward the top of the screen" and the caller's atan2 needs only the
   * standard +90 degrees. Nose at the top of its own box, so rotating about
   * the box centre swings the nose around a predictable circle. */
  const arrow = `
<svg class="pointer-aim" viewBox="0 0 24 24" width="${arrowPx}" height="${arrowPx}"
     aria-hidden="true" focusable="false">
  <path d="M12 2.5 21 20.5 12 15.6 3 20.5 Z"
        fill="currentColor" stroke="currentColor" stroke-width="1.6"
        stroke-linejoin="round"/>
</svg>`;

  return { arrow, housePx, arrowPx };
}
