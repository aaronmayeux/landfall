/**
 * _union.js — the three-way union, and the per-channel state that keeps it
 * honest. Pure: no fetch, no DOM, no caches.
 *
 * ==> THE ERUPTING SET IS A UNION, NEVER A FILTER, AND THIS IS MEASURED
 * RATHER THAN PREFERRED. <== Three feeds, three different definitions of
 * "active", and each one is blind to things the others see:
 *
 *   VAAC          global, hourly        ASH ONLY
 *   Smithsonian   global, weekly        every activity type
 *   USGS HANS     US only, live levels  alert level, not activity
 *
 * **VAAC does not replace the weekly feed and anyone who proposes dropping it
 * because VAAC is fresher has missed the point.** An effusive eruption emits
 * no ash and therefore no advisory: Great Sitkin and Kilauea are erupting lava
 * right now and appear in no VAAC traffic anywhere on Earth. Conversely the
 * weekly feed cannot see an ash cloud that started this morning. Intersecting
 * these, or preferring one, hides live eruptions — SPEC.md §5's exact failure.
 *
 * ==> AND STATE IS PER CHANNEL, WHICH IS WHAT PAYS FOR THIS BEING ONE ROUTE.
 * <== A single route is a single failure surface. That is only acceptable
 * because a dead channel is reported as dead beside two live ones instead of
 * being averaged into a quiet-looking whole. A VAAC outage reads as *ash
 * unavailable* while the weekly still reports, and the recovery action is
 * retry on the affected channel only.
 *
 * ==> `clear` IS NOT `unavailable`, AND ON THIS LAYER `clear` IS THE NORMAL
 * DAY. <== Most days there is no ash anywhere on the planet. That is a
 * successful fetch of a quiet sky and it must never be worded like an outage —
 * nor may an outage ever be worded like a quiet sky, which is the direction
 * that gets someone hurt. Four states, kept apart deliberately.
 *
 * Self-contained per §3: imports nothing. The constants it needs are passed in
 * from config/constants.js by the route, so VOLCANO stays the one place they
 * are defined.
 */

/** Resolve one channel's state. Order matters: a known failure outranks a
 *  known emptiness, and both outrank looking healthy.
 *
 *  ==> AND INCOMPLETE COVERAGE OUTRANKS BOTH `clear` AND `ok`. <== This is the
 *  bug that let Etna erupt at AVIATION COLOUR CODE RED with ash to FL230 while
 *  this function returned `ok`. On 2026-07-30 the ash channel was reading
 *  THREE Wellington bulletin slots — Vanuatu, Tonga and the Kermadecs, three
 *  percent of the planet — because BoM had started refusing us, and it
 *  reported `ok` because Wellington genuinely answered. **`ok` was true about
 *  the transport and a lie about the world.** A channel that cannot see eight
 *  of nine centres is `degraded`, and if it can see none of them it is
 *  `unavailable` no matter how healthy the fetch looked. Emptiness is only
 *  `clear` when coverage is whole: an empty read of a partial world is not a
 *  quiet sky, it is a smaller sky. */
function channelState(channel, resultCount, S) {
  if (!channel || !channel.ok) return S.unavailable;
  const coverage = channel.coverage;
  if (coverage && coverage.level === 'none') return S.unavailable;
  if (channel.stale) return S.stale;
  if (coverage && coverage.level === 'partial') return S.degraded;
  if (!resultCount) return S.clear;
  return S.ok;
}

/* ---------------------------------------------------------------------------
 * The Smithsonian weekly RSS.
 *
 * Parsed with regular expressions and not a DOM parser because there is no DOM
 * in workerd, and not with a bundled XML library because this feed is 22-24
 * items of one fixed shape published by one publisher. The fields read are the
 * three that matter: `guid` (the join key), `title` (name, window, activity
 * type) and `georss:point`.
 *
 * ==> THE POSITION IS DELIBERATELY DISCARDED. <== `georss:point` is present
 * and correct, and the catalog is the authority on where a volcano is (§22.1).
 * Carrying a second coordinate for the same volcano would make this feed a
 * second source of truth for the one fact the catalog owns. The join on the
 * number makes it redundant, so it is dropped rather than shipped unused.
 * ------------------------------------------------------------------------- */

import { classifyEmissions } from './_emissions.js';

const ITEM_RE = /<item\b[\s\S]*?<\/item>/gi;
const tag = (xml, name) => {
  const m = new RegExp(
    `<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`,
    'i'
  ).exec(xml);
  if (!m) return null;
  return m[1]
    .replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, '$1')
    .replace(/\s+/g, ' ')
    .trim();
};

