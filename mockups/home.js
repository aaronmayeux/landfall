/* home.js — behaviour for mockups/home.html.

 * ==> IT IS AN EXTERNAL FILE BECAUSE THE LIVE CSP REFUSES AN INLINE ONE. <==
 * `_headers` sends `script-src 'self'` with one pinned hash and no
 * 'unsafe-inline'. This page shipped with its script inline and had therefore
 * been DEAD on the deployed site for as long as the CSP has been enforced —
 * the layout drew, the styling drew (style-src does allow inline), and nothing
 * moved. Found on 2026-08-26 by tools/mockup-csp-check.mjs, not by looking.
 *
 * SPEC-OPS.md §17.4 carries the rule. Nothing here is app code.
 */
/* ---------------------------------------------------------------------------
 * THE DATA. Transcribed from al022026.fstadv.010.shtml and from a node run of
 * data/home.js. Times are CDT (UTC-5), which is what the advisory itself uses.
 * ------------------------------------------------------------------------- */
const NOW_LABEL = '4:00 PM CDT Tue Jul 21';

/* published forecast nodes: hours after advisory, wind kt, distance to home */
const NODES = [
  { h: 0,  clock: 'Tue 4 PM',  kt: 50, gust: 60, nm: 153.4, mi: 177, brg: 101.7, tag: 'now' },
  { h: 9,  clock: 'Wed 1 AM',  kt: 45, gust: 55, nm: 115.1, mi: 132, brg: 100.0 },
  { h: 21, clock: 'Wed 1 PM',  kt: 45, gust: 55, nm:  48.5, mi:  56, brg: 123.8 },
  { h: 33, clock: 'Thu 1 AM',  kt: 40, gust: 50, nm:  79.6, mi:  92, brg: 240.9, tag: 'coast' },
  { h: 45, clock: 'Thu 1 PM',  kt: 35, gust: 45, nm: 176.8, mi: 203, brg: 260.0 },
  { h: 57, clock: 'Fri 1 AM',  kt: 30, gust: 40, nm: 287.9, mi: 331, brg: 269.6 },
  { h: 69, clock: 'Fri 1 PM',  kt: 25, gust: 35, nm: 391.4, mi: 450, brg: 275.0 },
];

const CPA = { h: 25, clock: 'Wed 5:00 PM', lead: '25 h', nm: 31.3, mi: 36, brg: 173.1,
              kt: 43.3, bandNm: 39.8, bandMi: 46, loMi: 0, hiMi: 82 };

/* NHC 2026 Atlantic cone circle radii, nm — nhc.noaa.gov/aboutcone.shtml */
const CONE = [[12,25],[24,39],[36,49],[48,62],[60,77],[72,95],[96,134],[120,200]];
const coneNm = (h) => {
  if (h <= 12) return 25 * h / 12;
  for (let i = 0; i < CONE.length - 1; i++) {
    const [h0,r0] = CONE[i], [h1,r1] = CONE[i+1];
    if (h <= h1) return r0 + (r1 - r0) * (h - h0) / (h1 - h0);
  }
  return 200;
};
const MI = 1.15078;

