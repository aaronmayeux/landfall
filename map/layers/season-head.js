/**
 * season-head.js — the season clock's moving head. §57.23, §57.67 slice E.
 *
 * ==> ONE MARK PER RUNNING STORM, STANDING ON THE END OF ITS OWN TRAIL. <==
 * Aaron's call 4, 2026-08-31: the head is the app's own spiral — the same mark
 * the home-screen icons are cut from and the same one the 3D globe stamps —
 * Saffir-Simpson coloured at the moment the clock is showing, turning the way a
 * cyclone in that hemisphere turns.
 *
 * ==> IT IS A SEPARATE SOURCE FROM THE TRAIL, WHICH IS §57.67b's OWN
 * INSTRUCTION. <== Moving a head must never rewrite a season. The trail is up
 * to eleven thousand vertices for a fully ticked 2005; the head is one point per
 * running storm, which for most of a playthrough is one or two. They are pushed
 * together today because the trail grows on the same step the head moves — but
 * the moment anything wants to move a head without regrowing a trail, the two
 * sources are already apart and nothing has to be untangled first.
 *
 * ==> IT STANDS ON THE TRAIL'S LAST VERTEX AND NOT ON THE CLOCK'S OWN POSITION.
 * <== §57.67e measured this and left the instruction for this slice.
 * `lib/season-clock.js` answers a lon/lat interpolated in a straight line
 * between the two fixes either side of the moment, and the drawn curve BENDS
 * between those fixes — so the two points agree at every recorded fix and part
 * company in between, worst on a recurve, where the head would visibly float off
 * its own track. `setSeasonTracks` hands its tips forward for exactly this.
 * The clock's lon/lat is the fallback and only for a storm with no drawn trail
 * at all (a one-record storm, or one a single step past its first fix), where
 * being on the record's own position is the only answer there is.
 *
 * ==> AND IT ONLY DRAWS FROM `SEASONS.clockHeadMinZoom` UP, WHICH IS THE ONE
 * THING IN HERE THAT WOULD BE A BUG IF IT WERE DELETED. <== `SPEC-MAP.md` §9.13:
 * ONE engine draws the spiral and it is the 3D mesh. MapLibre's copy was deleted
 * on 2026-07-24 because the two overlapped for 1.6 zoom levels and drew one mark
 * twice at slightly different projected positions — a smear that was structural
 * rather than tunable. Below that zoom the mesh is still stamping every archive
 * storm's mark on its BIRTHPLACE (`map/season-mesh.js`), so a head down there
 * would be two spirals per storm meaning two different things. The floor is the
 * exact zoom the mesh's sprite reaches zero opacity at, derived from the dive
 * band rather than typed.
 *
 * **The cost of that, stated rather than hidden and accepted by Aaron on
 * 2026-08-31:** out at the space floor a playing season has no head. The tracks
 * still grow; the cage still shows every ticked storm's mountains and birthplace
 * mark whole, which is the gap `NOW.md` already carries against
 * `buildSeasonMeshPoints`.
 *
 * ==> THE MARK IS A PRE-COLOURED IMAGE PER CATEGORY, NOT A TINTED ONE. <==
 * MapLibre can only tint an SDF icon, and an SDF is a single channel — it would
 * throw away the baked halo that `map/glyph.js` spends a paragraph explaining is
 * the only thing holding the mark off the sea at the paler end of §6's fixed
 * palette. So there is one image per colour per hemisphere, built on demand and
 * kept, and the halo survives.
 *
 * ==> NOTHING HERE IS A TAP TARGET, AND THAT IS NOT AN OMISSION. <== The head
 * stands on the trail, and `seasonStormAtPoint` queries the trail's own line
 * layer inside a 44 px box. A finger aimed at the head lands on the track under
 * it and selects that storm, so the head is already tappable without a second
 * hit path that could disagree with the first.
 *
 * Imports config/, one lib/, and two map/ siblings. One direction, no cycle —
 * nothing in the archive imports this but `main.js`.
 */

