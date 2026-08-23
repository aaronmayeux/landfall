#!/usr/bin/env node
/**
 * archive-fetch.mjs — pull the live payloads and write them somewhere a session
 * can read the exact bytes.
 *
 * WHY THIS EXISTS
 * The cloud sandbox reaches GitHub and npm and nothing else. `curl` there
 * cannot touch nhc.noaa.gov, gdacs.org, or even our own app. WebFetch can, but
 * it shows no response headers and runs a small model over anything large, so
 * a big payload comes back approximated rather than verbatim. That is fine for
 * "is it up" and useless for "what exactly did the wind field say".
 *
 * A GitHub Actions runner has open internet. This runs there, hourly, and
 * commits the bytes to the `archive` branch. A session — or Aaron on a phone —
 * then reads them with plain git:
 *
 *     git fetch origin archive
 *     git show origin/archive:latest/nhc-currentstorms.json
 *
 * IT ALSO CAPTURES RESPONSE HEADERS, WHICH IS HALF THE POINT
 * `X-Landfall-Cache` has never been read by any session, because nothing
 * available in a session shows headers. Every header of every response lands in
 * manifest.json here.
 *
 * FAILURE IS RECORDED, NEVER SWALLOWED (§5)
 * A source that errors is written as status "unavailable" with the reason. It
 * is never written as an empty file, because an empty file is indistinguishable
 * from "no storms" and that confusion is the exact safety-adjacent bug the spec
 * forbids. Nothing is written for a failed source, so the previous good copy
 * stays put and manifest.json says why it is old.
 *
 * Zero dependencies. Run: node tools/archive-fetch.mjs <output-dir>
 * Exits 0 even when sources fail — a bad upstream is news, not a broken build.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/* ==> THE APP'S OWN RULE, IMPORTED RATHER THAN RESTATED. <== `countryMatch`
 * below counts alerts "in force", and that phrase already has an exact
 * definition in three parts (§50.8) which took a real bug to get right. A
 * second copy here would drift the first time one of them changed, and the
 * drift would be invisible: both would produce a plausible number. `lib/cap.js`
 * imports nothing and touches no DOM, so it runs on the bare runner. */
import { isInForce, normalizeAlert } from '../lib/cap.js';

/* The UGC reader, in its own file because `archive-fetch.mjs` runs on import
 * and a test therefore cannot reach anything declared inside it. §12. */
import { watchZoneCodes } from './zone-codes.mjs';

const OUT = process.argv[2];
if (!OUT) {
  console.error('usage: node tools/archive-fetch.mjs <output-dir>');
  process.exit(2);
}

/** Be identifiable in their logs, same string the relay uses. */
const UA = 'Landfall/1.0 (+https://landfall.getgravitate.app)';

const TIMEOUT_MS = 30_000;

/* The upstreams, and our own relay in front of them. Keeping both is the point:
   a session can diff what the Navy said against what our edge served, which is
   the difference between "the feed is broken" and "we are broken", and that has
   cost whole sessions of guessing. */
