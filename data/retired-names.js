/**
 * retired-names.js — every name the WMO has permanently withdrawn, and the
 * storm that earned it. §57.17's shelf rule.
 *
 * ===> HAND-MAINTAINED, ON PURPOSE, AND §57.17 IS EXPLICIT ABOUT WHY. <===
 * NOAA publishes this as a WEB PAGE, not a data file. **Do not build a scraper
 * for it.** A page NOAA restyles once would silently empty the shelf, and an
 * empty shelf looks exactly like a working shelf for a basin that happens to
 * have no retirements. One or two names get added each spring at the WMO
 * Hurricane Committee's meeting; this file is a five-minute edit once a year.
 *
 * ===> WHERE IT CAME FROM, AND HOW IT WAS CHECKED. <===
 * Transcribed 2026-08-26 from NOAA AOML's own TCFAQ B3 table, which is
 * authoritative and structured — and **last revised 20 June 2019**, so it
 * stops before Dorian. The 2019-2025 tail was filled from Wikipedia's
 * cumulative list and, for the East Pacific, from the WMO's own press release.
 *
 * IT IS NOT TRUSTED BECAUSE TWO PAGES AGREED. It is trusted because the
 * DECADE COUNTS reconcile independently. Wikipedia states, in prose, how many
 * Atlantic names each decade lost. Counting this file's Atlantic entries by
 * decade gives the same figure every time:
 *
 *   1954-59  8  |  1960s 11  |  1970s  9  |  1980s  7
 *   1990s   15  |  2000s 24  |  2010s 16  |  2020s 10   = 100
 *
 * A transcription slip would break one of those eight sums. All eight hold,
 * and the total matches the "100 retired names as of 2026" both sources state.
 * That is a checksum, not a vibe.
 *
 * ===> THREE THINGS IN HERE ARE GENUINELY UNCERTAIN. SAY SO RATHER THAN PICK.
 * <=== Each is marked `unsure` below and each must stay marked until somebody
 * checks it against a primary source:
 *
 *  1. CAROL AND EDNA HAVE TWO YEARS EACH AND THE WRONG ONE MARKS THE WRONG
 *     STORM. Both were destructive in 1954, retired for ten years, REINTRODUCED
 *     (Carol in 1965, Edna in 1968), then permanently retired in 1969. NOAA's
 *     table lists the reintroduction years. The storms worth remembering are
 *     the 1954 ones; there were also real, unremarkable Carol-1965 and
 *     Edna-1968 storms in the record. Marking the shelf by NOAA's years would
 *     put the badge on the forgettable storm and miss the famous one.
 *  2. KNUT IS 1987 OR 1988 DEPENDING ON WHO YOU ASK. NOAA's table says 1988;
 *     The Weather Channel says 1987. Unresolved.
 *  3. JOHN 2024 (East Pacific) rests on a single low-quality source. Otis and
 *     Dora 2023 come from the WMO's own announcement and are solid.
 *
 * ==> AND ONE UNCERTAINTY WAS KILLED OUTRIGHT BY THE DATA, WHICH IS THE WHOLE
 * ARGUMENT FOR CHECKING THE JOIN. <== NOAA's table dates Knut to 1988; The
 * Weather Channel says 1987. HURDAT2 settles it: there are storms named KNUT
 * in 1981 and 1987 and **none in 1988**. The primary record beats both web
 * pages, and it only came up because every entry was made to prove it points
 * at a real storm.
 *
 * ===> AND THE LIST IS NOT THE SHELF ON ITS OWN. <=== §57.17: the famous
 * unnamed storms — Galveston 1900, the Labor Day hurricane of 1935 — cannot be
 * retired, because they were never named. The alias list and this file
 * TOGETHER are the shelf. A shelf built on retirement alone silently drops the
 * two most important storms in the archive.
 *
 * Entries are `[name, year]`. Name is upper-case to match HURDAT2's field
 * exactly, so the join needs no normalisation.
 */

