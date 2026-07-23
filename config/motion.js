/**
 * motion.js — every duration and easing in Landfall.
 *
 * No `300ms` literals scattered around the codebase. One file, one edit.
 *
 * Overriding rule (SPEC lens 4): this is a globe on a phone. ANIMATE TRANSFORM
 * AND OPACITY ONLY. Anything that animates width, height, top, left, or
 * filter triggers layout or paint on every frame and will drop frames on a
 * mid-range Android while MapLibre is already using the GPU.
 *
 * Imports nothing. Ever.
 */

/* ---------------------------------------------------------------------------
 * EASING
 *
 * Named by intent, not by curve. Feature code asks for EASE.settle, not for
 * a cubic-bezier string it would have to understand.
 * ------------------------------------------------------------------------- */

export const EASE = Object.freeze({
  /** Decelerate into rest. The default for anything arriving. */
  settle: 'cubic-bezier(0.16, 1, 0.3, 1)',

  /** Accelerate away. For anything leaving — exits should feel quicker than
   *  entrances or the UI feels sticky. */
  exit: 'cubic-bezier(0.55, 0, 1, 0.45)',

  /** Symmetric. For state changes that aren't arrivals or departures —
   *  a toggle flipping, a swatch changing. */
  swap: 'cubic-bezier(0.4, 0, 0.2, 1)',

  /** Near-linear with a soft end. For long camera moves, where an aggressive
   *  ease-out makes the globe feel like it's braking. */
  camera: 'cubic-bezier(0.25, 0.1, 0.25, 1)',
});

/* ---------------------------------------------------------------------------
 * DURATIONS (ms)
 *
 * Three tiers. Anything that doesn't fit one of them is probably wrong.
 * ------------------------------------------------------------------------- */

export const DURATION = Object.freeze({
  /** Immediate feedback — a press state, a focus ring, a swatch. Fast enough
   *  to feel instant but not so fast it flickers. */
  instant: 90,

  /** Standard UI transition — panel enter/exit, layer fade, row expand. */
  base: 240,

  /** Deliberate — something big moving. Panel dock change on resize. */
  slow: 420,

  /** Camera flyTo on storm selection. Long enough to read as travel across a
   *  globe rather than a cut; short enough that you aren't waiting.
   *  Panel opens and camera flies TOGETHER on this same value — sequential
   *  reads as lag. */
  flyTo: 1400,
});

/* ---------------------------------------------------------------------------
 * OPENING SEQUENCE (SPEC §9)
 *
 * The globe arrives from a distance and rotates into its resting position.
 * This is the first thing anyone sees, and it delays time-to-first-paint —
 * the Phase 1 baseline — so it is deliberately short.
 *
 * Zoom-in and rotation run TOGETHER, not in sequence. One continuous move,
 * half the wall-clock time.
 *
 * CAMERA-ONLY. The intro runs while tiles are still streaming. No layer work,
 * no label solving during the fly. Labels appear at rest.
 * ------------------------------------------------------------------------- */

export const INTRO = Object.freeze({
  /** ~3.5 s total, ease-out — fast at the start, settling gently into the
   *  idle drift. */
  duration: 3500,

  /** Storm dots fade in during the LAST THIRD. The answer to "is anything out
   *  there" arrives before the intro does. Derived, not hand-set: change
   *  `duration` and this moves with it. */
  get stormFadeStart() {
    return this.duration * (2 / 3);
  },
  get stormFadeDuration() {
    return this.duration / 3;
  },

  /** Degrees of rotation traveled during the arrival. Enough to read as a
   *  turning planet, not so much that it spins. */
  rotateDeg: 62,

  /** Skipped entirely on warm loads. Someone checking twice during a landfall
   *  must not sit through it twice. */
  warmLoadWindow: 30 * 60 * 1000, // 30 min
});

/* ---------------------------------------------------------------------------
 * REDUCE MOTION
 *
 * Not a separate code path — a multiplier and a set of flags, so feature code
 * never branches on a media query.
 *
 * Under reduce-motion: the intro is SKIPPED entirely, idle rotation is
 * DISABLED, and everything else collapses to near-instant rather than
 * disappearing. A transition of 0 makes state changes hard to follow.
 * ------------------------------------------------------------------------- */

export const REDUCED = Object.freeze({
  durationScale: 0.01,
  skipIntro: true,
  disableIdleRotate: true,
  /** flyTo becomes an instant jumpTo — a 1.4 s camera move is exactly the
   *  kind of thing reduce-motion exists to prevent. */
  instantCamera: true,
});

/** Reads the OS preference. Live-updating: someone can change it in Settings
 *  without reloading, and the app should respect that immediately. */
export const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  window.matchMedia &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Scale any duration by the current motion preference.
 *  Every animation in the app runs its duration through this. */
export const scaled = (ms) => (prefersReducedMotion() ? ms * REDUCED.durationScale : ms);
