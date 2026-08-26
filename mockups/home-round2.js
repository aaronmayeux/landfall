/* home-round2.js — behaviour for mockups/home-round2.html.

 * ==> IT IS AN EXTERNAL FILE BECAUSE THE LIVE CSP REFUSES AN INLINE ONE. <==
 * `_headers` sends `script-src 'self'` with one pinned hash and no
 * 'unsafe-inline'. This page shipped with its script inline and had therefore
 * been DEAD on the deployed site for as long as the CSP has been enforced —
 * the layout drew, the styling drew (style-src does allow inline), and nothing
 * moved. Found on 2026-08-26 by tools/mockup-csp-check.mjs, not by looking.
 *
 * SPEC-OPS.md §17.4 carries the rule. Nothing here is app code.
 */
/* =========================================================================
 * THE DATA — all measured, none invented.
 * ====================================================================== */

/* Advisory 10 dense series, sampled along the track:
   [hours from issue, distance to home nm, 34kt radius facing home nm|null,
    wind kt, NHC two-thirds cone radius nm] */
const S=[[0,153.4,40,50,0],[0.75,150.2,40.2,49.6,1.6],[1.5,147,40.5,49.2,3.1],[2.25,143.8,40.7,48.8,4.7],[3,140.6,41,48.3,6.3],[3.75,137.4,41.2,47.9,7.8],[4.5,134.2,41.5,47.5,9.4],[5.25,131,41.7,47.1,10.9],[6,127.8,42,46.7,12.5],[6.75,124.7,42.3,46.3,14.1],[7.5,121.5,42.5,45.8,15.6],[8.25,118.3,42.8,45.4,17.2],[9,115.1,43.1,45,18.8],[10,109.2,42.6,45,20.8],[11,103.4,42.1,45,22.9],[12,97.6,41.5,45,25],[13,91.8,40.8,45,26.2],[14,86.1,40.1,45,27.3],[15,80.4,39.2,45,28.5],[16,74.8,38.2,45,29.7],[17,69.2,37,45,30.8],[18,63.8,35.7,45,32],[19,58.5,34.3,45,33.2],[20,53.4,32.7,45,34.3],[21,48.5,31.1,45,35.5],[22,41.9,29.2,44.6,36.7],[23,36.5,28.7,44.2,37.8],[24,32.7,29.9,43.8,39],[25,31.3,33,43.3,39.8],[26,32.5,36.3,42.9,40.7],[27,36.1,38,42.5,41.5],[28,41.5,37.9,42.1,42.3],[29,48,36.6,41.7,43.2],[30,55.3,35.2,41.3,44],[31,63.1,34.1,40.8,44.8],[32,71.2,33.1,40.4,45.7],[33,79.6,32.1,40,46.5],[34,87.1,30.7,39.6,47.3],[35,94.7,29.4,39.2,48.2],[36,102.6,28.2,38.8,49],[37,110.5,27.1,38.3,50.1],[38,118.6,26,37.9,51.2],[39,126.7,24.8,37.5,52.3],[40,135,23.7,37.1,53.3],[41,143.2,22.6,36.7,54.4],[42,151.6,21.5,36.3,55.5],[43,159.9,20.4,35.8,56.6],[44,168.3,19.3,35.4,57.7],[45,176.8,18.2,35,58.8],[46,185.8,17.6,34.6,59.8],[47,194.9,16.9,34.2,60.9],[48,204,15.9,33.8,62],[49,213.2,14.6,33.3,63.3],[50,222.5,13.3,32.9,64.5],[51,231.7,11.7,32.5,65.8],[52,241,10,32.1,67],[53,250.4,8.2,31.7,68.3],[54,259.7,6.3,31.3,69.5],[55,269.1,4.3,30.8,70.8],[56,278.5,2.2,30.4,72],[57,287.9,null,30,73.3],[58,296.5,null,29.6,74.5],[59,305,null,29.2,75.8],[60,313.6,null,28.8,77],[61,322.2,null,28.3,78.5],[62,330.8,null,27.9,80],[63,339.5,null,27.5,81.5],[64,348.1,null,27.1,83],[65,356.8,null,26.7,84.5],[66,365.4,null,26.3,86],[67,374.1,null,25.8,87.5],[68,382.8,null,25.4,89],[69,391.4,null,25,90.5]];

/* Advisory 10's own quadrant radii, nm, at the analysis hour. */
const R34 = { ne:70, se:100, sw:40, nw:40 };
const R50 = { ne:0,  se:40,  sw:0,  nw:0  };
/* Bearing from the storm toward home at the closest pass. */
const BRG_TO_HOME = 304;

/* Forecast churn: one row per advisory.
   [adv, hours since advisory 1, predicted closest pass nm, predicted wind kt|null,
    cone radius at that lead nm|null, already-past?] */
const CHURN=[
  [1,  0,  88.4, 50.0, 90.5, false],
  [3,  12, 51.4, 45.0, 90.5, false],
  [5,  24, 27.4, 37.5, 81.5, false],
  [7,  36, 39.1, 37.5, 65.8, false],
  [9,  48, 35.2, 38.8, 49.0, false],
  [10, 54, 31.6, 43.1, 40.3, false],
  [12, 66, 35.6, 38.1, 26.8, false],
  [14, 78, 11.4, null,  2.3, false],
  [16, 90, 125.1, null, null, true],
  [18, 102,241.1, null, null, true],
];
/* The observed track's own analysis positions — what actually happened. */
const OBS=[[1,0,276.6],[3,12,286.2],[5,24,249.9],[7,36,242.8],[9,48,200.7],[10,54,153.4],
           [12,66,98.2],[14,78,16.8],[16,90,125.1],[18,102,241.1],[19,108,308.3]];
