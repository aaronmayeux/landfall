/**
 * replay/boot.js — run the whole app against Hurricane Ida, August 2021.
 *
 * ==> IT IS THE APP. NOTHING HERE DRAWS ANYTHING. <==
 *
 * This module runs BEFORE main.js — module scripts execute in document order —
 * and does exactly three things:
 *
 *   1. Points the relay at the archive, `/api/replay/<iso>/…`, by setting the
 *      one global `ENDPOINT.relay` reads. Every fetch the app makes from then
 *      on goes to Ida's real published bytes through the app's real data path.
 *   2. Moves the clock to that instant. NOT the data — the data is NHC's, with
 *      its own 2021 timestamps, untouched. Moving the observer instead of the
 *      measurement is the honest direction: every "in 18 hrs", every staleness
 *      check and every advisory-age line is then computed the way it was
 *      computed on the night, against numbers nobody edited.
 *   3. Puts a scrubber on screen, and says loudly what this page is.
 *
 * IT IS INERT WITHOUT `?replay=ida`. index.html loads it on every page load,
 * so the first thing it does is check whether it was asked for. The shipping
 * app must be byte-identical when it was not.
 *
 * WHY THE CLOCK IS SHIFTED AND NOT THE TIMESTAMPS. The alternative — rewriting
 * every stamp forward so the app thinks Ida is happening today — would mean
 * the fixtures are no longer what NHC published, and this project's whole
 * position on fixtures is that they are the bytes. It would also quietly
 * defeat the one thing worth testing here: the app's staleness machinery,
 * which exists to notice when data is older than it should be.
 *
 * Imports nothing from the app. It cannot, and that is deliberate: importing
 * config/ here would evaluate part of the module graph before the clock moves.
 */

const params = new URLSearchParams(location.search);
if (params.get('replay') === 'ida') start();