/**
 * `Ahyi (United States) - Report for 16 July-22 July 2026 - New Eruptive Activity`
 *
 * Split with a pattern rather than on ` - ` because volcano names contain
 * hyphens and spaces both (`Krýsuvík-Trölladyngja`, `Atka Volcanic Complex`).
 * The anchor is the literal `- Report for `, which every item carries.
 *
 * ==> THE SPACES AROUND THE SEPARATING HYPHENS ARE LOAD-BEARING. <== The
 * report window is written `16 July-22 July 2026` with **no spaces** around
 * its own hyphen, while the separators either side of it are ` - `. Allowing
 * the separator to match a bare `-` splits the window in half and hands
 * `22 July 2026 - New Eruptive Activity` to the activity field — measured, and
 * the shape of the bug is that both fields still look like plausible strings.
 * So the separator requires whitespace and the window's internal hyphen can
 * never be mistaken for one.
 */
const TITLE_RE = /^(.*?)\s*\(([^)]*)\)\s+-\s+Report for\s+(.*?)\s+-\s+(.*)$/;

export function parseWeekly(xml) {
  if (typeof xml !== 'string' || !xml) return { reports: [], window: null };

  const reports = [];
  let window = null;

  for (const block of String(xml).match(ITEM_RE) || []) {
    const guid = tag(block, 'guid') || '';
    /* The join key. `...reports_weekly.cfm#vn_284141` -> 284141. */
    const num = /#vn_(\d{5,6})\b/.exec(guid);
    if (!num) continue;

    const title = tag(block, 'title') || '';
    const t = TITLE_RE.exec(title);

    /* Every item in one issue carries the same window, so the first parseable
     * one names the issue. Shown as the window, never as "now": a Tuesday
     * reader is looking at data up to eight days old and that is normal
     * rather than stale. */
    if (t && !window) window = t[3];

    reports.push({
      n: +num[1],
      /* Display only; the catalog owns the name. */
      weeklyName: t ? t[1] : null,
      country: t ? t[2] : null,
      /** The feed's own words. FOUR types observed live, not two:
       *  `New Eruptive Activity`, `Continuing Eruptive Activity`,
       *  `Ongoing Activity` and `New Unrest`. This is the channel that sees a
       *  lava-only eruption, so the activity type is payload, not decoration. */
      activity: t ? t[4] : null,
      /** ==> IS THIS AN ERUPTION, DECIDED HERE AND NOT BY A REGEX DOWNSTREAM.
       *  <== `New Unrest` is not an eruption — the live example was
       *  Kuchinoerabujima, whose report says the alert level was LOWERED — and
       *  the first version of the client filter excluded it only by accident,
       *  because the word "Activity" happens to be absent from that phrase.
       *  A correct answer reached by coincidence breaks the first time the
       *  Smithsonian names a category "Unrest Activity". Stated as a field so
       *  the judgement lives in one place and is visible in the payload. */
      erupting: t ? /Eruptive|Ongoing Activity/i.test(t[4]) : false,

      /** ==> WHAT IS ACTUALLY COMING OUT, READ FROM THE NARRATIVE. <== The
       *  only place on any of our feeds that distinguishes ash from
       *  gas-and-steam from lava. `functions/api/volcano/_emissions.js` owns
       *  the classification; an empty array means the text named no emission,
       *  which is common and correct, and is NOT "nothing is happening". */
      emissions: classifyEmissions(tag(block, 'description')),

      /* ==> THE NARRATIVE ITSELF IS STILL NOT CARRIED.
       * <== It was, on the first deploy, and the live payload came to ~26 KB
       * of which the overwhelming majority was prose that NOTHING RENDERS.
       * Two reasons it goes:
       *
       * 1. **The performance lens is the overriding one** and this is a globe
       *    on a phone. Twenty-odd KB at boot for text no surface reads is not
       *    a rounding error, and "we will need it in Phase G" is not a reason
       *    to ship it in Phase C.
       * 2. Nothing needs the sentences — it needs the CLASSIFICATION, and that
       *    is the `emissions` field above, at a few bytes instead of twenty
       *    thousand.
       *
       * The encoding fault that used to be the second reason is GONE: the feed
       * declares ISO-8859-1 and we were decoding it as UTF-8, which is what
       * produced `Rincón` -> `Rinc?n`. Fixed in `live.js`'s `decodeDeclared`,
       * so the text reaching this parser is now correct — which is exactly why
       * classifying it here is safe. */
    });
  }

  return { reports, window };
}

/* ---------------------------------------------------------------------------
 * USGS HANS elevated volcanoes.
 * ------------------------------------------------------------------------- */

/**
 * ==> TWO FAILURE SHAPES HERE, AND THE SECOND ONE IS THE DANGEROUS KIND. <==
 *
 * 1. HANS answers an empty ARRAY when nothing in the US is elevated. That is
 *    `clear` for this channel and a genuinely good day.
 * 2. HANS answers **HTTP 200 with `{"error": "Did not find ..."}`** when the
 *    path is wrong — measured, by appending a cache-busting query parameter to
 *    a service that routes on the path. A 200-with-an-error-body is the worst
 *    possible failure: `Array.isArray` is the only thing between it and the
 *    app reporting an empty, calm United States. So a non-array body is a
 *    hard failure, never an empty result.
 */