import { SEASONS } from '../../config/constants.js';
import { SIZE } from '../../config/tokens.js';
import { categoryColor } from '../../lib/category.js';
import { spiralCanvas } from '../glyph.js';
import { cutStateFor } from './season-cut.js';
import { focusOpacity } from './season-focus.js';

const SOURCE = 'season-head';
const LAYER = 'season-head';
const EMPTY = { type: 'FeatureCollection', features: [] };

/** The storm the reader has opened, or null. Held for the same reason
 *  `season-tracks.js` holds it: `ensure` can run again after a style install,
 *  and a layer added fresh would come back at full strength with a storm still
 *  focused. */
let focusId = null;

/** The image name for one colour and one hemisphere. The colour goes in the
 *  name because the image IS the colour — see the header on why these are not
 *  tinted at draw time. */
const imageName = (color, spin) => `season-head-${spin < 0 ? 's' : 'n'}-${color}`;

/**
 * Put one coloured mark in the map's sprite atlas, if it is not there already.
 *
 * ==> NO DOM MEANS NO HEAD, AND THAT IS A DEGRADE RATHER THAN A FAILURE. <==
 * The headless suites drive these layers with a stub map and no `document` at
 * all, and `map/layers/genesis.js` records what happens when a canvas builder
 * throws in that world: it took the whole layer engine down, every storm layer
 * and not just its own. Answering false here costs the mark and nothing else —
 * the trail still grows, the dots still draw, the scrubber still says what time
 * it is.
 *
 * @returns {boolean} whether the image is available to name in a feature
 */
function ensureHeadImage(map, color, spin) {
  const name = imageName(color, spin);
  /* ==> THE MAP'S OWN ATLAS IS THE ONLY RECORD OF WHAT HAS BEEN BUILT, AND A
   * SECOND ONE WAS WRITTEN HERE AND DELETED. <== The first version held a `Set`
   * of names beside this, checked before asking the map. Mutation found it: the
   * `Set` could not change any answer, because it was ANDed with this same
   * question. It could go WRONG, though — a style install takes MapLibre's
   * images with it and a module-level Set would still be saying yes, which is a
   * missing mark with nothing logged. One owner. */
  if (map?.hasImage?.(name)) return true;
  if (typeof document === 'undefined' || !document.createElement) return false;
  if (!map?.addImage) return false;

  let canvas = null;
  try {
    canvas = spiralCanvas(SEASONS.clockHeadTexturePx, color, spin < 0 ? -1 : 1);
  } catch (e) {
    console.warn('[landfall] the clock head could not be drawn:', e);
    return false;
  }
  const ctx = canvas?.getContext?.('2d');
  if (!ctx) return false;

  /* ==> THE PIXEL RATIO IS THE DOWNSCALE, AND IT IS THE SAME ONE THE 3D SPRITE
   * TAKES. <== The image is `clockHeadTexturePx` across and has to arrive at
   * `SIZE.stormDot3dPx` on screen, so MapLibre is told the image is that many
   * device pixels per CSS pixel and does the reduction itself. Naming the ratio
   * rather than an icon-size means the head and the mesh's own spiral are the
   * same size on glass, which is the point of using the same artwork. */
  map.addImage(name, ctx.getImageData(0, 0, canvas.width, canvas.height), {
    pixelRatio: SEASONS.clockHeadTexturePx / SIZE.stormDot3dPx,
  });
  return true;
}

/**
 * The mark for one storm at one moment, or null for a storm with no head.
 *
 * ==> ONLY A RUNNING STORM HAS ONE. <== §57.67c rule 2 and it is the rule that
 * makes the trail mean something: an ended storm keeps its whole track and loses
 * its head, because a mark standing on the final fix says the storm is still
 * there. An unborn one draws nothing at all, which is rule 1.
 *
 * @param {object} entry   the roster entry
 * @param {object|null} state  the clock's answer for this storm
 * @param {Array<number>|undefined} tip  the last coordinate of its drawn trail
 */
