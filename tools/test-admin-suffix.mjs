#!/usr/bin/env node
/**
 * test-admin-suffix.mjs — state names lose their administrative noun and
 * NOTHING ELSE (SPEC-MAP §11.2).
 *
 * ===========================================================================
 * WHY THIS FILE EXISTS
 * ===========================================================================
 *
 * OpenMapTiles' English names carry a trailing administrative word across much
 * of Asia — "Shimane Prefecture", "Jilin Province", "Gangwon State" — and at
 * the state label's type size that wraps to two lines to say what the map has
 * already said. `withoutAdminSuffix` in `map/style.js` strips it, as a
 * MapLibre expression evaluated once per label per tile.
 *
 * ==> THE `> 0` GUARD INSIDE IT IS LOAD BEARING AND WAS UNTESTED. <== The
 * end-of-string test is `index-of === length - suffixLength`, and `index-of`
 * returns **-1** when the suffix is absent. For a name exactly one character
 * SHORTER than the suffix that difference is ALSO -1, the test passes on a
 * word that never contained the suffix, and `slice(0, -1)` quietly eats the
 * last letter. TEXAS renders as TEXA.
 *
 * `tools/test-world-basemap.mjs` used to pin this. It was deleted with the
 * three-globe cut on 2026-08-08 — the suite went with the feature it was named
 * after, taking an assertion about SHIPPED behaviour with it. This is that
 * assertion's new home, in a file that is not about worlds.
 *
 * ===========================================================================
 * THE SPEC UNDERSTATED THIS IN ONE DIRECTION AND OVERSTATED IT IN ANOTHER
 * ===========================================================================
 *
 * Both §11.2 and the code comment said the bug turned "IOWA into IOW". It
 * cannot: IOWA is four characters, " State" is six, and -1 is not -2. Only a
 * name of exactly FIVE characters is at risk from " State".
 *
 * The real blast radius is much wider, because there are three suffixes of
 * three different lengths and each one endangers a different name length:
 *
 *     " State"       6 chars  ->  every 5-character name   TEXAS  -> TEXA
 *     " Province"    9 chars  ->  every 8-character name   Michigan -> Michiga
 *     " Prefecture" 11 chars  ->  every 10-character name  Washington -> Washingto
 *
 * All three are driven below. A test that only knew about TEXAS would pass on
 * a guard that had been removed from two clauses out of three.
 *
 * ===========================================================================
 * IT DRIVES THE REAL EXPRESSION, NOT A COPY OF THE RULE
 * ===========================================================================
 *
 * `withoutAdminSuffix` is not exported and should not be — it is an
 * implementation detail of one layer. So this pulls the `text-field` straight
 * out of the style `buildStyle()` actually generates and evaluates it. A
 * reimplementation of the rule in JavaScript would be a second copy free to
 * agree with itself while the shipped expression drifted, which is the exact
 * shape of a test that passes on the same wrong assumption as the bug.
 *
 * The evaluator below covers only the dozen operators this one expression
 * uses. It is not a MapLibre implementation and must not grow into one — if a
 * future edit reaches for an operator it does not know, it throws by design
 * rather than quietly returning undefined.
 *
 * WHAT THIS CANNOT PROVE: that MapLibre itself agrees, or that the label is
 * legible. Those are the style spec and glass.
 *
 * Zero dependencies. `node tools/test-admin-suffix.mjs`.
 */

import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
process.chdir(ROOT);

const { buildStyle } = await import('../map/style.js');

let pass = 0;
const failures = [];
const ok = (cond, msg) => { if (cond) pass++; else failures.push(msg); };
const eq = (got, want, msg) =>
  ok(got === want, `${msg} — got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`);

/* ---------------------------------------------------------------------------
 * A MINIMAL EXPRESSION EVALUATOR
 *
 * Deliberately small and deliberately loud. `let`/`var` scoping is the one
 * part worth reading carefully: the expression binds the name ONCE and reads
 * the variable a dozen times, which is why it is built that way, so the
 * evaluator has to carry a scope rather than substituting.
 * ------------------------------------------------------------------------- */