const SOURCES = [
  {
    name: 'nhc-currentstorms.json',
    url: 'https://www.nhc.noaa.gov/CurrentStorms.json',
    note: 'NHC upstream. The list every Atlantic/Pacific storm comes from.',
  },
  {
    name: 'gdacs-events.json',
    url:
      'https://www.gdacs.org/gdacsapi/api/Events/geteventlist/SEARCH' +
      '?eventlist=TC&alertlevel=Green;Orange;Red',
    note: 'GDACS upstream. 100 rows verbatim, filtered downstream not here.',
  },
  {
    name: 'jtwc.rss',
    url: 'https://www.metoc.navy.mil/jtwc/rss/jtwc.rss',
    note: 'JTWC index. Warning products are linked from inside it.',
  },
  /* GENESIS — §45. The two sources that answer "where might the next one
     start", and the reason this pass added them: nothing in a session can
     reach either host, so no parser can be written honestly until these bytes
     land here. Layer 3 carries BOTH horizons on one polygon; layer 2 is NHC's
     own label anchor, archived because the map layer hangs the seven-day
     percentage on it rather than on a centroid we computed ourselves. */
  {
    name: 'nhc-genesis-areas.geojson',
    url:
      'https://mapservices.weather.noaa.gov/tropical/rest/services/tropical/' +
      'NHC_tropical_weather/MapServer/3/query' +
      '?where=1%3D1&outFields=*&returnGeometry=true&outSR=4326&f=geojson',
    note:
      'NHC Seven-Day Potential Development Region. One polygon per watched ' +
      'area, carrying prob2day/risk2day/prob7day/risk7day. Probabilities are ' +
      'STRINGS with a percent sign. idp_filedate is the publication stamp.',
  },
  {
    name: 'nhc-genesis-anchors.geojson',
    url:
      'https://mapservices.weather.noaa.gov/tropical/rest/services/tropical/' +
      'NHC_tropical_weather/MapServer/2/query' +
      '?where=1%3D1&outFields=*&returnGeometry=true&outSR=4326&f=geojson',
    note:
      'Seven-Day Current Location. EVIDENCE, NOT A FEED — the app does not ' +
      'fetch this. It was meant to anchor each percentage, until these bytes ' +
      'showed 3 points against 5 polygons with attributes matching one shape ' +
      'while sitting inside another. Kept archived so the decision can be ' +
      'revisited against real data rather than from memory.',
  },
  {
    name: 'jtwc-abpw.txt',
    url: 'https://www.metoc.navy.mil/jtwc/products/abpwweb.txt',
    note:
      'JTWC Significant Tropical Weather Advisory. Plain text. The only ' +
      'genesis product outside NHC carrying a probability, expressed as ' +
      'LOW/MEDIUM/HIGH within 24 hours. WMO header carries the issue time. ' +
      'Covers the WESTERN and SOUTH PACIFIC only — its Indian Ocean sibling ' +
      'is the entry below.',
  },
  /* ==> THE APP READS THIS NOW, AND THE ARCHIVE IS STILL THE ONLY PLACE A
   * BUSY ONE WILL EVER BE SEEN FIRST. <== Shipped 2026-08-20 as the second
   * half of the genesis watch list (`functions/api/jtwc/abio.js`). Before
   * that the list watched the Pacific and was blind to the Indian Ocean — a
   * real hole in a globe app.
   *
   * THE PARSER WAS BUILT WITHOUT A BUSY SAMPLE, AND THIS ENTRY IS HOW THAT
   * GETS CLOSED. JTWC reissues ABIO once a day and every snapshot to date has
   * read `SUMMARY: NONE.` all the way down, so `samples/genesis/
   * jtwc-abio-busy.txt` is ASSEMBLED — a real Pacific disturbance body
   * transplanted into the real ABIO skeleton. It proves the template parses;
   * it cannot prove JTWC words an Indian Ocean disturbance the same way.
   * ==> WHEN A REAL BUSY ABIO LANDS HERE, REPLACE THAT FIXTURE WITH IT. <==
   *
   * What makes the gap survivable meanwhile is `GENESIS.ABPW.noneAssertion`:
   * a disturbance block that neither says NONE nor lists numbered items makes
   * the whole bulletin `unavailable`. A rewording we cannot read reports as a
   * gap, never as a calm ocean. That is §45.3's scar closed by a guard rather
   * than by a promise to be careful. */
  {
    name: 'jtwc-abio.txt',
    url: 'https://www.metoc.navy.mil/jtwc/products/abioweb.txt',
    note:
      'JTWC Significant Tropical Weather Advisory for the INDIAN OCEAN, read ' +
      'live by the app since 2026-08-20. Every snapshot so far has been a ' +
      'QUIET day. The first one carrying a real disturbance block should ' +
      'replace samples/genesis/jtwc-abio-busy.txt, which is assembled rather ' +
      'than captured.',
  },
  /* ==> THE TEXT OUTLOOKS. ADDED 2026-08-11 AND THEY ARE THE POINT OF THAT
   * NIGHT. <== NHC's GIS layer 3 reported zero areas while NHC's own bulletin
   * and public graphic both carried three Atlantic areas, one of them red.
   * Landfall rendered the layer and published a false all-clear.
   *
   * THE REASON THAT COULD NOT BE SETTLED QUICKLY IS THAT NOBODY ARCHIVED THE
   * AUTHORITATIVE COPY. The GIS layer was snapshotted hourly; the product it
   * is derived FROM was not, so the only way to check it was to read a live
   * web page by hand, one issuance at a time, and the answer kept turning out
   * to be an hour stale. Half an hour of a hurricane-season session went on a
   * question these two files answer in one `git show`.
   *
   * AN EMPTY GEOJSON IS UNSTAMPED AND THIS IS THE ANTIDOTE. The layer's empty
   * response carries no `idp_source` and no `idp_filedate`, so on its own it
   * cannot say whether it means "nothing is out there" or "I am broken".
   * These bulletins carry their own WMO header and issuance line in every
   * state, INCLUDING when the answer is genuinely nothing — "Tropical cyclone
   * formation is not expected during the next 7 days" is a stamped, positive
   * statement of an all-clear, which is exactly what the GeoJSON cannot make.
   *
   * Diff the two and the question answers itself. */
  {
    name: 'nhc-two-atlantic.txt',
    url: 'https://www.nhc.noaa.gov/text/MIATWOAT.shtml?text',
    note:
      'ABNT20 KNHC — the Atlantic Tropical Weather Outlook, the AUTHORITATIVE ' +
      'form of what genesis layer 3 is derived from. Issued 0000/0600/1200/' +
      '1800 UTC. Carries its own issuance line in every state, including a ' +
      'genuine all-clear — which the empty GeoJSON cannot. Diff against ' +
      'nhc-genesis-areas.geojson: they must agree, and on 2026-08-11 they ' +
      'did not.',
  },
  {
    name: 'nhc-two-epacific.txt',
    url: 'https://www.nhc.noaa.gov/text/MIATWOEP.shtml?text',
    note:
      'ABPZ20 KNHC — the same product for the East Pacific. Layer 3 carries ' +
      'both basins in one response, so checking only the Atlantic would leave ' +
      'half of any disagreement invisible.',
  },
  /* ==> THE RAW FEEDS, ARCHIVED SO THE UPSTREAM CHOICE CAN BE MADE ON
   * EVIDENCE. <== The relay currently scrapes the `<pre>` block out of the two
   * `.shtml` pages above. These are the same two products as plain text, with
   * no page around them, and switching to them would delete the scrape.
   *
   * They are archived rather than adopted because a NOAA raw path has already
   * been caught lying by omission: `www.nhc.noaa.gov/ftp/pub/forecasts/
   * discussion/MIATWOAT` was serving the 24 JUNE bulletin on 11 AUGUST — plain
   * text, HTTP 200, two months stale, and healthy by every signal except the
   * issue line inside the body. A source we would trust to CONTRADICT another
   * source has to prove it keeps up first. Diff these against the `.shtml`
   * copies over a few days; if they track, the relay switches and this comment
   * goes with it. */
  {
    name: 'nhc-two-atlantic-raw.txt',
    url: 'https://tgftp.nws.noaa.gov/data/raw/ab/abnt20.knhc.two.at.txt',
    note:
      'ABNT20 as plain text, no HTML. Candidate replacement for the scraped ' +
      'page. Measured current 2026-08-11 (111142Z), matching the .shtml copy.',
  },
  {
    name: 'nhc-two-epacific-raw.txt',
    url: 'https://tgftp.nws.noaa.gov/data/raw/ab/abpz20.knhc.two.ep.txt',
    note:
      'ABPZ20 as plain text. THE URL IS INFERRED FROM ITS ATLANTIC SIBLING ' +
      'and has never been fetched — the sandbox cannot reach it and no search ' +
      'returned it directly. If it 404s, that is this entry doing its job: ' +
      'the manifest will say so rather than the guess reaching the relay.',
  },
  {
    name: 'relay-nhc-outlook-atlantic.txt',
    url: 'https://landfall.getgravitate.app/api/nhc/outlook?basin=atlantic',
    note:
      'Our relay in front of the text outlook. Diff against the .shtml copy ' +
      'above: the bulletin must survive the <pre> extraction byte for byte.',
  },
  {
    name: 'relay-nhc-outlook-epacific.txt',
    url: 'https://landfall.getgravitate.app/api/nhc/outlook?basin=epacific',
    note: 'The same, for the East Pacific.',
  },
  {
    name: 'relay-nhc-storms.json',
    url: 'https://landfall.getgravitate.app/api/nhc/storms',
    note: 'Our relay in front of NHC. Diff against the upstream copy above.',
  },
  {
    name: 'relay-gdacs-events.json',
    url: 'https://landfall.getgravitate.app/api/gdacs/events',
    note: 'Our relay in front of GDACS.',
  },
  /* Added the same night, for the same reason. The genesis relay was the one
   * route in the chain nobody could see: upstream was archived and the app's
   * own reading was archived, but the thing in between — including whether it
   * is HOLDING a previous answer — was inferred rather than read. Its
   * `X-Landfall-Held` header is in the manifest now like every other. */
  {
    name: 'relay-nhc-genesis.json',
    url: 'https://landfall.getgravitate.app/api/nhc/genesis?part=areas',
    note:
      'Our relay in front of the genesis layer. The headers are the payload ' +
      'here: X-Landfall-Held says whether the last real answer is being served ' +
      'through an empty upstream, and X-Landfall-Fetched-At says how old it is.',
  },

  /* ==> ADDED 2026-08-21, AND THE REASON IS A SESSION THAT WENT THE LONG WAY
   *     ROUND. <==
   *
   * SAUDEL-26 lost its Saffir-Simpson dots on two devices and kept them on a
   * third. Diagnosing it meant answering one question — what did the app
   * actually receive from /api/jtwc/storms — and the archive could not answer
   * it. It held the Navy's raw warning products, so the upstream could be
   * proven healthy and the parser could be proven correct against real bytes,
   * and then the trail stopped at the one hop in the middle.
   *
   * ==> WE ARCHIVED THE INGREDIENTS AND NOT THE MEAL. <==
   * The app never reads a navy.mil URL. It reads our relay, and only our relay.
   * An upstream copy proves what JTWC published; it says nothing about what a
   * phone was handed, which is the only thing a bug report is ever about.
   *
   * The rule this establishes, enforced by tools/relay-archive-check.mjs: every
   * relay route the app calls is archived, or it is listed there with a stated
   * reason why it cannot be. Routes that need a live storm to address are the
   * legitimate exception and are named individually rather than waved at.
   * ---------------------------------------------------------------------- */
  {
    name: 'relay-jtwc-storms.json',
    url: 'https://landfall.getgravitate.app/api/jtwc/storms',
    note:
      'THE ONE THAT WAS MISSING. Every GDACS storm outside the NHC basins gets ' +
      'its measured wind — and therefore its category, its color and its cage ' +
      'height — from this response and nowhere else. Its `state` and its fix ' +
      'ages are what decide whether a storm reads as a graded Cat 4 or as a ' +
      'bare "HU", and both are invisible from the upstream copy.',
  },
  {
    name: 'relay-tcgp-storms.json',
    url: 'https://landfall.getgravitate.app/api/tcgp/storms',
    note:
      'The model-guidance roster. Same argument as the JTWC index above: this ' +
      'is the join that turns a GDACS name into an a-deck filename, and when ' +
      'model tracks go missing for one storm this is the first place to look.',
  },
  {
    name: 'relay-cap-alerts.json',
    url: 'https://landfall.getgravitate.app/api/cap/alerts',
    note:
      'Our relay in front of the CAP feed. Diff against capalerts-cyclone.json ' +
      'below, which is the same query straight from ArcGIS: the relay filters ' +
      'drills, cancellations and stand-downs, and this is the only way to see ' +
      'what survived that filter rather than inferring it.',
  },
  {
    name: 'relay-jtwc-abpw.txt',
    url: 'https://landfall.getgravitate.app/api/jtwc/abpw',
    note:
      'Our relay in front of the Pacific significant-weather advisory. The ' +
      'upstream copy is archived as jtwc-abpw.txt; this is what the app reads.',
  },
  {
    name: 'relay-jtwc-abio.txt',
    url: 'https://landfall.getgravitate.app/api/jtwc/abio',
    note: 'The same, for the Indian Ocean bulletin.',
  },

  /* ==> THE SAME AREAS, FROM A COMPLETELY DIFFERENT NHC PRODUCT. <==
   *
   * MEASURED 2026-08-11: the genesis layer answered 200 with an empty
   * FeatureCollection for hours while NHC's own website drew five areas, and
   * BOTH tropical map services were checked — `NHC_tropical_weather` layer 3
   * and `NHC_tropical_weather_summary` layer 3 — and both were empty. So the
   * emptiness is not a wrong address; the ArcGIS publication of this product
   * simply comes and goes, and it is our only source for the shapes.
   *
   * The KMZ is the outlook as NHC's own map consumers get it, on a different
   * publication path. `gtwo_atl.kmz` was confirmed live and serving
   * `application/vnd.google-earth.kmz`. IT HAS NOT BEEN OPENED — it is a zip,
   * and nothing in the sandbox can reach NOAA to open one. That is precisely
   * why it is archived first and parsed second: three sessions on this feature
   * went wrong by reasoning about bytes nobody had read.
   *
   * ==> THE PACIFIC NAME IS INFERRED FROM ITS ATLANTIC SIBLING AND HAS NEVER
   * BEEN FETCHED. <== If it 404s, the manifest will say so, which is this
   * entry doing its job rather than failing at it. */
  {
    name: 'nhc-gtwo-atlantic.kmz.b64',
    url: 'https://www.nhc.noaa.gov/xgtwo/gtwo_atl.kmz',
    binary: true,
    note:
      'The Graphical Tropical Weather Outlook as a KMZ — a zipped KML holding ' +
      'the same watched areas as GIS layer 3, published on a different path. ' +
      'Base64 here because it is a zip. Archived to decide whether it can be ' +
      'a fallback for the hours when layer 3 answers empty.',
  },
  {
    name: 'nhc-gtwo-epacific.kmz.b64',
    url: 'https://www.nhc.noaa.gov/xgtwo/gtwo_pac.kmz',
    binary: true,
    note:
      'The East Pacific sibling of the entry above. THE FILENAME IS INFERRED ' +
      'and has never been fetched — a 404 here is the answer, not a fault.',
  },

  /* ==> THE SHIPS DIRECTORY INDEX. §47, THE ENVIRONMENT RIBBON. <==
   *
   * SHIPS IS THE ONLY SOURCE FOR "IS THE ENVIRONMENT HELPING OR HURTING", AND
   * IT HAS NO STABLE PER-STORM URL. Every other feed here has one address that
   * always serves the current answer. SHIPS does not: the files are named
   * `YYMMDDHH` + storm id + `_ships.txt`, so 15 Aug 2026 06 UTC for Hernan is
   * `26081506EP0826_ships.txt` and the 12 UTC run is a DIFFERENT FILE. There
   * is no `latest`. Anything reading SHIPS has to either build the name from a
   * synoptic hour and handle the miss, or read this index.
   *
   * ==> NOTE THE TWO-DIGIT YEAR INSIDE THE STORM ID. <== The app carries
   * `ep082026` from CurrentStorms.json; the filename wants `EP0826`. Getting
   * that wrong produces a 404 that looks exactly like "no SHIPS for this
   * storm", which is the failure this archive exists to make impossible to
   * confuse.
   *
   * The index is also the only way to see files for systems the app never
   * lists — invests like AL9426 get a full SHIPS run, and so do the 80- and
   * 90-numbered test systems. Whether the ribbon should ever show those is a
   * question §45 owns, but it cannot be answered without seeing them. */
  {
    name: 'nhc-ships-index.html',
    url: 'https://ftp.nhc.noaa.gov/atcf/stext/',
    note:
      'Directory index of every SHIPS diagnostic file NHC currently holds. ' +
      'THE INDEX IS THE POINT: filenames are timestamped per synoptic hour ' +
      '(YYMMDDHH + AAnnYY + _ships.txt) with no "latest" alias, so this is ' +
      'the only way to know which runs exist without guessing. Also the only ' +
      'place invests and test systems show up.',
  },

  /* -------------------------------------------------------------------------
   * GLOBAL COVERAGE CANDIDATES — wave 5 pass 1.
   *
   * Four features stop at America's edge for the same reason: NHC and NWS are
   * the only sources they have. The pass that went looking for replacements
   * found two that are real, public and keyless, and NEITHER can be measured
   * from a session — the CAP service takes its whole question in a query
   * string, which web_fetch strips, and Open-Meteo is simply a blocked host.
   * So they are archived, and the next session reads bytes instead of a
   * vendor's marketing page. Both are candidates until then, not decisions.
   * ---------------------------------------------------------------------- */
  {
    name: 'capalerts-cyclone.json',
    url:
      'https://services9.arcgis.com/RHVPKKiFTONKtxq3/ArcGIS/rest/services/' +
      'CAP_Alerts_Feed/FeatureServer/0/query' +
      '?where=' +
      encodeURIComponent(
        "event LIKE '%Cyclone%' OR event LIKE '%Typhoon%' OR " +
          "event LIKE '%Hurricane%' OR event LIKE '%Tropical%' OR " +
          "event LIKE '%Storm Surge%'"
      ) +
      '&outFields=' +
      encodeURIComponent(
        'OBJECTID,event,headline,severity,urgency,certainty,senderName,' +
          'countryCode,areaDesc,effective,expires,sent,language,' +
          'status,msgType,responseType'
      ) +
      '&returnGeometry=false&orderByFields=sent+DESC' +
      '&resultRecordCount=100&f=json',
    note:
      "Esri's CAP Connector, republishing every alert the WMO Alert Hub " +
      'aggregates worldwide as an ordinary ArcGIS feature service — public, ' +
      'anonymous, spatially queryable, GeoJSON-capable. THE QUESTION IT ' +
      'ANSWERS is whether the rest of the world publishes tropical-cyclone ' +
      'watches and warnings in a form we could paint: how many, from which ' +
      'agencies, in what words, in what languages. Attributes only here; the ' +
      'shapes are the next entry. A row count of zero is a real answer too — ' +
      'it would mean no cyclone alert is live anywhere this hour, not that ' +
      'the service is empty.\n' +
      '==> `status`, `msgType` AND `responseType` ARE HERE BECAUSE THEIR ' +
      'ABSENCE WAS A BUG (§50.8). <== Without them a cancellation and a ' +
      "warning are identical on the wire: Costa Rica's archived " +
      '"Fin de Influencia de Onda Tropical" — the tropical wave has PASSED — ' +
      'carried severity Severe and rendered as "Significant threat". A ' +
      'national exercise would have rendered as a live alert for the same ' +
      'reason. Every captured row from here on carries them, so the filter ' +
      'that drops drills and stand-downs can finally be asserted against ' +
      'real bytes rather than against a schema page.',
  },
  {
    name: 'geometry/capalerts-cyclone-shapes.geojson',
    url:
      'https://services9.arcgis.com/RHVPKKiFTONKtxq3/ArcGIS/rest/services/' +
      'CAP_Alerts_Feed/FeatureServer/0/query' +
      '?where=' +
      encodeURIComponent(
        "event LIKE '%Cyclone%' OR event LIKE '%Typhoon%' OR " +
          "event LIKE '%Hurricane%' OR event LIKE '%Tropical%'"
      ) +
      '&outFields=' +
      encodeURIComponent('event,severity,senderName,countryCode,expires') +
      '&returnGeometry=true&outSR=4326&orderByFields=sent+DESC' +
      '&resultRecordCount=10&f=geojson',
    note:
      'Ten CAP cyclone alerts WITH their shapes. ==> THE SHAPE IS THE WHOLE ' +
      'DESIGN QUESTION. <== Our watch/warning paint is a stripe banded onto ' +
      'the coast from NHC breakpoint LINES (§7.7). A CAP area is whatever the ' +
      'issuing country drew — most often a whole province polygon, sometimes ' +
      'a circle. If these come back as administrative blobs then the global ' +
      'version of this feature is a different visual object from the one we ' +
      'ship, and that is a decision for Aaron rather than an adapter. Ten ' +
      'rows, and under geometry/ so a hundred provinces an hour never enter ' +
      'the 72-hour history.',
  },
  {
    name: 'relay-nws-flood.json',
    url: 'https://landfall.getgravitate.app/api/nws/flood',
    note:
      '==> OUR RELAY IN FRONT OF THE FLOOD LIST, AND THE ONLY ONE OF THE THREE ' +
      'THAT PROVES ANYTHING ABOUT THE APP. <== \u00a748.21. The two upstream ' +
      'captures below show what NWS published; this shows what a phone was ' +
      'actually handed, which is the only thing a bug report is ever about. ' +
      'Three things live here and nowhere else: the projection (does the ' +
      'polygon survive, does `drawable` agree with the geometry beside it), ' +
      'the two counts the drawer\u2019s sentence is built from (`total` against ' +
      '`drawable` \u2014 a warning carries a shape and a watch does not), and the ' +
      'X-Landfall-Cache header, which no session can see any other way. ' +
      'Diff `total` across history/ through a landfall to get the volume ' +
      'number this feature was built without.',
  },
  {
    name: 'nws-alerts-flood-national.json',
    url: 'https://api.weather.gov/alerts/active?event=Flash%20Flood%20Warning',
    headers: { accept: 'application/geo+json' },
    note:
      '==> ARCHIVED BECAUSE ITS VOLUME IS THE ONE THING §48.21 COULD NOT ' +
      'MEASURE. <== The flood map layer draws NWS flood polygons nationally. ' +
      'The per-feature SHAPE was known before a line was written — the five ' +
      'captured Hilo alerts in samples/rain/ are the same objects this ' +
      'returns — but HOW MANY come back on an active day was not, and a ' +
      'layer whose payload nobody has ever seen is a layer tuned against a ' +
      'guess. What this settles: the row count, the wire bytes, and how many ' +
      'of them carry a real polygon. Measured on the Hilo capture, a Flash ' +
      'Flood Warning carries a 346-byte polygon and a Flood Watch carries ' +
      'geometry: null with seventeen zone URLs instead — so the count that ' +
      'matters is not the number of alerts, it is the number that can be ' +
      'DRAWN. Diff across history/ to see it through a landfall.',
  },
  {
    name: 'nws-alerts-flood-watch-national.json',
    url: 'https://api.weather.gov/alerts/active?event=Flood%20Watch',
    headers: { accept: 'application/geo+json' },
    note:
      'The other half, and the half that cannot be drawn. Every Flood Watch ' +
      'captured so far is zone-based with a null geometry, which is why ' +
      '§48.21 puts watches in the list and keeps them off the globe. ==> IF ' +
      'A WATCH EVER TURNS UP HERE WITH A REAL POLYGON, THAT DECISION IS ' +
      'REOPENABLE ON EVIDENCE. <== Kept separate from the warnings above so ' +
      'the two counts never have to be untangled from one file.',
  },
  {
    name: 'openmeteo-rain-outside-nws.json',
    url:
      'https://api.open-meteo.com/v1/forecast' +
      '?latitude=14.5995&longitude=120.9842' +
      '&hourly=precipitation&forecast_days=3&timezone=UTC',
    note:
      'Rainfall at a house NWS will never answer for — Manila. Open-Meteo is ' +
      'keyless, CORS-open and global, which makes it the only candidate that ' +
      'could give §48 a non-American half. Archived to settle three things ' +
      'bytes settle and a docs page does not: the exact response shape, ' +
      'whether the hourly series is really gap-free at a tropical coastal ' +
      'point, and what the units and time base actually say. Attribution is ' +
      'required (CC BY 4.0) and the free tier is non-commercial with a daily ' +
      'call ceiling — both are constraints on shipping it, not on reading it.',
  },
  {
    name: 'openmeteo-rain-past-days-probe.json',
    url:
      'https://api.open-meteo.com/v1/forecast' +
      '?latitude=14.5995&longitude=120.9842' +
      '&hourly=precipitation&past_days=2&forecast_days=3&timezone=UTC',
    note:
      '==> THE PROBE PHASE 6 OF THE FLOOD PLAN IS BLOCKED ON, AND NOTHING ' +
      'ELSE BLOCKS IT. <== §56.14 says in as many words that not a line of ' +
      'past-rainfall code gets written until this is measured, because ' +
      '`api.open-meteo.com` is outside the wall. The SAME point and the same ' +
      'hourly variable as `openmeteo-rain-outside-nws.json` above, with ' +
      '`past_days=2` added and nothing else changed — so the two files diff ' +
      'cleanly and the delta IS the answer. Four of §56.14’s five questions ' +
      'fall out of this one capture. (1) Do the past hours arrive in the same ' +
      '`hourly.precipitation` array or a separate one — ==> DO NOT ASSUME THE ' +
      'ARRAY IS SIMPLY LONGER. <== (2) Is the join between past and forecast ' +
      'marked at all, or must it be found against the clock, and is the hour ' +
      'containing `now` counted once or twice. (3) The real byte cost and ' +
      'latency, against the arithmetic-on-one-capture table in §56.14 which ' +
      'is not a measurement. (4) What it reports over sparse land — Manila is ' +
      'a tropical coastal point, which is the case that matters. The fifth ' +
      'question, the free tier’s quota, has no runtime answer: §48.14 records ' +
      'there is no `x-ratelimit-*` header of any kind, so it can only come ' +
      'from Open-Meteo’s documentation. ==> IT IS A MODEL, NOT A RAIN GAUGE. ' +
      '<== Whatever comes back is reanalysis output, and §56.14 makes the ' +
      'wording carry that. Reading these numbers as observations is the single ' +
      'most likely way to get this feature wrong.',
  },
  {
    name: 'openmeteo-rain-cors-probe.json',
    url:
      'https://api.open-meteo.com/v1/forecast' +
      '?latitude=14.5995&longitude=120.9842' +
      '&hourly=precipitation&forecast_days=1&timezone=UTC',
    headers: { origin: 'https://landfall.getgravitate.app' },
    note:
      '==> THE SAME ENDPOINT, ASKED THE WAY A BROWSER ASKS. <== The entry ' +
      'above proved the DATA — 72 hourly values, no nulls, no gaps. It could ' +
      'not prove the ACCESS, and a session read its silence wrongly: that ' +
      'response carried no `access-control-allow-origin`, but the runner sent ' +
      'no `Origin` either, so the server was never asked. This request sends ' +
      'one, from our real production origin. ==> THE ANSWER IS IN THE ' +
      "MANIFEST'S HEADERS, NOT IN THE BODY. <== One day of data is requested " +
      'only because a request needs something to ask for. ' +
      '`access-control-allow-origin: *`, or our origin echoed back, means the ' +
      'browser can call Open-Meteo directly and §48 needs no relay for it. ' +
      'Absent means a relay route — a cost, not a dead end. Also read any ' +
      '`x-ratelimit-*` header here: the free tier\u2019s daily ceiling is ' +
      'currently a number on a docs page with nothing in the response to ' +
      'measure against, which is the harder of the two blockers to plan for.',
  },
];

