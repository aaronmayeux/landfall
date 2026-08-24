/**
 * test-sepia.mjs — the guard on the archive palette and the forced mode.
 *
 * Run:  node tools/test-sepia.mjs
 *
 * ==> THE BUG THIS EXISTS TO CATCH. <==
 * `SEPIA` spreads `DARK` (see the block above it in config/tokens.js). That is
 * the right call — sepia is DARK's lighting model at a different temperature,
 * and restating eighty-five values to change their hue would be six hundred
 * lines of duplication that drifts.
 *
 * The cost of a spread is that a colour ADDED to DARK tomorrow is inherited
 * here in cyan, silently, and nobody finds out until it appears on a parchment
 * globe on somebody's phone. Nothing throws. Nothing warns. It just looks
 * wrong, in a feature nobody is currently looking at.
 *
 * So: **every DARK key holding a colour must be overridden in SEPIA**, unless
 * it is on the `SEMANTIC` list below with a reason. Adding a themed colour is
 * two edits, and this file is what makes the second one non-optional.
 *
 * The other half is the forced mode. `forceMode`/`releaseMode` exist so a view
 * can own the whole screen and give it back. The thing that must never break
 * is that the USER'S OWN preference survives the round trip — the live app
 * getting stuck in sepia is the failure mode, and it is the sort that is only
 * discovered by the person it happened to.
 *
 * Zero dependencies. Plain node.
 */

import { DARK, LIGHT, SEPIA } from '../config/tokens.js';
import {
  MODE, forceMode, forcedMode, palette, releaseMode,
  resolveMode, setThemeMode, subscribeThemeChange, themeMode, isLight,
} from '../config/theme.js';

let pass = 0;
const failures = [];
const ok = (cond, msg) => { if (cond) pass++; else failures.push(msg); };

/* --------------------------------------------------------------------------
 * 1 — EVERY COLOUR IS OVERRIDDEN
 * ----------------------------------------------------------------------- */

/** Keys that inherit DARK's value ON PURPOSE, each with the reason it is not a
 *  ground or chrome colour. If you add to this list, add the reason with it —
 *  an unexplained entry here is how the guard gets hollowed out one key at a
 *  time. */
const SEMANTIC = new Map([
  ['error',          'a status colour. A brown error message is a bug wearing a theme.'],
  ['ok',             'a status colour, same reason.'],
  ['stale',          'a status colour, same reason.'],
  ['installCta',     'the install CTA is a fixed cross-theme fill — see the note in tokens.js.'],
  ['installCtaInk',  'the label on that fill; it moves only if the fill does.'],
  ['installCtaEdge', 'the boundary of that fill; same.'],
  ['homeBandFill',   'the home band is keyed to the CTA amber and reads as the same object.'],
  ['homeBandEdge',   'same.'],
  ['glassShadow',    'a shadow is an absence of light, not a colour.'],
]);

/** Is this value a colour at all? Numbers (`fx.*`, `meshStormMix`) and the
 *  odd string that is not a colour are not the concern here. */
