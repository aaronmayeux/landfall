globalThis.localStorage={getItem:()=>null,setItem(){},removeItem(){}};
const { greatCircleNm, bearingDeg } = await import('../lib/geo.js');
const { closestApproach } = await import('../data/home.js');
const { coneErrorNm } = await import('../lib/cone-error.js');
const HOME={lon:-90.0715,lat:29.9511};
const MI=1.15078;
const T=(dd,hhmm)=>`2026-07-${String(dd).padStart(2,'0')}T${hhmm.slice(0,2)}:${hhmm.slice(2)}:00Z`;

// [adv, issuedISO, lat, lon, wind, gust, mb, hdg, spd, r34(NE,SE,SW,NW)|null, forecast[[dd,hhmm,lat,lon,wind,gust,r34|null]]]
const ADV=[
 [1,'2026-07-19T15:00Z',28.0,-85.3,25,35,1011,340,2,null,[
   [20,'0000',28.2,-85.4,30,40,null],[20,'1200',28.5,-85.7,35,45,[50,50,0,0]],
   [21,'0000',28.8,-86.0,40,50,[60,50,0,30]],[21,'1200',29.1,-86.4,40,50,[80,80,0,50]],
   [22,'0000',29.4,-87.3,45,55,[80,80,30,50]],[22,'1200',29.7,-88.4,50,60,[80,80,30,50]]]],
 [3,'2026-07-20T03:00Z',28.0,-85.1,25,35,1008,335,3,null,[
   [20,'1200',28.3,-85.3,30,40,null],[21,'0000',28.6,-85.7,35,45,[50,50,0,0]],
   [21,'1200',28.8,-86.2,40,50,[60,50,30,40]],[22,'0000',29.1,-87.0,40,50,[70,70,40,50]],
   [22,'1200',29.3,-88.1,45,55,[70,70,40,50]],[23,'0000',29.2,-89.6,45,55,[70,70,40,50]]]],
 [5,'2026-07-20T15:00Z',28.5,-85.6,30,40,1007,310,3,null,[
   [21,'0000',28.6,-86.0,35,45,[40,50,0,0]],[21,'1200',28.9,-86.5,40,50,[50,50,40,0]],
   [22,'0000',29.2,-87.2,45,55,[50,70,60,40]],[22,'1200',29.4,-88.2,45,55,[50,70,70,50]],
   [23,'0000',29.5,-89.5,40,50,[50,70,70,50]],[23,'1200',29.5,-90.8,35,45,[0,50,50,0]]]],
 [7,'2026-07-21T03:00Z',28.2,-85.9,35,45,999,null,null,[0,60,60,0],[
   [21,'1200',28.8,-86.6,40,50,[40,60,60,40]],[22,'0000',29.1,-87.3,45,55,[50,80,80,40]],
   [22,'1200',29.3,-88.1,45,55,[50,80,80,50]],[23,'0000',29.3,-89.4,40,50,[50,70,70,50]],
   [23,'1200',29.3,-90.7,35,45,[40,60,60,0]],[24,'0000',29.3,-92.1,30,40,null]]],
 [9,'2026-07-21T15:00Z',29.3,-86.3,50,60,995,345,3,[40,80,80,0],[
   [22,'0000',29.4,-87.0,50,60,[50,90,90,30]],[22,'1200',29.5,-88.0,45,55,[40,80,90,20]],
   [23,'0000',29.4,-89.5,40,50,[30,70,70,20]],[23,'1200',29.3,-91.3,35,45,[0,60,60,0]],
   [24,'0000',29.4,-93.1,30,40,null],[24,'1200',29.9,-94.9,25,35,null]]],
 [10,'2026-07-21T21:00Z',29.4,-87.2,50,60,995,305,5,[70,100,40,40],[
   [22,'0600',29.6,-87.9,45,55,[60,90,50,40]],[22,'1800',29.5,-89.3,45,55,[50,90,60,30]],
   [23,'0600',29.3,-91.4,40,50,[30,60,60,20]],[23,'1800',29.4,-93.4,35,45,[0,60,40,0]],
   [24,'0600',29.8,-95.6,30,40,null],[24,'1800',30.3,-97.6,25,35,null]]],
 [12,'2026-07-22T09:00Z',29.4,-88.3,45,55,998,270,4,[60,90,60,40],[
   [22,'1800',29.4,-89.4,40,50,[50,80,60,40]],[23,'0600',29.3,-91.4,35,45,[0,80,60,30]],
   [23,'1800',29.3,-93.9,35,45,[0,50,50,0]],[24,'0600',29.5,-96.3,30,40,null]]],
 [14,'2026-07-22T21:00Z',29.8,-89.8,40,50,1000,270,6,[50,140,140,30],[
   [23,'0600',29.6,-91.3,40,50,[40,130,120,0]],[23,'1800',29.5,-93.9,35,45,[40,100,0,0]],
   [24,'0600',29.4,-96.9,25,35,null]]],
 [16,'2026-07-23T09:00Z',29.0,-92.2,40,50,1003,270,11,[50,140,140,0],[
   [23,'1800',29.3,-94.1,40,50,[50,130,90,0]],[24,'0600',29.0,-97.0,30,40,null],
   [24,'1800',28.5,-100.1,20,30,null]]],
 [18,'2026-07-23T21:00Z',29.8,-94.7,35,45,1006,290,11,[0,120,120,0],[
   [24,'0600',29.7,-97.2,25,35,null]]],
 [19,'2026-07-24T03:00Z',30.0,-96.0,30,40,1008,270,12,null,[]],
];