/* ---------------------------------------------------------------------------
 * SHIPS — §47. Derived per storm, and derived per SYNOPTIC HOUR too.
 *
 * A SHIPS file appears an hour or two after its nominal time, so asking only
 * for the newest synoptic hour would miss on more runs than it hit. Both the
 * current and previous slots are requested; between them one is always
 * published, and having two consecutive runs side by side in the archive is
 * itself worth having — the 00 and 06 UTC files for Hernan disagree about
 * whether he survives past 60 hours, which is the kind of thing a parser has
 * to be built against rather than surprised by.
 * ------------------------------------------------------------------------ */

const SHIPS_BASE = 'https://ftp.nhc.noaa.gov/atcf/stext';
/** How many synoptic slots back to ask for. Two covers publication lag. */
const SHIPS_SLOTS = 2;

/** `ep082026` -> `EP0826`. The two-digit year is the whole trap. */
function shipsStormId(id) {
  const m = /^([a-z]{2})(\d{2})(\d{4})$/i.exec(String(id || ''));
  if (!m) return null;
  return `${m[1].toUpperCase()}${m[2]}${m[3].slice(2)}`;
}

/** The synoptic hours, newest first, as `YYMMDDHH`. */
function synopticStamps(now, count) {
  const out = [];
  const d = new Date(now);
  d.setUTCMinutes(0, 0, 0);
  d.setUTCHours(Math.floor(d.getUTCHours() / 6) * 6);
  for (let i = 0; i < count; i++) {
    const p = (n) => String(n).padStart(2, '0');
    out.push(
      `${p(d.getUTCFullYear() % 100)}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}`
    );
    d.setUTCHours(d.getUTCHours() - 6);
  }
  return out;
}

/* ---------------------------------------------------------------------------
 * MODEL GUIDANCE DECKS
 *
 * ==> TWO ROUTES, BECAUSE THE APP USES TWO. <== `data/adeck.js resolveDeck`
 * sends an NHC storm to `/api/nhc/adeck?storm=<sourceId>` and everything else
 * to `/api/tcgp/adeck?storm=<tcgp id>`, and those are different upstreams with
 * different coverage. Archiving only one would leave exactly half the world's
 * guidance unreadable from a session — and the half that goes wrong is never
 * reliably the half you archived.
 *
 * OUR RELAY, NOT THE UPSTREAM. Same argument §18.3 makes for every other
 * relay route: a deck is only interesting alongside the cache headers the app
 * actually received, and the app never reads a ucar.edu or nhc.noaa.gov deck
 * URL directly.
 * ------------------------------------------------------------------------- */
function adeckSources(tcgpRoster, currentStormsJson) {
  const out = [];

  for (const s of currentStormsJson?.activeStorms || []) {
    const id = String(s?.id || '').toLowerCase().trim();
    if (!/^[a-z]{2}\d{6}$/.test(id)) continue;
    out.push({
      name: `adeck/nhc-${id}.txt`,
      url: `https://landfall.getgravitate.app/api/nhc/adeck?storm=${id}`,
      note:
        `Model guidance for ${s.name} (${id}), through the relay the app reads. ` +
        'Every model cycle, tau and position `lib/adeck.js` parses — the only ' +
        'way to tell a stale cycle from a bad parse from a deck that was never ' +
        'served. ATCF text, comma-separated, one row per model per tau.',
    });
  }

  for (const s of tcgpRoster?.storms || []) {
    const id = String(s?.id || '').toLowerCase().trim();
    if (!/^[a-z]{2}\d{6}$/.test(id)) continue;
    out.push({
      name: `adeck/tcgp-${id}.txt`,
      url: `https://landfall.getgravitate.app/api/tcgp/adeck?storm=${id}`,
      note:
        `Model guidance for ${s.label || id} from TCGP, through our relay. ` +
        'The basins NOAA does not publish decks for. An INVEST in this roster ' +
        'legitimately has no deck yet — an empty body is `none`, not a fault.',
    });
  }

  return out;
}