/* dense interpolation of the track, same linear scheme closestApproach() uses */
const DENSE = (() => {
  const out = [];
  const R = 3440.065, D = Math.PI / 180;
  /* published lat/lon, so the dense curve is geometry not a smoothing guess */
  const P = [
    [ -87.2, 29.4, 0,  50], [ -87.9, 29.6, 9,  45], [ -89.3, 29.5, 21, 45],
    [ -91.4, 29.3, 33, 40], [ -93.4, 29.4, 45, 35], [ -95.6, 29.8, 57, 30],
    [ -97.6, 30.3, 69, 25],
  ];
  const HL = [-90.0715, 29.9511];
  const gc = (lon1,lat1,lon2,lat2) => {
    const p1 = lat1*D, p2 = lat2*D, dp = (lat2-lat1)*D, dl = (lon2-lon1)*D;
    const a = Math.sin(dp/2)**2 + Math.cos(p1)*Math.cos(p2)*Math.sin(dl/2)**2;
    return 2*R*Math.asin(Math.min(1, Math.sqrt(a)));
  };
  const brg = (lon1,lat1,lon2,lat2) => {
    const p1 = lat1*D, p2 = lat2*D, dl = (lon2-lon1)*D;
    const y = Math.sin(dl)*Math.cos(p2);
    const x = Math.cos(p1)*Math.sin(p2) - Math.sin(p1)*Math.cos(p2)*Math.cos(dl);
    return (Math.atan2(y,x)/D + 360) % 360;
  };
  for (let i = 0; i < P.length; i++) {
    const [lo,la,t,w] = P[i], n = P[i+1];
    const add = (lon,lat,hh,ww) => {
      const nm = gc(HL[0],HL[1],lon,lat);
      out.push({ h: hh, nm, mi: nm*MI, brg: brg(HL[0],HL[1],lon,lat), kt: ww });
    };
    add(lo,la,t,w);
    if (!n) break;
    const SUB = 12;
    for (let s = 1; s < SUB; s++) {
      const f = s/SUB;
      add(lo + (n[0]-lo)*f, la + (n[1]-la)*f, t + (n[2]-t)*f, w + (n[3]-w)*f);
    }
  }
  return out;
})();

/* ------------------------------------------------------------------ helpers */
const h = (html) => html;
const catColor = (kt) => kt >= 137 ? 'var(--cat-5)' : kt >= 113 ? 'var(--cat-4)'
  : kt >= 96 ? 'var(--cat-3)' : kt >= 83 ? 'var(--cat-2)' : kt >= 64 ? 'var(--cat-1)'
  : kt >= 34 ? 'var(--cat-ts)' : 'var(--cat-td)';
const catWord = (kt) => kt >= 64 ? 'Hurricane' : kt >= 34 ? 'Tropical storm' : 'Tropical depression';

/* ============================================================== HERO A ==== */
/* THE APPROACH. Home dead centre; the track plotted at its true bearing and
   distance, so the shape on screen IS the geometry. Rings are miles. The soft
   disc at the closest pass is NHC's own two-thirds cone circle at that lead
   time — it visibly swallows the home dot, which is the honest reading. */
