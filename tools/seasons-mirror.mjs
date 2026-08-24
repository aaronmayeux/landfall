#!/usr/bin/env node
/**
 * seasons-mirror.mjs — keep the CURRENT season, before it is lost.
 * SPEC-SEASONS-BUILD.md §57.3, §57.13, §57.30 step 3, §57.33, §57.34 rule 1.
 *
 * WHY THIS EXISTS AND WHY IT IS URGENT IN A WAY THE REST OF SEASONS IS NOT
 * NOAA publishes the Atlantic and East/Central Pacific record twice: as the
 * reviewed HURDAT2 file once a year, and as ATCF b-decks while a storm is
 * happening. So for those basins nothing is at risk — we mirror for freshness,
 * not for survival.
 *
 * ==> THE REST OF THE WORLD IS DIFFERENT AND IT IS BEING LOST DAILY. <== JTWC
 * products vanish from the live directory when a storm ends and their season
 * archives lag badly. Every hour this job does not run is an hour of the west
 * Pacific, Indian Ocean and southern hemisphere that no later step can recover.
 * That is the whole reason §57.30 puts the capture in step 3, ahead of any UI.
 *
 * WHAT IT WRITES, ON THE `seasons-live` BRANCH
 *
 *   btk/<year>/b<basin><nn><year>.dat   NHC's own b-decks, verbatim bytes
 *   jtwc/<year>/<product>.jsonl         one line per JTWC warning, appended
 *   state.json                          etags, for the conditional GET below
 *   manifest.json                       what happened on the last run
 *
 * A session — or Aaron on a phone — reads any of it with plain git:
 *
 *     git fetch origin seasons-live
 *     git show origin/seasons-live:manifest.json
 *     git show origin/seasons-live:btk/2026/bal022026.dat
 *
 * ==> IT IS AN APPENDING BRANCH, NOT THE `archive` BRANCH'S ROLLING WINDOW.
 * <== `archive` answers "what is the feed serving right now" and force-pushes
 * one orphan commit an hour, so it has no history and cannot. This one answers
 * "what did the season do", which is a question only history can answer, so it
 * keeps real commits. §57.34 rule 1 is what stops that growing forever: once a
 * year has graduated to a settled file the hour-by-hour provenance has expired,
 * and the branch is squashed to one commit.
 *
 * ==> CONDITIONAL GET, WHICH ALSO HANDS US THE "COMMIT ONLY ON CHANGE" RULE.
 * <== Every b-deck is requested with the ETag and Last-Modified we stored last
 * time. An unchanged file answers 304 with no body: good manners toward a
 * public service we depend on, and a straight answer to "did this change"
 * instead of something we have to diff for. §57.35 FIX 10.
 *
 * ==> AND A RUN THAT CHANGED NOTHING MUST COMMIT NOTHING. <== §57.33: off
 * season this job costs zero commits a day. An hourly commit regardless of
 * change would grow the repo forever and carry no information. The decision is
 * made HERE, not in the workflow's shell, because only this file knows whether
 * a byte actually moved.
 *
 * ==> BUT SILENCE IS NOT A STATUS (§5). <== A run that stored nothing because
 * NOAA was down must not look like a run that stored nothing because nothing
 * changed. The manifest is compared IGNORING ITS TIMESTAMP ALONE, so a source
 * flipping from ok to failing is itself a change and forces a commit. The two
 * cases therefore read differently in git log, which is the only place anyone
 * would ever look.
 *
 * ONE FILTER, IMPORTED RATHER THAN RESTATED. §57.13's storm-number bands live
 * in `lib/hurdat.js` and are used by the parser the app ships. A second copy
 * here would drift, and the drift would be invisible: both would produce a
 * plausible list. `lib/hurdat.js` has no DOM and no network, so it runs on the
 * bare runner unchanged.
 *
 * Zero dependencies. Runs on a GitHub Actions runner, which has open internet;
 * the cloud sandbox cannot reach either host.
 *
 *   node tools/seasons-mirror.mjs <branch-working-dir> <report-dir>
 *
 * Exits 0 even when a source fails — a bad upstream is news, not a broken
 * build. It exits non-zero only when it could not write its own output.
 */