function shipsSources(currentStormsJson, now = Date.now()) {
  const storms = Array.isArray(currentStormsJson?.activeStorms)
    ? currentStormsJson.activeStorms
    : [];
  const stamps = synopticStamps(now, SHIPS_SLOTS);
  const out = [];
  for (const s of storms) {
    const sid = shipsStormId(s?.id);
    /* An id that does not match the ATCF shape is skipped rather than guessed
     * at, same rule the NHC track block follows: a URL this script invents
     * that 404s is indistinguishable in the manifest from a storm that
     * genuinely has no SHIPS run. */
    if (!sid) continue;
    for (const stamp of stamps) {
      out.push({
        name: `ships/${stamp}${sid}_ships.txt`,
        url: `${SHIPS_BASE}/${stamp}${sid}_ships.txt`,
        note:
          `SHIPS diagnostic for ${s.name} (${s.id}, bin ${s.binNumber}) at ` +
          `synoptic hour ${stamp}. Carries the environment table and, below ` +
          `it, the model's own per-factor contributions in knots — the ` +
          `numbers §47 colors the cone by. A 404 here means this run is not ` +
          `published yet, not that the storm has no SHIPS.`,
      });
    }
  }
  return out;
}

/* ---------------------------------------------------------------------------
 * JTWC PER-STORM PRODUCTS — FOUR FILES, ONE SETTLED ANSWER AND ONE OPEN ONE.
 *
 * ==> THE QUESTION THIS CLOSED, MEASURED 2026-08-19 ON SAUDEL (17W) AND LALA
 * (01C). <== Does JTWC publish PAST wind extent anywhere per-storm — the thing
 * GDACS was measured a day earlier not to publish, and that NHC storms answer
 * from layer 13. It does not. Not in one of the four.
 *
 *   `fix.txt`  388 bytes. ONE Dvorak satellite fix — a position, a time, a
 *              T-number and the analyst's shorthand. No history, no radii.
 *              Archived to prove the negative, not because it feeds anything.
 *   `.tcw`     Forecast radii per quadrant at 34/50/64 kt out to 120 hours,
 *              THEN a best track of 39 six-hourly positions back nine days
 *              carrying intensity — and no radii on any of them. The past rows
 *              repeat once per wind threshold the storm met at that hour with
 *              the radius columns stripped, so the record shape is there and
 *              the numbers are withheld deliberately.
 *   `.kmz`     The same nine-day best track as points, plus forward radius
 *              POLYGONS and a 34 kt danger swath. Every polygon is forecast.
 *              455 KB, 308 of it the JTWC logo — the `.tcw` carries the same
 *              track in 9 KB of plain text, so this is archived as evidence
 *              and is not a candidate to ship against.
 *
 * So no source anywhere publishes past wind footprints outside NHC. That is
 * settled and should not be re-asked without new evidence.
 *
 * ==> WHAT IS STILL OPEN, AND WHY `web.txt` JOINED THE LIST. <== The `.tcw`
 * turned out to embed a full warning text of its own, which raises whether one
 * fetch could replace the two the app makes today. It is NOT byte-identical:
 * its subject line reads `SUBJ:` where the plain product reads `SUBJ/`, the
 * exact character `parseSubject` keys on in the relay AND in lib/advisory.js.
 * Whether anything else differs needs both files in one snapshot, which is
 * what the `web.txt` entry is for.
 *
 * ==> THE ADDRESSES ARE JTWC'S OWN, SCRAPED FROM THE RSS THIS RUN JUST
 * FETCHED. <== Same rule as the GDACS geometry block below: a URL this script
 * INVENTS that 404s is indistinguishable in the manifest from a product JTWC
 * genuinely does not publish. The RSS links these per storm, and that link
 * also does the filtering for free — the Tropical Cyclone Formation Alert on
 * 90E is given a `.tcw`, a `.kmz` and its TCFA text but NO fix bulletin, and
 * its `.tcw` has a different layout entirely: no forecast rows, no radii, and
 * a header that says ALERT where a storm's says WARNING. Any parser written
 * against these has to branch on that before it reads a thing.
 * ------------------------------------------------------------------------ */

/** The published per-storm products worth having, and how to name them here.
 *  `.kmz` is a zip and MUST be flagged binary — `text()` would decode it as
 *  UTF-8 and hand back a plausible-looking length of replacement characters. */
const JTWC_PRODUCTS = Object.freeze([
  { suffix: 'web.txt', ext: 'web.txt', binary: false, what: 'warning text' },
  { suffix: 'fix.txt', ext: 'fix.txt', binary: false, what: 'Satellite Fix Bulletin' },
  { suffix: '.tcw', ext: '.tcw', binary: false, what: 'JMV 3.0 data' },
  { suffix: '.kmz', ext: '.kmz.b64', binary: true, what: 'Google Earth overlay' },
]);

/** Storms to pull products for. JTWC peaks around a dozen worldwide; eight is
 *  well past any real hour and caps a runaway feed at 32 fetches. */
const JTWC_MAX = 8;

/** Absolute product links in the RSS body. The alternation is what filters:
 *  `prog.txt`, `.gif` and the satellite JPEGs all fail it. The four-digit ATCF
 *  id is the storm — `wp1726` is the 17th West Pacific system of 2026.
 *
 *  `web.txt` IS THE PRODUCT THE APP ALREADY FETCHES LIVE, and it is here for
 *  one reason: the `.tcw` embeds a full warning text of its own, and the two
 *  are NOT byte-identical — the `.tcw` subject line reads `SUBJ:` where the
 *  plain product reads `SUBJ/`, which is the exact character `parseSubject`
 *  keys on in both the relay and lib/advisory.js. Whether anything ELSE
 *  differs decides whether one fetch can ever replace two, and that cannot be
 *  answered without both files side by side in the same snapshot. */
const JTWC_PRODUCT_RE =
  /https:\/\/www\.metoc\.navy\.mil\/jtwc\/products\/([a-z]{2}\d{4})(web\.txt|fix\.txt|\.tcw|\.kmz)/gi;

function jtwcStormSources(rssText) {
  const seen = new Set();
  const byStorm = new Map();
  for (const m of String(rssText || '').matchAll(JTWC_PRODUCT_RE)) {
    const id = m[1].toLowerCase();
    const suffix = m[2].toLowerCase();
    const key = `${id}${suffix}`;
    /* The RSS repeats a storm's block when it sits in two basin items. */
    if (seen.has(key)) continue;
    seen.add(key);
    if (!byStorm.has(id) && byStorm.size >= JTWC_MAX) continue;
    if (!byStorm.has(id)) byStorm.set(id, []);
    const spec = JTWC_PRODUCTS.find((p) => p.suffix === suffix);
    if (!spec) continue;
    byStorm.get(id).push({
      name: `jtwc/${id}${spec.ext}`,
      url: m[0],
      binary: spec.binary,
      note:
        `JTWC ${spec.what} for ATCF ${id.toUpperCase()}, linked from this ` +
        `run's jtwc.rss. Archived to settle one question and only one: does ` +
        `any per-storm JTWC product carry WIND EXTENT — a radius, a quadrant, ` +
        `a drawn band — and does it carry it for PAST hours as well as ` +
        `forecast ones. Everything else in here is a bonus.`,
    });
  }
  return [...byStorm.values()].flat();
}

/* ---------------------------------------------------------------------------
 * PER-STORM GEOMETRY — DERIVED, NOT LISTED
 *
 * ==> THE ONLY PART OF THIS FILE THAT CANNOT BE A CONSTANT. <== Every source
 * above has a fixed URL. A storm's geometry does not: the address carries the
 * event id AND the episode id, and the episode increments on every update, so
 * the URL for DOLPHIN-26 this hour is not the URL for DOLPHIN-26 last hour.
 * GDACS publishes the right one inside the event list under `url.geometry`, so
 * that is what is used — a link the source gave us keeps working if GDACS moves
 * the endpoint, which is the same rule data/gdacs-geometry.js follows.
 *
 * WHY IT WAS ADDED (2026-08-12). Four storms on screen and not one had a past
 * track. The parser was proven innocent against a shipped sample, no toggle
 * could hide the layer, and nothing had touched the track code — which left
 * two candidates that could only be told apart by reading the actual bytes
 * GDACS is serving right now for these actual storms. The archive held the
 * event list and not one polygon. A question that cannot be answered from
 * inside a session is the exact thing this file exists to remove.
 *
 * ==> IT IS WRITTEN TO latest/ AND DELIBERATELY KEPT OUT OF history/. <== One
 * storm's geometry ran 386 KB in the shipped sample; a handful of live storms
 * is a megabyte or more an hour, and the history keeps 72 hours. That is
 * roughly a hundred megabytes of near-identical polygons to answer questions
 * that are always about NOW — what is the feed serving for this storm today.
 * The rolling window earns its size for the event lists and the bulletins,
 * where "when did this change" is a real question. It does not here. The
 * workflow enforces the split; this file just puts them in a subdirectory.
 *
 * NHC HAS NO EQUIVALENT ENTRY YET, AND THAT IS A GAP RATHER THAN A DECISION.
 * Its geometry comes from an ArcGIS MapServer as one query per layer per storm
 * (data/nhc-mapserver.js), so it is several times the work — and with
 * CurrentStorms.json currently 24 bytes there is not a single Atlantic or
 * Pacific storm to point it at. Untestable code archiving nothing is worse
 * than an honest hole. */

/** How many storms' geometry to pull. A cap rather than a filter: the list is
 *  already only current cyclones, and a season that puts more than this many
 *  up at once has bigger problems than an incomplete archive. Ordered by the
 *  feed's own order, so it is at least stable between runs. */
const GEOMETRY_MAX = 8;

/** GDACS's own live flag, published as the STRING "true". Same test as
 *  data/gdacs.js `isCurrent`, restated rather than imported: this script runs
 *  on a bare runner with no bundler and must not drag the app's module graph
 *  onto it. If the two ever disagree the archive holds MORE than the app
 *  parses, which is the safe direction for a diagnostic. */
const isCurrentRow = (v) => v === true || String(v).toLowerCase() === 'true';

/** Safe in a filename and still readable at a glance. The event and episode
 *  ids are what make it unambiguous; the name is there so a session looking
 *  for PEILOU can find it without opening four files. */
const slug = (s) => String(s || 'unnamed').replace(/[^A-Za-z0-9-]+/g, '-').slice(0, 40);

function geometrySources(eventListJson) {
  const feats = Array.isArray(eventListJson?.features) ? eventListJson.features : [];
  const out = [];
  for (const f of feats) {
    const p = f?.properties || {};
    if ((p.eventtype || '') !== 'TC') continue;
    if (!isCurrentRow(p.iscurrent)) continue;
    const url = p.url?.geometry;
    /* ==> THE PUBLISHED URL OR NOTHING. <== Building one by hand would mean
     * this script inventing an address, and an invented address that 404s
     * looks identical in the manifest to a storm GDACS has no polygons for.
     * A row without the link is skipped and said so. */
    if (typeof url !== 'string' || !url.startsWith('https://www.gdacs.org/')) continue;
    out.push({
      name: `geometry/gdacs-${slug(p.eventname)}-${p.eventid}-e${p.episodeid}.json`,
      url,
      note:
        `Per-storm GDACS polygons for ${p.eventname} (event ${p.eventid}, ` +
        `episode ${p.episodeid}). Cone, wind bands, the pre-merged swath, the ` +
        `centre dots, and the Line_* track segments whose \`forecast\` flag ` +
        `splits past from future. Last analysed ${p.todate || 'unknown'}.`,
    });
    if (out.length >= GEOMETRY_MAX) break;
  }
  return out;
}

