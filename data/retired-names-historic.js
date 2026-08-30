/**
 * retired-names-historic.js — the retirements no subtraction can find, and the
 * two that were never retirements of a NAME at all.
 *
 * ==> HAND-WRITTEN, FROZEN, AND DELIBERATELY IN ITS OWN FILE. <== §57.51.
 * `data/retired-names.js` next door is GENERATED on a schedule. Everything in
 * here is the part that job cannot derive, and it lives outside the generated
 * file so that the job is physically incapable of damaging it. A generator
 * that has to preserve a hand-written block inside its own output is one bug
 * away from deleting 34 storms nobody would notice were gone.
 *
 * ==> NOTHING IN HERE CAN EVER GAIN A MEMBER, WHICH IS WHY FREEZING IT IS
 * HONEST RATHER THAN LAZY. <== Every entry is closed history:
 *
 *  - The pre-floor retirements are 1954-1994. Those seasons are settled; no
 *    committee will retire another name from them.
 *  - The Greek block cannot grow, because the alphabet was abolished in 2021
 *    and no storm will ever carry a Greek name again.
 *
 * So Aaron maintains nothing here. That is the requirement (2026-08-30), and
 * it is met by the shape rather than by a promise.
 *
 * ==> WHY THE FLOORS ARE WHERE THEY ARE — MEASURED, NOT CHOSEN. <== The
 * derivation is "every name the record shows was used, minus every name still
 * in service". Below each basin's floor that subtraction stops meaning
 * retirement:
 *
 *  - ATLANTIC, 1979. Before then names were often simply DROPPED rather than
 *    formally retired, and the whole all-female list was replaced when men's
 *    names were added. Measured on the real files 2026-08-30: a 1954 floor
 *    yields 184 candidates against a true figure near 100. A 1979 floor
 *    yields 81, and every one of them is real.
 *  - EAST PACIFIC and CENTRAL PACIFIC, 1995. Both basins reorganised their
 *    lists in the eighties and early nineties, and the record also carries
 *    spelling drift (DALILIA for DALILA, DELORES for DOLORES). Measured: a
 *    1979 floor puts 7 names in each basin that were dropped or misspelt
 *    rather than retired; a 1995 floor puts none in either.
 *
 * Entries are `[name, year]`, upper case, so the join to HURDAT2 needs no
 * normalisation. `tools/test-retired-names.mjs` proves every one points at a
 * real storm.
 */

/**
 * Atlantic retirements from 1954 through 1978. 26 names.
 *
 * Transcribed 2026-08-26 from NOAA AOML's TCFAQ B3 table and reconciled
 * against the decade counts both NOAA and the WMO publish in prose. That
 * reconciliation is the checksum: a transcription slip breaks exactly one
 * decade sum, and `tools/test-retired-names.mjs` asserts all eight.
 */
export const HISTORIC_ATLANTIC = Object.freeze([
  ['AUDREY', 1957], ['AGNES', 1972], ['ANITA', 1977],
  ['BETSY', 1965], ['BEULAH', 1967],
  ['CONNIE', 1955], ['CARLA', 1961], ['CLEO', 1964], ['CAROL', 1954],
  ['CAMILLE', 1969], ['CELIA', 1970], ['CARMEN', 1974],
  ['DIANE', 1955], ['DONNA', 1960], ['DORA', 1964],
  ['EDNA', 1954], ['ELOISE', 1975],
  ['FLORA', 1963], ['FIFI', 1974],
  ['GRETA', 1978],
  ['HAZEL', 1954], ['HATTIE', 1961], ['HILDA', 1964],
  ['IONE', 1955], ['INEZ', 1966],
  ['JANET', 1955],
]);

/** East Pacific retirements before 1995. 6 names. */
export const HISTORIC_EPACIFIC = Object.freeze([
  ['ADELE', 1970], ['FICO', 1978], ['FEFA', 1991],
  ['HAZEL', 1965], ['IVA', 1988], ['KNUT', 1987],
]);

/** Central Pacific retirements before 1995. 2 names. */
export const HISTORIC_CPACIFIC = Object.freeze([
  ['IWA', 1982], ['INIKI', 1992],
]);

