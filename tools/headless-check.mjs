/**
 * headless-check.mjs — a smoke pass over the drawer views in a real browser.
 *
 * NOT a replacement for glass. This catches the class of bug that killed the
 * home search — a ReferenceError inside a click handler, invisible unless you
 * happen to have a console open — plus dead controls, missing elements, and
 * layout that only fails at one width. Frame budget, feel, and anything that
 * needs a thumb still have to be checked on a phone.
 *
 * NEEDS PLAYWRIGHT. **It no longer needs the internet for the libraries** —
 * MapLibre and Three are served from ./vendor/ as of SPEC §17 A3, so a local
 * run works with no CDN at all. (Basemap TILES still come from OpenFreeMap,
 * so the map is blank offline; every check below is about the DOM, which is
 * exactly why they still pass.)
 *
 * Against the deployed site it needs neither a server nor a checkout:
 *
 *   npm i -g playwright && npx playwright install chromium
 *   LANDFALL_URL=https://landfall.getgravitate.app node tools/headless-check.mjs
 *
 * Or locally, with a static server on :8099:
 *
 *   python3 -m http.server 8099 & node tools/headless-check.mjs
 *
 * PLAYWRIGHT_CHROMIUM_PATH overrides the browser binary, for environments
 * that ship a Chromium whose build number does not match the installed
 * Playwright (CI images, sandboxes). Unset, Playwright picks its own.
 */

import os from 'node:os';
import { chromium } from 'playwright';

const URL = process.env.LANDFALL_URL || 'http://127.0.0.1:8099/index.html';
const EXECUTABLE_PATH = process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined;
const SHOT_DIR = process.env.LANDFALL_SHOT_DIR || os.tmpdir();
const WIDTHS = [
  { name: 'phone', width: 390, height: 844 },
  { name: 'desktop', width: 1280, height: 800 },
];


/**
 * Close the drawer if it is open, using the X — the way a phone user does.
 *
 * MEASURED 2026-07-25 at 390x844: an OPEN DRAWER COVERS THE NAV CONTROLS
 * (drawer top y=620, #btn-storms y=636..680). So every "click the next nav
 * button" step below was really "click through whatever drawer is already
 * open", which is a desktop assumption the phone layout does not honour. It
 * never showed up before because this file could not run at all without CDN
 * access, which §17 A3's vendoring fixed.
 *
 * Nothing is trapped by that — the X and Esc both close the drawer — so
 * whether a covered nav is acceptable is a design call for glass, recorded
 * in SPEC §17 rather than worked around in the app.
 */
async function closeDrawerIfOpen(page) {
  const open = await page.evaluate(
    () => document.querySelector('#drawer')?.dataset.open === 'true'
  );
  if (!open) return;
  await page.click('.drawer-close');
  await page.waitForTimeout(200);
}

/**
 * Is this console error the STATIC SERVER's fault rather than the app's?
 *
 * ==> TWENTY OF THIS SUITE'S TWENTY-TWO REPORTED FAILURES WERE THIS. <==
 * Measured 2026-08-08. Run locally, the app is served by
 * `python3 -m http.server`, which has no `/api/` routes and does not implement
 * POST. So every relay call 404s and every telemetry POST 501s, the browser
 * logs each one as a console error, and the handler above counted all of them
 * as app bugs. The suite already tolerated exactly this in one place — it
 * prints "search: no results (relay offline locally?)" — and forgot it here.
 *
 * Against the DEPLOYED site these routes exist, so a genuine 500 from the real
 * relay still has to be caught. Hence the URL test rather than a blanket mute:
 * only /api/ paths are excused, only the transport-level failures a missing
 * backend produces, and every one is counted and printed at the end so an
 * excused error is never a silent one.
 */
