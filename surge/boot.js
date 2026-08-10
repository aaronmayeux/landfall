/**
 * surge/boot.js — look at Milton's published surge on the real globe.
 *
 * ==> IT IS THE APP. NOTHING HERE DRAWS ANYTHING. <==
 *
 * `/?surge=milton` loads one advisory of Hurricane Milton's peak storm surge
 * out of `samples/milton-al142024/surge/` and hands it to the REAL surge layer
 * through the REAL layer engine. The rendering, the colours, the severity
 * stacking, the dilation stroke and the pair control are all the shipping
 * ones. Add `&adv=017` to pick an advisory; 017 is the default because it is
 * Milton's worst — 10-15 ft into Tampa Bay.
 *
 * ==> WHY NOT A MOCKUP PAGE, WHICH WOULD HAVE BEEN QUICKER. <== Because this
 * project has already paid for that answer. The home corridor chart was signed
 * off in `mockups/home-corridor.html`, which declares its own copies of the
 * CSS custom properties — so the one context that COULD NOT show the bug was
 * the context it was approved in, and it shipped drawing three black shapes on
 * a dark globe. A surge fixture judged anywhere but in the app would be the
 * same mistake with different pixels.
 *
 * ==> WHAT THIS IS NOT. <== It is not a replay. There is no storm on screen,
 * no track, no cone, no advisory clock — Milton is a fixture for ONE layer
 * (Aaron's call), so the page says so out loud rather than letting a bare
 * coastline read as a live forecast.
 *
 * IT IS INERT WITHOUT `?surge=milton`. index.html loads it on every page load,
 * so the first thing it does is check whether it was asked for.
 */

const params = new URLSearchParams(location.search);
if (params.get('surge') === 'milton') start();

async function start() {
  /* Read by data/surge.js. Set BEFORE main.js runs — module scripts execute in
   * document order — so nothing has to be re-pointed after the fact. */
  const adv = params.get('adv') || '017';
  globalThis.__LANDFALL_SURGE_FIXTURE__ = adv;

  let meta;
  try {
    const r = await fetch('/samples/milton-al142024/surge/index.json', { cache: 'no-store' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    meta = await r.json();
  } catch (e) {
    /* ==> A HARNESS THAT CANNOT LOAD ITS FIXTURE MUST SAY SO. <== Left silent
     * it boots the ordinary app with an empty ocean, which looks exactly like
     * a coast with no surge forecast — the §5 lie this layer exists to avoid. */
    banner(`Surge fixture unavailable — Milton's archive did not load (${e.message}). ` +
           `This page is NOT showing a forecast; it is showing a failure.`, true);
    return;
  }

  const row = meta.advisories.find((a) => a.advisory === adv) || meta.advisories[0];
  banner(
    `Hurricane Milton, advisory ${row.advisory} — NHC's published peak storm surge. ` +
    `${row.polygons} areas, ${row.lines} coastal reaches. Simplified to ` +
    `${meta.simplifiedToleranceDeg}°, the same generalization the live relay asks for. ` +
    `No storm is drawn: this is the surge layer on its own.`
  );

  scrubber(meta, adv);
}

/** Says what the page is, in the page. */
function banner(text, isError = false) {
  const el = document.createElement('div');
  el.setAttribute('role', isError ? 'alert' : 'status');
  el.textContent = text;
  el.style.cssText =
    'position:fixed;left:0;right:0;top:0;z-index:9999;padding:8px 12px;' +
    'font:13px/1.4 system-ui,sans-serif;text-align:center;' +
    `background:${isError ? '#7a1020' : 'rgba(0,0,0,.72)'};color:#fff;`;
  const put = () => document.body.appendChild(el);
  if (document.body) put(); else addEventListener('DOMContentLoaded', put, { once: true });
}

/**
 * Advisory scrubber. RELOADS the page on change, exactly as the Ida replay's
 * does and for the same reason: re-pointing the fixture mid-flight would do
 * nothing until the layer's next update and would look broken in between.
 */
function scrubber(meta, current) {
  const wrap = document.createElement('div');
  wrap.style.cssText =
    'position:fixed;left:50%;transform:translateX(-50%);bottom:16px;z-index:9999;' +
    'display:flex;gap:8px;align-items:center;padding:8px 12px;border-radius:10px;' +
    'background:rgba(0,0,0,.72);color:#fff;font:13px/1 system-ui,sans-serif;';

  const label = document.createElement('label');
  label.textContent = 'Advisory';
  label.style.cssText = 'opacity:.8';
  const id = 'surge-adv';
  label.htmlFor = id;

  const select = document.createElement('select');
  select.id = id;
  /* 44px is the §7 touch-target floor and applies to a harness too — this gets
   * used on a phone, which is the entire point of building it in the app. */
  select.style.cssText = 'min-height:44px;min-width:88px;font:inherit;color:#000;';
  for (const a of meta.advisories) {
    const o = document.createElement('option');
    o.value = a.advisory;
    o.textContent = a.advisory;
    if (a.advisory === current) o.selected = true;
    select.appendChild(o);
  }
  select.addEventListener('change', () => {
    const u = new URL(location.href);
    u.searchParams.set('surge', 'milton');
    u.searchParams.set('adv', select.value);
    location.href = u.toString();
  });

  wrap.append(label, select);
  const put = () => document.body.appendChild(wrap);
  if (document.body) put(); else addEventListener('DOMContentLoaded', put, { once: true });
}
