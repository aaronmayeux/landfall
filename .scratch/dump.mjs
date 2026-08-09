const { greatCircleNm, bearingDeg } = await import('../lib/geo.js');
const { coneErrorNm } = await import('../lib/cone-error.js');
const HOME={lon:-90.0715,lat:29.9511};
const CTRL=[[45,'ne'],[135,'se'],[225,'sw'],[315,'nw']];
function radiusAt(brg,r){const b=((brg%360)+360)%360;
 for(let i=0;i<4;i++){const [a,ak]=CTRL[i],bk=CTRL[(i+1)%4][1];
  const span=((CTRL[(i+1)%4][0]-a)%360+360)%360, off=((b-a)%360+360)%360;
  if(off<=span){const t=span?off/span:0,s=(1-Math.cos(Math.PI*t))/2;return r[ak]+(r[bk]-r[ak])*s;}}
 return r.ne;}
const P=[
 {h:0, lon:-87.2,lat:29.4,w:50,g:60,r:[70,100,40,40],r50:[0,40,0,0]},
 {h:9, lon:-87.9,lat:29.6,w:45,g:55,r:[60,90,50,40],r50:null},
 {h:21,lon:-89.3,lat:29.5,w:45,g:55,r:[50,90,60,30],r50:null},
 {h:33,lon:-91.4,lat:29.3,w:40,g:50,r:[30,60,60,20],r50:null},
 {h:45,lon:-93.4,lat:29.4,w:35,g:45,r:[0,60,40,0],r50:null},
 {h:57,lon:-95.6,lat:29.8,w:30,g:40,r:null,r50:null},
 {h:69,lon:-97.6,lat:30.3,w:25,g:35,r:null,r50:null},
];
const out=[];
for(let i=0;i<P.length-1;i++){
  const a=P[i],b=P[i+1];
  for(let s=0;s<12;s++){
    const f=s/12;
    const lon=a.lon+(b.lon-a.lon)*f, lat=a.lat+(b.lat-a.lat)*f, h=a.h+(b.h-a.h)*f;
    const nm=greatCircleNm(HOME.lon,HOME.lat,lon,lat);
    const brg=bearingDeg(lon,lat,HOME.lon,HOME.lat);
    let rad=null;
    if(a.r&&b.r){const r={ne:a.r[0]+(b.r[0]-a.r[0])*f,se:a.r[1]+(b.r[1]-a.r[1])*f,
      sw:a.r[2]+(b.r[2]-a.r[2])*f,nw:a.r[3]+(b.r[3]-a.r[3])*f}; rad=radiusAt(brg,r);}
    else if(a.r&&!b.r){const r={ne:a.r[0]*(1-f),se:a.r[1]*(1-f),sw:a.r[2]*(1-f),nw:a.r[3]*(1-f)}; rad=radiusAt(brg,r);}
    out.push([ +h.toFixed(2), +nm.toFixed(1), rad==null?null:+rad.toFixed(1),
               +(a.w+(b.w-a.w)*f).toFixed(1), +coneErrorNm(Math.max(0,h),'atlantic').toFixed(1) ]);
  }
}
const L=P[P.length-1];
out.push([L.h,+greatCircleNm(HOME.lon,HOME.lat,L.lon,L.lat).toFixed(1),null,L.w,+coneErrorNm(L.h,'atlantic').toFixed(1)]);
console.log('// [hours, distNm, radiusFacingHomeNm|null, windKt, coneNm]');
console.log('const S='+JSON.stringify(out)+';');