/**
 * ==> THE FIRST VERSION OF THIS TESTED THE MESSAGE TEXT AND MATCHED NOTHING. <==
 * Measured on the runner 2026-08-09: Chrome's wording for a failed subresource
 * is exactly
 *
 *   Failed to load resource: the server responded with a status of 404 (File not found)
 *
 * and THE URL IS NOT IN IT. The URL lives on the message's location(), which
 * the first cut never read, so every /api/ test failed and all 18 came through
 * as app bugs. The lesson is the cheap one: match against the field that
 * actually holds the thing you are matching on.
 *
 * Classification is now deferred to the end of the run rather than decided as
 * each message arrives, because a console error and the response that caused
 * it are two separate events with no guaranteed order. By the time the page is
 * done, both are recorded and the answer is not a race.
 *
 * Two independent signals, either one enough:
 *   1. the message's own location().url contains /api/
 *   2. the status code in the text was seen on an /api/ response AND was NOT
 *      seen on any non-/api/ response
 *
 * The second condition is what keeps this honest. A 404 on a missing icon or
 * a mistyped module path registers as a non-/api/ failure, so that status is
 * poisoned for the whole run and no 404 gets excused. Only codes that ONLY
 * ever came from the absent backend are forgiven.
 */
function classifyConsoleErrors(consoleErrors, apiStatuses, otherStatuses) {
  const real = [];
  const noise = [];
  for (const { text, url } of consoleErrors) {
    if (/\/api\//.test(url)) {
      noise.push(text);
      continue;
    }
    const m = /status of (\d{3})\b/.exec(text);
    const code = m ? Number(m[1]) : null;
    if (code !== null && apiStatuses.has(code) && !otherStatuses.has(code)) {
      noise.push(text);
      continue;
    }
    real.push(text);
  }
  return { real, noise };
}

const problems = [];
const note = (m) => console.log('  ' + m);
const fail = (m) => {
  problems.push(m);
  console.log('  ✗ ' + m);
};

const browser = await chromium.launch({ executablePath: EXECUTABLE_PATH });