function headFeature(map, entry, state, tip) {
  const storm = entry?.storm;
  if (!storm?.id || state?.phase !== 'running') return null;

  const at = Array.isArray(tip) && Number.isFinite(tip[0]) && Number.isFinite(tip[1])
    ? tip
    : (Number.isFinite(state.lon) && Number.isFinite(state.lat) ? [state.lon, state.lat] : null);
  if (!at) return null;

  const spin = state.spin < 0 ? -1 : 1;
  const color = categoryColor(state.category ?? null, state.nature || 'tropical', null);
  if (!ensureHeadImage(map, color, spin)) return null;

  return {
    type: 'Feature',
    /* ==> THE LONGITUDE IS WRAPPED BACK INSIDE ±180 HERE, AND THIS IS THE ONE
     * PLACE IN THE ARCHIVE THAT IS RIGHT. <== The trail is drawn in `lonU`, the
     * continuous longitude, because a LINE through raw values travels the long
     * way round the planet at the seam. A POINT has no neighbours and nothing to
     * be continuous with — `season-points.js` argues this at length for the dots
     * — and a symbol at 214°E is a symbol MapLibre has to decide where to put.
     * Wrapping is the same answer the record itself gives. */
    geometry: { type: 'Point', coordinates: [wrapLon(at[0]), at[1]] },
    properties: {
      id: storm.id,
      icon: imageName(color, spin),
      /* Degrees clockwise, which is what `icon-rotate` means. The clock answers
       * it because the clock is the only thing that knows what time it is; the
       * sign and the period are both argued there. */
      rot: Number.isFinite(state.spinDeg) ? state.spinDeg : 0,
    },
  };
}

/** Longitude back inside ±180. `lonU` can run several turns out on a storm that
 *  crosses the seam, so this is a modulo rather than one subtraction — KEONI
 *  1993 runs 166°E to 144°W and one `-360` would be enough for her, which is
 *  exactly the kind of fix that holds until a storm goes round twice. */
function wrapLon(lon) {
  if (!Number.isFinite(lon)) return 0;
  /* ==> A LONGITUDE ALREADY ON THE MAP IS HANDED BACK UNTOUCHED, AND THAT IS
   * NOT AN OPTIMISATION. <== The arithmetic below adds 180, takes a modulo and
   * subtracts 180 again, and in `double` that round trip moves the value in its
   * last decimal place — so every head on the globe would sit a few nanometres
   * off the trail it is supposed to be standing on. Invisible on a phone and
   * loud in a suite that compares the two, which is how it was found. */
  if (lon >= -180 && lon <= 180) return lon;
  return ((((lon + 180) % 360) + 360) % 360) - 180;
}

/**
 * Attach the layer. Idempotent, like every other archive layer.
 *
 * @param {object} map
 * @param {string} [beforeId] draw beneath this layer
 */
export function ensureSeasonHead(map, beforeId) {
  if (!map || map.getSource(SOURCE)) return;

  map.addSource(SOURCE, { type: 'geojson', data: EMPTY });
  map.addLayer(
    {
      id: LAYER,
      type: 'symbol',
      source: SOURCE,
      /* See the header: below this the 3D mesh still owns the spiral. */
      minzoom: SEASONS.clockHeadMinZoom,
      layout: {
        'icon-image': ['get', 'icon'],
        'icon-rotate': ['get', 'rot'],
        /* ==> VIEWPORT, NOT MAP. <== `map` alignment would turn the mark with
         * the compass, so a two-finger twist would spin every head on the globe
         * and undo the one thing the rotation is saying. The spin belongs to the
         * storm, not to which way the reader is holding the planet. */
        'icon-rotation-alignment': 'viewport',
        /* ==> NEITHER OF THESE IS DECORATION. <== The live globe sets both on
         * its position glyph for the reason §9.13 gives: a name may be dropped
         * to collision, a storm may not. Two heads close together on a busy
         * season are information, and one of them silently vanishing is the §5
         * failure wearing a symbol. */
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
      },
      paint: {
        'icon-opacity': focusOpacity(focusId),
      },
    },
    beforeId
  );
}