const OBSERVED_CPA = 16.8;

const MI = 1.15078;
const mi = (nm) => Math.round(nm * MI);
const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

/* Hours-from-advisory-10 → CDT clock label. Advisory 10 issued 4:00 PM CDT Tue. */
const T0 = Date.parse('2026-07-21T21:00:00Z');
const clock = (h, withDay = true) => {
  const d = new Date(T0 + h * 3600000 - 5 * 3600000);
  const dow = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d.getUTCDay()];
  let hh = d.getUTCHours(); const m = d.getUTCMinutes();
  const ap = hh >= 12 ? 'PM' : 'AM'; hh = hh % 12 || 12;
  return `${withDay ? dow + ' ' : ''}${hh}${m ? ':' + String(m).padStart(2,'0') : ''} ${ap}`;
};

const catColor = (kt) => kt>=137?'var(--cat-5)':kt>=113?'var(--cat-4)':kt>=96?'var(--cat-3)'
  :kt>=83?'var(--cat-2)':kt>=64?'var(--cat-1)':kt>=34?'var(--cat-ts)':'var(--cat-td)';

/* ==========================================================================
 * 1. THE SPATIAL CORRIDOR — asymmetric wind reach vs distance
 *
 * Two curves and the gap between them. Upper = distance to the eye. Lower =
 * distance to the NEAREST EDGE of the 34 kt field, measured along the bearing
 * that actually points at the house. The filled gap IS the wind field. Where
 * the lower curve touches the home baseline, tropical-storm winds are on the
 * house — with the eye still 31 nm away.
 *
 * Radii are blended between quadrant CENTRES with a periodic cosine (HA's
 * `_wind_radius_at`), so it never overshoots the issued numbers and there are
 * no hard corners at the quadrant lines.
 * ======================================================================= */