async function start() {
  /* ---- 1. the archive, and what is in it -------------------------------- */
  let meta;
  try {
    const r = await fetch('/samples/ida-al092021/gis/index.json', { cache: 'no-store' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    meta = await r.json();
  } catch (e) {
    /* ==> A REPLAY THAT CANNOT LOAD ITS ARCHIVE MUST SAY SO. <== Left silent
     * it boots the ordinary app against the live feed, in August 2021, and
     * shows an empty ocean that looks exactly like a quiet day. */
    banner(`Replay unavailable — the Ida archive did not load (${e.message}). ` +
           `This page is NOT showing a storm; it is showing a failure.`, true);
    return;
  }

  const advisories = meta.advisories;
  /* Advisory 12 is where the corridor work landed: 120 kt, eighteen hours out,
   * all three wind fields reaching the house. Overridable with ?adv=. */
  const wanted = params.get('adv');
  let i = wanted
    ? Math.max(0, advisories.findIndex((a) => a.adv === wanted || a.advisnum === wanted))
    : advisories.findIndex((a) => a.adv === '012');
  if (i < 0) i = advisories.length - 1;

  /* ---- 2. the clock ------------------------------------------------------
   * Date.now() and `new Date()` with no arguments are the only two ways the
   * app asks what time it is. Everything else parses a string, and those must
   * keep working exactly as they do — which is why this shifts by an OFFSET
   * rather than pinning a constant: intervals, animations and elapsed-time
   * measurements all still advance at one second per second. */
  const RealDate = Date;
  let offset = 0;
  const shifted = new Proxy(RealDate, {
    construct(target, args) {
      return args.length === 0 ? new target(RealDate.now() + offset) : new target(...args);
    },
    get(target, prop) {
      if (prop === 'now') return () => RealDate.now() + offset;
      return Reflect.get(target, prop);
    },
  });
  globalThis.Date = shifted;

  /* Point the relay and the clock at one advisory. Runs once, before the app
     starts; see `seek` for why moving is a different operation. */
  const a0 = advisories[i];
  offset = RealDate.parse(a0.time) - RealDate.now();
  globalThis.__LANDFALL_RELAY_BASE__ = `/api/replay/${encodeURIComponent(a0.time)}`;

  /* ==> SEEKING RELOADS THE PAGE, AND THAT IS THE HONEST CHOICE. <==
   *
   * Repointing the relay mid-flight changes nothing on screen until the app's
   * own poll comes round, which is minutes — so a scrubber that only moved the
   * base would look broken for a minute and then jump, which is worse than
   * slow. Reaching into the app to force a refresh would mean an export that
   * exists for this page and for nothing else, and a second way to invalidate
   * every cache in the app is exactly the sort of seam that rots.
   *
   * A reload re-runs the real boot against the new advisory. It costs a globe
   * rebuild — a second or so — and in exchange every figure on screen is
   * unambiguously from one advisory, with nothing left over from the last. For
   * a replay that is the right trade. It is also why the scrubber acts on
   * `change` and not `input`: dragging should not reload per pixel. */
  function seek(n) {
    const j = Math.min(advisories.length - 1, Math.max(0, n));
    if (j === i) return;
    location.search = `?replay=ida&adv=${advisories[j].adv}`;
  }

  /* ---- 3. the furniture -------------------------------------------------- */
  const bar = document.createElement('div');
  bar.id = 'replay-bar';
  bar.innerHTML = `
    <div class="rp-row">
      <span class="rp-tag">REPLAY</span>
      <span class="rp-what">Hurricane Ida · AL092021 · <span id="rp-when"></span></span>
    </div>
    <div class="rp-row">
      <button id="rp-prev" type="button" aria-label="Previous advisory">‹</button>
      <button id="rp-play" type="button" aria-label="Play">▶</button>
      <button id="rp-next" type="button" aria-label="Next advisory">›</button>
      <input id="rp-scrub" type="range" min="0" max="${advisories.length - 1}" value="${i}"
             aria-label="Advisory">
      <span class="rp-adv" id="rp-adv"></span>
    </div>
    <p class="rp-note">Real NHC advisories, replayed. Every position, cone, wind field
      and warning is what NHC published at that hour. Surge is not shown — the app
      does not draw it yet.</p>`;
  const style = document.createElement('style');
  style.textContent = `
    #replay-bar{position:fixed;left:0;right:0;bottom:0;z-index:9999;
      background:rgba(8,14,24,.92);backdrop-filter:blur(8px);
      border-top:1px solid rgba(120,190,225,.22);color:#E8F1F8;
      font:13px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;
      padding:8px 12px calc(8px + env(safe-area-inset-bottom));
      display:flex;flex-direction:column;gap:6px}
    #replay-bar .rp-row{display:flex;align-items:center;gap:8px}
    #replay-bar .rp-tag{font-weight:700;letter-spacing:.14em;font-size:10px;
      background:#E0A93C;color:#0b1220;padding:2px 6px;border-radius:4px}
    #replay-bar .rp-what{color:#9DB3C7;min-width:0;overflow:hidden;text-overflow:ellipsis;
      white-space:nowrap}
    #replay-bar #rp-when{color:#E8F1F8}
    #replay-bar button{min-width:44px;min-height:44px;border-radius:8px;
      border:1px solid rgba(120,190,225,.28);background:rgba(16,30,48,.6);
      color:#E8F1F8;font-size:16px;cursor:pointer}
    #replay-bar button:focus-visible{outline:2px solid #5FE0F5;outline-offset:2px}
    #replay-bar input[type=range]{flex:1;min-width:60px;height:44px;accent-color:#4FD1E8}
    #replay-bar .rp-adv{font:12px ui-monospace,SFMono-Regular,Menlo,monospace;color:#9DB3C7;
      min-width:5.5em;text-align:right}
    #replay-bar .rp-note{margin:0;color:#7089A5;font-size:11px;line-height:1.45}
    /* The app's own bottom furniture has to clear this. */
    body{--replay-bar-h:118px}
    #controls{bottom:calc(var(--replay-bar-h) + 12px)!important}
    #drawer{bottom:var(--replay-bar-h)!important}`;

  function render(a) {
    const el = document.getElementById('rp-when');
    if (el) el.textContent = a.advdate;
    const n = document.getElementById('rp-adv');
    if (n) n.textContent = `adv ${a.advisnum}${/A$/.test(a.adv) ? 'A' : ''} · ${a.windKt} kt`;
    const s = document.getElementById('rp-scrub');
    if (s && Number(s.value) !== i) s.value = String(i);
  }

  function banner(text, bad) {
    const b = document.createElement('div');
    b.setAttribute('role', 'status');
    b.style.cssText = `position:fixed;left:0;right:0;bottom:0;z-index:9999;padding:12px;
      background:${bad ? '#5b1a1a' : '#0b1220'};color:#fff;font:13px system-ui;`;
    b.textContent = text;
    document.body.appendChild(b);
  }

  const mount = () => {
    document.head.appendChild(style);
    document.body.appendChild(bar);
    render(advisories[i]);
    document.getElementById('rp-prev').onclick = () => seek(i - 1);
    document.getElementById('rp-next').onclick = () => seek(i + 1);
    const scrub = document.getElementById('rp-scrub');
    scrub.onchange = (e) => seek(Number(e.target.value));
    scrub.oninput = (e) => {
      const a = advisories[Math.min(advisories.length - 1, Math.max(0, Number(e.target.value)))];
      document.getElementById('rp-when').textContent = a.advdate;
      document.getElementById('rp-adv').textContent =
        `adv ${a.advisnum}${/A$/.test(a.adv) ? 'A' : ''} · ${a.windKt} kt`;
    };

    /* PLAY SURVIVES THE RELOAD, because seeking IS a reload. The flag rides
     * in the URL rather than in a variable that dies with the document, and
     * the timer starts on the next page's own load. */
    const playing = params.get('play') === '1';
    const play = document.getElementById('rp-play');
    play.textContent = playing ? '❚❚' : '▶';
    play.setAttribute('aria-label', playing ? 'Pause' : 'Play');
    play.onclick = () => {
      if (playing) { location.search = `?replay=ida&adv=${advisories[i].adv}`; return; }
      location.search = `?replay=ida&play=1&adv=${advisories[i].adv}`;
    };
    if (playing && i < advisories.length - 1) {
      /* Long enough that the globe has settled and the eye has read the new
       * advisory before it moves again. Shorter and it is a slideshow of
       * loading screens. */
      setTimeout(() => {
        location.search = `?replay=ida&play=1&adv=${advisories[i + 1].adv}`;
      }, 6000);
    }

    /* Keyboard, first-class like every other control in this app (§Input). */
    globalThis.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement) return;
      if (e.key === ',' || e.key === '[') seek(i - 1);
      if (e.key === '.' || e.key === ']') seek(i + 1);
    });
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount, { once: true });
  } else {
    mount();
  }
}