/** Retired from the Atlantic list. 100 names, 1954-2025. */
export const RETIRED_ATLANTIC = Object.freeze([
  ['AUDREY', 1957], ['AGNES', 1972], ['ANITA', 1977], ['ALLEN', 1980],
  ['ALICIA', 1983], ['ANDREW', 1992], ['ALLISON', 2001],
  ['BETSY', 1965], ['BEULAH', 1967], ['BOB', 1991],
  ['CONNIE', 1955], ['CARLA', 1961], ['CLEO', 1964], ['CAROL', 1954],
  ['CAMILLE', 1969], ['CELIA', 1970], ['CARMEN', 1974], ['CESAR', 1996],
  ['CHARLEY', 2004],
  ['DIANE', 1955], ['DONNA', 1960], ['DORA', 1964], ['DAVID', 1979],
  ['DIANA', 1990], ['DENNIS', 2005], ['DEAN', 2007], ['DORIAN', 2019],
  ['EDNA', 1954], ['ELOISE', 1975], ['ELENA', 1985], ['ERIKA', 2015],
  ['ETA', 2020],
  ['FLORA', 1963], ['FIFI', 1974], ['FREDERIC', 1979], ['FRAN', 1996],
  ['FLOYD', 1999], ['FABIAN', 2003], ['FRANCES', 2004], ['FELIX', 2007],
  ['FLORENCE', 2018], ['FIONA', 2022],
  ['GRETA', 1978], ['GLORIA', 1985], ['GILBERT', 1988], ['GEORGES', 1998],
  ['GUSTAV', 2008],
  ['HAZEL', 1954], ['HATTIE', 1961], ['HILDA', 1964], ['HUGO', 1989],
  ['HORTENSE', 1996], ['HARVEY', 2017], ['HELENE', 2024],
  ['IONE', 1955], ['INEZ', 1966], ['IRIS', 2001], ['ISIDORE', 2002],
  ['ISABEL', 2003], ['IVAN', 2004], ['IKE', 2008], ['IGOR', 2010],
  ['IRENE', 2011], ['INGRID', 2013], ['IRMA', 2017], ['IDA', 2021],
  ['IAN', 2022], ['IOTA', 2020],
  ['JANET', 1955], ['JOAN', 1988], ['JUAN', 2003], ['JEANNE', 2004],
  ['JOAQUIN', 2015],
  ['KLAUS', 1990], ['KEITH', 2000], ['KATRINA', 2005],
  ['LUIS', 1995], ['LENNY', 1999], ['LILI', 2002], ['LAURA', 2020],
  ['MARILYN', 1995], ['MITCH', 1998], ['MICHELLE', 2001], ['MATTHEW', 2016],
  ['MARIA', 2017], ['MICHAEL', 2018], ['MILTON', 2024], ['MELISSA', 2025],
  ['NOEL', 2007], ['NATE', 2017],
  ['OPAL', 1995], ['OTTO', 2016],
  ['PALOMA', 2008],
  ['ROXANNE', 1995], ['RITA', 2005],
  ['STAN', 2005], ['SANDY', 2012],
  ['TOMAS', 2010],
  ['WILMA', 2005],
  ['BERYL', 2024],
]);

/** Retired from the East Pacific list. Far shorter, and §57.12's rule explains
 *  it rather than excusing it: most East Pacific storms head out to sea and
 *  never trouble anybody, so there is nothing to retire. A thin list here is a
 *  fact about the ocean, not a gap in the data. */
export const RETIRED_EPACIFIC = Object.freeze([
  ['ADELE', 1970], ['ADOLPH', 2001], ['ALMA', 2008],
  ['DORA', 2023],
  ['FICO', 1978], ['FEFA', 1991],
  ['HAZEL', 1965],
  ['IVA', 1988], ['ISMAEL', 1995],
  ['JOHN', 2024],
  ['KNUT', 1987], ['KENNA', 2002],
  ['MANUEL', 2013],
  ['ODILE', 2014], ['OTIS', 2023],
  ['PAULINE', 1997], ['PATRICIA', 2015],
]);

/** Retired from the Central Pacific list. These storms DO live in the East
 *  Pacific HURDAT2 file — it carries both EP and CP — so they join normally. */
export const RETIRED_CPACIFIC = Object.freeze([
  ['IWA', 1982], ['INIKI', 1992], ['IOKE', 2006], ['PAKA', 1997],
]);

/** ==> ENTRIES THAT CANNOT BE TRUSTED YET. <== Keyed `NAME|year`. A storm on
 *  this list still gets its badge, but anything that REPORTS on the shelf —
 *  a count, a "years that cost a name" filter — has to be able to say how many
 *  of its answers are standing on one of these. Silent confidence is the bug
 *  §5 exists to prevent. */
export const RETIRED_UNSURE = Object.freeze({
  'CAROL|1954': 'Destructive in 1954, retired 10 years, reintroduced 1965, permanently retired 1969. NOAA lists 1965. A real, unremarkable Carol also exists in 1965.',
  'EDNA|1954': 'Same story as Carol, reintroduced 1968. NOAA lists 1968. A real, unremarkable Edna also exists in 1968.',
  'JOHN|2024': 'Single low-quality source. Otis and Dora 2023 are from the WMO directly and are solid.',
});

/** ==> RETIRED WITHOUT A STORM TO HANG THE BADGE ON. <== These names were
 *  withdrawn without a matching entry in the best-track record, so there is
 *  nothing in the archive to mark. They are deliberately ABSENT from the lists
 *  above rather than entered with a year that would never join — an entry that
 *  silently matches nothing is indistinguishable from a typo.
 *
 *  ISIS was pulled from the East Pacific list in 2016 for political
 *  sensitivity while slated for use; its last actual storm was 2004.
 *
 *  ISRAEL was pulled at the same 2001 meeting as ADOLPH, for the same
 *  sensitivity reasons. **`tools/test-retired-names.mjs` finds no storm named
 *  ISRAEL anywhere in the East Pacific record**, which is consistent with the
 *  name being retired before the season ever reached it — ADOLPH joins fine,
 *  ISRAEL was next on the list and appears never to have been used. That is an
 *  inference from the join, NOT a confirmed fact, and it stays labelled as one
 *  until somebody reads a primary source. */
export const RETIRED_NEVER_USED = Object.freeze(['ISIS', 'ISRAEL']);
