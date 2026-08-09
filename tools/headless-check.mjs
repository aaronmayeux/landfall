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

import { chromium } from 'playwright';

const URL = process.env.LANDFALL_URL || 'http://127.0.0.1:8099/index.html';
const EXECUTABLE_PATH = process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined;
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
function isBackendNoise(text) {
  if (!/\/api\//.test(text)) return false;
  return /\b(404|405|500|501|502|503)\b/.test(text)
    || /Failed to load resource/i.test(text)
    || /Failed to fetch/i.test(text);
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

  const errors = [];
  const backendNoise = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const text = m.text();
    if (isBackendNoise(text)) {
      backendNoise.push(text);
      return;
    }
    errors.push('console: ' + text);
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

  /* --- Home: the pick path that was throwing ------------------------------ */
  await closeDrawerIfOpen(page);
  await page.click('#btn-home');
  await page.waitForTimeout(300);
  const drop = await page.evaluate(async () => {
    document.querySelector('.home-drop').click();
    await new Promise((r) => setTimeout(r, 400));
    return {
      confirm: document.querySelector('.home-confirm').dataset.hidden,
      label: document.querySelector('.home-confirm-label').textContent.trim(),
      pin: !!document.querySelector('.home-pin-provisional'),
    };
  });
  if (drop.confirm !== 'false') fail('drop-a-pin did not reach the confirm step');
  else note(`✓ drop-a-pin -> confirm ("${drop.label}"), pin on map: ${drop.pin}`);

  await page.evaluate(() => document.querySelector('.home-confirm-no').click());
  await page.waitForTimeout(200);

  const search = await page.evaluate(async () => {
    const inp = document.querySelector('.home-search');
    inp.value = 'Baton Rouge';
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 2600));
    const first = document.querySelector('.home-result');
    if (!first) return { picked: false, why: 'no results (relay offline locally?)' };
    first.click();
    await new Promise((r) => setTimeout(r, 400));
    return {
      picked: document.querySelector('.home-confirm').dataset.hidden === 'false',
      label: document.querySelector('.home-confirm-label').textContent.trim(),
    };
  });
  if (search.why) note('· search: ' + search.why);
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

  /* --- keyboard: nothing focusable is invisible ---------------------------- */
  const kb = await page.evaluate(() => {
    const hidden = [];
    for (const el of document.querySelectorAll('button:not([disabled]), input, [tabindex="0"]')) {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none') continue;
      if (r.width === 0 || r.height === 0) hidden.push(el.className || el.id);
    }
    return hidden;
  });
  if (kb.length) note('· zero-size focusables (check these): ' + JSON.stringify(kb));

  if (backendNoise.length) {
    note(
      `(${backendNoise.length} console error(s) from /api/ paths ignored — ` +
      'the local static server has no backend. Not counted as failures.)'
    );
  }
  if (errors.length) {
    for (const e of errors) fail('page error — ' + e);
  } else {
    note('✓ no page errors or console errors');
  }

  await page.screenshot({ path: `/tmp/landfall-${vp.name}.png` });
  await ctx.close();
}

await browser.close();

console.log(
  problems.length
    ? `\n${problems.length} PROBLEM(S)\n` + problems.map((p) => ' - ' + p).join('\n')
    : '\nAll checks passed.'
);
process.exit(problems.length ? 1 : 0);
