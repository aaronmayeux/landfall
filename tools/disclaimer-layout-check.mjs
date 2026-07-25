/**
 * disclaimer-layout-check.mjs — the §17 A1 acknowledgement button stays put.
 *
 * WHY THIS IS A FILE AND NOT A ONE-OFF. The button rendered OFF THE SCREEN on
 * both iOS and Android while looking perfect on a desktop browser, and the
 * cause was invisible in the rule that broke it: `.nudge` sets
 * `flex-wrap: wrap` under @media (max-width: 480px), which is right for the
 * ROW-shaped pill nudges (the action drops to a second line) and catastrophic
 * for a COLUMN one, where overflow wraps into a NEW COLUMN beside the first.
 * The button landed at x=365..493 inside a 390px viewport.
 *
 * Nothing about that is visible by reading either rule alone. It only shows up
 * in geometry, at narrow widths, which is exactly what this measures.
 *
 * It asserts four things at six widths: the button is inside the panel, inside
 * the viewport, horizontally centred, and still at least 44px tall (§10).
 *
 *   python3 -m http.server 8099 &
 *   node tools/disclaimer-layout-check.mjs
 *
 * Exits non-zero on any failure. PLAYWRIGHT_CHROMIUM_PATH overrides the
 * browser binary, as in headless-check.mjs.
 */

import { chromium } from 'playwright';
const URL = process.env.LANDFALL_URL || 'http://127.0.0.1:8099/index.html';
const b = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined });
const WIDTHS = [
  { name: 'iPhone SE', w: 375, h: 667 },
  { name: 'iPhone 15', w: 390, h: 844 },
  { name: 'Pixel',     w: 412, h: 915 },
  { name: 'phablet',   w: 480, h: 900 },
  { name: 'tablet',    w: 768, h: 1024 },
  { name: 'desktop',   w: 1280, h: 800 },
];
let bad = 0;
for (const vp of WIDTHS) {
  const ctx = await b.newContext({ viewport: { width: vp.w, height: vp.h } });
  const p = await ctx.newPage();
  await p.goto(URL, { waitUntil: 'load' });
  await p.waitForTimeout(2200);
  const r = await p.evaluate(() => {
    const panel = document.querySelector('.nudge-disclaimer');
    const btn = panel?.querySelector('.nudge-action');
    if (!panel || !btn) return null;
    const pb = panel.getBoundingClientRect(), bb = btn.getBoundingClientRect();
    const panelCentre = pb.x + pb.width / 2, btnCentre = bb.x + bb.width / 2;
    return {
      insidePanel: bb.left >= pb.left - 1 && bb.right <= pb.right + 1,
      insideViewport: bb.left >= 0 && bb.right <= window.innerWidth,
      centred: Math.abs(panelCentre - btnCentre) <= 2,
      tallEnough: bb.height >= 44,
      btn: { x: Math.round(bb.x), right: Math.round(bb.right), w: Math.round(bb.width), h: Math.round(bb.height) },
      panel: { x: Math.round(pb.x), right: Math.round(pb.right) },
    };
  });
  if (!r) { console.log(`  ✗ ${vp.name}: disclaimer not found`); bad++; await ctx.close(); continue; }
  const ok = r.insidePanel && r.insideViewport && r.centred && r.tallEnough;
  if (!ok) bad++;
  console.log(`  ${ok ? '✓' : '✗'} ${vp.name.padEnd(10)} (${String(vp.w).padStart(4)}px)  ` +
    `btn ${r.btn.x}..${r.btn.right} (w${r.btn.w} h${r.btn.h})  panel ${r.panel.x}..${r.panel.right}  ` +
    `${r.insidePanel ? '' : 'OUTSIDE-PANEL '}${r.insideViewport ? '' : 'OFF-SCREEN '}${r.centred ? '' : 'NOT-CENTRED '}${r.tallEnough ? '' : 'TOO-SHORT'}`);
  await ctx.close();
}
console.log(bad === 0 ? '\n✓ disclaimer button is centred and contained at every width'
                      : `\n✗ ${bad} width(s) failed`);
await b.close();
process.exit(bad ? 1 : 0);
