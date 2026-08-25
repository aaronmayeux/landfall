/**
 * seasons-height-harness.js — mount the real board so its parts can be measured.
 *
 * ==> THE SHIPPED VIEW, THE SHIPPED DATA MODULE AND THE REAL SEASON FILES.
 * <== `data/seasons.js` fetches `/seasons/index.json` and `/seasons/data/*.txt`,
 * both of which are in this repo and served by the static server, so the roster
 * below is 2005 parsed out of NOAA's own bytes rather than a list somebody
 * typed.
 *
 * `data/seasons-live.js` is the one thing that cannot work here — it wants
 * `/api/seasons/live`, which is a relay route. It is stubbed, and the SHAPE of
 * the stub is load-bearing rather than incidental; see the note on it below.
 */

import { applyTokens } from '../app/theme-switch.js';
import { forceMode, MODE } from '../config/theme.js';
import * as seasonsData from '../data/seasons.js';
import { createSeasonsBoardView } from '../ui/view-seasons-board.js';
import { createDrawer } from '../ui/drawer.js';

/* ==> THE TYPE SCALE IS NOT IN A STYLESHEET, SO IT HAS TO BE FETCHED. <==
 * `--type-small` and its siblings are declared in `index.html`'s own `:root`
 * block, not in `ui/panels.css`. A page that merely links the stylesheets gets
 * every rule that READS them and none of their values — so a `calc()` on one
 * is invalid, the whole declaration is dropped, and the box silently falls
 * back to a content size. On THIS harness that would corrupt the one number it
 * exists to produce. Same trick and same reason as
 * `tools/seasons-row-harness.js`; pulled out of the shipped file rather than
 * copied, because a copy looks right on the day it is written. */
const indexHtml = await (await fetch('/index.html')).text();
const block = indexHtml.match(/<style[^>]*>([\s\S]*?)<\/style>/i);
if (!block) throw new Error('[seasons-height-harness] no <style> block in index.html');
const sheet = document.createElement('style');
sheet.textContent = block[1];
document.head.appendChild(sheet);

/* Sepia, because the archive forces it and this sheet is only ever seen in it.
 * AFTER the scale, because `applyTokens` writes onto the same `:root`. */
forceMode(MODE.SEPIA);
applyTokens();

/**
 * ==> THE LIVE ROAD SUCCEEDS HERE, AND THAT IS THE CORRECTION THAT MATTERS.
 * <== `/api/seasons/live` is a relay route and cannot answer in a sandbox, and
 * the first version of this harness let it fail. That is a real state the
 * board answers in words — a `seasons-bad` paragraph and a `Try again` button,
 * ABOVE the roster — so the furniture came out taller than the app's, and the
 * one number this file produces would have been quietly wrong in the direction
 * nothing invites you to check. It returns a plausible index instead, so
 * `liveDownHtml` renders nothing, which is what a reader sees on an ordinary
 * day.
 *
 * `loadLiveSeason` is never reached: the harness opens 2005, which the settled
 * index holds, so the settled road serves it off the real files.
 */
const live = {
  loadLiveIndex: async () => ({
    status: 'ok',
    year: 2026,
    years: [2026],
    storms: [],
    stale: false,
    fetchedAt: '2026-08-25T20:00:00.000Z',
  }),
  loadLiveSeason: async () => ({
    status: 'unavailable', reason: 'the harness never opens the live season', year: 2026,
  }),
};

const drawer = createDrawer({ root: document.getElementById('drawer') });

const view = createSeasonsBoardView({
  seasons: seasonsData,
  live,
  onSelection: () => {},
  onFocus: () => {},
  onWhere: () => {},
  onOpenStorm: () => {},
  liveRunningIds: () => null,
});

/* 2005 by default, on purpose: it is the busiest year in the record, so the
 * roster is longer than any sheet and the scroller is doing its job, which is
 * the state the height question is actually about. `?year=` overrides it so
 * `tools/seasons-height-check.mjs` can put a one-storm year beside it — the
 * comparison IS the bug, and one year alone cannot show it. */
const YEAR = Number(new URLSearchParams(location.search).get('year')) || 2005;
view.setSeason(YEAR);

/* ==> THROUGH THE REAL DRAWER, NOT `view.mount()` DIRECTLY. <== The header —
 * the title and the minimise chevron — belongs to `ui/drawer.js` rather than
 * to the view, so a harness that mounted the view alone would measure the
 * furniture with the top of it missing. That was the first version's other
 * error, and it pushed the number the opposite way from the live-road one. */
drawer.register(view);
drawer.go('seasons-board');

/* The check polls for this rather than racing the fetch. */
const done = () => document.querySelectorAll('.seasons-row').length > 0;
const tick = () => {
  if (done()) { document.documentElement.dataset.harnessReady = 'true'; return; }
  setTimeout(tick, 50);
};
tick();