import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';

import { isRealStorm, parseStormId } from '../lib/hurdat.js';

/* ---------------------------------------------------------------------------
 * WHERE THE DATA COMES FROM
 *
 * These are runner-only constants and they live here rather than in
 * `config/constants.js` on purpose. That file ships to every visitor on every
 * load (§12 — no build step, every import is downloaded), and a polling cadence
 * for a job that runs on a server is not something a phone should be paying to
 * download. It is the same call `tools/archive-fetch.mjs` already makes.
 * ------------------------------------------------------------------------- */

/** NHC's live ATCF directory. Holds the CURRENT season only, one small file
 *  per system, updated as each advisory lands. The step-0 probe measured 18
 *  `.dat` files here, 14 of them real storms. */
export const BTK_INDEX = 'https://ftp.nhc.noaa.gov/atcf/btk/';

/** OUR OWN RELAY, not JTWC directly, and that is deliberate. The relay already
 *  parses the Navy's warning text into positions, and it is the parse the app
 *  itself trusts. Reading the same route means the capture cannot disagree with
 *  what a reader saw on the day — one parser, one answer. The runner can reach
 *  our origin; a session cannot. */
export const JTWC_STORMS = 'https://landfall.getgravitate.app/api/jtwc/storms';

/** Be identifiable in their logs. Same string the relay and the archive use. */
const UA = 'Landfall/1.0 (+https://landfall.getgravitate.app)';

/** Generous. A slow government server is not a reason to throw away a run. */
const TIMEOUT_MS = 30_000;

/** Politeness between b-deck requests. Fourteen files at this pace is under
 *  six seconds, which is nothing against an hourly schedule. */
const PAUSE_MS = 400;

/* ---------------------------------------------------------------------------
 * PURE HELPERS — everything below this line is testable with no network.
 * `tools/test-seasons-mirror.mjs` drives all of them.
 * ------------------------------------------------------------------------- */

/** Every `href` in a directory listing, however it is quoted. */
export function hrefs(html) {
  return [...String(html || '').matchAll(/href\s*=\s*["']([^"']+)["']/gi)].map((m) => m[1]);
}

/**
 * A directory listing → the b-decks worth keeping, with the ones we are
 * dropping and WHY beside them.
 *
 * ==> THE FILTER IS THE POINT OF THIS FUNCTION, NOT A DETAIL OF IT. <==
 * §57.13: numbers 90-99 are invests and those numbers are REUSED several times
 * inside one season, so an unfiltered mirror stores three different systems
 * under one name and each quietly overwrites the last. 80-89 are internal test
 * systems. Neither failure announces itself — the directory looks fine, the
 * files look fine, and the season is wrong.
 *
 * The rejections are RETURNED rather than dropped, so the manifest can say
 * "18 listed, 14 kept, 4 invests" instead of just a number nobody can check.
 */
export function bdeckFiles(html) {
  const kept = [];
  const skipped = [];
  const seen = new Set();

  for (const href of hrefs(html)) {
    const file = href.split('/').pop() || '';
    const m = /^b([a-z]{2})(\d{2})(\d{4})\.dat$/i.exec(file);
    if (!m) continue;
    if (seen.has(file.toLowerCase())) continue;
    seen.add(file.toLowerCase());

    const id = `${m[1]}${m[2]}${m[3]}`.toUpperCase();
    const parsed = parseStormId(id);
    const entry = {
      file: file.toLowerCase(),
      id,
      basin: parsed?.basin ?? null,
      number: parsed?.number ?? null,
      year: parsed?.year ?? null,
    };

    if (isRealStorm(id)) kept.push(entry);
    else skipped.push({ ...entry, why: whyNotReal(entry) });
  }

  kept.sort((a, b) => a.file.localeCompare(b.file));
  skipped.sort((a, b) => a.file.localeCompare(b.file));
  return { kept, skipped };
}

/** Plain English for the manifest. An unexplained rejection is a rejection
 *  nobody will ever check. */
function whyNotReal(entry) {
  if (entry.number === null) return 'not a storm id';
  if (entry.number >= 90) return 'invest — number is reused within a season';
  if (entry.number >= 80) return 'internal test system';
  if (entry.number < 1) return 'storm number out of range';
  return 'basin is not one NHC publishes here';
}