const isColor = (v) =>
  typeof v === 'string' && (/^#[0-9a-f]{3,8}$/i.test(v) || /^rgba?\(/i.test(v));

/** Flatten one level of nesting so `geo.trackPast` is checked by name. */
function colorLeaves(P, prefix = '') {
  const out = [];
  for (const [k, v] of Object.entries(P)) {
    if (Array.isArray(v)) {
      if (v.every(isColor)) out.push([prefix + k, v.join('|')]);
    } else if (v && typeof v === 'object') {
      out.push(...colorLeaves(v, `${prefix}${k}.`));
    } else if (isColor(v)) {
      out.push([prefix + k, v]);
    }
  }
  return out;
}

const darkColors = new Map(colorLeaves(DARK));
const sepiaColors = new Map(colorLeaves(SEPIA));

for (const [key, darkValue] of darkColors) {
  const sepiaValue = sepiaColors.get(key);
  ok(sepiaValue !== undefined,
     `SEPIA is missing the key '${key}' entirely — a spread cannot drop a key, ` +
     `so something has overwritten a nested object without spreading it`);

  const inherited = sepiaValue === darkValue;
  const allowed = SEMANTIC.has(key.split('.')[0]) || SEMANTIC.has(key);
  ok(!inherited || allowed,
     `SEPIA inherits DARK's '${key}' (${darkValue}) unchanged. That is a cool ` +
     `colour on a parchment globe. Give it a sepia value in config/tokens.js, ` +
     `or add it to SEMANTIC in this file WITH THE REASON it should not move`);
}

/* And the reverse: a SEMANTIC entry for a key that no longer exists is a
 * comment pretending to be a rule. */
for (const key of SEMANTIC.keys()) {
  ok(darkColors.has(key),
     `SEMANTIC lists '${key}' but DARK has no such colour — the exemption is stale`);
}

/* --------------------------------------------------------------------------
 * 2 — THE FIXED COLOURS ARE NOT IN ANY PALETTE
 * ----------------------------------------------------------------------- */

/* §6: the Saffir-Simpson ramp and the watch/warning colours are their own
 * exports and are never themed. This asserts nobody has "helpfully" added a
 * sepia category colour, which would break the one contract the archive globe
 * is judged against. */
for (const name of ['CATEGORY_COLOR', 'WATCH_WARNING_COLOR', 'SURGE_RAMP']) {
  ok(!(name in SEPIA),
     `SEPIA carries '${name}'. Severity colours are fixed by §6 and live outside ` +
     `every palette — a Cat 3 dot reads the same on the archive globe as on the live one`);
}

/* --------------------------------------------------------------------------
 * 3 — SEPIA CANNOT BE REACHED BY A PREFERENCE
 * ----------------------------------------------------------------------- */

for (const pref of ['sepia', 'auto', 'dark', 'light', 'nonsense', undefined, null]) {
  for (const prefersLight of [true, false]) {
    const m = resolveMode(pref, prefersLight);
    ok(m === MODE.DARK || m === MODE.LIGHT,
       `resolveMode(${JSON.stringify(pref)}, ${prefersLight}) returned '${m}' — ` +
       `a stored preference must never resolve to a forced-only mode`);
  }
}

setThemeMode(MODE.DARK);
ok(setThemeMode(MODE.SEPIA) === false,
   'setThemeMode accepted sepia. A settings write must not be able to land the ' +
   'live app on the archive palette');
ok(themeMode() === MODE.DARK, 'setThemeMode(sepia) moved the palette anyway');

/* --------------------------------------------------------------------------
 * 4 — THE ROUND TRIP. This is the one that protects the user.
 * ----------------------------------------------------------------------- */

for (const start of [MODE.DARK, MODE.LIGHT]) {
  setThemeMode(start);
  ok(themeMode() === start, `could not set up the ${start} case`);

  ok(forceMode(MODE.SEPIA) === true, `${start}: forceMode(sepia) reported no change`);
  ok(themeMode() === MODE.SEPIA, `${start}: forceMode did not move the palette`);
  ok(palette() === SEPIA, `${start}: palette() is not SEPIA while sepia is forced`);
  ok(forcedMode() === MODE.SEPIA, `${start}: forcedMode() does not report sepia`);
  ok(isLight() === false,
     `${start}: isLight() is true in sepia. Sepia is a dark-ground palette and ` +
     `every caller of isLight() is asking whether the ground is pale`);

  ok(releaseMode() === true, `${start}: releaseMode reported no change`);
  ok(themeMode() === start,
     `${start}: releaseMode restored '${themeMode()}' instead. THIS IS THE BUG ` +
     `THAT LEAVES SOMEBODY IN SEPIA ON THE LIVE GLOBE`);
  ok(palette() === (start === MODE.LIGHT ? LIGHT : DARK),
     `${start}: the palette did not come back with the mode`);
  ok(forcedMode() === null, `${start}: forcedMode() still reports a forced mode`);
}

/* Releasing when nothing is forced is a no-op, not a throw. A view's teardown
 * runs on error routes too. */
setThemeMode(MODE.DARK);
ok(releaseMode() === false, 'releaseMode with nothing forced reported a change');
ok(themeMode() === MODE.DARK, 'releaseMode with nothing forced moved the palette');

/* --------------------------------------------------------------------------
 * 5 — A SETTINGS WRITE WHILE FORCED IS REMEMBERED, NOT APPLIED
 * ----------------------------------------------------------------------- */

/* `createThemeSwitch`'s apply() runs on EVERY settings change, not just a
 * theme one. Without the guard in setThemeMode, changing the units while
 * Seasons is open would drop the archive globe back to the live palette. */
setThemeMode(MODE.DARK);
forceMode(MODE.SEPIA);
ok(setThemeMode(MODE.LIGHT) === false,
   'a settings write while sepia was forced reported a change');
ok(themeMode() === MODE.SEPIA,
   'a settings write while sepia was forced repainted the archive globe in the live palette');
releaseMode();
ok(themeMode() === MODE.LIGHT,
   'the settings write made while forced was LOST on release — the user changed ' +
   'their theme inside Seasons and came out on the old one');

/* --------------------------------------------------------------------------
 * 6 — SUBSCRIBERS HEAR BOTH ENDS
 * ----------------------------------------------------------------------- */

setThemeMode(MODE.DARK);
const heard = [];
const off = subscribeThemeChange((P, m) => heard.push(m));
forceMode(MODE.SEPIA);
releaseMode();
off();
ok(heard.join(',') === 'sepia,dark',
   `subscribers heard [${heard.join(', ')}] rather than sepia then dark — a surface ` +
   `that repaints on theme change would be left painted in the wrong world`);

/* A subscriber that throws must not stop the others. Same contract
 * setThemeMode has always kept; forceMode/releaseMode go through the same
 * announce(), and this proves it rather than assuming it. */
setThemeMode(MODE.DARK);
const after = [];
const offBad = subscribeThemeChange(() => { throw new Error('deliberate'); });
const offGood = subscribeThemeChange((P, m) => after.push(m));
forceMode(MODE.SEPIA);
offBad(); offGood(); releaseMode();
ok(after.join(',') === 'sepia',
   'a throwing subscriber stopped the ones after it from repainting');

/* ------------------------------------------------------------------------- */
console.log('');
for (const f of failures) console.log(`  ✗ ${f}`);
console.log(failures.length ? `\n  ${pass} passed, ${failures.length} failed`
                            : `\n✓ ${pass} assertions passed`);
console.log('  (whether the sepia values are RIGHT is glass — this is that they exist)');
process.exit(failures.length ? 1 : 0);
