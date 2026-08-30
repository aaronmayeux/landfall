/**
 * retired-names.js — GENERATED. DO NOT EDIT BY HAND.
 *
 * Every name the WMO has withdrawn, and the storm that earned it. Written by
 * `tools/seasons-retired.mjs`; read that file for the method and the gates.
 *
 * ==> IT IS DERIVED, NOT TRANSCRIBED, AND NOTHING FETCHES A LIST OF RETIRED
 * NAMES. <== Retirement is defined as removal from the active lists, so this
 * is every name the best-track record shows was used minus every name still in
 * service. Both halves already refresh themselves monthly. §57.51.
 *
 * ==> THE FAILURE DIRECTION IS THE LOUD ONE, WHICH IS WHY §57.17'S OBJECTION
 * TO A SCRAPER DOES NOT APPLY. <== A page restyle here makes every name look
 * retired — a flood, caught by the gates, refused, and the last good file left
 * exactly where it is. §57.17 refused the opposite: a silently emptied list
 * that still renders.
 *
 * ==> WHAT COULD NOT BE DERIVED IS NEXT DOOR IN `retired-names-historic.js`
 * AND THIS FILE ONLY RE-EXPORTS IT. <== That file is hand-written and frozen
 * and this job never touches it. The provenance stays readable: an entry in
 * `RETIRED_DERIVED` was computed this month; an entry that is only in
 * `RETIRED_HISTORIC` was written by a person once and cannot change.
 *
 * Derived this run: 72 Atlantic, 12 east Pacific, 2 central Pacific.
 *
 * Entries are `[name, year]`, upper case, so the join to HURDAT2 needs no
 * normalisation.
 *
 * Generated 2026-08-30T01:45:16.704Z.
 */

import {
  HISTORIC_ATLANTIC, HISTORIC_EPACIFIC, HISTORIC_CPACIFIC,
  RETIRED_BY_DESCRIPTION,
} from './retired-names-historic.js';

export {
  RETIRED_BY_DESCRIPTION,
  RETIRED_UNSURE,
  RETIRED_NEVER_USED,
} from './retired-names-historic.js';

/** Atlantic, computed from the record and the lists in service. */
export const DERIVED_ATLANTIC = Object.freeze([
  ['ALICIA', 1983], ['ALLEN', 1980], ['ALLISON', 2001],
  ['ANDREW', 1992], ['BERYL', 2024], ['BOB', 1991], ['CESAR', 1996],
  ['CHARLEY', 2004], ['DAVID', 1979], ['DEAN', 2007], ['DENNIS', 2005],
  ['DIANA', 1990], ['DORIAN', 2019], ['ELENA', 1985], ['ERIKA', 2015],
  ['FABIAN', 2003], ['FELIX', 2007], ['FIONA', 2022],
  ['FLORENCE', 2018], ['FLOYD', 1999], ['FRAN', 1996],
  ['FRANCES', 2004], ['FREDERIC', 1979], ['GEORGES', 1998],
  ['GILBERT', 1988], ['GLORIA', 1985], ['GUSTAV', 2008],
  ['HARVEY', 2017], ['HELENE', 2024], ['HORTENSE', 1996],
  ['HUGO', 1989], ['IAN', 2022], ['IDA', 2021], ['IGOR', 2010],
  ['IKE', 2008], ['INGRID', 2013], ['IRENE', 2011], ['IRIS', 2001],
  ['IRMA', 2017], ['ISABEL', 2003], ['ISIDORE', 2002], ['IVAN', 2004],
  ['JEANNE', 2004], ['JOAN', 1988], ['JOAQUIN', 2015], ['JUAN', 2003],
  ['KATRINA', 2005], ['KEITH', 2000], ['KLAUS', 1990], ['LAURA', 2020],
  ['LENNY', 1999], ['LILI', 2002], ['LUIS', 1995], ['MARIA', 2017],
  ['MARILYN', 1995], ['MATTHEW', 2016], ['MELISSA', 2025],
  ['MICHAEL', 2018], ['MICHELLE', 2001], ['MILTON', 2024],
  ['MITCH', 1998], ['NATE', 2017], ['NOEL', 2007], ['OPAL', 1995],
  ['OTTO', 2016], ['PALOMA', 2008], ['RITA', 2005], ['ROXANNE', 1995],
  ['SANDY', 2012], ['STAN', 2005], ['TOMAS', 2010], ['WILMA', 2005]
]);

/** East Pacific, computed. */
export const DERIVED_EPACIFIC = Object.freeze([
  ['ADOLPH', 2001], ['ALMA', 2008], ['DORA', 2023], ['ISIS', 2004],
  ['ISMAEL', 1995], ['JOHN', 2024], ['KENNA', 2002], ['MANUEL', 2013],
  ['ODILE', 2014], ['OTIS', 2023], ['PATRICIA', 2015],
  ['PAULINE', 1997]
]);

/** Central Pacific, computed. Storms whose id carries the CP prefix. */
export const DERIVED_CPACIFIC = Object.freeze([
  ['IOKE', 2006], ['PAKA', 1997]
]);

/** Which entries were computed and which were written by hand, kept apart on
 *  purpose — the two are different kinds of claim. */
export const RETIRED_DERIVED = Object.freeze({
  atlantic: DERIVED_ATLANTIC,
  epacific: DERIVED_EPACIFIC,
  cpacific: DERIVED_CPACIFIC,
});
export const RETIRED_HISTORIC = Object.freeze({
  atlantic: HISTORIC_ATLANTIC,
  epacific: HISTORIC_EPACIFIC,
  cpacific: HISTORIC_CPACIFIC,
});

/* The two together, which is what a reader of this file almost always wants.
 * ==> THE GREEK PAIR IS DELIBERATELY NOT IN HERE. <== Eta and Iota were
 * retired by DESCRIPTION rather than by name and any copy about them has to
 * read differently; folding them in would let a caller print "the name Eta was
 * retired and will never be used again", which is false twice over. They are
 * exported above under their own name so a caller has to opt in. */
export const RETIRED_ATLANTIC = Object.freeze([...HISTORIC_ATLANTIC, ...DERIVED_ATLANTIC]);
export const RETIRED_EPACIFIC = Object.freeze([...HISTORIC_EPACIFIC, ...DERIVED_EPACIFIC]);
export const RETIRED_CPACIFIC = Object.freeze([...HISTORIC_CPACIFIC, ...DERIVED_CPACIFIC]);