function heroApproach() {
  const W = 320, H = 250, cx = 160, cy = 104, R = 104, MAXMI = 215;
  const rr = (mi) => Math.min(mi, MAXMI) / MAXMI * R;
  const X = (mi, b) => cx + rr(mi) * Math.sin(b * Math.PI / 180);
  const Y = (mi, b) => cy - rr(mi) * Math.cos(b * Math.PI / 180);

  let d = '', segs = [];
  let cur = null;
  for (const p of DENSE) {
    const inside = p.mi <= MAXMI;
    if (inside && !cur) cur = [];
    if (inside) cur.push(`${X(p.mi,p.brg).toFixed(1)},${Y(p.mi,p.brg).toFixed(1)}`);
    if (!inside && cur) { segs.push(cur); cur = null; }
  }
  if (cur) segs.push(cur);
  d = segs.map(s => 'M' + s.join(' L')).join(' ');

  const rings = [50, 100, 150, 200].map(mi => `
    <circle cx="${cx}" cy="${cy}" r="${rr(mi).toFixed(1)}" fill="none"
            stroke="var(--glass-border)" stroke-width="1"/>
    <text x="${cx + 3}" y="${(cy - rr(mi) + 10).toFixed(1)}" font-size="8">${mi} mi</text>`).join('');

  const ticks = [['N',0],['E',90],['S',180],['W',270]].map(([l,b]) => `
    <text x="${X(MAXMI + 12, b).toFixed(1)}" y="${(Y(MAXMI + 12, b) + 3).toFixed(1)}"
          font-size="8" text-anchor="middle" class="lab">${l}</text>`).join('');

  const dots = NODES.filter(n => n.mi <= MAXMI).map(n => `
    <circle cx="${X(n.mi,n.brg).toFixed(1)}" cy="${Y(n.mi,n.brg).toFixed(1)}" r="${n.tag === 'now' ? 5 : 3.2}"
            fill="${catColor(n.kt)}" stroke="var(--space)" stroke-width="${n.tag === 'now' ? 1.6 : 1}"/>`).join('');

  const cpx = X(CPA.mi, CPA.brg), cpy = Y(CPA.mi, CPA.brg);

  return `
  <svg class="chart" viewBox="0 0 ${W} ${H}" role="img"
       aria-label="Bertha's forecast track drawn around your home. Closest pass 36 miles south in 25 hours; NHC's two-thirds error circle at that time is 46 miles, so it reaches your home.">
    ${rings}${ticks}
    <!-- the two-thirds band at the closest pass -->
    <circle cx="${cpx.toFixed(1)}" cy="${cpy.toFixed(1)}" r="${rr(CPA.bandMi).toFixed(1)}"
            fill="color-mix(in srgb, var(--stale) 12%, transparent)"
            stroke="var(--stale)" stroke-width="1" stroke-dasharray="3 3" opacity="0.85"/>
    <path d="${d}" fill="none" stroke="var(--cat-ts)" stroke-width="2.2"
          stroke-linecap="round" stroke-linejoin="round" opacity="0.9"/>
    <line x1="${cx}" y1="${cy}" x2="${cpx.toFixed(1)}" y2="${cpy.toFixed(1)}"
          stroke="var(--text-muted)" stroke-width="1" stroke-dasharray="2 3"/>
    ${dots}
    <circle cx="${cpx.toFixed(1)}" cy="${cpy.toFixed(1)}" r="6" fill="none"
            stroke="var(--text-primary)" stroke-width="1.8"/>
    <!-- home -->
    <rect x="${cx-5}" y="${cy-5}" width="10" height="10" rx="2.5" fill="none"
          stroke="var(--coast-glow)" stroke-width="2"/>
    <text x="${cx + 10}" y="${cy + 3}" font-size="8.5" class="lab" fill="var(--text-secondary)">Home</text>
    <text x="${(cpx + 10).toFixed(1)}" y="${(cpy + 16).toFixed(1)}" font-size="8.5">36 mi · Wed 5 PM</text>
    <text x="6" y="${H - 22}" font-size="8">Tue 4 PM &rarr; Fri 1 PM · dots are 12-hourly forecast points</text>
    <text x="6" y="${H - 10}" font-size="8" fill="var(--stale)">dashed circle = two-thirds of past NHC forecasts</text>
  </svg>`;
}

/* ============================================================== HERO B ==== */
/* LINKED. Intensity over distance-to-home, one time axis, one marker crossing
   both. The distance lane carries the cone band as a ribbon; where the ribbon
   touches the home baseline, "over your house" is inside the forecast. */
