/**
 * cpacific-lists.mjs — GENERATED. DO NOT EDIT BY HAND.
 *
 * The four Central Pacific name lists currently in service, written by
 * `tools/seasons-names.mjs` from NHC's own names page:
 *   https://www.nhc.noaa.gov/aboutnames.shtml
 *
 * ==> THIS IS NOT A ROSTER AND MUST NEVER BECOME ONE. <== §57.12. CPHC runs
 * these four lists one after another across season boundaries — when the
 * bottom of one is reached the next name is the top of the next — so "the
 * names for 2026" is a question with no answer in this basin. What IS well
 * defined, and all this file claims, is the flat set of names in service.
 *
 * ==> IT LIVES IN tools/ BECAUSE NOTHING THE APP DRAWS READS IT. <== §12: an
 * import in `lib/` is bytes on every phone. `tools/seasons-retired.mjs` is the
 * only reader — a name still in service somewhere cannot be a retired name,
 * and without this set every Central Pacific name that ever crossed into the
 * east Pacific best-track record falls out of that subtraction looking
 * retired. Measured: Ela, Ulika, Lana and Akoni all do.
 *
 * ==> REPLACED WHOLE ON EVERY RUN, NEVER MERGED. <== A withdrawn name has to
 * be able to LEAVE this file, or the job that reads it can never see a
 * Central Pacific retirement happen.
 *
 * Generated 2026-08-30T01:39:44.884Z.
 */

export const CPACIFIC_LISTS = Object.freeze([
  /* List 1 */
  [
    'AKONI', 'EMA', 'HONE', 'IONA', 'KELI', 'LALA', 'MOKE', 'NOLO',
    'OLANA', 'PENA', 'ULANA', 'WALE'
  ],
  /* List 2 */
  [
    'AKA', 'EKEKA', 'HENE', 'IOLANA', 'KEONI', 'LINO', 'MELE', 'NONA',
    'OLIWA', 'PAMA', 'UPANA', 'WENE'
  ],
  /* List 3 */
  [
    'ALIKA', 'ELE', 'HUKO', 'IOPA', 'KIKA', 'LANA', 'MAKA', 'NEKI',
    'OMEKA', 'PEWA', 'UNALA', 'WALI'
  ],
  /* List 4 */
  [
    'ANA', 'ELA', 'HALOLA', 'IUNE', 'KILO', 'LOKE', 'MALIA', 'NIALA',
    'OHO', 'PALI', 'ULIKA', 'WALAKA'
  ],
].map(Object.freeze));

/** Every Central Pacific name in service, flattened. */
export const CPACIFIC_IN_SERVICE = Object.freeze(CPACIFIC_LISTS.flat());