export function parseAlerts(json) {
  if (!Array.isArray(json)) return null;

  return json
    .map((r) => {
      /* `vnum` is a STRING here and a NUMBER in the catalog. Coerce or the
       * join silently matches nothing and the whole channel reads as empty. */
      const n = Number.parseInt(r && r.vnum, 10);
      if (!Number.isFinite(n)) return null;
      return {
        n,
        hansName: r.volcano_name || null,
        /** §22.3 fixed colour contract, not themeable. */
        colour: r.color_code || null,
        alertLevel: r.alert_level || null,
        observatory: r.obs_abbr || null,
        /** ==> WHEN THE LEVEL LAST CHANGED. NOT A FRESHNESS SIGNAL. <==
         *  Measured: every elevated volcano carried a date three weeks old
         *  because that is when its level was last revised. Anything reading
         *  this as feed age reports a healthy channel as permanently stale.
         *  It is content — how long this volcano has been at this level. */
        levelSince: r.sent_utc || null,
        noticeUrl: r.notice_url || null,
      };
    })
    .filter(Boolean);
}

/* ---------------------------------------------------------------------------
 * The union.
 * ------------------------------------------------------------------------- */

/**
 * Build the payload from three already-fetched channels.
 *
 * Every channel is `{ok: true, ...}` or `{ok: false, error}`, optionally with
 * `stale: true` when the route served a last-good copy. This function does no
 * I/O at all, which is what lets tools/test-vaa.mjs kill any channel and
 * assert what comes out — the failure states are tested rather than hoped for.
 *
 * @param {object} channels  {ash, weekly, alerts}
 * @param {object} VOLCANO   the config/constants.js block
 * @param {number} nowMs     injected so the age filter is testable
 */