function heroLinked() {
  const W = 320, H = 236, L = 30, Rt = 8, HMAX = 69;
  const X = (hh) => L + (W - L - Rt) * hh / HMAX;
  const A0 = 14, A1 = 78, KLO = 20, KHI = 55;
  const YA = (kt) => A1 - (A1 - A0) * (kt - KLO) / (KHI - KLO);
  const B0 = 108, B1 = 196, DMAX = 260;
  const YB = (mi) => B0 + (B1 - B0) * Math.min(mi, DMAX) / DMAX;

  const line = DENSE.map((p,i) => `${i?'L':'M'}${X(p.h).toFixed(1)},${YA(p.kt).toFixed(1)}`).join(' ');
  const dist = DENSE.map((p,i) => `${i?'L':'M'}${X(p.h).toFixed(1)},${YB(p.mi).toFixed(1)}`).join(' ');

  const up = DENSE.map(p => `${X(p.h).toFixed(1)},${YB(Math.max(0, p.mi - coneNm(p.h)*MI)).toFixed(1)}`);
  const dn = DENSE.slice().reverse().map(p => `${X(p.h).toFixed(1)},${YB(p.mi + coneNm(p.h)*MI).toFixed(1)}`);
  const band = 'M' + up.join(' L') + ' L' + dn.join(' L') + ' Z';

  const ktGrid = [50, 40, 30].map(k => `
    <line x1="${L}" y1="${YA(k).toFixed(1)}" x2="${W-Rt}" y2="${YA(k).toFixed(1)}"
          stroke="var(--glass-border)" stroke-width="1"/>
    <text x="2" y="${(YA(k)+3).toFixed(1)}" font-size="8">${k}kt</text>`).join('');
  const miGrid = [200, 100].map(m => `
    <line x1="${L}" y1="${YB(m).toFixed(1)}" x2="${W-Rt}" y2="${YB(m).toFixed(1)}"
          stroke="var(--glass-border)" stroke-width="1"/>
    <text x="2" y="${(YB(m)+3).toFixed(1)}" font-size="8">${m}mi</text>`).join('');

  const days = [[0,'Tue 4 PM'],[24,'Wed 4 PM'],[48,'Thu 4 PM'],[69,'Fri 1 PM']].map(([hh,l]) => `
    <text x="${X(hh).toFixed(1)}" y="${H-4}" font-size="8" text-anchor="${hh===0?'start':hh===69?'end':'middle'}">${l}</text>`).join('');

  const segs = [];
  for (let i = 1; i < DENSE.length; i++) {
    const a = DENSE[i-1], b = DENSE[i];
    segs.push(`<line x1="${X(a.h).toFixed(1)}" y1="${YA(a.kt).toFixed(1)}"
      x2="${X(b.h).toFixed(1)}" y2="${YA(b.kt).toFixed(1)}"
      stroke="${catColor((a.kt+b.kt)/2)}" stroke-width="2.4" stroke-linecap="round"/>`);
  }

  return `
  <svg class="chart" viewBox="0 0 ${W} ${H}" role="img"
       aria-label="Two stacked lanes on one time axis. Top: Bertha's forecast wind falling from 50 to 25 knots. Bottom: distance from your home dipping to 36 miles on Wednesday at 5 PM, with the forecast error ribbon reaching your home.">
    ${ktGrid}${miGrid}
    <text x="${L}" y="9" font-size="8" class="lab" fill="var(--text-secondary)">STRENGTH</text>
    <text x="${L}" y="103" font-size="8" class="lab" fill="var(--text-secondary)">DISTANCE FROM HOME</text>

    <!-- home baseline: zero miles -->
    <line x1="${L}" y1="${YB(0)}" x2="${W-Rt}" y2="${YB(0)}" stroke="var(--coast-glow)" stroke-width="1.4"/>
    <text x="2" y="${YB(0)+3}" font-size="8" fill="var(--coast-glow)">home</text>

    <path d="${band}" fill="color-mix(in srgb, var(--stale) 14%, transparent)"
          stroke="var(--stale)" stroke-width="0.8" stroke-dasharray="3 3" opacity="0.8"/>
    ${segs.join('')}
    <path d="${dist}" fill="none" stroke="var(--text-primary)" stroke-width="2"/>

    <!-- the one marker crossing both lanes -->
    <line x1="${X(CPA.h).toFixed(1)}" y1="${A0-6}" x2="${X(CPA.h).toFixed(1)}" y2="${B1}"
          stroke="var(--text-primary)" stroke-width="1" stroke-dasharray="3 3" opacity="0.7"/>
    <circle cx="${X(CPA.h).toFixed(1)}" cy="${YA(CPA.kt).toFixed(1)}" r="4" fill="var(--cat-ts)"
            stroke="var(--space)" stroke-width="1.4"/>
    <circle cx="${X(CPA.h).toFixed(1)}" cy="${YB(CPA.mi).toFixed(1)}" r="4" fill="var(--text-primary)"/>
    <text x="${(X(CPA.h)+6).toFixed(1)}" y="${(YA(CPA.kt)-5).toFixed(1)}" font-size="8.5">43 kt</text>
    <text x="${(X(CPA.h)+6).toFixed(1)}" y="${(YB(CPA.mi)-6).toFixed(1)}" font-size="8.5">36 mi</text>
    <text x="${(X(CPA.h)+6).toFixed(1)}" y="${A0+2}" font-size="8" class="lab">closest pass</text>
    ${days}
  </svg>`;
}