/** GDACS EVENT DETAIL — the storm's own record, not its polygons.
 *
 * Wave 5 pass 1 went looking for a storm surge product that covers the world
 * and found that GDACS already runs one: the JRC models surge globally after
 * every advisory from every centre and publishes, per populated place, a
 * maximum height and a traffic-light colour, about twenty minutes behind the
 * bulletin. That is a per-PLACE answer where NHC's is a per-COAST band, so it
 * is not an adapter behind `fetchSurgeLive()` — it is a different product with
 * a different shape, and the home dashboard is arguably its better home.
 *
 * ==> WHETHER ANY OF IT IS MACHINE-READABLE IS THE OPEN QUESTION. <== The
 * numbers are visible on a GDACS web page and in JRC bulletin files; nothing
 * says they ride the JSON API. The event list does not carry them — checked,
 * zero of 98 rows mention surge. `url.details` is the next place they could
 * be, and the sandbox cannot open it. So it gets archived and the answer is
 * read off real bytes next session.
 *
 * Under geometry/ for the reason that directory exists: per-storm, rebuilt
 * every run, and the question is always about now. */
const EVENTDATA_MAX = 4;

function eventDataSources(eventListJson) {
  const feats = Array.isArray(eventListJson?.features) ? eventListJson.features : [];
  const out = [];
  for (const f of feats) {
    const p = f?.properties || {};
    if ((p.eventtype || '') !== 'TC') continue;
    if (!isCurrentRow(p.iscurrent)) continue;
    const url = p.url?.details;
    /* Same rule as the geometry block: the published link or nothing. */
    if (typeof url !== 'string' || !url.startsWith('https://www.gdacs.org/')) continue;
    out.push({
      name: `geometry/gdacs-eventdata-${slug(p.eventname)}-${p.eventid}.json`,
      url,
      note:
        `GDACS event record for ${p.eventname} (event ${p.eventid}). ` +
        'Archived to answer one question: does anything in here carry the ' +
        "JRC's storm surge output — a height, a colour, an affected place — " +
        'or is that web-page-only. Everything else it holds is a bonus.',
    });
    if (out.length >= EVENTDATA_MAX) break;
  }
  return out;
}

/** ==> THE NHC TRACK WAS THE ONE THING THIS ARCHIVE NEVER HELD. <==
 *
 * The storm LIST was snapshotted hourly from day one; the per-storm TRACK never
 * was, on either feed's NHC side. That gap cost two bugs in one week, both of
 * them questions about a field on a track point that nobody could read:
 *
 *   - `stormtype` on Past Points is a two-letter CODE while `tcdvlp` on
 *     Forecast Points is spelled out, so every weak storm's history drew in the
 *     generic red for a season.
 *   - The pre-genesis stretch of a track drew hotter than the depression it
 *     became, and the diagnosis had to be argued from where the red patches sat
 *     on the globe rather than read off a field.
 *
 * Neither needed cleverness. Both needed the bytes. The sandbox cannot reach
 * NOAA and `web_fetch` strips the query string an ArcGIS query IS, so a session
 * has no route to a track point at all — which makes this the single highest
 * value thing the archive can add.
 *
 * Layers 5, 8 and 10. Forecast Points and Past Points are where every
 * per-position field lives. The cone, the track lines and the wind radii are
 * geometry-heavy and answer questions nobody has been stuck on.
 *
 * ==> LAYER 8 IS HERE BECAUSE IT ANSWERED WITH NO GEOMETRY AT ALL. <== On
 * 2026-08-13 Lala's Hurricane Watch arrived as ONE feature carrying every
 * attribute — `tcww: "HWA"`, advisory 5A, bin CP2 — and `geometry: null`,
 * `shape: null`, `st_length(shape): null`. The panel said "Hurricane Watch",
 * the coast drew unmarked, and the only way anyone found out was Aaron
 * opening the relay on a phone and pasting the body back. That is exactly the
 * transport this file exists to replace. Snapshotting it hourly is also the
 * only way to answer the question one paste cannot: is a shapeless watch a
 * Central Pacific quirk, one bad advisory, or the normal state of this layer.
 * It is small — a handful of coastal breakpoint lines, or one empty row.
 *
 * The bin number comes from the list this run just fetched — NHC's own
 * `binNumber`, never assembled here. Same rule the GDACS block follows above:
 * a URL this script invents that 404s is indistinguishable in the manifest from
 * a storm that genuinely has no track. */
/* ==> NOT ONLY POINTS ANY MORE, WHICH IS WHY THE NAME CHANGED. <== Layer 13
 * is the PAST wind field — polygons, not positions — and §49.9 blocks on it:
 * the corridor's past arm is the answer to "did dangerous wind already reach
 * my house", and the spec says in as many words that nobody has ever read this
 * layer field-by-field off real bytes. It is consumed in production by
 * `lib/windswath.js`, so the field names are trustworthy and the COVERAGE is
 * not — how far back it publishes, whether it carries all three thresholds at
 * every synoptic hour, what it does across a basin change. Those are questions
 * one hourly snapshot answers and no amount of reading our own code can.
 *
 * IT JOINS TO LAYER 10 ON A TEN-DIGIT STAMP: 13 carries `synoptime` as a
 * STRING, 10 carries `dtg` as a NUMBER of the same digits. Both are in this
 * table, so one snapshot holds both sides of the join and the next session can
 * test it without the network. */
/* ==> AND LAYERS 15 AND 16, BECAUSE A SESSION CANNOT DIAGNOSE THE HOME CHART
 * WITHOUT THEM (§49.15). <== The chart's wind bands are built from the
 * FORECAST quadrant numbers (15) and the field at the storm's present position
 * (16). Neither was archived, so the Lala band fault of 2026-08-16 could be
 * confirmed for the measured half — layer 13 was here — and only REASONED
 * ABOUT for the forecast half, which is the one that was being dropped.
 * `data/nhc-mapserver.js` reads 15 for its numbers and then OVERWRITES the
 * slot with the swept envelope, so the published quadrants exist for one
 * instant in the live app and nowhere at all in the archive. They exist here
 * now. Four layers a storm an hour is the price of being able to measure the
 * band instead of arguing about it. */
/* ==> AND LAYERS 6 AND 7, WITHOUT WHICH THE CONE CANNOT BE DEBUGGED AT ALL.
 * <== §7.9, §47.5. The cone rebuild sweeps layer 7 along layer 6 and those two
 * are the ONLY inputs it has. Neither was archived. So when Aaron reported the
 * environment ribbon coming and going on Lala (2026-08-18), the one feature
 * being diagnosed was the one with no real bytes anywhere — the whole
 * investigation ran against Ida's 2021 GIS capture instead, a different storm
 * in a different basin five years earlier, and the finding could only be
 * generalised to Lala rather than confirmed on her.
 *
 * Two layers a storm an hour is the price of never being in that position
 * again. It is also the pair that answers the first question about any cone
 * fault: did the rebuild decline, and if so at which guard. */
/* ==> THIS LIST MUST MATCH `SUMMARY_LAYER` IN data/nhc-mapserver.js. <== It
 * held eight of the app's nine layers for weeks, and the missing one was
 * `pastTrack` (11) — the line every "track doubles back" warning in the
 * console is about. A session chasing that on 2026-08-21 found the archive
 * carried the past POINTS and not the past LINE, which are different products
 * with different vertex counts, and had no way to read the bytes it needed.
 * An archive that covers most of a bundle is an archive that fails on exactly
 * the day something goes wrong with the rest. */
const NHC_STORM_LAYER = Object.freeze({
  forecastPoints: 5,
  forecastTrack: 6,
  cone: 7,
  watchWarning: 8,
  pastPoints: 10,
  pastTrack: 11,
  windPast: 13,
  windSwath: 15,
  windCurrent: 16,
});
const NHC_MAPSERVER =
  'https://mapservices.weather.noaa.gov/tropical/rest/services/tropical/' +
  'NHC_tropical_weather_summary/MapServer';

function nhcTrackSources(currentStormsJson) {
  const storms = Array.isArray(currentStormsJson?.activeStorms)
    ? currentStormsJson.activeStorms
    : [];
  const out = [];
  for (const s of storms) {
    const bin = String(s?.binNumber || '').toUpperCase();
    /* The same shape data/nhc-mapserver.js validates. A bin that fails it is
     * skipped rather than queried, so a bad row cannot fill the manifest with
     * identical 400s. */
    if (!/^[A-Z]{2}[0-9]$/.test(bin)) continue;
    for (const [key, id] of Object.entries(NHC_STORM_LAYER)) {
      out.push({
        name: `geometry/nhc-${slug(s.name)}-${bin}-${key}.geojson`,
        url:
          `${NHC_MAPSERVER}/${id}/query?where=${encodeURIComponent(`binnumber='${bin}'`)}` +
          '&outFields=*&returnGeometry=true&outSR=4326&f=geojson',
        note:
          `NHC ${key} (layer ${id}) for ${s.name} (${s.id}, bin ${bin}), ` +
          `classified ${s.classification} at ${s.intensity} kt. Every ` +
          `per-position field verbatim — including \`stormtype\`, \`tcdvlp\`, ` +
          `\`ss\`/\`ssnum\` and \`intensity\`/\`maxwind\`, which are what the ` +
          `cage ridge reads and what no session could see before this existed.`,
      });
    }
    /* ==> THE CAP IS STORMS, NOT REQUESTS, AND IT HAS TO BE DERIVED. <== This
     * read `GEOMETRY_MAX * 2` while the map held exactly two layers. Adding a
     * third would have quietly turned a cap on STORMS into a cap two-thirds
     * as generous — no error, no warning, just the last storms of a busy
     * season missing from the archive and nobody able to say since when. */
    if (out.length >= GEOMETRY_MAX * Object.keys(NHC_STORM_LAYER).length) break;
  }
  return out;
}

async function grab(src) {
  const started = Date.now();
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(src.url, {
      /* ==> A SOURCE MAY ADD HEADERS, AND EXACTLY ONE NEEDS TO. <== A CORS
       * answer is a RESPONSE to a request that carried an `Origin`; a server
       * that omits `access-control-allow-origin` when nobody asked has said
       * nothing, and reading that silence as "CORS is closed" is the mistake
       * this parameter exists to prevent. `src.headers` never overrides the
       * user-agent, so a source cannot accidentally anonymise the archive. */
      headers: { 'user-agent': UA, accept: '*/*', ...(src.headers || {}) },
      signal: ctl.signal,
      redirect: 'follow',
    });
    const isBinary = src.binary === true;
    /* ==> A BINARY SOURCE CANNOT GO THROUGH `text()`. <== It decodes as UTF-8,
     * and every byte that is not valid UTF-8 comes out as a replacement
     * character — silently, with a plausible-looking length. A zip archive run
     * through that is unrecoverable. Binary sources are read as bytes and
     * written base64, and the byte count reported is the REAL one so the
     * manifest still says whether the thing arrived. */
    const buf = isBinary ? Buffer.from(await res.arrayBuffer()) : null;
    const body = isBinary ? buf.toString('base64') : await res.text();
    const byteLength = isBinary ? buf.length : body.length;
    const headers = Object.fromEntries(res.headers.entries());

    /* An HTTP error still has a body worth keeping — an NHC maintenance page
       tells you more than "500". But it is NOT written to latest/, because
       latest/ must only ever hold something the app could actually parse. */
    const okish = res.ok && byteLength > 0;
    return {
      name: src.name,
      url: src.url,
      note: src.note,
      status: okish ? 'ok' : 'unavailable',
      http: res.status,
      httpText: res.statusText,
      bytes: byteLength,
      ms: Date.now() - started,
      headers,
      body,
      reason: okish ? null : `HTTP ${res.status} ${res.statusText}, ${byteLength} bytes`,
    };
  } catch (err) {
    return {
      name: src.name,
      url: src.url,
      note: src.note,
      status: 'unavailable',
      http: null,
      bytes: 0,
      ms: Date.now() - started,
      headers: {},
      body: null,
      reason: String(err && err.message ? err.message : err),
    };
  } finally {
    clearTimeout(timer);
  }
}