console.log('=== A. OBSERVED TRACK (each advisory\'s own analysis position) ===');
console.log('| adv | issued UTC | CDT | lat | lon | kt | dist home nm | mi |');
const obs=[];
for(const a of ADV){
  const nm=greatCircleNm(HOME.lon,HOME.lat,a[3],a[2]);
  obs.push({adv:a[0],t:Date.parse(a[1]),nm,kt:a[4],lat:a[2],lon:a[3]});
  const cdt=new Date(Date.parse(a[1])-5*3600e3).toISOString().slice(5,16).replace('T',' ');
  console.log(`| ${a[0]} | ${a[1].slice(5,16).replace('T',' ')} | ${cdt} | ${a[2]} | ${a[3]} | ${a[4]} | ${nm.toFixed(1)} | ${Math.round(nm*MI)} |`);
}
const minObs=obs.reduce((x,y)=>y.nm<x.nm?y:x);
console.log(`\n>>> OBSERVED closest of the sampled fixes: adv ${minObs.adv}, ${minObs.nm.toFixed(1)} nm (${Math.round(minObs.nm*MI)} mi), ${minObs.kt} kt`);

console.log('\n=== B. FORECAST CHURN: each advisory\'s PREDICTED closest approach ===');
console.log('| adv | issued CDT | predicted CPA nm | mi | at (UTC) | wind kt | lead h | cone nm |');
const churn=[];
for(const a of ADV){
  if(!a[10].length) { console.log(`| ${a[0]} | — | (no forecast track) | | | | | |`); continue; }
  const storm={lon:a[3],lat:a[2],windKt:a[4],observedAt:a[1],
    forecast:a[10].map(([dd,hhmm,lat,lon,w])=>({time:T(dd,hhmm),lat,lon,windKt:w}))};
  const now=Date.parse(a[1]);
  const ca=closestApproach(storm,HOME,now);
  const lead=(Date.parse(ca.time)-now)/3.6e6;
  const cone=coneErrorNm(lead,'atlantic');
  churn.push({adv:a[0],t:now,nm:ca.nm,kt:ca.windKt,time:ca.time,lead,cone});
  const cdt=new Date(now-5*3600e3).toISOString().slice(5,16).replace('T',' ');
  console.log(`| ${a[0]} | ${cdt} | ${ca.nm.toFixed(1)} | ${Math.round(ca.nm*MI)} | ${ca.time.slice(5,16)} | ${ca.windKt==null?'—':ca.windKt.toFixed(1)} | ${lead.toFixed(1)} | ${cone?cone.toFixed(1):'—'} |`);
}