/* ============================================================== HERO C ==== */
/* COUNTDOWN. No geometry at all — lead time and plain sentences. Also the
   accessible twin of whichever picture wins, because this is what a screen
   reader and a keyboard get. */
function heroCountdown(compact) {
  const rows = [
    { key: 'now',  lead: 'now',   ev: 'Bertha is 177 mi east-southeast', det: '50 kt, gusting 60 · moving northwest at 5 kt' },
    { key: '',     lead: '+14 h', ev: 'Comes inside 100 miles',          det: 'Wed 6 AM' },
    { key: 'true', lead: '+25 h', ev: 'Closest pass — 36 mi south',      det: 'Wed 5 PM · 43 kt, tropical storm strength' },
    { key: 'held', lead: '—',     ev: 'Tropical-storm winds arrive',     det: 'Needs the per-hour wind radii — Phase B' },
    { key: 'held', lead: '—',     ev: 'Winds ease',                      det: 'Needs the per-hour wind radii — Phase B' },
    { key: '',     lead: '+34 h', ev: 'Back beyond 100 miles',           det: 'Thu 2 AM' },
  ];
  const use = compact ? rows.filter(r => r.key !== 'held') : rows;
  return `<ul class="rail">` + use.map(r => `
    <li data-key="${r.key || 'false'}">
      <div class="lead">${r.lead}</div>
      <div class="ev">${r.ev}</div>
      <div class="det">${r.det}</div>
    </li>`).join('') + `</ul>`;
}

/* ================================================== the shared drawer ===== */
function pencil() {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"
    stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17v3Z"/><path d="M14.5 6.5 17.5 9.5"/></svg>`;
}
function xIcon() {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"
    stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>`;
}
function homeIcon() {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"
    stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M4 11 12 4l8 7"/><path d="M6.5 9.6V20h11V9.6"/></svg>`;
}