/** `bal022026.dat` → `btk/2026/bal022026.dat`. Foldered by year so a graduated
 *  season is one directory to promote and one directory to delete. */
export function bdeckPath(file) {
  const m = /^b[a-z]{2}\d{2}(\d{4})\.dat$/i.exec(file);
  if (!m) return null;
  return `btk/${m[1]}/${file.toLowerCase()}`;
}

/**
 * `wp1726` → `{ basin: 'WP', number: 17, year: 2026 }`.
 *
 * ==> MEASURED ON REAL BYTES, NOT REMEMBERED. <== The `product` field on every
 * storm in the 2026-08-24 archived `/api/jtwc/storms` response is two basin
 * letters, a two-digit storm number and a TWO-DIGIT YEAR: `wp1726`, `wp1826`,
 * `cp0126`. The two-digit year is why this is a function rather than a slice —
 * and why a product that is not this shape returns null and is REPORTED as a
 * fault rather than guessed at. A wrong year silently files a storm under a
 * season it did not happen in, which is unrecoverable once the branch is
 * squashed.
 */
export function parseProduct(product) {
  const m = /^([a-z]{2})(\d{2})(\d{2})$/i.exec(String(product || '').trim());
  if (!m) return null;
  return {
    basin: m[1].toUpperCase(),
    number: Number(m[2]),
    year: 2000 + Number(m[3]),
  };
}

/** The line stored for one warning, and the key it is deduplicated on.
 *
 *  ==> THE WHOLE STORM OBJECT IS STORED, TRIMMED OF NOTHING. <== The temptation
 *  is to reduce it now to the handful of fields the globe draws. That decision
 *  belongs to step 13, when there is a UI to decide it against — and a field
 *  discarded here is discarded forever, because the warning it came from is
 *  gone off JTWC's server within days. Storage is cheap; a lost season is not.
 *
 *  `capturedAt` is deliberately OUTSIDE the dedupe key. The same warning read
 *  on two consecutive hours is one warning, not two. */
export function jtwcRecord(storm, capturedAt) {
  const body = { ...storm };
  delete body.capturedAt;
  const key = sha256(stableJson(body));
  return { key, line: JSON.stringify({ ...body, capturedAt, key }) };
}

/**
 * Fold this run's warnings into the lines already on the branch.
 *
 * Append-only, and the existing text is never rewritten — a file that only
 * grows at the end is a file a reader can trust, and it makes every commit's
 * diff a short list of what actually happened rather than a wall.
 */
export function mergeJsonl(existingText, incoming) {
  const lines = String(existingText || '').split('\n').filter(Boolean);
  const seen = new Set();
  for (const l of lines) {
    try { seen.add(JSON.parse(l).key); } catch { /* a bad line is kept, not dropped */ }
  }
  const added = [];
  for (const rec of incoming) {
    if (seen.has(rec.key)) continue;
    seen.add(rec.key);
    added.push(rec.line);
  }
  const out = lines.concat(added);
  return { text: out.length ? `${out.join('\n')}\n` : '', added: added.length };
}

/**
 * Did anything about the last run's OUTCOME change, ignoring only the clock?
 *
 * ==> THIS IS THE §5 GUARD, AND THE `runAt` STRIP IS THE WHOLE OF IT. <== If
 * the manifest were compared whole, every run would differ and the branch would
 * take a commit an hour forever. If it were not compared at all, a source that
 * started failing at 3am would be invisible until somebody happened to look —
 * the archive branch's own manifest exists because that silence cost real time.
 * Stripping the timestamp and nothing else means: nothing happened, no commit;
 * something broke, a commit that says so.
 */
export function manifestChanged(prev, next) {
  const strip = (m) => {
    if (!m || typeof m !== 'object') return null;
    const { runAt, ...rest } = m;
    return stableJson(rest);
  };
  return strip(prev) !== strip(next);
}

/** JSON with object keys in a fixed order, so two equal things compare equal.
 *  `JSON.stringify` preserves insertion order, and a rebuilt object can carry
 *  the same fields in a different one — which would read as a change every
 *  time and defeat the function above. */