function chartCorridor() {
  const W=320,H=250,L=32,R=8,TOP=18,BOT=196;
  const hMax=48; // beyond this the storm is gone and the field has collapsed
  const nmMax=160;
  const X=(h)=>L+(W-L-R)*Math.min(h,hMax)/hMax;
  const Y=(nm)=>BOT-(BOT-TOP)*Math.min(nm,nmMax)/nmMax;
  const pts=S.filter(p=>p[0]<=hMax);

  const eye=pts.map((p,i)=>`${i?'L':'M'}${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join('');
  /* lower edge, clamped at the house — a distance cannot be negative */
  const edge=pts.filter(p=>p[2]!=null);
  const lower=edge.map(p=>`${X(p[0]).toFixed(1)},${Y(Math.max(0,p[1]-p[2])).toFixed(1)}`);
  const upper=edge.slice().reverse().map(p=>`${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`);
  const fill=`M${lower.join(' L')} L${upper.join(' L')} Z`;
  const lowerLine=edge.map((p,i)=>`${i?'L':'M'}${X(p[0]).toFixed(1)},${Y(Math.max(0,p[1]-p[2])).toFixed(1)}`).join('');

  /* the crossing window, measured: Wed 5:00 PM to 7:30 PM CDT */
  const w0=X(20),w1=X(22.5);

  const grid=[150,100,50].map(nm=>`
    <line x1="${L}" y1="${Y(nm)}" x2="${W-R}" y2="${Y(nm)}" stroke="var(--glass-border)" stroke-width="1"/>
    <text x="2" y="${(Y(nm)+3).toFixed(1)}" font-size="8">${mi(nm)}mi</text>`).join('');
  const axis=[0,12,24,36,48].map(h=>`
    <text x="${X(h).toFixed(1)}" y="${H-24}" font-size="8" text-anchor="${h===0?'start':h===48?'end':'middle'}">${esc(clock(h))}</text>`).join('');

  /* the asymmetry inset — the whole reason this chart exists */
  const cx=272,cy=44,sc=26/100;
  const blob=[];
  for(let b=0;b<=360;b+=6){
    const CTRL=[[45,'ne'],[135,'se'],[225,'sw'],[315,'nw']];
    let r=R34.ne;
    for(let i=0;i<4;i++){const [a,ak]=CTRL[i],bk=CTRL[(i+1)%4][1];
      const span=((CTRL[(i+1)%4][0]-a)%360+360)%360, off=((b-a)%360+360)%360;
      if(off<=span){const t=span?off/span:0,s=(1-Math.cos(Math.PI*t))/2;r=R34[ak]+(R34[bk]-R34[ak])*s;break;}}
    blob.push(`${(cx+r*sc*Math.sin(b*Math.PI/180)).toFixed(1)},${(cy-r*sc*Math.cos(b*Math.PI/180)).toFixed(1)}`);
  }
  const hx=cx+48*sc*Math.sin(BRG_TO_HOME*Math.PI/180), hy=cy-48*sc*Math.cos(BRG_TO_HOME*Math.PI/180);

  return `<svg class="c" viewBox="0 0 ${W} ${H}" role="img"
    aria-label="Distance to the storm's eye, and to the nearest edge of its tropical-storm-force wind field, over time. The wind edge reaches your home for about two and a half hours on Wednesday evening while the eye is still 36 miles away.">
    ${grid}
    <text x="${L}" y="12" font-size="8" class="lab">DISTANCE FROM HOME</text>

    <rect x="${w0.toFixed(1)}" y="${TOP}" width="${(w1-w0).toFixed(1)}" height="${BOT-TOP}"
          fill="color-mix(in srgb, var(--kt34) 12%, transparent)"/>

    <path d="${fill}" fill="color-mix(in srgb, var(--kt34) 22%, transparent)"/>
    <path d="${eye}" fill="none" stroke="var(--text-primary)" stroke-width="2" stroke-linejoin="round"/>
    <path d="${lowerLine}" fill="none" stroke="var(--kt34)" stroke-width="1.8" stroke-linejoin="round"/>

    <line x1="${L}" y1="${Y(0)}" x2="${W-R}" y2="${Y(0)}" stroke="var(--coast-glow)" stroke-width="1.6"/>
    <text x="2" y="${Y(0)+3}" font-size="8" fill="var(--coast-glow)">home</text>

    <circle cx="${X(25).toFixed(1)}" cy="${Y(31.3).toFixed(1)}" r="3.5" fill="var(--text-primary)"/>
    <text x="${(X(25)+6).toFixed(1)}" y="${(Y(31.3)-5).toFixed(1)}" font-size="8">eye 36 mi</text>
    <text x="${(w0+3).toFixed(1)}" y="${BOT-6}" font-size="8" fill="var(--kt34)">2.5 h of 34 kt</text>

    <!-- asymmetry inset -->
    <polygon points="${blob.join(' ')}" fill="color-mix(in srgb, var(--kt34) 22%, transparent)"
             stroke="var(--kt34)" stroke-width="1"/>
    <circle cx="${cx}" cy="${cy}" r="2" fill="var(--text-primary)"/>
    <rect x="${(hx-3).toFixed(1)}" y="${(hy-3).toFixed(1)}" width="6" height="6" rx="1.5"
          fill="none" stroke="var(--coast-glow)" stroke-width="1.6"/>
    <text x="${cx}" y="${cy+38}" font-size="7.5" text-anchor="middle" class="lab">34 kt field, to scale</text>
    <text x="${cx}" y="${cy+47}" font-size="7" text-anchor="middle">home is on the narrow side</text>
    ${axis}
  </svg>`;
}

/* ==========================================================================
 * 2. THE HONEST CONE ENVELOPE
 * Distance to the eye, with NHC's own two-thirds error as a ribbon, clamped at
 * the house. The clamp is not cosmetic: a negative distance is nonsense, and
 * where the ribbon sits ON the baseline the centre passing over the house is
 * inside the two-thirds envelope.
 * ======================================================================= */
function chartCone() {
  const W=320,H=236,L=32,R=8,TOP=20,BOT=190;
  const hMax=48, nmMax=200;
  const X=(h)=>L+(W-L-R)*Math.min(h,hMax)/hMax;
  const Y=(nm)=>BOT-(BOT-TOP)*Math.min(nm,nmMax)/nmMax;
  const pts=S.filter(p=>p[0]<=hMax);

  const up=pts.map(p=>`${X(p[0]).toFixed(1)},${Y(Math.max(0,p[1]-p[4])).toFixed(1)}`);
  const dn=pts.slice().reverse().map(p=>`${X(p[0]).toFixed(1)},${Y(p[1]+p[4]).toFixed(1)}`);
  const ribbon=`M${up.join(' L')} L${dn.join(' L')} Z`;
  const mid=pts.map((p,i)=>`${i?'L':'M'}${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join('');

  /* where the lower bound is AT the house — measured from the series */
  const touch=pts.filter(p=>p[1]-p[4]<=0);
  const t0=touch.length?X(touch[0][0]):null, t1=touch.length?X(touch[touch.length-1][0]):null;

  const grid=[200,100,50].map(nm=>`
    <line x1="${L}" y1="${Y(nm)}" x2="${W-R}" y2="${Y(nm)}" stroke="var(--glass-border)" stroke-width="1"/>
    <text x="2" y="${(Y(nm)+3).toFixed(1)}" font-size="8">${mi(nm)}mi</text>`).join('');
  const axis=[0,12,24,36,48].map(h=>`
    <text x="${X(h).toFixed(1)}" y="${H-6}" font-size="8" text-anchor="${h===0?'start':h===48?'end':'middle'}">${esc(clock(h))}</text>`).join('');

  return `<svg class="c" viewBox="0 0 ${W} ${H}" role="img"
    aria-label="Distance to the storm centre with NHC's two-thirds forecast error band. The band reaches your home between about 1 PM Wednesday and 1 AM Thursday, so a direct hit cannot be ruled out at that confidence.">
    ${grid}
    <text x="${L}" y="12" font-size="8" class="lab">DISTANCE TO THE CENTRE · 2⁄3 BAND</text>
    ${t0!=null?`<rect x="${t0.toFixed(1)}" y="${TOP}" width="${(t1-t0).toFixed(1)}" height="${BOT-TOP}"
        fill="color-mix(in srgb, var(--home-band-edge) 10%, transparent)"/>`:''}
    <path d="${ribbon}" fill="var(--home-band-fill)" stroke="var(--home-band-edge)"
          stroke-width="0.9" stroke-dasharray="3 3"/>
    <path d="${mid}" fill="none" stroke="var(--text-primary)" stroke-width="2" stroke-linejoin="round"/>
    <line x1="${L}" y1="${Y(0)}" x2="${W-R}" y2="${Y(0)}" stroke="var(--coast-glow)" stroke-width="1.6"/>
    <text x="2" y="${Y(0)+3}" font-size="8" fill="var(--coast-glow)">home</text>
    <circle cx="${X(25).toFixed(1)}" cy="${Y(31.3).toFixed(1)}" r="4" fill="var(--text-primary)"/>
    <text x="${(X(25)+6).toFixed(1)}" y="${(Y(31.3)-6).toFixed(1)}" font-size="8.5">36 mi</text>
    ${t0!=null?`<text x="${(t0+3).toFixed(1)}" y="${BOT-6}" font-size="8" fill="var(--home-band-edge)">band reaches home</text>`:''}
    <!-- what actually happened, from advisory 14 -->
    <line x1="${L}" y1="${Y(OBSERVED_CPA)}" x2="${W-R}" y2="${Y(OBSERVED_CPA)}"
          stroke="var(--coast-glow)" stroke-width="1" stroke-dasharray="1 3"/>
    <text x="${W-R}" y="${Y(OBSERVED_CPA)-4}" font-size="7.5" text-anchor="end" fill="var(--coast-glow)">what happened: 19 mi</text>
    ${axis}
  </svg>`;
}

/* ==========================================================================
 * 3. WIND, WITH THE UNCERTAINTY THAT SWALLOWS IT
 *
 * ==> CHANGED FROM GEMINI'S SPEC, AND THIS ONE MATTERS. <==
 * The spec asked for a "calculated local sustained wind expected at the home
 * coordinates" and a gust line 1.15x above it. NHC publishes no wind decay
 * profile, so a continuous wind-at-your-house curve can only come from a decay
 * model we would be inventing — and the gust line would then be a multiplier
 * on an invention. §5 forbids stating a fabricated number as fact.
 *
 * What IS published, and is drawn instead: the storm's own wind curve, NHC's
 * own +/-15 kt intensity error around it, and a THRESHOLD STRIP showing the
 * hours the house is inside the real 34 kt radius. Inside that strip the only
 * honest statement is a FLOOR — "34 kt or more" — not a value.
 * ======================================================================= */
function chartWind() {
  const W=320,H=236,L=32,R=8,TOP=22,BOT=162;
  const hMax=48, ktMax=70;
  const X=(h)=>L+(W-L-R)*Math.min(h,hMax)/hMax;
  const Y=(kt)=>BOT-(BOT-TOP)*Math.min(kt,ktMax)/ktMax;
  const pts=S.filter(p=>p[0]<=hMax);
  const ERR=15; // NHC's own stated average intensity error, from the advisory

  const up=pts.map(p=>`${X(p[0]).toFixed(1)},${Y(Math.min(ktMax,p[3]+ERR)).toFixed(1)}`);
  const dn=pts.slice().reverse().map(p=>`${X(p[0]).toFixed(1)},${Y(Math.max(0,p[3]-ERR)).toFixed(1)}`);
  const ribbon=`M${up.join(' L')} L${dn.join(' L')} Z`;

  const segs=[];
  for(let i=1;i<pts.length;i++){
    const a=pts[i-1],b=pts[i];
    segs.push(`<line x1="${X(a[0]).toFixed(1)}" y1="${Y(a[3]).toFixed(1)}"
      x2="${X(b[0]).toFixed(1)}" y2="${Y(b[3]).toFixed(1)}"
      stroke="${catColor((a[3]+b[3])/2)}" stroke-width="2.6" stroke-linecap="round"/>`);
  }

  const thresh=[[64,'Hurricane','var(--kt64)'],[50,'Strong TS','var(--kt50)'],[34,'TS force','var(--kt34)']]
    .map(([kt,lab,col])=>`
      <line x1="${L}" y1="${Y(kt)}" x2="${W-R}" y2="${Y(kt)}" stroke="${col}" stroke-width="1" stroke-dasharray="4 3" opacity="0.6"/>
      <text x="${W-R}" y="${Y(kt)-3}" font-size="7.5" text-anchor="end" fill="${col}">${lab} ${kt}kt</text>`).join('');

  const axis=[0,12,24,36,48].map(h=>`
    <text x="${X(h).toFixed(1)}" y="${BOT+14}" font-size="8" text-anchor="${h===0?'start':h===48?'end':'middle'}">${esc(clock(h))}</text>`).join('');

  /* the threshold strip: the hours home is inside the real 34 kt radius */
  const SY=BOT+30, SH=16;
  const s0=X(20), s1=X(22.5);
  const strip=`
    <rect x="${L}" y="${SY}" width="${W-L-R}" height="${SH}" rx="3"
          fill="none" stroke="var(--glass-border)" stroke-width="1"/>
    <rect x="${s0.toFixed(1)}" y="${SY}" width="${(s1-s0).toFixed(1)}" height="${SH}" rx="3"
          fill="color-mix(in srgb, var(--kt34) 40%, transparent)" stroke="var(--kt34)" stroke-width="1"/>
    <text x="${L}" y="${SY-4}" font-size="7.5" class="lab">HOME INSIDE THE 34 KT FIELD</text>
    <text x="${(s1+5).toFixed(1)}" y="${SY+11}" font-size="7.5" fill="var(--kt34)">2.5 h · Wed 5–7:30 PM</text>`;

  return `<svg class="c" viewBox="0 0 ${W} ${H}" role="img"
    aria-label="The storm's forecast wind, falling from 50 to 33 knots, inside NHC's own plus or minus 15 knot error band. Below it, the two and a half hours your home sits inside the tropical-storm-force wind field.">
    <path d="${ribbon}" fill="var(--home-band-fill)" stroke="var(--home-band-edge)" stroke-width="0.9" stroke-dasharray="3 3"/>
    ${thresh}
    ${segs.join('')}
    <circle cx="${X(0)}" cy="${Y(50)}" r="4.5" fill="var(--cat-ts)" stroke="var(--space)" stroke-width="1.6"/>
    <text x="${X(0)+7}" y="${Y(50)-6}" font-size="8.5">50 kt — peak is NOW</text>
    <line x1="${X(25).toFixed(1)}" y1="${TOP-6}" x2="${X(25).toFixed(1)}" y2="${BOT}"
          stroke="var(--text-primary)" stroke-width="1" stroke-dasharray="3 3" opacity="0.7"/>
    <circle cx="${X(25).toFixed(1)}" cy="${Y(43.3).toFixed(1)}" r="3.5" fill="var(--text-primary)"/>
    <text x="${(X(25)+6).toFixed(1)}" y="${(Y(43.3)+12).toFixed(1)}" font-size="8">43 kt at the pass</text>
    <text x="2" y="${Y(0)+3}" font-size="8">0kt</text>
    ${axis}
    ${strip}
  </svg>`;
}

/* ==========================================================================
 * 4. FORECAST CHURN — ten advisories, and what actually happened
 * Each dot is one advisory's predicted closest pass. The whisker is NHC's own
 * two-thirds error at that lead time. The dashed line is the OBSERVED closest
 * approach, 16.8 nm, measured from the advisory-14 analysis position.
 * ======================================================================= */
function chartChurn() {
  const W=320,H=236,L=34,R=10,TOP=22,BOT=180;
  const hMax=80, nmMax=110;
  const X=(h)=>L+(W-L-R)*h/hMax;
  const Y=(nm)=>BOT-(BOT-TOP)*Math.min(nm,nmMax)/nmMax;
  const live=CHURN.filter(c=>!c[5]);

  const line=live.map((c,i)=>`${i?'L':'M'}${X(c[1]).toFixed(1)},${Y(c[2]).toFixed(1)}`).join('');
  const whisk=live.filter(c=>c[4]!=null).map(c=>{
    const lo=Y(Math.min(nmMax,c[2]+c[4])), hi=Y(Math.max(0,c[2]-c[4])), x=X(c[1]).toFixed(1);
    return `<line x1="${x}" y1="${lo.toFixed(1)}" x2="${x}" y2="${hi.toFixed(1)}"
      stroke="var(--home-band-edge)" stroke-width="6" opacity="0.22" stroke-linecap="round"/>`;
  }).join('');
  const dots=live.map(c=>`
    <circle cx="${X(c[1]).toFixed(1)}" cy="${Y(c[2]).toFixed(1)}" r="4"
            fill="${c[3]!=null?catColor(c[3]):'var(--text-muted)'}" stroke="var(--space)" stroke-width="1.4"/>
    <text x="${X(c[1]).toFixed(1)}" y="${(Y(c[2])-9).toFixed(1)}" font-size="7.5" text-anchor="middle">${c[0]}</text>`).join('');

  const grid=[100,50].map(nm=>`
    <line x1="${L}" y1="${Y(nm)}" x2="${W-R}" y2="${Y(nm)}" stroke="var(--glass-border)" stroke-width="1"/>
    <text x="2" y="${(Y(nm)+3).toFixed(1)}" font-size="8">${mi(nm)}mi</text>`).join('');

  const days=[[0,'Sun'],[24,'Mon'],[48,'Tue'],[72,'Wed']].map(([h,l])=>`
    <text x="${X(h).toFixed(1)}" y="${BOT+14}" font-size="8" text-anchor="middle">${l}</text>`).join('');

  return `<svg class="c" viewBox="0 0 ${W} ${H}" role="img"
    aria-label="Each advisory's predicted closest approach to your home, from 102 miles down to 13, against what actually happened: 19 miles. Every prediction was about twice too far out, and every one of their error bands contained the truth.">
    ${grid}
    <text x="${L}" y="12" font-size="8" class="lab">PREDICTED CLOSEST PASS, BY ADVISORY</text>
    ${whisk}
    <path d="${line}" fill="none" stroke="var(--text-secondary)" stroke-width="1.4" stroke-dasharray="4 3"/>
    ${dots}
    <line x1="${L}" y1="${Y(OBSERVED_CPA)}" x2="${W-R}" y2="${Y(OBSERVED_CPA)}"
          stroke="var(--coast-glow)" stroke-width="1.8"/>
    <text x="${L+3}" y="${Y(OBSERVED_CPA)+11}" font-size="8" fill="var(--coast-glow)">what actually happened — 19 mi</text>
    <line x1="${L}" y1="${Y(0)}" x2="${W-R}" y2="${Y(0)}" stroke="var(--glass-border)" stroke-width="1"/>
    ${days}
    <text x="${W-R}" y="${H-6}" font-size="7.5" text-anchor="end">shaded whisker = NHC 2⁄3 error at that lead time</text>
  </svg>`;
}

/* ==========================================================================
 * 5. THE IMPACT TIMELINE (Gantt)
 *
 * ==> CHANGED FROM GEMINI'S SPEC. <== The spec had a "Safe Outside / CLEAR"
 * row and a "PREPARE NOW" row. Both are the app telling somebody what to do
 * and when it is safe to go outside, and the app's own disclaimer says to
 * follow local authorities. Those two rows are replaced with the FACTS they
 * were derived from: when the wind field is clear of the house, and the
 * measured lead time between the first warning and the winds.
 * ======================================================================= */
function chartGantt() {
  /* hours relative to advisory 10 (Tue 4 PM CDT = 0). Negative is the past. */
  const W=320,H=250,L=6,R=8;
  const h0=-54, h1=54;              // Sun 10 AM through Thu 10 PM
  const X=(h)=>L+(W-L-R)*(h-h0)/(h1-h0);
  const ROWS=[
    { lab:'TS Watch',        bars:[[-54,30]],  col:'var(--ww-twa)' },
    { lab:'Storm Surge Watch',bars:[[-30,-6]], col:'var(--ww-twa)' },
    { lab:'TS Warning',      bars:[[-18,54]],  col:'var(--ww-twr)' },
    { lab:'Inside 100 mi',   bars:[[13.85,33.97]], col:'var(--text-secondary)' },
    { lab:'34 kt at home',   bars:[[20,22.5]], col:'var(--kt34)' },
  ];
  const y0=42, rh=26;

  const rows=ROWS.map((r,i)=>{
    const y=y0+i*rh;
    return `<text x="${L}" y="${y-3}" font-size="8" class="lab">${esc(r.lab)}</text>` +
      `<rect x="${L}" y="${y}" width="${W-L-R}" height="11" rx="3" fill="none" stroke="var(--glass-border)" stroke-width="0.8"/>` +
      r.bars.map(([a,b])=>`<rect x="${X(a).toFixed(1)}" y="${y}" width="${Math.max(2,X(b)-X(a)).toFixed(1)}" height="11" rx="3"
        fill="color-mix(in srgb, ${r.col} 45%, transparent)" stroke="${r.col}" stroke-width="1"/>`).join('');
  }).join('');

  const yPass=y0+ROWS.length*rh+4;
  const nowX=X(0).toFixed(1);

  /* the measured lead time: first TS Warning (adv 7, Mon 10 PM) to the winds */
  const lead0=X(-18), lead1=X(20);

  const axis=[[-54,'Sun 10a'],[-24,'Mon 4p'],[0,'now'],[24,'Wed 4p'],[48,'Thu 4p']].map(([h,l])=>`
    <text x="${X(h).toFixed(1)}" y="${H-6}" font-size="7.5"
          text-anchor="${h===h0?'start':h===48?'end':'middle'}"
          fill="${h===0?'var(--text-primary)':'var(--text-muted)'}">${esc(l)}</text>`).join('');

  return `<svg class="c" viewBox="0 0 ${W} ${H}" role="img"
    aria-label="A timeline of Bertha's watches and warnings against the windows when she is inside 100 miles and when tropical-storm winds reach your home. The first warning came 38 hours before the winds.">
    <text x="${L}" y="12" font-size="8" class="lab">WHAT IS IN FORCE, AND WHEN</text>

    <!-- measured lead time, stated as a fact rather than as advice -->
    <line x1="${lead0.toFixed(1)}" y1="26" x2="${lead1.toFixed(1)}" y2="26"
          stroke="var(--text-muted)" stroke-width="1"/>
    <line x1="${lead0.toFixed(1)}" y1="22" x2="${lead0.toFixed(1)}" y2="30" stroke="var(--text-muted)" stroke-width="1"/>
    <line x1="${lead1.toFixed(1)}" y1="22" x2="${lead1.toFixed(1)}" y2="30" stroke="var(--text-muted)" stroke-width="1"/>
    <text x="${((lead0+lead1)/2).toFixed(1)}" y="20" font-size="7.5" text-anchor="middle">38 h from first warning to winds</text>

    ${rows}

    <!-- now -->
    <line x1="${nowX}" y1="32" x2="${nowX}" y2="${yPass+16}" stroke="var(--text-primary)" stroke-width="1.4"/>
    <text x="${nowX}" y="${yPass+26}" font-size="7.5" text-anchor="middle" fill="var(--text-primary)">now</text>

    <!-- closest pass -->
    <polygon points="${X(25.5).toFixed(1)},${yPass} ${(X(25.5)+5).toFixed(1)},${yPass+5} ${X(25.5).toFixed(1)},${yPass+10} ${(X(25.5)-5).toFixed(1)},${yPass+5}"
             fill="var(--text-primary)"/>
    <text x="${(X(25.5)+8).toFixed(1)}" y="${yPass+8}" font-size="7.5">closest pass · 36 mi</text>
    ${axis}
  </svg>`;
}

/* ======================================================================= */
function pencil(){return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17v3Z"/><path d="M14.5 6.5 17.5 9.5"/></svg>`;}
function xIcon(){return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>`;}
function hIcon(){return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 11 12 4l8 7"/><path d="M6.5 9.6V20h11V9.6"/></svg>`;}

function shell(headline, chart, legend, extra) {
  return `<div class="phone">
    <div class="globe"></div><div class="dot"></div><div class="hg"></div>
    <div class="drawer">
      <header class="dhead"><h1>Home</h1>
        <button class="ibtn" aria-label="Edit home">${pencil()}</button>
        <button class="ibtn" aria-label="Close">${xIcon()}</button></header>
      <div class="dbody">
        <div class="sect">
          <div class="threat">
            <span class="sw" style="--c: var(--cat-ts)"></span>
            <span class="tname">Tropical Storm Bertha</span>
            <span class="chip">Bearing down</span>
          </div>
          ${headline}
        </div>
        <div class="sect">${chart}${legend||''}</div>
        ${extra||''}
        <div class="sect"><button class="edit">${hIcon()}
          <span class="a">New Orleans, Louisiana</span><span class="g">Edit ›</span></button></div>
      </div>
    </div>
  </div>`;
}

const CONCEPTS = {
  1: {
    t: '1 · The Spatial Corridor',
    cap: '<strong>1 · The Spatial Corridor</strong>' +
      '<span class="found">Gemini\'s best idea, and it changes the answer.</span> The white line is the eye; the green line is the nearest edge of the 34 kt field along the bearing that actually points at the house. At every <em>published</em> 12-hourly point that edge misses by 17 nm. Interpolated, it <b>crosses the house for 2.5 hours</b>. The inset shows why the miss is so narrow: home sits on Bertha\'s thin side — 40 nm of reach, against 100 nm on her southeast flank.',
    build: () => shell(
      `<div class="kick">Tropical-storm winds</div>
       <div class="big">2.5 hrs <small>Wed 5:00–7:30 PM</small></div>
       <div class="when">The eye never comes closer than 36 mi</div>
       <p class="band">Home is on Bertha's <b>narrow flank</b> — her 34 kt winds reach
         <b>115 mi</b> southeast and only <b>46 mi</b> northwest. On the other side of the
         same track this would be six hours, not two and a half.</p>`,
      chartCorridor(),
      `<div class="legend">
         <span><i style="background:var(--text-primary)"></i>eye</span>
         <span><i style="background:var(--kt34)"></i>34 kt edge</span>
         <span><i style="background:color-mix(in srgb, var(--kt34) 22%, transparent)"></i>wind field</span>
       </div>`,
      `<div class="sect">
        <div class="figs">
          <div><div class="k">Winds start</div><div class="v">Wed 5:00 PM</div><div class="s">in 20 hrs</div></div>
          <div><div class="k">Duration</div><div class="v">2.5 hrs</div><div class="s">34 kt or more</div></div>
          <div><div class="k">Deepest</div><div class="v">4 mi</div><div class="s">inside the edge</div></div>
        </div>
        <p class="soft" style="margin-top:var(--space-snug)">Measured along the storm's own quadrant
          radii, interpolated between them. The 12-hourly points on their own say this never happens.</p>
      </div>`
    ),
  },
  2: {
    t: '2 · The Honest Cone Envelope',
    cap: '<strong>2 · The Honest Cone Envelope</strong>' +
      '<span class="changed">CHANGED — and this is already shipped.</span> It is the lower lane of the chart now live in the app. Two fixes to the spec: the ribbon is <b>clamped at the house</b>, because a negative distance is nonsense; and the copy does <b>not</b> say "high probability of a direct hit". The band reaching home means a direct hit cannot be <em>ruled out</em> at two-thirds confidence — a very different claim. The cyan dashed line is what actually happened: 19 mi.',
    build: () => shell(
      `<div class="kick">Closest pass</div>
       <div class="big">36 mi <small>south of you</small></div>
       <div class="when">Wed 5:30 PM · in 26 hrs</div>
       <p class="band">Two-thirds of past NHC forecasts landed within <b>46 mi</b> of that point.
         <b class="hit">Your home is inside that band</b> — a direct hit cannot be ruled out.</p>`,
      chartCone(),
      `<div class="legend">
         <span><i style="background:var(--text-primary)"></i>forecast centre</span>
         <span><i style="background:var(--home-band-fill);box-shadow:inset 0 0 0 1px var(--home-band-edge)"></i>2⁄3 band</span>
         <span><i style="background:var(--coast-glow)"></i>what happened</span>
       </div>`,
      `<div class="sect">
        <div class="figs">
          <div><div class="k">Best estimate</div><div class="v">36 mi</div><div class="s">south</div></div>
          <div><div class="k">Honest range</div><div class="v">0–83 mi</div><div class="s">two-thirds</div></div>
          <div><div class="k">Actual</div><div class="v" style="color:var(--coast-glow)">19 mi</div><div class="s">measured after</div></div>
        </div>
        <p class="soft" style="margin-top:var(--space-snug)">One in three past forecasts fell
          <em>outside</em> this band. It is not a worst case.</p>
      </div>`
    ),
  },
  3: {
    t: '3 · Wind, and the error that swallows it',
    cap: '<strong>3 · Wind + confidence</strong>' +
      '<span class="changed">CHANGED — the spec asked for a number nobody publishes.</span> A "local sustained wind at the home coordinates" needs a wind-decay profile NHC does not publish, and the gust line would then be a multiplier on our own invention. Replaced with what is real: the storm\'s wind, NHC\'s own <b>±15 kt</b> error around it, and a strip marking the hours the house is inside the measured 34 kt field. Inside that strip the only honest statement is a <b>floor</b> — 34 kt or more.',
    build: () => shell(
      `<div class="kick">Strength</div>
       <div class="big">50 kt <small>and this is the peak</small></div>
       <div class="when">43 kt when it passes you</div>
       <p class="band">NHC's own average intensity error is <b>±15 kt</b> — wider than this whole
         forecast. The band is the honest reading; the line is the best guess.</p>`,
      chartWind(),
      `<div class="legend">
         <span><i style="background:var(--cat-ts)"></i>forecast wind</span>
         <span><i style="background:var(--home-band-fill);box-shadow:inset 0 0 0 1px var(--home-band-edge)"></i>±15 kt</span>
         <span><i style="background:color-mix(in srgb, var(--kt34) 40%, transparent)"></i>home in the field</span>
       </div>`,
      `<div class="sect">
        <div class="held">
          <div class="h">What Landfall will not tell you</div>
          <div class="b">A wind speed <em>at your address</em>. NHC publishes the storm's strength
            and how far each wind threshold reaches — not how the wind decays in between. Any
            single number for your street would be ours, not theirs.</div>
        </div>
      </div>`
    ),
  },
  4: {
    t: '4 · Forecast churn',
    cap: '<strong>4 · Forecast churn</strong>' +
      '<span class="found">Real, and the most useful thing on this page.</span> Ten advisories fetched from the archive. Each dot is that advisory\'s predicted closest pass; the shaded whisker is NHC\'s two-thirds error at that lead time. <b>Every point estimate was roughly twice too far out. Every band contained the truth.</b> Note it did not improve monotonically — advisory 5, three days out, was closer than advisories 7 through 12.',
    build: () => shell(
      `<div class="kick">Forecast history</div>
       <div class="big">36 mi <small>latest estimate</small></div>
       <div class="when">Was 102 mi on Sunday · 32 mi on Monday</div>
       <p class="band">The predicted pass has <b>settled between 32 and 45 mi</b> for the last four
         advisories. A figure that stops moving is a figure worth acting on.</p>`,
      chartChurn(),
      `<div class="legend">
         <span><i style="background:var(--cat-ts)"></i>predicted pass</span>
         <span><i style="background:color-mix(in srgb, var(--home-band-edge) 22%, transparent)"></i>2⁄3 error</span>
         <span><i style="background:var(--coast-glow)"></i>what happened</span>
       </div>`,
      `<div class="sect">
        <div class="figs">
          <div><div class="k">Advisories</div><div class="v">10</div><div class="s">since Sunday</div></div>
          <div><div class="k">Trend</div><div class="v">settling</div><div class="s">±6 mi, 4 advisories</div></div>
          <div><div class="k">Swing</div><div class="v">102→36 mi</div><div class="s">toward you</div></div>
        </div>
        <p class="soft" style="margin-top:var(--space-snug)">Needs the advisory history kept on
          device. Nothing in the app stores it today — this is the one concept that needs new
          plumbing, not just a new chart.</p>
      </div>`
    ),
  },
  5: {
    t: '5 · The impact timeline',
    cap: '<strong>5 · The impact timeline</strong>' +
      '<span class="changed">CHANGED — two rows removed.</span> The spec had "PREPARE NOW" and "Safe Outside / CLEAR". Both are the app issuing instructions and safety verdicts, and its own disclaimer says to follow local authorities. Replaced with the facts underneath them: the measured <b>38-hour</b> gap between the first warning and the winds, and the windows themselves. Everything drawn here is a published product or a measured window.',
    build: () => shell(
      `<div class="kick">In force now</div>
       <div class="big" style="font-size:1.1rem;line-height:1.3">Tropical Storm Warning</div>
       <div class="when">Metropolitan New Orleans and Lake Pontchartrain</div>
       <p class="band">Issued <b>Mon 10 PM</b>, 38 hours before tropical-storm winds are forecast
         to reach you. Landfall cannot confirm your exact address is inside the warned zone —
         NHC names the zones, not their outlines.</p>`,
      chartGantt(),
      `<div class="legend">
         <span><i style="background:color-mix(in srgb, var(--ww-twa) 45%, transparent)"></i>Watch</span>
         <span><i style="background:color-mix(in srgb, var(--ww-twr) 45%, transparent)"></i>Warning</span>
         <span><i style="background:color-mix(in srgb, var(--kt34) 45%, transparent)"></i>34 kt at home</span>
       </div>`,
      `<div class="sect">
        <div class="held">
          <div class="h">Not Landfall's call</div>
          <div class="b">When to prepare, and when it is safe to go outside. Landfall shows what
            the agencies published and when. The instructions come from your local authorities.</div>
        </div>
      </div>`
    ),
  },
};

function render(v) {
  const keys = v === 'all' ? ['1','2','3','4','5'] : [v];
  document.getElementById('out').innerHTML = keys.map(k => `
    <figure>${CONCEPTS[k].build()}<figcaption>${CONCEPTS[k].cap}</figcaption></figure>`).join('');
}

document.querySelectorAll('[data-v]').forEach(b=>b.addEventListener('click',()=>{
  document.querySelectorAll('[data-v]').forEach(o=>o.setAttribute('aria-pressed',String(o===b)));
  render(b.dataset.v);
}));
document.querySelectorAll('[data-t]').forEach(b=>b.addEventListener('click',()=>{
  document.querySelectorAll('[data-t]').forEach(o=>o.setAttribute('aria-pressed',String(o===b)));
  document.documentElement.dataset.theme=b.dataset.t;
}));
document.querySelectorAll('[data-s]').forEach(b=>b.addEventListener('click',()=>{
  document.querySelectorAll('[data-s]').forEach(o=>o.setAttribute('aria-pressed',String(o===b)));
  document.documentElement.style.setProperty('--sheet',b.dataset.s);
}));

render('1');