function dashboard(hero, { compactCountdown = false } = {}) {
  return `
  <div class="drawer">
    <header class="drawer-head">
      <div class="drawer-title-slot"><h1 class="drawer-title">Home</h1></div>
      <button class="drawer-icon-btn" type="button" aria-label="Edit home">${pencil()}</button>
      <button class="drawer-icon-btn" type="button" aria-label="Close">${xIcon()}</button>
    </header>
    <div class="drawer-body">

      <div class="sect">
        <div class="threat">
          <span class="swatch" style="--sw: var(--cat-ts)"></span>
          <span class="threat-name">Tropical Storm Bertha</span>
          <span class="chip">Bearing down</span>
        </div>

        <div class="headline">
          <div class="big">36 mi <small>south of you</small></div>
          <div class="when">Closest pass Wed 5:00 PM · in 25 hours</div>
          <div class="band">Two-thirds of past NHC forecasts landed within <b>46 mi</b> of that point.
            <b>Your home is inside that band.</b></div>
        </div>
      </div>

      <div class="sect">${hero}</div>

      <div class="sect">
        <div class="figs">
          <div>
            <div class="k">When closest</div>
            <div class="v" style="color: var(--cat-ts)">43 kt</div>
            <div class="s">Tropical storm</div>
          </div>
          <div>
            <div class="k">Right now</div>
            <div class="v">177 mi</div>
            <div class="s">ESE · closing</div>
          </div>
          <div>
            <div class="k">Peak</div>
            <div class="v">50 kt</div>
            <div class="s">already past</div>
          </div>
        </div>
        <div class="detail-soft" style="margin-top: var(--space-snug)">
          Weakening as it approaches — strongest now, 43 kt when it passes you.
        </div>
      </div>

      <div class="sect">
        <div class="detail-kicker">In effect</div>
        <div class="ww" style="margin-top: 6px">
          <span class="bar-mark"></span>
          <span>
            <span class="t">Tropical Storm Warning</span>
            <span class="z">Bay/Gulf County Line, Florida to Morgan City, Louisiana ·
              Metropolitan New Orleans and Lake Pontchartrain</span>
          </span>
        </div>
        <div class="detail-soft" style="margin-top: var(--space-snug)">
          NHC names the zones, not their outlines. Landfall can&rsquo;t yet check whether your exact
          address sits inside one.
        </div>
      </div>

      <div class="sect">
        <div class="detail-kicker">What happens when</div>
        <div style="margin-top: var(--space-snug)">${heroCountdown(compactCountdown)}</div>
      </div>

      <div class="sect">
        <div class="detail-kicker">Bertha right now</div>
        <dl class="detail-vitals" style="margin-top: 6px">
          <dt>Winds</dt><dd>58 mph (50 kt)</dd>
          <dt>Gusts</dt><dd>69 mph (60 kt)</dd>
          <dt>Pressure</dt><dd>995 mb</dd>
          <dt>Moving</dt><dd>NW at 6 mph (5 kt)</dd>
        </dl>
        <div class="stamp">NHC advisory 10 · issued ${NOW_LABEL} · 0 min ago</div>
      </div>

      <div class="sect">
        <button class="edithome" type="button">
          ${homeIcon()}
          <span class="addr">New Orleans, Louisiana</span>
          <span class="go">Edit ›</span>
        </button>
      </div>

    </div>
  </div>`;
}

/* ------------------------------------------------------------ other states */
function stateAllClear() {
  return `
  <div class="drawer">
    <header class="drawer-head">
      <div class="drawer-title-slot"><h1 class="drawer-title">Home</h1></div>
      <button class="drawer-icon-btn" type="button" aria-label="Edit home">${pencil()}</button>
      <button class="drawer-icon-btn" type="button" aria-label="Close">${xIcon()}</button>
    </header>
    <div class="drawer-body">
      <div class="sect">
        <div class="threat">
          <span class="swatch" style="--sw: var(--text-muted)"></span>
          <span class="threat-name">Nothing bearing down</span>
          <span class="chip" data-tone="calm">All clear</span>
        </div>
        <div class="headline">
          <div class="big" style="font-size: 1.15rem">No storm is closing on New Orleans</div>
          <div class="when">Three cyclones are active worldwide. The nearest is 2,180 mi away
            and moving away from you.</div>
        </div>
      </div>
      <div class="sect">
        <div class="detail-kicker">Nearest storm</div>
        <div class="threat" style="padding-top: 6px">
          <span class="swatch" style="--sw: var(--cat-1)"></span>
          <span class="threat-name" style="font-size: 0.9rem">Hurricane Cristobal</span>
          <span class="detail-soft" style="margin-left:auto">2,180 mi ESE ›</span>
        </div>
      </div>
      <div class="sect">
        <div class="stamp">NHC and GDACS both answered · checked 3 min ago</div>
      </div>
      <div class="sect">
        <button class="edithome" type="button">${homeIcon()}
          <span class="addr">New Orleans, Louisiana</span><span class="go">Edit ›</span></button>
      </div>
    </div>
  </div>`;
}