export function stableJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableJson(value[k])}`).join(',')}}`;
}

export function sha256(text) {
  return createHash('sha256').update(String(text)).digest('hex');
}

/* ---------------------------------------------------------------------------
 * THE RUN
 * ------------------------------------------------------------------------- */

/* ==> COMPARE THE RESOLVED PATH, NOT THE FILENAME'S TAIL. <== The first
 * version of this line was `endsWith('seasons-mirror.mjs')`, which is also true
 * of `test-seasons-mirror.mjs` — so the suite started a live run against NOAA
 * the moment it imported a helper, and died on the usage message instead. */
const isMain = process.argv[1]
  && pathToFileURL(process.argv[1]).href === import.meta.url;

async function grab(url, { headers = {} } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: '*/*', ...headers },
      signal: ctrl.signal,
      redirect: 'follow',
    });
    const status = r.status;
    if (status === 304) return { ok: true, notModified: true, status };
    if (!r.ok) return { ok: false, status, reason: `HTTP ${status} ${r.statusText}` };
    const text = await r.text();
    return {
      ok: true,
      status,
      text,
      etag: r.headers.get('etag'),
      lastModified: r.headers.get('last-modified'),
    };
  } catch (e) {
    return { ok: false, status: 0, reason: String(e?.message || e) };
  } finally {
    clearTimeout(timer);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function readIf(path) {
  return existsSync(path) ? readFileSync(path, 'utf8') : null;
}

function writeIfDifferent(root, rel, text) {
  const p = join(root, rel);
  if (readIf(p) === text) return false;
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, text);
  return true;
}

/** NHC's b-decks. Conditional, paced, and every outcome recorded. */
async function mirrorBdecks(root, state) {
  const out = {
    status: 'ok', listed: 0, eligible: 0,
    stored: 0, unchanged: 0, failed: 0,
    skipped: [], files: {},
  };
  let wrote = false;

  const index = await grab(BTK_INDEX);
  if (!index.ok) {
    out.status = 'unavailable';
    out.reason = index.reason;
    return { out, wrote };
  }

  const { kept, skipped } = bdeckFiles(index.text);
  out.listed = kept.length + skipped.length;
  out.eligible = kept.length;
  out.skipped = skipped.map((s) => `${s.file} — ${s.why}`);

  for (const entry of kept) {
    const rel = bdeckPath(entry.file);
    if (!rel) continue;
    const prev = state[rel] || {};
    const headers = {};
    if (prev.etag) headers['If-None-Match'] = prev.etag;
    if (prev.lastModified) headers['If-Modified-Since'] = prev.lastModified;

    const r = await grab(BTK_INDEX + entry.file, { headers });
    await sleep(PAUSE_MS);

    if (r.ok && r.notModified) {
      out.unchanged++;
      out.files[rel] = 'unchanged (304)';
      continue;
    }
    if (!r.ok) {
      out.failed++;
      out.files[rel] = `failed — ${r.reason}`;
      continue;
    }

    /* A 200 is not proof the bytes moved: not every server sends validators,
       and the ones that do sometimes send a new one for identical content.
       Compare the content itself, or the branch takes a commit for nothing. */
    const changed = writeIfDifferent(root, rel, r.text);
    state[rel] = {
      etag: r.etag || null,
      lastModified: r.lastModified || null,
      bytes: r.text.length,
      sha256: sha256(r.text),
    };
    if (changed) {
      wrote = true;
      out.stored++;
      out.files[rel] = `stored ${r.text.length} bytes`;
    } else {
      out.unchanged++;
      out.files[rel] = 'unchanged (same bytes)';
    }
  }

  if (out.failed && !out.stored && !out.unchanged) out.status = 'unavailable';
  else if (out.failed) out.status = 'partial';
  return { out, wrote };
}

