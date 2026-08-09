/**
 * tcm-fixture.mjs — read an NHC Forecast/Advisory (TCM) fixture into the shapes
 * the app's own functions take. TEST SCAFFOLDING, not application code.
 *
 * ==> WHY THIS EXISTS AND WHY IT IS NOT IN data/. <== The app never parses a
 * TCM. It reads JSON and GeoJSON off NHC's MapServer, and it must keep doing
 * exactly that. But a fixture has to come from somewhere, and the alternative
 * — typing a hundred fixed-column numbers into a test file by hand — is how a
 * suite ends up measuring a self-consistent fiction. tools/test-home.mjs
 * guards Bertha's transcription by grepping the fixture for every line it
 * claims to have read; this does the same job by never transcribing at all.
 *
 * IT IS STILL CHECKED, because a parser can misread as easily as a human can
 * mistype. Every caller asserts a handful of quoted lines against the file.
 *
 * THE ONE THING THAT IS INFERRED AND NOT READ: the calendar month. A TCM says
 * "FORECAST VALID 30/0600Z" — a day and an hour, never a month — so a forecast
 * that runs past the end of the month has to be rolled forward against the
 * advisory's own header date. Getting this wrong moves a figure by 30 days,
 * which is far too obvious to ship, unlike getting it wrong by an hour.
 */

const MONTHS = { JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5,
                 JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11 };

/** "2100 UTC SUN AUG 29 2021" → ms. */
function headerTime(text) {
  const m = text.match(/^(\d{4}) UTC \w{3} (\w{3})\s+(\d{1,2}) (\d{4})$/m);
  if (!m) throw new Error('no advisory header time');
  const [, hhmm, mon, day, year] = m;
  return Date.UTC(+year, MONTHS[mon], +day, +hhmm.slice(0, 2), +hhmm.slice(2));
}

/** "30/0600Z" against a reference ms → ms, rolling the month over when the
 *  day number goes backwards. */
function dayHourToMs(ddhh, refMs) {
  const day = +ddhh.slice(0, 2);
  const hh = +ddhh.slice(2, 4);
  const ref = new Date(refMs);
  let y = ref.getUTCFullYear();
  let mo = ref.getUTCMonth();
  if (day < ref.getUTCDate()) {
    mo += 1;
    if (mo > 11) { mo = 0; y += 1; }
  }
  return Date.UTC(y, mo, day, hh);
}

const iso = (ms) => new Date(ms).toISOString();

/** "34 KT....... 70NE 100SE  40SW  40NW." or "34 KT... 70NE ..." */
function radiiFrom(block) {
  const out = [];
  const re = /^\s*(34|50|64) KT\.*\s*(\d+)NE\s+(\d+)SE\s+(\d+)SW\s+(\d+)NW\./gm;
  let m;
  while ((m = re.exec(block))) {
    out.push({ kt: +m[1], ne: +m[2], se: +m[3], sw: +m[4], nw: +m[5] });
  }
  return out;
}

const latlon = (la, ns, lo, ew) => ({
  lat: ns === 'N' ? +la : -(+la),
  lon: ew === 'W' ? -(+lo) : +lo,
});

/**
 * @returns {{issued, storm, forecast, radii, name, advisoryNumber, special}}
 */
export function parseTcm(text, { id, sourceId, basin = 'atlantic' } = {}) {
  const issuedMs = headerTime(text);

  const hdr = text.match(/^(.+?)\s+(SPECIAL\s+)?FORECAST\/ADVISORY NUMBER\s+(\d+)/m);
  if (!hdr) throw new Error('no advisory header');
  const name = hdr[1].replace(/^(HURRICANE|TROPICAL STORM|TROPICAL DEPRESSION|POTENTIAL TROPICAL CYCLONE|SUBTROPICAL STORM)\s+/, '').trim();
  const special = Boolean(hdr[2]);
  const advisoryNumber = +hdr[3];

  const pos = text.match(
    /CENTER LOCATED NEAR\s*([\d.]+)([NS])\s+([\d.]+)([EW]) AT (\d{2}\/\d{4})Z/
  );
  if (!pos) throw new Error('no current position');
  const cur = latlon(pos[1], pos[2], pos[3], pos[4]);

  const mv = text.match(/PRESENT MOVEMENT TOWARD THE .+? OR\s+(\d+) DEGREES AT\s+(\d+) KT/);
  const pr = text.match(/ESTIMATED MINIMUM CENTRAL PRESSURE\s+(\d+) MB/);
  const mw = text.match(/MAX SUSTAINED WINDS\s+(\d+) KT WITH GUSTS TO\s+(\d+) KT\./);

  /* The CURRENT radii are the block between the max-wind line and the seas
     line. Slicing on those two anchors keeps a forecast hour's radii from
     being read as the present ones, which is the single easiest way to get a
     wind field twelve hours out of date. */
  const curBlockStart = text.indexOf('MAX SUSTAINED WINDS');
  const seasIdx = text.indexOf('SEAS..', curBlockStart);
  const curBlock = text.slice(curBlockStart, seasIdx > 0 ? seasIdx : curBlockStart + 400);

  const radii = radiiFrom(curBlock).map((r) => ({ tau: 0, ...r }));

  const forecast = [];
  const fre =
    /^FORECAST VALID (\d{2})\/(\d{4})Z\s+([\d.]+)([NS])\s+([\d.]+)([EW])([^\n]*)\n\s*MAX WIND\s+(\d+) KT\.\.\.GUSTS\s+(\d+) KT\./gm;
  let f;
  while ((f = fre.exec(text))) {
    const ms = dayHourToMs(f[1] + f[2], issuedMs);
    const p = latlon(f[3], f[4], f[5], f[6]);
    const tau = Math.round((ms - issuedMs) / 3_600_000);
    forecast.push({
      time: iso(ms), ...p, windKt: +f[8], gustKt: +f[9], tau,
      note: f[7].trim(),
    });
    /* Radii for this hour are whatever follows the MAX WIND line up to the
       blank line that ends the block. */
    const after = text.slice(fre.lastIndex);
    const block = after.slice(0, after.search(/\n\s*\n/) < 0 ? after.length : after.search(/\n\s*\n/));
    for (const r of radiiFrom(block)) radii.push({ tau, ...r });
  }

  const storm = {
    id: id || `nhc:${sourceId}`,
    source: 'nhc',
    sourceId,
    name: name.charAt(0) + name.slice(1).toLowerCase(),
    basin,
    lat: cur.lat,
    lon: cur.lon,
    windKt: mw ? +mw[1] : null,
    gustKt: mw ? +mw[2] : null,
    pressureMb: pr ? +pr[1] : null,
    headingDeg: mv ? +mv[1] : null,
    speedKt: mv ? +mv[2] : null,
    nature: 'tropical',
    observedAt: iso(issuedMs),
    advisoryKey: `${sourceId}-${advisoryNumber}`,
    can: { forecastPoints: true },
  };

  return { issuedMs, issued: iso(issuedMs), storm, forecast, radii, name, advisoryNumber, special };
}