function stateUnavailable() {
  return `
  <div class="drawer">
    <header class="drawer-head">
      <div class="drawer-title-slot"><h1 class="drawer-title">Home</h1></div>
      <button class="drawer-icon-btn" type="button" aria-label="Edit home">${pencil()}</button>
      <button class="drawer-icon-btn" type="button" aria-label="Close">${xIcon()}</button>
    </header>
    <div class="drawer-body">
      <div class="sect">
        <div class="threat">
          <span class="swatch" style="--sw: var(--error)"></span>
          <span class="threat-name">Can&rsquo;t say right now</span>
        </div>
        <div class="headline">
          <div class="big" style="font-size: 1.05rem; line-height:1.35">
            NHC didn&rsquo;t answer. This is <em>not</em> an all&#8209;clear.</div>
          <div class="when">GDACS answered and has nothing within 1,500 mi of you —
            but GDACS does not cover the Atlantic in detail.</div>
        </div>
      </div>
      <div class="sect">
        <div class="detail-kicker">Last good answer</div>
        <div class="detail-figure">2 h 14 m ago — nothing bearing down</div>
        <div class="detail-soft" style="margin-top:6px">Stale data with its age on it beats a blank screen.</div>
        <button class="edithome" type="button" style="margin-top: var(--space-snug); color: var(--text-primary)">
          <span class="addr">Try NHC again</span><span class="go">↻</span></button>
      </div>
      <div class="sect">
        <button class="edithome" type="button">${homeIcon()}
          <span class="addr">New Orleans, Louisiana</span><span class="go">Edit ›</span></button>
      </div>
    </div>
  </div>`;
}

function stateNoHome() {
  return `
  <div class="drawer">
    <header class="drawer-head">
      <div class="drawer-title-slot"><h1 class="drawer-title">Home</h1></div>
      <button class="drawer-icon-btn" type="button" aria-label="Close">${xIcon()}</button>
    </header>
    <div class="drawer-body">
      <div class="sect">
        <div class="headline">
          <div class="big" style="font-size: 1.1rem; line-height:1.35">Set a home and this becomes
            a page about you.</div>
          <div class="when">Distance, closest pass, how strong it is when it gets there, and how long
            you have. Your coordinates never leave this phone.</div>
        </div>
      </div>
      <div class="sect">
        <button class="edithome" type="button" style="color: var(--text-primary)">
          <span class="addr">Use my location</span><span class="go">›</span></button>
        <button class="edithome" type="button" style="color: var(--text-primary)">
          <span class="addr">Search for an address</span><span class="go">›</span></button>
        <button class="edithome" type="button" style="color: var(--text-primary)">
          <span class="addr">Drop a pin on the globe</span><span class="go">›</span></button>
      </div>
      <div class="sect">
        <div class="held">
          <div class="h">Reminder</div>
          <div class="b">This is the whole of the old Home drawer. In the rework it lives behind
            &ldquo;Edit home&rdquo; and is only the first thing you see when no home is set.</div>
        </div>
      </div>
    </div>
  </div>`;
}

function stateGdacs() {
  return `
  <div class="drawer">
    <header class="drawer-head">
      <div class="drawer-title-slot"><h1 class="drawer-title">Home</h1></div>
      <button class="drawer-icon-btn" type="button" aria-label="Edit home">${pencil()}</button>
      <button class="drawer-icon-btn" type="button" aria-label="Close">${xIcon()}</button>
    </header>
    <div class="drawer-body">
      <div class="sect">
        <div class="threat">
          <span class="swatch" style="--sw: var(--cat-ts)"></span>
          <span class="threat-name">Tropical Cyclone Halima</span>
          <span class="chip" data-tone="calm">Nearest</span>
        </div>
        <div class="headline">
          <div class="big">263 mi <small>north-northeast</small></div>
          <div class="when">GDACS publishes no heading, so Landfall can&rsquo;t tell you whether
            this one is closing.</div>
        </div>
      </div>
      <div class="sect">
        <div class="detail-kicker">Closest approach</div>
        <div class="detail-figure">118 mi · Thu 9:00 AM</div>
        <div class="detail-soft" style="margin-top:6px">
          From GDACS centre positions. No forecast wind, so there is no
          &ldquo;how strong when closest&rdquo; to give you.</div>
      </div>
      <div class="sect">
        <div class="held">
          <div class="h">Not available from this source</div>
          <div class="b">Strength curve, gusts, category and watch/warning products are NHC-only.
            An honest gap, not a broken panel.</div>
        </div>
      </div>
      <div class="sect">
        <button class="edithome" type="button">${homeIcon()}
          <span class="addr">Darwin, Northern Territory</span><span class="go">Edit ›</span></button>
      </div>
    </div>
  </div>`;
}