/* ---------------------------------------------------------------------------
 * NWS ZONE SHAPES — THE BYTES PHASE 4 OF THE FLOOD PLAN IS BLOCKED ON.
 *
 * ==> A FLOOD WATCH CARRIES `geometry: null` AND THEREFORE CANNOT BE MATCHED,
 * NOT JUST CANNOT BE DRAWN. <== §56.4. The corridor test measures a distance
 * from the storm's track to the alert's shape; with no shape there is nothing
 * to measure, so a watch is invisible to the very test that decides whether it
 * is near the reader. The zones ARE named, in `geocode.UGC`, and NWS serves
 * each one's real boundary. Resolving them is what makes a watch drawable AND
 * matchable through the same test as everything else.
 *
 * ==> THE SHAPE OF THAT RESPONSE HAS NEVER BEEN READ IN THIS PROJECT. <== Not
 * once, by anything. `api.weather.gov` is outside the sandbox wall, WebFetch
 * comes back empty against it (NWS answers 403 without a contact in the
 * User-Agent and WebFetch cannot set one), and no zone URL has ever been
 * archived. So every input Phase 4 needs is currently a guess: the envelope
 * (Feature or FeatureCollection), the geometry type, how many rings an island
 * zone carries, how many BYTES a zone costs, and whether the boundary is fine
 * enough to need `lib/simplify.js` before it goes near a phone. §12's rule is
 * that a parser written against a guessed payload inherits the wrong
 * assumptions and its tests then pass on them. This entry exists so the next
 * session opens with the real bytes instead.
 *
 * ==> AND ONE OF THESE IS NOT LIKE THE OTHERS: THE BULK QUERY. <== §56.4 costs
 * this feature at "seventeen more requests per watch", and that figure is the
 * whole reason §48.21 rejected zone resolution in the first place. NWS also
 * documents a collection endpoint taking a comma-separated id list, which — if
 * it answers — turns seventeen requests into one and retires the cost argument
 * entirely. Nobody has asked it. It is asked here beside the per-zone requests
 * so the two can be compared in one snapshot: same zones, same hour, one
 * request against many. **A 400 here is a real and useful answer** — it means
 * the per-zone loop is the only route and the plan's arithmetic stands.
 *
 * Under `geometry/` for exactly the reason that directory exists: a zone
 * boundary changes on the order of once a year, so 72 hours of hourly copies
 * buys nothing. The question these answer is about the SHAPE, not about now.
 *
 * ==> DERIVED FROM THIS RUN'S LIVE WATCHES, NEVER FROM A HARDCODED LIST. <==
 * Same rule the GDACS geometry and NHC track phases follow. A UGC this script
 * invents that 404s is indistinguishable in the manifest from a zone NWS
 * genuinely does not publish, and the point of the exercise is to find out
 * which. Zero watches in force is a real answer and derives zero URLs.
 */

/** How many distinct zones to resolve in one run.
 *
 *  ==> A BOUND, NOT A TUNING KNOB. <== Three watches on the quiet day this was
 *  written named 8, 11 and 4 zones — 23 in all. A national flood event could
 *  name hundreds, and this script must never turn a bad weather day into
 *  several hundred requests at one agency. The cap is deliberately larger than
 *  the measured day so a normal run is never truncated, and small enough that
 *  the worst case stays neighbourly. If a run reports exactly this many, the
 *  set was cut and the next question is what got left out. */
const ZONE_SHAPE_CAP = 40;


/** The per-zone requests, plus the one bulk request that could replace them. */
function zoneShapeSources(watchBody) {
  const { forecast, county, malformed } = watchZoneCodes(watchBody);
  const codes = forecast.slice(0, ZONE_SHAPE_CAP);
  if (!codes.length) return [];

  /* ==> WHAT WAS LEFT OUT RIDES ON EVERY NOTE, BECAUSE THE MANIFEST IS THE
   * ONLY CHANNEL A SESSION CAN READ. <== A capped set, a county code nobody
   * fetched and a malformed code all look identical to a quiet hour otherwise,
   * and §5's silence rule applies to our own tooling exactly as it applies
   * to the app. */
  const caveats = [
    forecast.length > codes.length
      ? ` ==> CUT FROM ${forecast.length} FORECAST ZONES BY ZONE_SHAPE_CAP — the set is incomplete this run. <==`
      : '',
    county.length
      ? ` ==> ${county.length} COUNTY CODE(S) WERE NAMED AND NOT FETCHED: ${county.join(', ')}. <== They live at /zones/county/, not /zones/forecast/, and nothing here has read one. If Phase 4 has to handle them, this is the hour that proved it.`
      : '',
    malformed ? ` ${malformed} code(s) matched neither shape and were dropped.` : '',
  ].join('');

  const out = codes.map((ugc) => ({
    name: `geometry/nws-zone-${ugc}.geojson`,
    url: `https://api.weather.gov/zones/forecast/${ugc}`,
    headers: { accept: 'application/geo+json' },
    note:
      `Forecast zone ${ugc}, named by a Flood Watch in force this hour. ` +
      'THE FIRST ZONE BOUNDARY THIS PROJECT HAS EVER READ (§56.4). What it ' +
      'settles, none of which is currently known: the response envelope, the ' +
      'geometry type, the vertex count and byte cost of one zone, and whether ' +
      'the boundary needs simplifying before a phone draws seventeen of them. ' +
      '==> IT IS NWS’S OWN BOUNDARY, WHICH IS WHY RESOLVING IT IS PERMITTED ' +
      'AT ALL. <== §48.21 forbids giving a shapeless watch an INVENTED shape ' +
      '— a centroid, a circle. Fetching the polygon the agency itself ' +
      'publishes for the zone it itself named is the opposite of that.' +
      caveats,
  }));

  out.push({
    name: 'geometry/nws-zones-bulk-probe.geojson',
    url:
      'https://api.weather.gov/zones?type=forecast&id=' +
      encodeURIComponent(codes.join(',')),
    headers: { accept: 'application/geo+json' },
    note:
      `THE SAME ${codes.length} ZONES ASKED FOR IN ONE REQUEST. ==> THIS IS THE ` +
      'ENTRY THAT COULD DELETE §56.4’S COST ARGUMENT. <== That section ' +
      'prices zone resolution at "seventeen more requests per watch", and ' +
      '§48.21 rejected the whole idea on that number. If this returns a ' +
      'FeatureCollection carrying the same boundaries, seventeen requests ' +
      'become one and the objection is gone. Compare it against the per-zone ' +
      'files beside it: same geometry, or a coarser one? All of the zones, or ' +
      'a silently capped page? ==> A 400 OR 404 IS A REAL ANSWER AND MUST NOT ' +
      'BE READ AS AN OUTAGE. <== It means the collection endpoint does not ' +
      'take an id list, the per-zone loop is the only route, and the plan’s ' +
      'arithmetic stands as written.' + caveats,
  });

  out.push({
    name: 'geometry/relay-nws-zone.json',
    url:
      'https://landfall.getgravitate.app/api/nws/zone?ids=' +
      encodeURIComponent(codes.join(',')),
    note:
      '==> OUR RELAY IN FRONT OF THE ZONE BOUNDARIES, AND THE ONLY CAPTURE HERE ' +
      'THAT PROVES ANYTHING ABOUT THE APP. <== \u00a756.4. The per-zone files ' +
      'beside this one show what NWS published; this shows what a phone was ' +
      'actually handed, which is the only thing a bug report is ever about. ' +
      'Three things live here and nowhere else: the projection (is the boundary ' +
      'still there after name, state and shape are the only fields kept, and ' +
      'did the rounding to four places survive the trip), the `missing` array ' +
      '(a zone the route could not resolve is named rather than dropped, and a ' +
      'watch that reaches a reader unplaced is unplaced BECAUSE of a row in ' +
      'here), and X-Landfall-Cache, which says whether the thirty-day per-zone ' +
      'hold is actually holding. ==> THE ID LIST IS THIS HOUR\u2019S WATCHES, SO ' +
      'THE URL MOVES. <== That is the point: it asks for exactly what a phone ' +
      'would ask for at the moment of capture. A quiet hour derives no codes ' +
      'and this entry does not exist, which is a quiet hour and not a fault.' +
      caveats,
  });

  out.push({
    name: 'geometry/nws-zones-bulk-probe-geometry.geojson',
    url:
      'https://api.weather.gov/zones?type=forecast&include_geometry=true&id=' +
      encodeURIComponent(codes.join(',')),
    headers: { accept: 'application/geo+json' },
    note:
      'THE SAME BULK REQUEST WITH ONE PARAMETER ADDED, AND IT IS THE ONLY ' +
      'THING STILL STANDING BETWEEN §56.4 AND A ONE-REQUEST RESOLVER. ==> THE ' +
      'PLAIN BULK PROBE BESIDE THIS ONE ANSWERED, AND ANSWERED WITHOUT ' +
      'SHAPES. <== Measured 2026-08-23: 200 OK, all 23 zones asked for, 30,172 ' +
      'bytes, and a null geometry on every single feature. So the collection ' +
      'endpoint DOES take an id list — the half nobody had ever tested — but ' +
      'serves metadata only, which left the per-zone loop as the only route to ' +
      'a boundary and Phase 4 shipped on it: 23 zones cost 23 requests and ' +
      '1.63 MB. NWS documents an include_geometry parameter on this endpoint ' +
      'and this project has never sent it. ==> IF IT COMES BACK CARRYING THE ' +
      'SAME BOUNDARIES, THE RESOLVER SHOULD ASK ONCE INSTEAD OF FORTY TIMES. ' +
      '<== Compare against the per-zone files: same geometry type, same vertex ' +
      'count, or a coarser boundary? All of the zones, or a silently capped ' +
      'page? A 400, or a 200 with null geometries again, is equally useful — ' +
      'it means the parameter is not real on this route and the loop stays.' +
      caveats,
  });

  return out;
}

const stamp = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
mkdirSync(OUT, { recursive: true });
mkdirSync(join(OUT, 'geometry'), { recursive: true });
mkdirSync(join(OUT, 'ships'), { recursive: true });
mkdirSync(join(OUT, 'jtwc'), { recursive: true });
/* ==> A SOURCE NAME WITH A SLASH IN IT NEEDS ITS FOLDER MADE HERE. <== The
 * a-deck phase landed on 2026-08-21 naming its sources `adeck/nhc-<id>.txt`
 * and nobody added the line below, so the FIRST deck write threw ENOENT, the
 * phase's own try/catch swallowed it, and the run reported 68/69 sources ok
 * with no deck and no complaint. Every other prefixed family above is here for
 * the same reason. Add the folder in the same commit as the family. */
mkdirSync(join(OUT, 'adeck'), { recursive: true });

const results = [];

/* ==> A DERIVED PHASE THAT THROWS MUST NOT LOOK LIKE A QUIET HOUR. <== Every
 * derived block below is wrapped in its own try/catch, deliberately: an
 * experiment must never cost us a storm list. But the catch printed one line
 * to stdout and nothing reached the manifest, so a phase that failed OUTRIGHT
 * was indistinguishable from a phase that legitimately derived nothing.
 *
 * Measured 2026-08-21: the a-deck phase threw ENOENT on its first write, every
 * hour, and `manifest.json` said `68/69 sources ok`. A session read that,
 * concluded the relay had served no decks, and lost the run. §5's silence rule
 * applies to our own tooling exactly as it applies to the app.
 *
 * `derivedFailures` rides in the manifest so the failure is readable with the
 * same `git show` that reads everything else. An EMPTY array is the healthy
 * state and is written every hour, so nothing has to remember the key exists. */
