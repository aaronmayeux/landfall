/**
 * plate-names.js — the fifty-two PB2002 plate codes, spelled out.
 *
 * `assets/hazards/plate-boundaries.geojson` names every boundary by the pair of
 * plates it separates, and it names them in the model's own shorthand: two
 * letters each, `PlateA` and `PlateB`. "PA-OK" is the Japan Trench. Nobody
 * reads that, so this is the only place in the app that turns the shorthand
 * into English.
 *
 * ---------------------------------------------------------------------------
 * WHERE THESE COME FROM, AND WHY IT IS NOT MY RECOLLECTION.
 *
 * PB2002 is Bird (2003), "An updated digital model of plate boundaries". The
 * fifty-two names below were read off the author's own publication page for
 * that paper (peterbird.name/publications/2003_PB2002) — fourteen large plates
 * and thirty-eight small ones — and every code in that list appears in our
 * GeoJSON, and every code in our GeoJSON appears in that list. Both directions
 * checked; the sets are identical. A name typed from memory would be wrong in
 * exactly the places nobody would notice, which on a map is worse than a code.
 *
 * ---------------------------------------------------------------------------
 * PLATE A IS ON THE LEFT. THIS IS MEASURED, NOT ASSUMED.
 *
 * `lib/plate-lines.js` puts each plate's name on its own side of the seam, so
 * it has to know which side each one is. PB2002 orders every boundary so that
 * `PlateA` lies to the LEFT of the direction the line is drawn, and `PlateB` to
 * the right. That was confirmed against five boundaries whose geography is not
 * in doubt before a line of label code was written:
 *
 *   San Andreas (NA-PA)     — runs southeast; North America to the northeast  OK
 *   Japan Trench (PA-OK)    — Pacific to the east                             OK
 *   Peru-Chile (NZ-SA)      — Nazca to the west                               OK
 *   Mid-Atlantic 50N (NA-EU)— North America to the west                       OK
 *   Mid-Atlantic Iceland    — published as EU-NA, and Eurasia IS to the east   OK
 *   Himalaya (EU-IN)        — Eurasia to the north                            OK
 *
 * The Iceland case is the one that matters, because it is the same ridge with
 * the pair written the other way round and the sides genuinely swap with it.
 * That rules out "PlateA is always the western one" and leaves only the
 * left-of-travel rule standing.
 *
 * IF THE BOUNDARY FILE IS EVER REPLACED, RE-CHECK THAT RULE FIRST. It is a
 * property of PB2002's authoring, not of GeoJSON, and a different source can
 * order its vertices however it likes. Getting it backwards labels the Pacific
 * plate over California, which reads as a data error rather than a style one.
 *
 * ---------------------------------------------------------------------------
 * IMPORTS NOTHING. Pure data plus one lookup. No DOM, ever.
 */

/**
 * Code to name. Grouped the way Bird groups them, because the split is not
 * arbitrary — the fourteen large plates are the ones with names a reader
 * already knows, and they are also the ones whose labels appear first on the
 * globe (`lib/plate-lines.js` ranks by boundary length, which lands on very
 * nearly the same fourteen).
 */
export const PLATE_NAMES = Object.freeze({
  /* --- the fourteen large plates ------------------------------------------ */
  AF: 'Africa',
  AN: 'Antarctica',
  AR: 'Arabia',
  AU: 'Australia',
  CA: 'Caribbean',
  CO: 'Cocos',
  EU: 'Eurasia',
  IN: 'India',
  JF: 'Juan de Fuca',
  NA: 'North America',
  NZ: 'Nazca',
  PA: 'Pacific',
  PS: 'Philippine Sea',
  SA: 'South America',

  /* --- the thirty-eight small plates -------------------------------------- */
  AM: 'Amur',
  AP: 'Altiplano',
  AS: 'Aegean Sea',
  AT: 'Anatolia',
  BH: 'Birds Head',
  BR: 'Balmoral Reef',
  BS: 'Banda Sea',
  BU: 'Burma',
  CL: 'Caroline',
  CR: 'Conway Reef',
  EA: 'Easter',
  FT: 'Futuna',
  GP: 'Galapagos',
  JZ: 'Juan Fernandez',
  KE: 'Kermadec',
  MA: 'Mariana',
  MN: 'Manus',
  MO: 'Maoke',
  MS: 'Molucca Sea',
  NB: 'North Bismarck',
  ND: 'North Andes',
  NH: 'New Hebrides',
  NI: "Niuafo'ou",
  OK: 'Okhotsk',
  ON: 'Okinawa',
  PM: 'Panama',
  RI: 'Rivera',
  SB: 'South Bismarck',
  SC: 'Scotia',
  SL: 'Shetland',
  SO: 'Somalia',
  SS: 'Solomon Sea',
  SU: 'Sunda',
  SW: 'Sandwich',
  TI: 'Timor',
  TO: 'Tonga',
  WL: 'Woodlark',
  YA: 'Yangtze',
});

/**
 * A plate's name, or its raw code if the model ever grows one we do not know.
 *
 * ==> FALLING BACK TO THE CODE IS DELIBERATE, AND IT IS THE §5 ANSWER. <== An
 * unknown code draws "XX" on the map, which is visibly a thing we failed to
 * translate. Returning an empty string would draw nothing and look exactly like
 * a boundary that has no second plate — a silent hole where a name should be.
 */
export function plateName(code) {
  if (typeof code !== 'string' || !code) return '';
  return PLATE_NAMES[code] || code;
}