/** JTWC, through our own relay. The half of this job that is a race. */
async function mirrorJtwc(root) {
  const out = { status: 'ok', storms: 0, linesAdded: 0, files: {}, faults: [] };
  let wrote = false;

  const r = await grab(JTWC_STORMS);
  if (!r.ok) {
    out.status = 'unavailable';
    out.reason = r.reason;
    return { out, wrote };
  }

  let payload;
  try {
    payload = JSON.parse(r.text);
  } catch (e) {
    out.status = 'unavailable';
    out.reason = `unreadable JSON — ${String(e?.message || e)}`;
    return { out, wrote };
  }

  /* The relay says so itself when it could not read the Navy. An empty list
     under `state: "ok"` is a genuinely quiet ocean; an empty list under
     anything else is an outage, and storing them the same way is the exact
     confusion §5 forbids. */
  if (payload.state && payload.state !== 'ok') {
    out.status = 'unavailable';
    out.reason = `relay reported state "${payload.state}"`;
    return { out, wrote };
  }

  const storms = Array.isArray(payload.storms) ? payload.storms : [];
  out.storms = storms.length;
  const capturedAt = payload.fetchedAt || new Date().toISOString();

  const byFile = new Map();
  for (const storm of storms) {
    const p = parseProduct(storm?.product);
    if (!p) {
      out.faults.push(`storm ${storm?.designation || '?'} has no readable product id`);
      continue;
    }
    const rel = `jtwc/${p.year}/${String(storm.product).toLowerCase()}.jsonl`;
    if (!byFile.has(rel)) byFile.set(rel, []);
    byFile.get(rel).push(jtwcRecord(storm, capturedAt));
  }

  for (const [rel, records] of [...byFile.entries()].sort()) {
    const existing = readIf(join(root, rel));
    const merged = mergeJsonl(existing, records);
    if (merged.added > 0) {
      writeIfDifferent(root, rel, merged.text);
      wrote = true;
      out.linesAdded += merged.added;
      out.files[rel] = `+${merged.added}`;
    } else {
      out.files[rel] = 'already held';
    }
  }

  if (out.faults.length) out.status = 'partial';
  return { out, wrote };
}

/**
 * The commit subject line.
 *
 * ==> `git log` IS THE ONLY INTERFACE THIS BRANCH HAS. <== There is no UI over
 * it and there never will be; a session or Aaron reads it with plain git. A
 * hundred commits all saying "seasons-live 2026-08-24T15:00Z" is a hundred
 * commits nobody can navigate. Saying WHAT MOVED turns the log into the change
 * history of the season, which is the thing the branch exists to be.
 */
export function commitMessage(manifest) {
  const b = manifest.sources.btk;
  const j = manifest.sources.jtwc;
  const bits = [];
  if (b.stored) bits.push(`${b.stored} b-deck${b.stored === 1 ? '' : 's'}`);
  if (j.linesAdded) bits.push(`${j.linesAdded} JTWC warning${j.linesAdded === 1 ? '' : 's'}`);
  if (b.status !== 'ok') bits.push(`NHC ${b.status}`);
  if (j.status !== 'ok') bits.push(`JTWC ${j.status}`);
  const what = bits.length ? bits.join(', ') : 'first run';
  return `seasons-live: ${what} — ${manifest.runAt.slice(0, 16)}Z`;
}

function summary(manifest, decision) {
  const b = manifest.sources.btk;
  const j = manifest.sources.jtwc;
  /* `null` means "this section does not apply and is dropped"; an empty string
     is a real blank line and markdown needs it to start a new paragraph. The
     first version filtered both and produced a wall of run-together text. */
  const lines = [
    '# seasons-mirror',
    '',
    `Run ${manifest.runAt} — **${decision === 'commit' ? 'committing' : 'nothing changed, no commit'}**.`,
    '',
    `## NHC b-decks — ${b.status}`,
    '',
    b.reason ? `**${b.reason}**` : null,
    b.reason ? '' : null,
    `${b.listed} listed, ${b.eligible} real storms, ${b.stored} stored, ${b.unchanged} unchanged, ${b.failed} failed.`,
    '',
    b.skipped.length ? 'Dropped by the §57.13 filter:' : null,
    b.skipped.length ? '' : null,
    b.skipped.length ? b.skipped.map((s) => `- ${s}`).join('\n') : null,
    b.skipped.length ? '' : null,
    `## JTWC — ${j.status}`,
    '',
    j.reason ? `**${j.reason}**` : null,
    j.reason ? '' : null,
    `${j.storms} storms warned on, ${j.linesAdded} new warnings stored.`,
    '',
    j.faults.length ? j.faults.map((s) => `- FAULT: ${s}`).join('\n') : null,
    j.faults.length ? '' : null,
    Object.keys(j.files).length ? Object.entries(j.files).map(([k, v]) => `- \`${k}\` ${v}`).join('\n') : null,
  ];
  return lines.filter((l) => l !== null).join('\n');
}

