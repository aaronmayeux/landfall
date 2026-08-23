/**
 * test-flood-alert.mjs — the on-demand single-alert route. §56.6.
 *
 * ==> IT RUNS OVER REAL NWS BYTES AND NOT A FIXTURE ANYBODY WROTE. <==
 * `samples/flood/alert-one.json` and `alert-one-watch.json` are two genuine
 * alerts lifted off the archive branch: a Flash Flood Warning from NWS Grand
 * Junction CO and a Flood Watch from NWS Honolulu HI. §56's rule is to read the
 * real payload rather than build against a guessed shape, and the wrapping this
 * file's main assertion is about is a property of NWS's actual teletype output
 * that nobody would think to invent.
 *
 * A Pages Function is not reachable from the sandbox and neither is its
 * upstream, so `projectAlert` and `unwrapNws` — both pure — are the whole of
 * what a test can stand on here.
 */

import path from 'node:path';
import { readFileSync } from 'node:fs';

const ROOT = path.resolve(import.meta.dirname, '..');

let pass = 0;
const failures = [];
const ok = (cond, label) => {
  if (cond) { pass++; console.log(`  ✓ ${label}`); }
  else { failures.push(label); console.log(`  ✗ ${label}`); }
};
const section = (s) => console.log(`\n  ${s}\n`);

const { projectAlert, unwrapNws } = await import('../functions/api/nws/alert.js');
const { floodAlertPulls, loadFloodAlertText, resetFloodAlertText } =
  await import('../data/flood-alert.js');

const load = (f) =>
  JSON.parse(readFileSync(path.join(ROOT, 'samples/flood', f), 'utf8'));

const WARNING = load('alert-one.json');
const WATCH = load('alert-one-watch.json');

/* --------------------------------------------------------------------- */
section('§56.6 — the projection, on real bytes');

const w = projectAlert(WARNING);
ok(w.status === 'ok', 'a real warning projects');
ok(typeof w.instruction === 'string' && w.instruction.length > 0,
  'and it carries the instruction, which is the field this route exists for');
ok(/life threatening/i.test(w.instruction),
  'the actionable sentence survives verbatim — "life threatening" is in it');
ok(w.senderName === 'NWS Grand Junction CO',
  `the issuing office comes through — ${w.senderName}`);

const wa = projectAlert(WATCH);
ok(wa.senderName === 'NWS Honolulu HI', `and on the watch too — ${wa.senderName}`);
ok(/monitor later forecasts/i.test(wa.instruction || ''),
  'a watch carries its own, quieter instruction');

/* ==> NOT ONE WORD IS SUMMARISED OR REPHRASED. <== §5's rule carried into
 * prose: a paraphrase of a hazard instruction is an instruction this app wrote.
 * Whitespace is the only thing `unwrapNws` may touch, so every non-whitespace
 * character of the original has to survive in order.
 * MUTATION-VERIFIED: truncate or re-word anything in `unwrapNws` and this
 * fails. */
const strip = (t) => String(t).replace(/\s+/g, '');
for (const [name, src] of [['warning', WARNING], ['watch', WATCH]]) {
  const p = projectAlert(src);
  const orig = src.properties;
  ok(strip(p.description) === strip(orig.description),
    `the ${name}'s description keeps every character — only whitespace changed`);
  ok(strip(p.instruction) === strip(orig.instruction),
    `and so does its instruction`);
}

/* --------------------------------------------------------------------- */
section('§56.6 — unwrapping the teletype');

/* NWS wraps to about 66 columns for teletype, so a single newline is a WRAP
 * and a blank line is a real paragraph break. Rendered raw into a phone-width
 * panel the text comes out ragged, with breaks mid-sentence that look like the
 * app is broken. */
const wrapped = 'The National Weather Service in Grand Junction has\nissued a Flash Flood Warning for\nCentral Rio Blanco County.\n\nThis is a second paragraph.';
const un = unwrapNws(wrapped);
ok(!/has\nissued/.test(un), 'a mid-sentence wrap is joined back up');
ok(un.includes('has issued a Flash Flood Warning'),
  'and the sentence reads as one line again');
ok(un.split(/\n\n/).length === 2, 'while a blank line stays a paragraph break');

/* ==> THE BULLET LINES ARE LEFT ALONE. <== `* Until 9:15 PM MDT` is a list NWS
 * formatted on purpose, and joining those wraps would run the list into one
 * paragraph. MUTATION-VERIFIED: drop the bullet test and this fails.
 * (The pattern is not written out here: a caret-backslash-star-slash inside a
 * block comment closes it early, which is exactly how this line first broke.) */
const bullets = '* Until 915 PM MDT\n* Flash Flooding caused by heavy rain\n* Some locations that will\nexperience flooding include...';
const ub = unwrapNws(bullets);
ok(ub.split('\n').length === 3,
  'three bullets stay three lines, and the wrap inside the third is joined');
ok(ub.includes('that will experience flooding'),
  'the continuation line folds into its own bullet, not into the next one');

ok(unwrapNws(null) === null, 'no text is null rather than an empty string');
ok(unwrapNws('') === null, 'and so is an empty one');
ok(unwrapNws('   \n\n  ') === null, 'and so is whitespace pretending to be text');

/* A product with no instruction is a real shape, not an error. */
const noInstr = projectAlert({ properties: { id: 'x', description: 'Only this.' } });
ok(noInstr.instruction === null && noInstr.description === 'Only this.',
  'an alert with no instruction projects null rather than throwing');