/**
 * Draw exactly these heads and nothing else.
 *
 * ==> A WHOLE-SET PUSH RIDING THE SAME CALL AS THE TRAIL, FOR THE SAME REASON.
 * <== `season-tracks.js` spends a paragraph on why the cut is an argument to the
 * push rather than a call of its own; this is the other end of it. The tips come
 * from that push's own return value, so a head can never stand on a trail from a
 * moment ago.
 *
 * @param {object} map
 * @param {Array<{storm:object}>} selected
 * @param {Map<string, object>|null} cut
 * @param {Map<string, Array<number>>} [tips] from `setSeasonTracks`
 */
export function setSeasonHead(map, selected = [], cut = null, tips = null) {
  const src = map?.getSource?.(SOURCE);
  if (!src) return;

  /* NO CUT IS NO CLOCK, AND NO CLOCK IS NO HEAD. The archive without the clock
   * is a set of finished tracks with no current moment for a head to stand at —
   * which is the same argument `map/season-mesh.js` makes for putting the cage's
   * mark on the FIRST fix instead.
   *
   * ==> THE CHECK CHANGES NO ANSWER AND IS KEPT ANYWAY, ON THE SAME TERMS AS
   * THE TWO GUARDS BEFORE IT. <== Mutation, 2026-08-31: with no cut every storm
   * answers a null state and `headFeature` refuses anything that is not
   * `running`, so the loop below produces nothing either way and both suites
   * stay green. It stays because it says the rule in one line where the loop
   * says it in three, and because it skips a walk over every ticked storm on
   * every push the archive makes with the clock down — which is all of them
   * until somebody presses play. */
  const features = [];
  if (cut) {
    for (const entry of selected) {
      const f = headFeature(
        map,
        entry,
        cutStateFor(cut, entry?.storm?.id),
        tips?.get?.(entry?.storm?.id)
      );
      if (f) features.push(f);
    }
  }

  src.setData({ type: 'FeatureCollection', features });
}

/**
 * Dim every head but one. `null` puts them all back.
 *
 * ==> IT EXISTS BECAUSE THE TRAILS ALREADY DO IT. <== A reader who opens a storm
 * mid-playback gets every other track dropped to a ghost, and a full-strength
 * mark sitting on the end of a ghosted line reads as a rendering fault rather
 * than as emphasis — which is the whole argument `season-focus.js` was written
 * for, applied to a third layer.
 */
export function setSeasonHeadFocus(map, id = null) {
  focusId = id || null;
  if (!map?.getLayer?.(LAYER)) return;
  map.setPaintProperty(LAYER, 'icon-opacity', focusOpacity(focusId));
}

/** Take it off. Leaving the archive, and the failure path inside it.
 *
 *  ==> THE IMAGES STAY IN THE ATLAS AND THAT IS DELIBERATE. <== Removing them
 *  would buy back half a megabyte the reader is not short of, at the price of a
 *  texture upload on the frame they are looking at the next time they press play
 *  — which is the cost `map/layers/genesis.js` and `flood-chip.js` both pre-add
 *  their images to avoid. The archive forces sepia the whole time it is open, so
 *  a cached mark can never be a stale theme's. */
export function clearSeasonHead(map) {
  focusId = null;
  map?.getSource?.(SOURCE)?.setData(EMPTY);
  if (map?.getLayer?.(LAYER)) {
    map.setPaintProperty(LAYER, 'icon-opacity', focusOpacity(null));
  }
}

export const __internals = {
  SOURCE,
  LAYER,
  imageName,
  headFeature,
  wrapLon,
  focus: () => focusId,
};
