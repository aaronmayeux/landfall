/**
 * ripple-field.js — live earthquake waves, as data. Portable on purpose.
 *
 * PROTOTYPE CODE. Not wired into the app.
 *
 * This file owns WHERE the waves are and HOW STRONG they are. It does not draw
 * anything and it does not know what a globe is. Any world can consume it:
 *  - the dot world reads the arrays straight into a vertex shader (see world-air.js)
 *  - anything else can call sampleAt() on the CPU for one point at a time
 *
 * So if earthquakes end up on a different globe later, this file moves across
 * untouched and only the drawing changes.
 *
 * Imports: nothing.
 */

/** Every behavioural number, in one place, with the reason next to it. */
export const RIPPLE = {
  /** Hard ceiling on simultaneous waves. Must match MAX_RIPPLES in any shader
   *  that consumes this — GLSL needs a fixed array size. */
  maxLive: 8,

  /** S-wave speed. This is the real number, so the wave crosses the planet at
   *  the speed the ground actually moved. */
  speedKmS: 3.5,

  earthRadiusKm: 6371,

  /** Shaking falls off with depth. A 600 km-deep quake barely reaches the
   *  surface, and the feed's depths run that far, so without this the app draws
   *  drama that did not happen. Amplitude halves roughly every this-many km. */
  depthHalfKm: 120,

  /** Magnitudes below this contribute nothing; at or above the top they are
   *  full strength. Everything between is a straight ramp. */
  magFloor: 4.0,
  magCeil: 8.0,

  /** Thickness of the moving ring, in radians of arc along the surface.
   *  0.05 rad is about 320 km of ground. */
  widthRad: 0.05,

  /** A wave is finished once it has travelled this far. Pi radians is the far
   *  side of the planet — measured at true speed that is about 95 minutes. */
  maxRad: Math.PI,

  /** Playback speed. 1 is real time. At the space floor a true-speed wave moves
   *  about a twentieth of a pixel per second, which reads as motionless, so a
   *  compressed clock is a real design option and this is the dial for it. */
  timeScale: 1,
};

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);

/**
 * Create a ripple field.
 * @param {object} [opts] overrides for anything in RIPPLE
 */
export function createRippleField(opts = {}) {
  const cfg = Object.assign({}, RIPPLE, opts);
  const max = cfg.maxLive;

  /** @type {{x:number,y:number,z:number,amp:number,startMs:number}[]} */
  const live = [];

  /* Flat arrays sized for a shader uniform. Rewritten every update(). */
  const origins = new Float32Array(max * 3); // unit vector of each epicentre
  const params = new Float32Array(max * 3); // [current radius (rad), amplitude 0..1, ring width (rad)]
  let count = 0;

  /** Degrees to a unit vector, in the globe's axis convention:
   *  +Y is the north pole, the prime meridian faces +Z. */
  function unitVec(lon, lat) {
    const la = (lat * Math.PI) / 180;
    const lo = (lon * Math.PI) / 180;
    const c = Math.cos(la);
    return { x: c * Math.sin(lo), y: Math.sin(la), z: c * Math.cos(lo) };
  }

  /** How loud this quake is at the surface, 0..1, before it starts spreading. */
  function strength(mag, depthKm) {
    const m = clamp01((mag - cfg.magFloor) / (cfg.magCeil - cfg.magFloor));
    const d = Math.exp(-Math.max(0, depthKm) / cfg.depthHalfKm);
    return m * d;
  }

  /** Ring amplitude once it has spread to `rad`.
   *
   *  The same energy is smeared around an ever-longer ring, so amplitude falls
   *  as one over the square root of the ring's circumference — which on a
   *  sphere is proportional to sin(rad). That term peaks at the halfway point
   *  and eases off again as the wave converges on the far side, which is real;
   *  `fade` is what stops it ever coming back loud. */
  function spread(rad) {
    const grow = clamp01(rad / 0.02); // brief ramp-in so it does not pop
    const geo = Math.min(1, Math.sqrt(0.35 / Math.max(0.02, Math.sin(rad))));
    const fade = 1 - clamp01(rad / cfg.maxRad);
    return grow * fade * geo;
  }

  return {
    config: cfg,
    origins,
    params,
    get count() {
      return count;
    },
    get liveCount() {
      return live.length;
    },

    /**
     * Start a wave.
     * @param {object} q
     * @param {number} q.lon
     * @param {number} q.lat
     * @param {number} [q.mag=6.5]
     * @param {number} [q.depthKm=10]
     * @param {number} [q.at] epoch ms of the quake; defaults to now
     */
    fire({ lon, lat, mag = 6.5, depthKm = 10, at = Date.now() }) {
      const v = unitVec(lon, lat);
      live.push({ x: v.x, y: v.y, z: v.z, amp: strength(mag, depthKm), startMs: at });
      if (live.length > max) live.shift(); // oldest wave drops off the end
    },

    clear() {
      live.length = 0;
      count = 0;
    },

    /**
     * Age every wave and refill the shader arrays.
     * @param {number} nowMs
     * @returns {number} how many waves are still alive
     */
    update(nowMs) {
      const kmPerRad = cfg.earthRadiusKm;
      let n = 0;
      for (let i = live.length - 1; i >= 0; i--) {
        const w = live[i];
        const elapsedS = ((nowMs - w.startMs) / 1000) * cfg.timeScale;
        const rad = (elapsedS * cfg.speedKmS) / kmPerRad;
        if (rad >= cfg.maxRad || w.amp <= 0.001) {
          live.splice(i, 1);
          continue;
        }
        if (n < max) {
          origins[n * 3] = w.x;
          origins[n * 3 + 1] = w.y;
          origins[n * 3 + 2] = w.z;
          params[n * 3] = rad;
          params[n * 3 + 1] = w.amp * spread(rad);
          params[n * 3 + 2] = cfg.widthRad;
          n++;
        }
      }
      count = n;
      return n;
    },

    /**
     * CPU version of what the shader does, for any world that is not drawing
     * this with a point cloud. Give it a unit vector on the sphere.
     * @returns {number} displacement/brightness, 0..1
     */
    sampleAt(x, y, z) {
      let total = 0;
      for (let i = 0; i < count; i++) {
        const dot = x * origins[i * 3] + y * origins[i * 3 + 1] + z * origins[i * 3 + 2];
        const d = Math.acos(Math.max(-1, Math.min(1, dot)));
        const t = (d - params[i * 3]) / params[i * 3 + 2];
        total += params[i * 3 + 1] * Math.exp(-t * t);
      }
      return total > 1 ? 1 : total;
    },
  };
}