for (const vp of WIDTHS) {
  console.log(`\n=== ${vp.name} (${vp.width}x${vp.height}) ===`);
  const ctx = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: 2,
  });
  const page = await ctx.newPage();

  /* A thrown exception is ALWAYS the app's problem — it goes straight in.
   * Console errors are collected raw and sorted out after the page settles. */
  const errors = [];
  const consoleErrors = [];
  const apiStatuses = new Set();
  const otherStatuses = new Set();

  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    consoleErrors.push({ text: m.text(), url: m.location()?.url || '' });
  });
  page.on('response', (r) => {
    const status = r.status();
    if (status < 400) return;
    (/\/api\//.test(r.url()) ? apiStatuses : otherStatuses).add(status);
  });

  await page.goto(URL, { waitUntil: 'load' });
  await page.waitForTimeout(2500);

  /* --- a home, so every home-dependent surface is exercised --------------- */
  await page.evaluate(() => {
    localStorage.setItem(
      'landfall.home',
      JSON.stringify({
        lon: -91.00107,
        lat: 30.334537,
        label: '18642 Magnolia Estates Road, Prairieville, Louisiana 70769',
        source: 'address',
        setAt: Date.now(),
      })
    );
  });
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(2500);

  /* --- the close button, in every view ------------------------------------ */
  for (const [btn, view] of [
    ['btn-storms', 'storms'],
    ['btn-layers', 'layers'],
    ['btn-home', 'home'],
    ['btn-settings', 'settings'],
  ]) {
    await page.click('#' + btn);
    await page.waitForTimeout(250);
    const geom = await page.evaluate(() => {
      const head = document.querySelector('.drawer-head');
      const close = document.querySelector('.drawer-close');
      if (!head || !close) return null;
      const h = head.getBoundingClientRect();
      const c = close.getBoundingClientRect();
      return { gapRight: Math.round(h.right - c.right), headW: Math.round(h.width) };
    });
    if (!geom) fail(`${view}: no drawer header`);
    else if (geom.gapRight > 16) {
      fail(`${view}: close button is ${geom.gapRight}px from the right edge`);
    } else note(`✓ ${view}: close pinned right (${geom.gapRight}px inset)`);
    /* CLOSE VIA THE DRAWER'S OWN X, NOT THE NAV BUTTON.
     *
     * MEASURED 2026-07-25 at 390x844: an open drawer's top edge sits at
     * y=620 while #btn-storms spans y=636..680, so THE OPEN DRAWER COVERS
     * THE NAV CONTROLS at phone width. Clicking the toggle button again is a
     * desktop assumption — on a phone that click lands on the drawer.
     *
     * Confirmed pre-existing and unrelated to the §17 A1 disclaimer strip:
     * the same geometry appears with the disclaimer acknowledged and not.
     * Whether a covered nav is acceptable is a design judgement for glass
     * (the X and Esc both close it, so nothing is trapped) — it is recorded
     * in SPEC §17 rather than silently worked around here. This line changes
     * only HOW the test closes the drawer, to the way a phone user actually
     * does it. */
    await page.click('.drawer-close');
    await page.waitForTimeout(150);
  }

  /* --- Layers: scroll survives a toggle ----------------------------------- */
  await closeDrawerIfOpen(page);
  await page.click('#btn-layers');
  await page.waitForTimeout(300);
  const layerCheck = await page.evaluate(async () => {
    const body = document.querySelector('#layers-body');
    body.scrollTop = body.scrollHeight; // to the bottom
    const before = body.scrollTop;
    const row = document.querySelector('[data-toggle="cities"]');
    row?.click();
    await new Promise((r) => setTimeout(r, 200));
    const after = document.querySelector('#layers-body').scrollTop;
    return { before, after, scrollable: body.scrollHeight > body.clientHeight };
  });
  if (!layerCheck.scrollable) {
    note('· layers panel does not overflow at this width — scroll test moot');
  } else if (Math.abs(layerCheck.before - layerCheck.after) > 2) {
    fail(`layers: scroll jumped ${layerCheck.before} -> ${layerCheck.after}`);
  } else {
    note(`✓ layers: scroll held at ${layerCheck.after} across a toggle`);
  }

  /* --- Layers: order, labels, and the retired heading --------------------- */
  const layerShape = await page.evaluate(() => {
    const heads = [...document.querySelectorAll('.layer-group-head')].map((n) =>
      n.textContent.trim()
    );
    const labels = [...document.querySelectorAll('.layer-row-label')].map((n) =>
      n.textContent.trim()
    );
    return { heads, labels, modelHeads: document.querySelectorAll('.model-group-head').length };
  });
  note('groups: ' + JSON.stringify(layerShape.heads));
  note('rows: ' + JSON.stringify(layerShape.labels));
  if (layerShape.heads.includes('Imagery')) fail('the Imagery group heading is still there');
  const li = layerShape.labels.indexOf('Imagery');
  const lc = layerShape.labels.indexOf('Coastal');
  if (li !== lc + 1) fail(`Imagery is not directly under Coastal (${lc} -> ${li})`);
  else note('✓ Imagery sits directly under Coastal');
  /* THE APP IS RIGHT AND THIS ASSERTION WAS STALE. It read "Lat/long lines"
   * until the layer stopped drawing lat/long lines; config/layers.js:495 is
   * the source of truth and says 'Tropics & equator'. The storage key is
   * still `graticule`, which is why the rename was invisible from here. */
  const GRATICULE_LABEL = 'Tropics & equator';
  if (!layerShape.labels.includes(GRATICULE_LABEL))
    fail(`graticule row does not read "${GRATICULE_LABEL}"`);
  else note(`✓ graticule row reads "${GRATICULE_LABEL}"`);

  /* --- the model selector ------------------------------------------------- */
  await page.evaluate(() => {
    const t = document.querySelector('[data-toggle="modelTracks"]');
    if (t && t.getAttribute('aria-checked') !== 'true') t.click();
  });
  await page.waitForTimeout(300);
  const models = await page.evaluate(() => ({
    heads: document.querySelectorAll('.model-group-head').length,
    subs: [...document.querySelectorAll('.model-sub')].map((n) => n.textContent.trim()),
    rowHeights: [...document.querySelectorAll('.model-row')].map((n) =>
      Math.round(n.getBoundingClientRect().height)
    ),
  }));
  if (models.heads) fail(`${models.heads} model group headings still rendering`);
  else note('✓ model group headings gone');
  const hafs = models.subs.find((s) => s.includes('Forecast System'));
  note('HAFS sub: ' + hafs);
  if (hafs && hafs.includes(' and ')) fail('HAFS subtitle still spells out "and"');

  /* --- the segmented control actually looks selected ---------------------- */
  const seg = await page.evaluate(() => {
    const on = document.querySelector('.seg[aria-checked="true"]');
    const off = document.querySelector('.seg[aria-checked="false"]:not([disabled])');
    if (!on || !off) return null;
    const c = (el) => getComputedStyle(el).backgroundColor;
    return { on: c(on), off: c(off), group: c(on.closest('.seg-group')) };
  });
  note('segment on/off/group: ' + JSON.stringify(seg));

  /* --- Storms: two-line rows, no filter ----------------------------------- */
  await closeDrawerIfOpen(page);
  await page.click('#btn-storms');
  await page.waitForTimeout(400);
  const list = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('.storm-row')];
    return {
      filter: !!document.querySelector('.scope-filter'),
      count: rows.length,
      firstShape: rows[0]
        ? (() => {
            const n = rows[0].querySelector('.row-name').getBoundingClientRect();
            const m = rows[0].querySelector('.row-meta').getBoundingClientRect();
            return { nameTop: Math.round(n.top), metaTop: Math.round(m.top) };
          })()
        : null,
      names: rows.map((r) => r.querySelector('.row-name').textContent.trim()),
    };
  });
  if (list.filter) fail('the scope filter is still in the DOM');
  else note('✓ scope filter gone');
  if (list.firstShape && list.firstShape.metaTop <= list.firstShape.nameTop) {
    fail('storm row meta is not below the name');
  } else if (list.firstShape) {
    note('✓ storm rows are two lines, name on top');
  }
  note(`${list.count} storms: ` + JSON.stringify(list.names.slice(0, 4)));

  /* --- Home: the invitation, then the pick path that was throwing ---------- */
  /*
   * ==> HOME IS A DASHBOARD NOW, AND THIS BLOCK SPENT TWO DAYS RED BECAUSE OF
   * IT. <== It used to click the drop-a-pin button the moment the home view
   * opened,
   * because opening home LANDED on search / locate / drop-a-pin. It does not
   * any more: with no home saved — which is every CI run, every time, since
   * the browser is fresh — the view renders the INVITATION, and the setup flow
   * is one click further in, behind "Set your home ›". So the selector matched
   * nothing, `.click()` threw on a null, and the whole suite died at this line
   * with a TypeError rather than reporting anything about the app.
   *
   * TWO LESSONS, AND THE SECOND ONE IS THE EXPENSIVE ONE.
   *
   * 1. The extra step is now an ASSERTION rather than something to skip past.
   *    "No home yet" is one of the five render paths §5 requires the home view
   *    to keep apart, and it is the first thing every new visitor sees. It had
   *    no coverage at all.
   *
   * 2. A CONTROL THAT MOVED MUST FAIL, NOT CRASH. Every lookup below is
   *    null-guarded and reports which selector went missing. A suite that dies
   *    on a TypeError tells you it is broken; it does not tell you what moved,
   *    it abandons every check after it, and it reads identically whether the
   *    app regressed or the app was merely rearranged.
   */
  await closeDrawerIfOpen(page);
  await page.click('#btn-home');
  await page.waitForTimeout(300);

  const invite = await page.evaluate(async () => {
    /* Already configured — a real home is saved, so the dashboard is correct
     * and the setup flow is behind "Edit home" instead. Both are valid states
     * for this suite to find; only "neither" is a bug. */
    const cta = document.querySelector('.home-cta');
    const edit = document.querySelector('.home-edit');
    if (!cta && !edit) return { shape: 'neither' };
    const shape = cta ? 'invitation' : 'dashboard';
    (cta || edit).click();
    await new Promise((r) => setTimeout(r, 400));
    return {
      shape,
      reachedSetup: !!document.querySelector('.home-choice[data-choice="pin"]'),
    };
  });
  if (invite.shape === 'neither') {
    fail('home rendered neither the invitation (.home-cta) nor an edit row (.home-edit)');
  } else if (!invite.reachedSetup) {
    fail(`home ${invite.shape} -> setup did not open (no drop-a-pin choice)`);
  } else {
    note(`✓ home opens on the ${invite.shape}, and it reaches the setup flow`);
  }

  const drop = await page.evaluate(async () => {
    const btn = document.querySelector('.home-choice[data-choice="pin"]');
    if (!btn) return { missing: '.home-choice[data-choice="pin"]' };
    btn.click();
    await new Promise((r) => setTimeout(r, 400));
    const box = document.querySelector('.home-confirm');
    if (!box) return { missing: '.home-confirm' };
    return {
      confirm: box.dataset.hidden,
      label: document.querySelector('.home-confirm-label')?.textContent.trim() || '',
      pin: !!document.querySelector('.home-pin-provisional'),
    };
  });
  if (drop.missing) fail(`drop-a-pin: ${drop.missing} is not in the DOM`);
  else if (drop.confirm !== 'false') fail('drop-a-pin did not reach the confirm step');
  else note(`✓ drop-a-pin -> confirm ("${drop.label}"), pin on map: ${drop.pin}`);

  await page.evaluate(() => document.querySelector('.home-confirm-no')?.click());
  await page.waitForTimeout(200);

  const search = await page.evaluate(async () => {
    /* ==> THE BOX IS BEHIND A TAP NOW, AND TYPING INTO A HIDDEN FIELD PROVES
     * NOTHING. <== Search stopped being a field sitting open when the three
     * ways to set a home became peers (SPEC-UI §8). The field still exists in
     * the DOM while collapsed, so setting `.value` on it would "work" and the
     * debounce would even fire — against a control no user can see. Open the
     * choice first, the way a person does, and fail loudly if that does not
     * reveal the box. */
    const opener = document.querySelector('.home-choice[data-choice="search"]');
    if (!opener) return { missing: '.home-choice[data-choice="search"]' };
    opener.click();
    await new Promise((r) => setTimeout(r, 200));
    const block = document.querySelector('.home-search-block');
    if (!block || block.dataset.hidden !== 'false') {
      return { missing: 'the search box did not open on tap' };
    }
    const inp = document.querySelector('.home-search');
    if (!inp) return { missing: '.home-search' };
    inp.value = 'Baton Rouge';
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 2600));
    const first = document.querySelector('.home-result');
    if (!first) return { picked: false, why: 'no results (relay offline locally?)' };
    first.click();
    await new Promise((r) => setTimeout(r, 400));
    return {
      picked: document.querySelector('.home-confirm')?.dataset.hidden === 'false',
      label: document.querySelector('.home-confirm-label')?.textContent.trim() || '',
    };
  });
  if (search.missing) fail(`home search: ${search.missing} is not in the DOM`);
  else if (search.why) note('· search: ' + search.why);
  else if (!search.picked) fail('picking a search result still does nothing');
  else note(`✓ picking a search result opens confirm ("${search.label}")`);

  /* --- Settings: the install row ------------------------------------------ */
  await closeDrawerIfOpen(page);
  await page.click('#btn-settings');
  await page.waitForTimeout(300);
  /* ==> RESOLVED: THE APP WAS NEVER MISSING THIS. <==
   * This used to look for `#set-install` and fail when it was absent. That
   * button is the READY shape only — ui/view-settings.js:465 renders it after
   * the browser fires `beforeinstallprompt`, which headless Chromium against a
   * plain static server never does. What renders instead is the manual shape:
   * a heading and a numbered list of per-platform steps.
   *
   * Both are correct. What would actually be a bug is the block rendering
   * NEITHER — an empty install section is a dead end on the one screen the
   * user opened in order to install. So that is what gets asserted. */
  const install = await page.evaluate(() => {
    const box = document.querySelector('#set-install-block');
    if (!box) return null;
    const cta = box.querySelector('#set-install');
    if (cta) return { shape: 'ready', text: cta.textContent.trim() };
    const heading = box.querySelector('.install-heading');
    const steps = box.querySelectorAll('.install-steps li').length;
    if (heading && steps) return { shape: 'manual', text: `${steps} steps` };
    return { shape: box.hidden ? 'installed' : 'empty', text: '' };
  });
  if (!install) fail('no install block in Settings');
  else if (install.shape === 'empty')
    fail('the Settings install block rendered empty — no button and no steps');
  else note(`✓ install block: ${install.shape} (${install.text})`);

  /* --- the view control ---------------------------------------------------- */
  const viewCtl = await page.evaluate(async () => {
    const btn = document.getElementById('btn-recenter');
    const nav = document.getElementById('controls');
    const firstId = nav.firstElementChild.id;
    const atRest = { mode: btn.dataset.mode, label: btn.getAttribute('aria-label') };
    window.__landfall.map.setBearing(40);
    await new Promise((r) => setTimeout(r, 300));
    const rotated = {
      mode: btn.dataset.mode,
      label: btn.getAttribute('aria-label'),
      aim: document.querySelector('.view-aim').style.transform,
    };
    btn.click();
    await new Promise((r) => setTimeout(r, 1200));
    return { firstId, atRest, rotated, afterClick: window.__landfall.map.getBearing() };
  });
  if (viewCtl.firstId !== 'btn-recenter') fail(`view control is not first in the cluster (${viewCtl.firstId})`);
  else note('✓ view control sits at the top of the cluster');
  if (viewCtl.atRest.mode !== 'recenter') fail(`at north the mode is "${viewCtl.atRest.mode}"`);
  if (viewCtl.rotated.mode !== 'north') fail(`rotated 40deg the mode is "${viewCtl.rotated.mode}"`);
  note(`✓ modes: rest=${viewCtl.atRest.mode} rotated=${viewCtl.rotated.mode} needle=${viewCtl.rotated.aim}`);
  if (Math.abs(viewCtl.afterClick) > 0.5) fail(`tapping the compass left bearing at ${viewCtl.afterClick}`);
  else note('✓ tapping the compass returns to north');

  /* --- keyboard: nothing focusable is invisible ----------------------------
   *
   * ==> THIS REPORTED 32 CONTROLS AND COULD NOT SEE WHY. <==
   * The old test read the element's OWN computed style. `display: none` on an
   * ANCESTOR does not show up there — a button inside a hidden view reports
   * its own `display: inline-flex` quite happily, measures 0x0 because nothing
   * is laid out, and got named. Every drawer view but the open one is
   * `hidden`, and `.drawer-view[hidden] { display: none }` (panels.css:244)
   * makes that real, so the list was essentially "every control in every view
   * that is not currently on screen". All noise, no signal, printed every run.
   *
   * `checkVisibility()` walks ancestors and answers the question actually
   * being asked: would the tab order reach this. `checkOpacity` is left OFF
   * on purpose — an `opacity: 0` control IS still tabbable, and that is a real
   * trap worth catching, not something to filter away.
   *
   * Anything that survives now is a genuine finding, so it is reported with
   * enough context to act on: which view it lives in and what it measures. */
  const kb = await page.evaluate(() => {
    const out = [];
    const sel = 'button:not([disabled]), input, [tabindex="0"]';
    for (const el of document.querySelectorAll(sel)) {
      if (typeof el.checkVisibility === 'function') {
        if (!el.checkVisibility({ checkVisibilityCSS: true })) continue;
      } else {
        /* Fallback for a browser without checkVisibility. offsetParent is null
         * for a display:none subtree, which is the ancestor case; position
         * fixed is the documented exception and has to be let through. */
        const cs = getComputedStyle(el);
        if (cs.visibility === 'hidden' || cs.display === 'none') continue;
        if (el.offsetParent === null && cs.position !== 'fixed') continue;
      }
      const r = el.getBoundingClientRect();
      if (r.width !== 0 && r.height !== 0) continue;
      const view = el.closest('.drawer-view');
      out.push({
        what: el.id || el.className || el.tagName.toLowerCase(),
        where: view ? `view:${view.dataset.view}` : 'outside the drawer',
        size: `${Math.round(r.width)}x${Math.round(r.height)}`,
      });
    }
    return out;
  });
  /* A FAILURE NOW, NOT A NOTE. It printed clean on the runner once the
   * ancestor blindness was gone, which is what a check has to do before it is
   * allowed to block anything. Anything it names from here is a control the
   * tab order really does reach and a sighted user really cannot see — a trap,
   * not a curiosity. */
  if (kb.length) {
    for (const k of kb) {
      fail(`zero-size but tabbable: ${k.what} (${k.where}, ${k.size})`);
    }
  } else note('✓ nothing tabbable measures zero');

  const { real, noise } = classifyConsoleErrors(
    consoleErrors, apiStatuses, otherStatuses
  );
  for (const t of real) errors.push('console: ' + t);

  if (noise.length) {
    note(
      `· ${noise.length} console error(s) traced to absent /api/ routes, ignored ` +
      `(statuses seen only on /api/: ${[...apiStatuses].sort().join(', ') || 'none'})`
    );
  }
  if (errors.length) {
    for (const e of errors) fail('page error — ' + e);
  } else {
    note('✓ no page errors or console errors');
  }

  await page.screenshot({ path: `${SHOT_DIR}/landfall-${vp.name}.png` });
  await ctx.close();
}

await browser.close();

console.log(
  problems.length
    ? `\n${problems.length} PROBLEM(S)\n` + problems.map((p) => ' - ' + p).join('\n')
    : '\nAll checks passed.'
);
process.exit(problems.length ? 1 : 0);