/**
 * ==> RETIRED BY DESCRIPTION, NOT BY NAME. THIS IS THE ONE ENTRY THAT MUST
 * NOT BE READ LIKE THE OTHERS. <==
 *
 * The 2020 season spent its 21 names and ran on into nine letters of the Greek
 * alphabet. Every one of those nine falls out of the subtraction as "retired",
 * because the 2021 WMO session ENDED the use of the Greek alphabet and
 * replaced it with a supplemental list. The system was abolished; the letters
 * were not each withdrawn.
 *
 * ==> TWO OF THE NINE WERE ACTUALLY RETIRED, AND THAT IS FROM THE SOURCE
 * RATHER THAN FROM MEMORY. <== The WMO's own announcement of 17 March 2021
 * records the Hurricane Committee retiring Dorian (2019) and Laura, Eta and
 * Iota (2020), and says plainly that impacts from Eta and Iota were severe
 * enough that those names were formally retired while there had been no
 * formal plan for retiring Greek names at all. So: Eta and Iota, and nothing
 * else. Alpha, Beta, Gamma, Delta, Epsilon, Zeta and Theta of 2020 were NOT
 * retired, and neither were the six Greek names 2005 spent.
 *
 * ==> AND THE WORDING HAS TO DIFFER. <== The same committee agreed it was not
 * practical to retire a letter of the Greek alphabet into hurricane history,
 * so where a Greek-designated storm is retired the YEAR OF OCCURRENCE and
 * other details are recorded instead. "The name Eta was retired and will never
 * be used again" is false twice over: the letter was not withdrawn as a name,
 * and the retirement is attached to the storm and its year. Anything reading
 * this list for on-screen copy must say so differently.
 *
 * This block cannot grow. There will be no tenth Greek storm.
 */
export const RETIRED_BY_DESCRIPTION = Object.freeze([
  ['ETA', 2020, 'atlantic'], ['IOTA', 2020, 'atlantic'],
]);

/**
 * ==> THE SEVEN THAT MUST GET NOTHING. <== Excluded from the derived answer
 * explicitly rather than by accident. Without this list each of them earns a
 * confidently wrong sentence that reads perfectly.
 *
 * The 2005 Greek names are in here too. 2005 spent Alpha through Zeta and none
 * of the six was retired — Katrina, Rita, Wilma, Dennis and Stan were.
 */
export const GREEK_NEVER_RETIRED = Object.freeze([
  'ALPHA', 'BETA', 'GAMMA', 'DELTA', 'EPSILON', 'ZETA', 'THETA',
]);

/**
 * ==> THINGS IN HERE ARE GENUINELY UNCERTAIN. SAY SO RATHER THAN PICK. <==
 * Each must stay marked until somebody checks it against a primary source.
 * Keyed `NAME|YEAR` to match the entry it qualifies.
 */
export const RETIRED_UNSURE = Object.freeze({
  'CAROL|1954': 'Destructive in 1954, retired 10 years, reintroduced 1965, permanently retired 1969. NOAA lists 1965. A real, unremarkable Carol also exists in 1965.',
  'EDNA|1954': 'Same story as Carol, reintroduced 1968. NOAA lists 1968. A real, unremarkable Edna also exists in 1968.',
  'JOHN|2024': 'Single low-quality source. Otis and Dora 2023 are from the WMO directly and are solid.',
});

/**
 * ==> RETIRED WITHOUT A STORM TO HANG THE BADGE ON. <== Withdrawn without a
 * matching entry in the best-track record, so there is nothing in the archive
 * to mark. Deliberately ABSENT from every list above rather than entered with
 * a year that would never join — an entry that silently matches nothing is
 * indistinguishable from a typo.
 *
 * ISRAEL was pulled at the 2001 meeting alongside ADOLPH, for the same
 * sensitivity reasons. ADOLPH joins a real storm; ISRAEL appears nowhere in
 * the east Pacific record, which is consistent with the name being withdrawn
 * before a season ever reached it. **That is an inference from the join, not a
 * confirmed fact**, and it stays labelled as one.
 *
 * ==> ISIS USED TO BE IN HERE AND IT WAS WRONG. <== It was filed as never used
 * while this file's own note said its last storm was 2004. The record agrees
 * with the note: there is a storm. The derivation found the contradiction on
 * its first run (2026-08-30) and ISIS is now a derived east Pacific
 * retirement. Worth remembering as the argument for deriving rather than
 * transcribing — a hand list can disagree with itself and stay green.
 */
export const RETIRED_NEVER_USED = Object.freeze(['ISRAEL']);