/* ------------------------------------------------------------------ render */
function phone(inner) {
  return `<div class="phone">
    <div class="globe"></div><div class="stormdot"></div><div class="homeglyph"></div>
    ${inner}
  </div>`;
}

const HEROES = {
  a: { title: 'A · The Approach',
       cap: '<b>Home at the centre, drawn to scale.</b> The track&rsquo;s real bearing and distance, so the picture is the geometry. The dashed disc is NHC&rsquo;s own two-thirds error circle at the closest pass — it reaches the house, and that is the point.',
       build: () => dashboard(heroApproach(), { compactCountdown: true }) },
  b: { title: 'B · Linked lanes',
       cap: '<b>Strength over distance, one clock.</b> Most information per pixel. The shaded ribbon is the same error band, and where it touches the home line, &ldquo;directly overhead&rdquo; is inside the forecast.',
       build: () => dashboard(heroLinked(), { compactCountdown: true }) },
  c: { title: 'C · Countdown only',
       cap: '<b>No picture at all.</b> Clearest, most accessible, survives a 60&nbsp;vh sheet without scrolling past the point. This is also the form a screen reader gets for A and B, so it has to exist either way.',
       build: () => dashboard('<div class="detail-kicker">Countdown</div><div style="margin-top:var(--space-snug)">' + heroCountdown(false) + '</div>', { compactCountdown: true }) },
};

function renderHeroes(which) {
  const keys = which === 'all' ? ['a','b','c'] : [which];
  document.getElementById('heroes').innerHTML = keys.map(k => `
    <figure class="cell" style="margin:0">
      ${phone(HEROES[k].build())}
      <figcaption><strong>${HEROES[k].title}</strong><br>${HEROES[k].cap}</figcaption>
    </figure>`).join('');
}

function renderStates() {
  const list = [
    [stateAllClear(),   'Nothing bearing down', 'A calm sentence and the nearest storm as a way out. Never blank, never a spinner that stopped.'],
    [stateUnavailable(),'Source unavailable',   'The §5 case that matters most. An outage must not read as an all-clear, and the last good answer keeps its age.'],
    [stateNoHome(),     'No home set',          'The old drawer, demoted. It is the whole screen only when there is nothing else to say.'],
    [stateGdacs(),      'GDACS-only storm',     'No heading, no wind curve, no watch/warning. Degraded honestly rather than filled in.'],
  ];
  document.getElementById('states').innerHTML = list.map(([d,t,c]) => `
    <figure class="cell" style="margin:0">
      ${phone(d)}
      <figcaption><strong>${t}</strong><br>${c}</figcaption>
    </figure>`).join('');
}

/* controls */
document.querySelectorAll('[data-variant]').forEach(b => b.addEventListener('click', () => {
  document.querySelectorAll('[data-variant]').forEach(o => o.setAttribute('aria-pressed', String(o === b)));
  renderHeroes(b.dataset.variant);
}));
document.querySelectorAll('[data-theme-set]').forEach(b => b.addEventListener('click', () => {
  document.querySelectorAll('[data-theme-set]').forEach(o => o.setAttribute('aria-pressed', String(o === b)));
  document.documentElement.dataset.theme = b.dataset.themeSet;
}));
document.querySelectorAll('[data-sheet]').forEach(b => b.addEventListener('click', () => {
  document.querySelectorAll('[data-sheet]').forEach(o => o.setAttribute('aria-pressed', String(o === b)));
  const pct = parseFloat(b.dataset.sheet) / 100;
  document.documentElement.style.setProperty('--sheet-height', `calc(660px * ${pct})`);
}));

document.documentElement.style.setProperty('--sheet-height', 'calc(660px * 0.60)');
renderHeroes('a');
renderStates();