const derivedFailures = [];

/** Record a derived phase that threw. Prints loudly AND lands in the manifest;
 *  the console alone is not a channel any session can read. */
function phaseFailed(phase, err) {
  const reason = String(err && err.message ? err.message : err);
  derivedFailures.push({ phase, reason });
  console.log(`\n!! DERIVED PHASE FAILED — ${phase}: ${reason}`);
}

/** Fetch one source, write it, log it. Extracted when the geometry phase
 *  arrived, because a second copy of this would be a second place for the
 *  "a failure writes no data file" rule to drift out of. */
async function run(src) {
  const r = await grab(src);
  if (r.status === 'ok') {
    writeFileSync(join(OUT, r.name), r.body);
  } else if (r.body != null) {
    /* Keep the error body under a name that cannot be mistaken for real data. */
    writeFileSync(join(OUT, r.name + '.error.txt'), r.body);
  }
  delete r.body;
  results.push(r);
  console.log(
    `${r.status === 'ok' ? 'ok  ' : 'FAIL'} ${r.name.padEnd(44)} ` +
      `${String(r.http ?? '-').padStart(3)}  ${String(r.bytes).padStart(8)} B  ${r.ms} ms` +
      (r.reason ? `  ${r.reason}` : '')
  );
  return r;
}

for (const src of SOURCES) await run(src);

/* ==> PHASE TWO: THE STORMS THE FIRST PHASE JUST FOUND. <==
 *
 * Reads the file that was WRITTEN rather than holding the body in memory, so
 * the geometry phase runs against exactly the bytes a session will read. If
 * the event list failed, there is nothing on disk, nothing is derived, and the
 * manifest already says the list is unavailable — no second complaint needed
 * and no invented storm list to fall back on. */
let geometryCount = 0;
try {
  const list = JSON.parse(readFileSync(join(OUT, 'gdacs-events.json'), 'utf8'));
  const derived = geometrySources(list);
  console.log(`\nderived ${derived.length} per-storm geometry URL(s) from the GDACS list`);
  for (const src of derived) {
    const r = await run(src);
    if (r.status === 'ok') geometryCount++;
  }
} catch (err) {
  phaseFailed('geometry', err);
}

/* GDACS event detail, §4.8. Its own try block for the same reason as every
 * other derived phase: an experiment must never be able to cost us a polygon.
 * The NAMES that landed are kept, because the surge phase below reads these
 * files back off disk — a failed one has no file and must not be opened. */
const eventDataWritten = [];
try {
  const list = JSON.parse(readFileSync(join(OUT, 'gdacs-events.json'), 'utf8'));
  const derived = eventDataSources(list);
  console.log(`\nderived ${derived.length} GDACS event-detail URL(s) from the GDACS list`);
  for (const src of derived) {
    const r = await run(src);
    if (r.status === 'ok') eventDataWritten.push(r.name);
  }
} catch (err) {
  phaseFailed('gdacs-event-detail', err);
}

/* The NHC half of phase two. Separate try block on purpose: a GDACS list that
 * failed must not also cost us the NHC tracks, and vice versa. Same rule as the
 * per-layer slots in the app itself — one source failing never blanks another. */
try {
  const list = JSON.parse(readFileSync(join(OUT, 'nhc-currentstorms.json'), 'utf8'));
  const derived = nhcTrackSources(list);
  console.log(`\nderived ${derived.length} NHC track URL(s) from CurrentStorms.json`);
  for (const src of derived) {
    const r = await run(src);
    if (r.status === 'ok') geometryCount++;
  }
} catch (err) {
  phaseFailed('nhc-tracks', err);
}

/* SHIPS, §47. Its own try block for the same reason as the two above: this is
 * the newest and least proven of the derived phases, and it must not be able
 * to cost us a track or a polygon if the filename convention turns out to be
 * wrong. Roughly half of these are EXPECTED to 404 — two synoptic slots are
 * requested and usually only one is published yet. A run where every one
 * fails is the signal worth reading, not a run where some do. */
try {
  const list = JSON.parse(readFileSync(join(OUT, 'nhc-currentstorms.json'), 'utf8'));
  const derived = shipsSources(list, Date.now());
  console.log(`\nderived ${derived.length} SHIPS URL(s) from CurrentStorms.json`);
  for (const src of derived) await run(src);
} catch (err) {
  phaseFailed('ships', err);
}

/* JTWC per-storm products. Its own try block like every other derived phase:
 * this is an open research question, and an experiment must never be able to
 * cost us a track or a polygon. Reads the RSS that was WRITTEN rather than a
 * body held in memory, so it derives from exactly the bytes a session reads.
 * A run deriving ZERO URLs is a real answer when JTWC has no active warnings —
 * the Southern Hemisphere block says so in as many words for half the year. */
try {
  const rss = readFileSync(join(OUT, 'jtwc.rss'), 'utf8');
  const derived = jtwcStormSources(rss);
  console.log(`\nderived ${derived.length} JTWC per-storm product URL(s) from jtwc.rss`);
  for (const src of derived) await run(src);
} catch (err) {
  phaseFailed('jtwc-storm-products', err);
}

/* NWS ZONE SHAPES, §56.4. Its own try block like every derived phase: this is
 * the newest and least proven of them and it must never be able to cost us a
 * track or a polygon. Reads the watch file that was WRITTEN rather than a body
 * held in memory, so it derives from exactly the bytes a session will read.
 *
 * ==> DERIVING ZERO IS A REAL ANSWER AND IS THE COMMON CASE. <== Most hours
 * have no Flood Watch in force anywhere in the United States. A run that
 * derives nothing means the weather was quiet, not that the phase broke — the
 * broken case lands in `derivedFailures` and says so. */
let zoneShapeCount = 0;
try {
  const watches = JSON.parse(
    readFileSync(join(OUT, 'nws-alerts-flood-watch-national.json'), 'utf8')
  );
  const derived = zoneShapeSources(watches);
  console.log(
    `\nderived ${derived.length} NWS zone-shape URL(s) from the live Flood Watches`
  );
  for (const src of derived) {
    const r = await run(src);
    if (r.status === 'ok') zoneShapeCount++;
  }
} catch (err) {
  phaseFailed('nws-zone-shapes', err);
}



/* MODEL GUIDANCE. The decks themselves, one per storm the roster names, read
 * through our own relay because that is the URL the app reads and the only one
 * whose cache headers mean anything.
 *
 * ==> THE ONE INPUT TO `lib/adeck.js` THAT NOTHING COULD SEE. <== Model tracks
 * were reported drawing from the wrong origin on 2026-08-21 and the session
 * could not tell a parse fault from a stale cycle from a deck the relay never
 * served, because the deck was not archived. Every OTHER track on the map had
 * its bytes here.
 *
 * Its own try block like every derived phase: this must never be able to cost
 * us a storm list. Deriving ZERO decks is a real answer — TCGP files nothing
 * for a storm that formed an hour ago, and `data/adeck.js` calls that `none`
 * rather than a failure. */
try {
  const roster = JSON.parse(readFileSync(join(OUT, 'relay-tcgp-storms.json'), 'utf8'));
  const list = JSON.parse(readFileSync(join(OUT, 'nhc-currentstorms.json'), 'utf8'));
  const derived = adeckSources(roster, list);
  console.log(`\nderived ${derived.length} a-deck URL(s) from the two rosters`);
  for (const src of derived) await run(src);
} catch (err) {
  phaseFailed('adeck', err);
}


/* ---------------------------------------------------------------------------
 * COUNTRY MATCH — the one thing the hourly window can measure and a session
 * cannot. §50.12.
 *
 * ==> THE FEATURE JOINS STORMS TO ALERTS BY COUNTRY CODE, AND ON 2026-08-19
 * THAT JOIN MATCHED NOTHING WHILE AN ALERT WAS IN FORCE. <== GDACS attributed
 * a country to one of three live storms; PAGASA had a Tropical Cyclone Alert
 * out for a Philippine-basin system GDACS did not list AT ALL. The alert was
 * real, we had it in hand, we could colour it, and nothing on the globe
 * carried `PH` to hang it on.
 *
 * ==> THAT IS TWO FAILURE MODES WEARING ONE SYMPTOM, AND THEY NEED DIFFERENT
 * FIXES. <== A listed storm with no country yet is an attribution LAG. An
 * alert for a system that is not in the storm list at all is a COVERAGE hole
 * — GDACS tracks named cyclones, PAGASA warns on depressions and invests, and
 * no amount of waiting closes that. Both look identical from inside the app:
 * a section that says nothing.
 *
 * Nothing in a session can tell them apart — it needs the same storm looked
 * at across many hours, which is exactly what `history/` is. So each run
 * records both halves of the join as it stood, and a later session diffs the
 * snapshots instead of arguing from one. A country that appears in
 * `unmatchedAlertCountries` for a while and then attaches to a storm was a
 * lag; one that never attaches was a hole.
 *
 * ==> BOTH HALVES, OR IT MEASURES NOTHING. <== A storm list alone cannot tell
 * you whether an unattributed storm mattered that hour. The pair can: an hour
 * with an alert country that no live storm carries is one hour of the app
 * saying nothing while an agency was warning somebody.
 *
 * Position rides along because it is the only field that says whether the
 * storm was NEAR anyone — the difference between "not scored yet" and "out in
 * the middle of the Pacific" is a coordinate, and reconstructing it later
 * would mean re-fetching a list that has since rolled over.
 *
 * Reads what was WRITTEN, like every other derived phase, so it summarises
 * exactly the bytes a session will read back. A missing or broken file makes
 * this null rather than throwing — an experiment must never cost a polygon.
 * ------------------------------------------------------------------------ */
function countryMatchSummary() {
  const out = {
    note:
      'Both halves of the §50.3 country join, hourly. `storms` is every live ' +
      'GDACS cyclone with the ISO-2 codes it carried; `alertCountries` is ' +
      'every country with a cyclone alert IN FORCE (drills, cancellations ' +
      'and stand-downs already excluded by lib/cap.js). ==> AN ENTRY IN ' +
      '`unmatchedAlertCountries` IS AN HOUR THE APP SHOWED NOTHING WHILE AN ' +
      'AGENCY WAS WARNING SOMEBODY. <== Diff these across history/ to measure ' +
      "how far GDACS's attribution lags the warnings themselves.",
    storms: null,
    alertCountries: null,
    unmatchedAlertCountries: null,
  };

  try {
    const list = JSON.parse(readFileSync(join(OUT, 'gdacs-events.json'), 'utf8'));
    const feats = Array.isArray(list?.features) ? list.features : [];
    out.storms = feats
      .filter((f) => f?.properties?.eventtype === 'TC' && isCurrentRow(f.properties.iscurrent))
      .map((f) => {
        const p = f.properties;
        const coords = Array.isArray(f.geometry?.coordinates) ? f.geometry.coordinates : null;
        return {
          name: p.eventname ?? null,
          eventid: p.eventid ?? null,
          episodeid: p.episodeid ?? null,
          source: p.source ?? null,
          alertlevel: p.alertlevel ?? null,
          /* The join key itself, exactly as `lib/cap.js` reads it. An empty
           * array and a missing field are the same thing to the feature and
           * are recorded the same way here. */
          iso2: (Array.isArray(p.affectedcountries) ? p.affectedcountries : [])
            .map((c) => String(c?.iso2 ?? '').trim().toUpperCase())
            .filter(Boolean),
          lon: coords ? coords[0] : null,
          lat: coords ? coords[1] : null,
        };
      });
  } catch {
    /* The list failed this run; the manifest already says so. */
  }

  try {
    const feed = JSON.parse(readFileSync(join(OUT, 'capalerts-cyclone.json'), 'utf8'));
    const rows = Array.isArray(feed?.features) ? feed.features : [];
    const now = Date.now();
    const seen = new Set();
    for (const r of rows) {
      const a = normalizeAlert(r?.attributes);
      if (!a || !a.country) continue;
      if (!isInForce(a, now)) continue;
      seen.add(a.country);
    }
    out.alertCountries = [...seen].sort();
  } catch {
    /* Same: the feed's own manifest row carries the failure. */
  }

  /* Only computable when BOTH halves arrived. Null here means unknown, and
   * unknown must not read as zero — that is the §5 rule applied to a
   * diagnostic rather than to a screen. */
  if (out.storms && out.alertCountries) {
    const carried = new Set(out.storms.flatMap((s) => s.iso2));
    out.unmatchedAlertCountries = out.alertCountries.filter((c) => !carried.has(c));
  }

  return out;
}

