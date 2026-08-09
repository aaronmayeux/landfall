const { greatCircleNm, bearingDeg, densifyTrack } = await import('../lib/geo.js');
const HOME={lon:-90.0715,lat:29.9511}; const MI=1.15078;
/* HA's _wind_radius_at: quadrant radii are values at quadrant CENTRES
   (45/135/225/315), blended with a periodic cosine. Never overshoots. */
const CTRL=[[45,'ne'],[135,'se'],[225,'sw'],[315,'nw']];
function radiusAt(brg,r){
  const b=((brg%360)+360)%360;
  for(let i=0;i<4;i++){
    const [a,ak]=CTRL[i], bk=CTRL[(i+1)%4][1];
    const span=((CTRL[(i+1)%4][0]-a)%360+360)%360;
    const off=((b-a)%360+360)%360;
    if(off<=span){ const t=span?off/span:0; const s=(1-Math.cos(Math.PI*t))/2; return r[ak]+(r[bk]-r[ak])*s; }
  }
  return r.ne;
}
const q=(a)=>a?{ne:a[0],se:a[1],sw:a[2],nw:a[3]}:null;

function corridor(label, pts){
  console.log(`\n=== ${label} ===`);
  console.log('| tau h | lat | lon | dist nm | brg storm→home | 34kt radius facing home | gap nm | inside? |');
  for(const [h,lat,lon,r34] of pts){
    const nm=greatCircleNm(HOME.lon,HOME.lat,lon,lat);
    const b=bearingDeg(lon,lat,HOME.lon,HOME.lat);      // FROM STORM TO HOME
    const rr=r34?radiusAt(b,q(r34)):null;
    const gap=rr==null?null:nm-rr;
    console.log(`| ${h} | ${lat} | ${lon} | ${nm.toFixed(1)} | ${b.toFixed(0)}° | ${rr==null?'—':rr.toFixed(1)} | ${gap==null?'—':gap.toFixed(1)} | ${gap==null?'no field':(gap<=0?'*** YES ***':'no')} |`);
  }
}
// ADVISORY 10
corridor('ADVISORY 10 (Tue 4 PM CDT) — 34 kt reach toward home',[
 [0,29.4,-87.2,[70,100,40,40]],
 [9,29.6,-87.9,[60,90,50,40]],
 [21,29.5,-89.3,[50,90,60,30]],
 [33,29.3,-91.4,[30,60,60,20]],
 [45,29.4,-93.4,[0,60,40,0]],
 [57,29.8,-95.6,null],
 [69,30.3,-97.6,null],
]);
// ADVISORY 14 — what actually happened
corridor('ADVISORY 14 (Wed 4 PM CDT) — the field had DOUBLED',[
 [0,29.8,-89.8,[50,140,140,30]],
 [9,29.6,-91.3,[40,130,120,0]],
 [21,29.5,-93.9,[40,100,0,0]],
]);

/* Dense corridor for advisory 10: interpolate radii along the track so the
   crossing time can be found rather than snapped to a 12-hourly point. */
console.log('\n=== ADVISORY 10, DENSE — when does the 34 kt edge reach home? ===');
const P=[
 {lon:-87.2,lat:29.4,time:'2026-07-21T21:00:00Z',r:[70,100,40,40]},
 {lon:-87.9,lat:29.6,time:'2026-07-22T06:00:00Z',r:[60,90,50,40]},
 {lon:-89.3,lat:29.5,time:'2026-07-22T18:00:00Z',r:[50,90,60,30]},
 {lon:-91.4,lat:29.3,time:'2026-07-23T06:00:00Z',r:[30,60,60,20]},
 {lon:-93.4,lat:29.4,time:'2026-07-23T18:00:00Z',r:[0,60,40,0]},
];
const now=Date.parse('2026-07-21T21:00:00Z');
let prev=null, first=null, last=null, minGap=Infinity, minAt=null;
for(let i=0;i<P.length-1;i++){
  for(let s=0;s<24;s++){
    const f=s/24, a=P[i], b=P[i+1];
    const lon=a.lon+(b.lon-a.lon)*f, lat=a.lat+(b.lat-a.lat)*f;
    const t=Date.parse(a.time)+(Date.parse(b.time)-Date.parse(a.time))*f;
    const r={ne:a.r[0]+(b.r[0]-a.r[0])*f, se:a.r[1]+(b.r[1]-a.r[1])*f,
             sw:a.r[2]+(b.r[2]-a.r[2])*f, nw:a.r[3]+(b.r[3]-a.r[3])*f};
    const nm=greatCircleNm(HOME.lon,HOME.lat,lon,lat);
    const brg=bearingDeg(lon,lat,HOME.lon,HOME.lat);
    const gap=nm-radiusAt(brg,r);
    if(gap<minGap){minGap=gap;minAt=t;}
    if(prev!=null && (gap<=0)!==(prev<=0)){
      const iso=new Date(t).toISOString();
      if(gap<=0 && !first) first=iso; else if(gap>0 && first && !last) last=iso;
    }
    prev=gap;
  }
}
const cdt=(iso)=>new Date(Date.parse(iso)-5*3600e3).toISOString().slice(5,16).replace('T',' ');
console.log('closest the 34 kt EDGE gets to home:', minGap.toFixed(1),'nm at', new Date(minAt).toISOString(), '=', cdt(new Date(minAt).toISOString()),'CDT');
console.log('edge reaches home at :', first?`${first} = ${cdt(first)} CDT`:'never');
console.log('edge leaves home at  :', last?`${last} = ${cdt(last)} CDT`:'not within forecast');
if(first&&last) console.log('duration inside 34 kt:', ((Date.parse(last)-Date.parse(first))/3.6e6).toFixed(1),'hours');