function evaluate(expr, props, scope = new Map()) {
  if (!Array.isArray(expr)) return expr;
  const [op, ...args] = expr;
  const ev = (e) => evaluate(e, props, scope);

  switch (op) {
    case 'literal': return args[0];
    case 'get': return Object.prototype.hasOwnProperty.call(props, args[0]) ? props[args[0]] : null;
    case 'var': {
      if (!scope.has(args[0])) throw new Error(`unbound var ${args[0]}`);
      return scope.get(args[0]);
    }
    case 'let': {
      const inner = new Map(scope);
      /* Bindings come in name/value pairs, with the body last. */
      let i = 0;
      for (; i + 1 < args.length - 1; i += 2) inner.set(args[i], evaluate(args[i + 1], props, inner));
      return evaluate(args[args.length - 1], props, inner);
    }
    case 'coalesce': {
      for (const a of args) {
        const v = ev(a);
        if (v !== null && v !== undefined) return v;
      }
      return null;
    }
    case 'case': {
      for (let i = 0; i + 1 < args.length; i += 2) if (ev(args[i])) return ev(args[i + 1]);
      return ev(args[args.length - 1]);
    }
    case 'all': return args.every((a) => ev(a));
    case 'in': {
      const needle = ev(args[0]);
      const hay = ev(args[1]);
      return Array.isArray(hay) ? hay.includes(needle) : String(hay).includes(needle);
    }
    case 'index-of': return String(ev(args[1])).indexOf(String(ev(args[0])));
    case 'slice': {
      const s = ev(args[0]);
      return String(s).slice(ev(args[1]), args.length > 2 ? ev(args[2]) : undefined);
    }
    case 'length': return String(ev(args[0])).length;
    case '-': return ev(args[0]) - ev(args[1]);
    case '>': return ev(args[0]) > ev(args[1]);
    case '==': return ev(args[0]) === ev(args[1]);
    default:
      throw new Error(`test-admin-suffix: unhandled operator "${op}" — this evaluator `
        + 'covers only what the state-name expression uses, on purpose. Extend it '
        + 'consciously or the assertions below stop meaning anything.');
  }
}

/* ---------------------------------------------------------------------------
 * THE REAL EXPRESSION, OUT OF THE REAL STYLE
 * ------------------------------------------------------------------------- */
const style = buildStyle();
const layer = style.layers.find((l) => l.id === 'place-state');
ok(!!layer, 'the state-name layer `place-state` is in the generated style');

const field = layer?.layout?.['text-field'];
ok(Array.isArray(field) && field[0] === 'let',
  'its text-field is the bound-once suffix expression, not a bare name field — '
  + 'if this changed shape the assertions below are testing something else');

/** The name as it would be rendered, before `text-transform: uppercase`. */
const label = (name) => evaluate(field, name === null ? {} : { 'name:en': name });

/* ---- the guard, by every name length it protects ------------------------ */

/* ==> THE THREE THAT BREAK WITHOUT IT. <== One per suffix length, because a
 * guard removed from one clause and left in the other two is a real edit and
 * a single example would sail past it. */
eq(label('Texas'), 'Texas',
  'TEXAS keeps its S — " State" is 6 characters and `index-of` returns -1 on a '
  + '5-character name, which equals 5 - 6, so the end-of-string test passes on a '
  + 'word that never contained the suffix');
eq(label('Michigan'), 'Michigan',
  'Michigan keeps its N — the same arithmetic with " Province" (9) endangers '
  + 'every 8-character name');
eq(label('Washington'), 'Washington',
  'Washington keeps its N — and with " Prefecture" (11) it is every '
  + '10-character name');

/* Neighbouring lengths, so a guard rewritten as `>= 0` or `!= -1` is not
 * mistaken for a correct one by a suite that only ever tries the exact
 * off-by-one case. */
for (const name of ['Ohio', 'Utah', 'Maine', 'Nevada', 'Kentucky', 'California']) {
  eq(label(name), name, `${name} is returned untouched — it contains no admin suffix`);
}

/* ---- and it still does the job it exists for ---------------------------- */
eq(label('Shimane Prefecture'), 'Shimane', 'a real Prefecture is stripped');
eq(label('Jilin Province'), 'Jilin', 'a real Province is stripped');
eq(label('Gangwon State'), 'Gangwon', 'a real State is stripped');

/* ---- the two words deliberately left alone ------------------------------ */
eq(label('Northern Territory'), 'Northern Territory',
  'Territory is NOT stripped — "Northern" is not a place');
eq(label('Brussels Capital Region'), 'Brussels Capital Region',
  'Region is NOT stripped, for the same reason');

/* ---- the exceptions list ------------------------------------------------ */
eq(label('Free State'), 'Free State',
  "South Africa's Free State keeps its suffix — the suffix IS the name, and it "
  + 'would otherwise render as FREE');

/* ---- the suffix must be TRAILING, never anywhere ------------------------- */
eq(label('State College'), 'State College',
  'a name merely CONTAINING the word is untouched — the rule is a trailing '
  + 'word, and `index-of` alone would find it anywhere');

/* ---- the nameless feature ----------------------------------------------- */
/* A feature with no name in any of the three fields binds null, and `length`
 * on null is a hard expression error that takes the WHOLE LAYER down — not a
 * blank label, no state names anywhere on the map. That is what the
 * `coalesce ... ''` at the top of the expression is for. */
eq(label(null), '',
  'a feature with no name at all resolves to an empty string rather than '
  + 'erroring the layer out of existence');

/* ------------------------------------------------------------------------- */
console.log('');
for (const f of failures) console.log(`  ✗ ${f}`);
console.log(
  failures.length
    ? `\n  ${pass} passed, ${failures.length} failed`
    : `\n✓ ${pass} assertions passed — the state-name suffix trim, driven through `
      + 'the expression the app actually ships'
);
process.exit(failures.length ? 1 : 0);