const countryMatch = countryMatchSummary();
if (countryMatch.unmatchedAlertCountries?.length) {
  console.log(
    `\nCOUNTRY MATCH: alert in force in ${countryMatch.unmatchedAlertCountries.join(', ')} ` +
      'with no live storm carrying that country — the panel shows nothing this hour.'
  );
}

/* ---------------------------------------------------------------------------
 * GDACS SURGE AND IMPACT PAYLOADS — the values behind the index. §4.8, §50.12.
 *
 * ==> THE EVENT RECORD TURNED OUT TO BE A TABLE OF CONTENTS, NOT AN ANSWER.
 * <== Read 2026-08-19: `cyclonesurge` is present on all three live storms
 * INCLUDING the JTWC one, which is the whole reason to care — it is the only
 * surge product on earth with a non-American half. Structure is better than
 * hoped: three models (ECMWF, GFS, HWRF) crossed with every bulletin, each row
 * flagged `last` and `overall` so picking the current one needs no date
 * arithmetic. But every row is a URL and nothing has ever opened one, so the
 * heights, the places and the units are all still unmeasured.
 *
 * `impacts[].resource` is the same story and was not even noticed until now:
 * `locations`, `timeline`, `buffer39` and `buffer74` are four more export
 * endpoints nobody has followed.
 *
 * ==> WHY `locations` IS FETCHED FOR EVERY STORM AND THE REST ONLY ONCE. <==
 * GDACS answers per POPULATED PLACE where NHC answers per stretch of COAST.
 * If that holds, it is a different product from `surge/`, and the home
 * dashboard — which is already about one house — is its better home than the
 * globe. That makes `locations` the shape decision, and the others reference.
 * A sample of one answers "what is in it"; only a sample across storms answers
 * "does an Atlantic storm and a Pacific one look the same", which is the
 * question that decides whether one parser can serve both.
 *
 * ==> BUDGETS, BECAUSE NOTHING HERE HAS A KNOWN SIZE. <== These are the first
 * payloads in this file requested without ever having seen one, so an
 * unlucky storm could in principle return megabytes. Both caps are small and
 * round-robin across storms, so one storm cannot eat the whole budget and
 * leave the other basin unmeasured. Raise them once the sizes are known.
 *
 * Reads the eventdata files that were WRITTEN by the phase before, same rule
 * as every other derived phase. Under geometry/ because these are per-storm,
 * rebuilt every run, and always about now.
 * ------------------------------------------------------------------------ */
const SURGE_DETAIL_MAX = 6;
const IMPACT_EXPORT_MAX = 6;

/** The rows worth opening out of one storm's surge index, best first.
 *
 *  ==> `overall` IS THE EVENT AGGREGATE. CONFIRMED 2026-08-19, NOT INFERRED.
 *  <== This used to say the reading was a guess off the flag and the id. Three
 *  storms of bytes settled it: every model group carries exactly one
 *  `overall: true` row, it is always `bulletinid: "0"`, its `episodedate`
 *  equals the newest bulletin's, and its figures are the running maxima —
 *  Lala's overall rain 831 mm against bulletin 15's 328, Hernán's overall wind
 *  31 m/s against 17. It is the simulation across bulletins 1..N.
 *
 *  ==> AND IT IS NOT THE PRODUCT THE APP SHIPS. <== §51.1. Every one of these
 *  cards arrives with `geometry: null` and no places in it. What the app reads
 *  is `getlocations` off the `impacts` block, which is already aggregated and
 *  is model-agnostic. These are still fetched because the card is the only
 *  place the model identity and the headline `maxheight` are stated — and the
 *  card's number disagrees with the towns' (Saudel 0.72 m against Shomushon's
 *  0.48), which is worth being able to see.
 *
 *  ==> `aoi_surge` WAS FETCHED, READ, AND RULED OUT. DO NOT RE-DERIVE IT. <==
 *  §51.1. It is an affected-PLACES export, not a water surface: 52 features of
 *  cities, provinces and urban areas, `intensity: 1` on every one, and no
 *  height, surge, water or depth field among its twenty keys. Its two real
 *  shapes are a Korea/Honshu outline and a model-domain bounding box. And it
 *  names Korea, Japan and the Philippines for a storm whose surge export names
 *  the Northern Mariana Islands — two products about one storm naming
 *  different countries. There is nothing in it to draw. */
function surgePicks(cyclonesurge) {
  const picks = [];
  const groups = Array.isArray(cyclonesurge) ? cyclonesurge : [];
  for (const g of groups) {
    const rows = Array.isArray(g?.data) ? g.data : [];
    const overall = rows.find((r) => r?.overall === true && typeof r.url === 'string');
    const latest = rows.find(
      (r) => r?.last === true && r?.overall !== true && typeof r.url === 'string'
    );
    if (overall) picks.push({ model: g.source || 'unknown', kind: 'overall', row: overall });
    if (latest) picks.push({ model: g.source || 'unknown', kind: 'latest', row: latest });
  }
  return picks;
}

/** Round-robin so every storm contributes before any storm contributes twice.
 *  Without this, the first storm's three models fill a budget of six and the
 *  other basin — the entire reason this is being measured — is never read. */
function interleave(perStorm, cap) {
  const out = [];
  for (let i = 0; out.length < cap; i++) {
    let anyLeft = false;
    for (const list of perStorm) {
      if (i >= list.length) continue;
      anyLeft = true;
      out.push(list[i]);
      if (out.length >= cap) break;
    }
    if (!anyLeft) break;
  }
  return out;
}

function surgeAndImpactSources(eventDataNames) {
  const perStormSurge = [];
  const perStormImpact = [];

  for (const name of eventDataNames) {
    let p;
    try {
      p = JSON.parse(readFileSync(join(OUT, name), 'utf8'))?.properties;
    } catch {
      continue; // that storm's record failed this run; its manifest row says so
    }
    if (!p) continue;
    const tag = `${slug(p.eventname)}-${p.eventid}`;
    const who = `${p.eventname} (${p.source || 'unknown centre'}, event ${p.eventid})`;

    const surge = [];
    for (const pick of surgePicks(p.cyclonesurge)) {
      surge.push({
        name: `geometry/gdacs-surge-${tag}-${slug(pick.model)}-${pick.kind}.json`,
        url: pick.row.url,
        note:
          `JRC storm surge for ${who}, ${pick.model} model, ` +
          `${pick.kind === 'overall'
            ? 'the row flagged `overall` — believed to be the event aggregate, which is exactly what this fetch is meant to confirm or disprove'
            : `bulletin ${pick.row.bulletinid} of ${pick.row.episodedate}, the newest single run`}. ` +
          '==> READ FOR SHAPE FIRST, NUMBERS SECOND. <== The open questions ' +
          'are whether a height arrives as a number or as a traffic-light ' +
          'colour, what its unit is, whether it is tied to a named place or ' +
          'to a coordinate, and whether the answer is per-place (a different ' +
          'product from §36, better suited to the home dashboard) or per-coast ' +
          '(an adapter behind the existing surge layer).',
      });
    }
    if (surge.length) perStormSurge.push(surge);

    const impacts = Array.isArray(p.impacts) ? p.impacts : [];
    const exports = [];
    for (const im of impacts) {
      const res = im?.resource || {};
      /* `locations` first for every storm — it is the shape decision. The
       * other three are reference and are capped hard below. */
      for (const key of ['locations', 'timeline', 'buffer74', 'buffer39']) {
        const url = res[key];
        if (typeof url !== 'string' || !url.startsWith('https://www.gdacs.org/')) continue;
        exports.push({
          name: `geometry/gdacs-impact-${key}-${tag}.json`,
          url,
          note:
            `GDACS ${key} export for ${who}, source ${im.source || 'unknown'}. ` +
            (key === 'locations'
              ? '==> THE ONE THAT DECIDES A DESIGN. <== If this is a list of ' +
                'populated places with a per-place number, it is a home-dashboard ' +
                'feature and not a globe layer, and it works on JTWC storms where ' +
                'nothing American reaches.'
              : key === 'timeline'
                ? 'Whether GDACS publishes a per-step history with impact figures on it.'
                : `The ${key.replace('buffer', '')}-knot wind buffer as GDACS models it — ` +
                  'compare against what §35 already draws before assuming it adds anything.'),
        });
      }
    }
    if (exports.length) perStormImpact.push(exports);
  }

  return [
    ...interleave(perStormSurge, SURGE_DETAIL_MAX),
    ...interleave(perStormImpact, IMPACT_EXPORT_MAX),
  ];
}

/* The phase itself. Sits below its helpers rather than beside the others
 * because `SURGE_DETAIL_MAX` is a `const` and would be in its temporal dead
 * zone up there — the phases above are free to move, this one is not. */
try {
  const derived = surgeAndImpactSources(eventDataWritten);
  console.log(
    `\nderived ${derived.length} GDACS surge/impact payload URL(s) from ` +
      `${eventDataWritten.length} event record(s)`
  );
  for (const src of derived) await run(src);
} catch (err) {
  phaseFailed('gdacs-surge', err);
}

const okCount = results.filter((r) => r.status === 'ok').length;

writeFileSync(
  join(OUT, 'manifest.json'),
  JSON.stringify(
    {
      fetchedAt: stamp,
      runner: 'github-actions',
      note:
        'Written by tools/archive-fetch.mjs. Every response header of every ' +
        'source is here, including X-Landfall-Cache, which nothing inside a ' +
        'session can show you.',
      geometryNote:
        'Sources under geometry/ are per-storm GDACS polygons, derived from ' +
        "this run's event list rather than from a fixed URL. They live in " +
        'latest/ ONLY and are not carried into history/ — a megabyte an hour ' +
        'across a 72-hour window buys nothing, because the question they ' +
        'answer is always about now. Do not go looking for them in a snapshot.',
      geometryStorms: geometryCount,
      /* IN THE MANIFEST AND NOT ITS OWN FILE, ON PURPOSE. manifest.json is the
       * one thing carried into `history/` every hour; a sibling file would
       * live in `latest/` only and answer nothing about a lag. */
      countryMatch,
      /* Derived phases that THREW, as opposed to deriving nothing. Empty is
       * the healthy state and is written every hour. A non-empty entry means
       * a whole family of sources is missing from `sources` below and their
       * absence is a fault, not a quiet hour. */
      derivedFailures,
      ok: okCount,
      unavailable: results.length - okCount,
      sources: results,
    },
    null,
    2
  ) + '\n'
);

console.log(`\n${okCount}/${results.length} sources ok — manifest.json written to ${OUT}`);
if (derivedFailures.length) {
  console.log(
    `!! ${derivedFailures.length} derived phase(s) FAILED: ` +
      derivedFailures.map((f) => f.phase).join(', ') +
      ' — see derivedFailures in manifest.json'
  );
}
