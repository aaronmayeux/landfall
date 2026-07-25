/**
 * headless-check.mjs — a smoke pass over the drawer views in a real browser.
 *
 * NOT a replacement for glass. This catches the class of bug that killed the
 * home search — a ReferenceError inside a click handler, invisible unless you
 * happen to have a console open — plus dead controls, missing elements, and
 * layout that only fails at one width. Frame budget, feel, and anything that
 * needs a thumb still have to be checked on a phone.
 *
 * NEEDS PLAYWRIGHT AND INTERNET. The page pulls MapLibre and Three from
 * unpkg, so this cannot run anywhere the CDN is unreachable — which is why it
 * exists as a file rather than as something already run. Against the deployed
 * site it needs neither a server nor a checkout:
 *
 *   npm i -g playwright && npx playwright install chromium
 *   LANDFALL_URL=https://landfall.getgravitate.app node tools/headless-check.mjs
 *
 * Or locally, with a static server on :8099 and the CDN reachable:
 *
 *   python3 -m http.server 8099 & node tools/headless-check.mjs
 */

import { chromium } from 'playwright';

const URL = process.env.LANDFALL_URL || 'http://127.0.0.1:8099/index.html';
const WIDTHS = [
  { name: 'phone', width: 390, height: 844 },
  { name: 'desktop', width: 1280, height: 800 },
];

const problems = [];
const note = (m) => console.log('  ' + m);
const fail = (m) => {
  problems.push(m);
  console.log('  ✗ ' + m);
};

const browser = await chromium.launch();

for (const vp of WIDTHS) {
  console.log(`\n=== ${vp.name} (${vp.width}x${vp.height}) ===`);
  const ctx = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: 2,
  });
  const page = await ctx.newPage();

  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push('console: ' + m.text());
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
    await page.click('#' + btn); // toggle shut
    await page.waitForTimeout(150);
  }

  /* --- Layers: scroll survives a toggle ----------------------------------- */
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
  if (!layerShape.labels.includes('Lat/long lines')) fail('graticule row not renamed');
  else note('✓ graticule row reads "Lat/long lines"');

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
  await page.click('#btn-settings');
  await page.waitForTimeout(300);
  const install = await page.evaluate(() => {
    const b = document.querySelector('#set-install');
    const n = document.querySelector('#set-install-note');
    return b ? { text: b.textContent.trim(), disabled: b.disabled, note: n.textContent.trim() } : null;
  });
  if (!install) fail('no install control in Settings');
  else note(`✓ install row: "${install.text}" disabled=${install.disabled} — ${install.note}`);

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