async function main() {
  const root = process.argv[2];
  const reportDir = process.argv[3];
  if (!root || !reportDir) {
    console.error('usage: node tools/seasons-mirror.mjs <branch-working-dir> <report-dir>');
    process.exit(2);
  }
  mkdirSync(root, { recursive: true });
  mkdirSync(reportDir, { recursive: true });

  let state = {};
  try { state = JSON.parse(readIf(join(root, 'state.json')) || '{}'); } catch { state = {}; }

  const btk = await mirrorBdecks(root, state);
  const jtwc = await mirrorJtwc(root);

  const manifest = {
    runAt: new Date().toISOString(),
    sources: { btk: btk.out, jtwc: jtwc.out },
  };

  let previous = null;
  try { previous = JSON.parse(readIf(join(root, 'manifest.json')) || 'null'); } catch { previous = null; }

  const dataMoved = btk.wrote || jtwc.wrote;
  const outcomeMoved = manifestChanged(previous, manifest);
  const decision = dataMoved || outcomeMoved ? 'commit' : 'skip';

  if (decision === 'commit') {
    writeIfDifferent(root, 'state.json', `${JSON.stringify(state, null, 2)}\n`);
    writeIfDifferent(root, 'manifest.json', `${JSON.stringify(manifest, null, 2)}\n`);
    writeIfDifferent(root, 'README.md', README);
  }

  writeFileSync(join(reportDir, 'decision.txt'), decision);
  writeFileSync(join(reportDir, 'commit-message.txt'), commitMessage(manifest));
  writeFileSync(join(reportDir, 'summary.md'), `${summary(manifest, decision)}\n`);
  writeFileSync(join(reportDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

  console.log(summary(manifest, decision));
  console.log(`\ndecision: ${decision} (data moved: ${dataMoved}, outcome moved: ${outcomeMoved})`);
}

const README = `# seasons-live — the current season, captured hourly

**Data, not code. Never merge this branch into \`main\`.**

Written by \`tools/seasons-mirror.mjs\` on a GitHub Actions runner.
See \`SPEC-SEASONS-BUILD.md\` §57.30 step 3.

## What is here

| path | what it is |
|---|---|
| \`btk/<year>/\` | NHC's own ATCF b-decks, verbatim. Atlantic, East and Central Pacific |
| \`jtwc/<year>/\` | One JSON line per JTWC warning, appended. West Pacific, Indian Ocean, southern hemisphere — **and this half exists because JTWC deletes its own** |
| \`state.json\` | ETags, so unchanged files are not re-downloaded |
| \`manifest.json\` | What happened on the last run that changed anything |

## Reading it

    git fetch origin seasons-live
    git show origin/seasons-live:manifest.json
    git show origin/seasons-live:btk/2026/bal022026.dat

## Two things that will look wrong and are not

**Long gaps between commits are correct.** The job runs hourly and commits only
when a byte actually moved. Out of season that is zero commits a day.

**Invests are missing on purpose.** Storm numbers 90-99 are reused several times
inside one season and 80-89 are internal test systems, so mirroring the
directory unfiltered would store several different systems under one name.
\`manifest.json\` lists every file dropped and why.

## Retention

Once a season has graduated to a settled file, this branch's hour-by-hour
provenance has expired and the branch is squashed to a single commit —
\`SPEC-SEASONS-BUILD.md\` §57.34 rule 1. Run the workflow with \`squash\` set.
`;

if (isMain) {
  main().catch((e) => {
    console.error(`seasons-mirror failed to run: ${String(e?.stack || e)}`);
    process.exit(1);
  });
}