/* --------------------------------------------------------------------- */
section('§56.6 — the client memo');

/* ==> THE MEMO IS COUNTED, BECAUSE THE OBVIOUS TEST OF ONE CANNOT FAIL. <==
 * Asserting that two calls return the same text passes with the memo deleted,
 * since a second fetch returns the same bytes. §12's rule. */
{
  resetFloodAlertText();
  let served = 0;
  globalThis.fetch = async () => {
    served++;
    return {
      ok: true, status: 200,
      json: async () => ({ status: 'ok', description: 'D', instruction: 'I', senderName: 'NWS X' }),
    };
  };

  const ID = 'urn:oid:2.49.0.1.840.0.aaaa.001.1';
  const a = await loadFloodAlertText(ID);
  const b = await loadFloodAlertText(ID);
  ok(a.instruction === 'I' && b.instruction === 'I', 'the text comes back');
  ok(floodAlertPulls() === 1,
    'and a second open of the same alert costs no second request');

  /* Two taps on the same chip before the first answer lands must not fire
   * two requests — the PROMISE goes in the memo, not just the result. */
  resetFloodAlertText();
  served = 0;
  const [p1, p2] = [loadFloodAlertText(ID), loadFloodAlertText(ID)];
  await Promise.all([p1, p2]);
  ok(floodAlertPulls() === 1,
    'and two taps before the first answer lands still make one request');
}

/* ==> A FAILURE IS NOT MEMOIZED, OR THE RETRY BUTTON DOES NOTHING WHILE
 * LOOKING LIKE IT WORKED. <== MUTATION-VERIFIED: delete the `memo.delete` on
 * the unavailable branch and this goes red. */
{
  resetFloodAlertText();
  let attempt = 0;
  globalThis.fetch = async () => {
    attempt++;
    if (attempt === 1) throw new Error('network down');
    return {
      ok: true, status: 200,
      json: async () => ({ status: 'ok', description: 'D', instruction: 'I' }),
    };
  };

  const ID = 'urn:oid:2.49.0.1.840.0.bbbb.001.1';
  const bad = await loadFloodAlertText(ID);
  ok(bad.status === 'unavailable', 'a dead network answers unavailable, never empty text');
  const good = await loadFloodAlertText(ID);
  ok(good.status === 'ok', 'and asking again genuinely goes back to the network');
}

/* ==> A 404 IS `gone`, NOT `unavailable`, AND THE DIFFERENCE IS A RETRY
 * BUTTON. <== NWS drops an alert from its store a while after it expires. That
 * is a durable fact about the alert; pressing again cannot change it. */
{
  resetFloodAlertText();
  globalThis.fetch = async () => ({ ok: false, status: 404, json: async () => ({}) });
  const gone = await loadFloodAlertText('urn:oid:2.49.0.1.840.0.cccc.001.1');
  ok(gone.status === 'gone',
    'an alert NWS no longer holds is `gone` rather than an outage');
}

/* --------------------------------------------------------------------- */
section('§56.6 — the id is validated before it reaches a URL');

/* ==> THIS IS THE ONLY ROUTE IN THE APP THAT BUILDS AN UPSTREAM URL OUT OF
 * SOMETHING THE CLIENT SENT. <== An unchecked id is a request forgery: the
 * function would fetch whatever the caller named, with our User-Agent, from
 * inside Cloudflare's network. The pattern is read out of the route file
 * itself rather than re-declared here, because a copy would drift. */
const routeSrc = readFileSync(
  path.join(ROOT, 'functions/api/nws/alert.js'), 'utf8');
const m = routeSrc.match(/const CAP_URN = (\/.+\/);/);
ok(!!m, 'the route declares a CAP_URN pattern');
const CAP_URN = m ? eval(m[1]) : /$^/;

ok(CAP_URN.test(WARNING.properties.id),
  'a real archived CAP URN passes');
ok(CAP_URN.test(WATCH.properties.id),
  'and so does the watch’s');

for (const bad of [
  'https://evil.example/x',
  '../../etc/passwd',
  'urn:oid:2.49.0.1.840.0.aa.1.1?x=https://evil.example',
  'https://evil.example/?ok=urn:oid:2.49.0.1.840.0.aaaaaaaa.001.1',
  'urn:oid:2.49.0.1.840.0.aaaaaaaa.001.1 https://evil.example',
  'urn:oid:2.49.0.0.999.0.aaaaaaaa.001.1',
  '',
]) {
  ok(!CAP_URN.test(bad), `refused: ${bad.slice(0, 46) || '(empty)'}`);
}

/* ==> THE ANCHORS ARE THE WHOLE DEFENCE, SO THEY ARE ASSERTED DIRECTLY. <==
 * MUTATION-VERIFIED: drop either `^` or `$` from the route's pattern and the
 * embedded-URL cases above go green, which is exactly the bug. */
ok(routeSrc.includes('^urn:oid:') && /\$\/;?\s*$/m.test(m?.[1] || ''),
  'and the pattern is anchored at both ends');

/* --------------------------------------------------------------------- */
if (failures.length) {
  console.log(`\n✗ ${failures.length} failed:`);
  for (const f of failures) console.log(`   - ${f}`);
  process.exit(1);
}
console.log(`\n✓ ${pass} assertions passed`);