export function buildPayload(channels, VOLCANO, nowMs) {
  const S = VOLCANO.state;
  const now = Number.isFinite(nowMs) ? nowMs : Date.now();

  /* --- ash ---------------------------------------------------------------
   * The age filter is the guard that stops a latest-only bulletin slot nobody
   * has touched since 2024 rendering as a live RED eruption. Rejects are
   * COUNTED, not swallowed: a channel that is answering 200 while producing
   * nothing usable must be visible, or it reads as a calm sky (§5). */
  const ash = channels.ash || { ok: false, error: 'not attempted' };
  let advisories = [];
  let ashRejected = null;
  let droppedStale = 0;
  let centres = [];

  if (ash.ok && ash.parsed) {
    ashRejected = ash.parsed.rejected;
    const maxAgeMs = VOLCANO.ash.advisoryMaxAgeHours * 60 * 60 * 1000;
    for (const a of ash.parsed.advisories) {
      if (now - Date.parse(a.dtg) > maxAgeMs) {
        droppedStale++;
        continue;
      }
      advisories.push(a);
    }
    /** WHICH CENTRES ACTUALLY CONTRIBUTED. BoM already silently omits
     *  Wellington, which is why this relay reads the raw slots too. If it
     *  starts omitting a second centre, this list is how that becomes
     *  visible instead of reading as calm.
     *
     *  IT IS NOT AN ALARM AND MUST NOT BE WIRED AS ONE: a centre that has
     *  legitimately issued nothing in seven days is correctly absent. It
     *  answers "who did we hear from", not "who is broken". */
    centres = [...new Set(ash.parsed.advisories.map((a) => a.vaac).filter(Boolean))].sort();
  }

  /* --- weekly ------------------------------------------------------------ */
  const weekly = channels.weekly || { ok: false, error: 'not attempted' };
  const weeklyParsed = weekly.ok && weekly.parsed ? weekly.parsed : { reports: [], window: null };

  /* --- alerts ------------------------------------------------------------ */
  const alerts = channels.alerts || { ok: false, error: 'not attempted' };
  const alertList = alerts.ok && Array.isArray(alerts.parsed) ? alerts.parsed : [];

  /* --- the union, keyed on the GVP number ------------------------------- */
  const byNumber = new Map();
  const slot = (n) => {
    if (!byNumber.has(n)) byNumber.set(n, { n, live: {} });
    return byNumber.get(n);
  };

  for (const a of advisories) {
    slot(a.n).live.ash = {
      vaac: a.vaac,
      dtg: a.dtg,
      status: a.status,
      observed: a.observed,
      colour: a.colour,
      plumeTopFeet: a.plumeTopFeet,
      /** ==> THE OTHER HALF OF THE HEIGHT, AND IT MUST NOT BE DROPPED HERE.
       *  <== `plumeTopFeet` is above SEA LEVEL. On its own it draws Sabancaya's
       *  441 m plume as a 6.4 km column. The two fields are one measurement in
       *  two parts and neither is useful without the other. */
      sourceElevM: a.sourceElevM,
      advisoryNr: a.advisoryNr,
      eruptionDetails: a.eruptionDetails,
      /** True when this advisory is about wind-lifted old ash rather than an
       *  eruption. A renderer must not draw a column from it (§42.1.9). */
      resuspended: a.resuspended,
      nextAdvisory: a.nextAdvisory,
      vaacName: a.vaacName,
    };
  }
  for (const r of weeklyParsed.reports) {
    slot(r.n).live.report = {
      activity: r.activity,
      /** Decided in parseWeekly, not by a downstream regex — see there. */
      erupting: r.erupting,
      /** What the narrative said was coming out. Omitted rather than sent
       *  empty: an absent key is "the text named none", and an empty array on
       *  the wire invites a reader to treat it as a measured nothing. */
      ...(r.emissions && r.emissions.length ? { emissions: r.emissions } : {}),
      window: weeklyParsed.window,
      weeklyName: r.weeklyName,
      country: r.country,
    };
  }
  for (const a of alertList) {
    slot(a.n).live.alert = {
      colour: a.colour,
      alertLevel: a.alertLevel,
      observatory: a.observatory,
      levelSince: a.levelSince,
      hansName: a.hansName,
      noticeUrl: a.noticeUrl,
    };
  }

  return {
    fetchedAt: new Date(now).toISOString(),

    /** ==> PER-SOURCE STATE. THE REASON ONE ROUTE IS SAFE. <== Nothing
     *  downstream may collapse these into one badge or one status: three
     *  feeds at three ages means one badge lies in whichever direction it
     *  rounds. And `unavailable` here must never reach a surface worded as
     *  all-clear. */
    sources: {
      ash: {
        state: channelState(ash, advisories.length, S),
        at: ash.fetchedAt || null,
        count: advisories.length,
        /** Bulletins read but not published, with why. `exercise` is drill
         *  traffic, `unknown_volcano` is unjoinable ash (Buenos Aires on
         *  resuspension), `no_dtg` is corrupt. */
        rejected: ashRejected,
        /** Advisories older than VOLCANO.ash.advisoryMaxAgeHours. A nonzero
         *  number here is normal; a number that equals the total means every
         *  centre has gone quiet and the channel is reporting nothing for a
         *  reason worth seeing. */
        droppedStale,
        centres,
        /** ==> HOW MUCH OF THE WORLD THIS READING COVERS, AND IT SITS BESIDE
         *  `state` BECAUSE `state` ALONE CANNOT SAY IT. <== `centres` above
         *  answers "who did we hear from", which is not the same question: a
         *  centre with nothing to report is correctly silent. This answers
         *  "who could we have heard from" — the transport view — and it is the
         *  field whose absence hid an eight-of-nine-centre outage behind the
         *  word `ok`. Same role as `us_observatories_only` on the alerts
         *  channel: a limit stated in the payload so no surface can forget it.
         *
         *  `level` is `global` (all nine reachable), `partial` (some centres
         *  dark, and `centresUnreachable` NAMES them) or `none`. Anything but
         *  `global` must be worded as reduced coverage and never as calm. */
        coverage: ash.coverage || null,
        error: ash.ok ? null : String(ash.error || 'unknown'),
      },
      weekly: {
        state: channelState(weekly, weeklyParsed.reports.length, S),
        at: weekly.fetchedAt || null,
        count: weeklyParsed.reports.length,
        /** The REPORT WINDOW, which is the honest thing to show — not "now".
         *  Published by 2300 UTC Thursday and running up to eight days
         *  behind by design. */
        window: weeklyParsed.window,
        error: weekly.ok ? null : String(weekly.error || 'unknown'),
      },
      alerts: {
        state: channelState(alerts, alertList.length, S),
        at: alerts.fetchedAt || null,
        count: alertList.length,
        /** ==> US OBSERVATORIES ONLY, AND EMPTY OUTSIDE THE US IS NOT CALM.
         *  <== Stated in the payload so no surface can forget it (§42.1.6). */
        coverage: 'us_observatories_only',
        error: alerts.ok ? null : String(alerts.error || 'unknown'),
      },
    },

    /** One entry per volcano with anything live on it, newest ash first.
     *  Position, name, elevation and history all come from the shipped
     *  catalog — this payload carries only what is LIVE, joined on `n`. */
    volcanoes: [...byNumber.values()].sort((a, b) => {
      const ad = a.live.ash ? a.live.ash.dtg : '';
      const bd = b.live.ash ? b.live.ash.dtg : '';
      if (ad !== bd) return ad < bd ? 1 : -1;
      return a.n - b.n;
    }),
  };
}
