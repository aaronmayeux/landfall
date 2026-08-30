/**
 * The merged figure row, drawn by the shipped renderers off a real storm.
 * SPEC-SEASONS-BUILD.md §57.57b.
 *
 * ==> A SEPARATE FILE, NOT AN INLINE `<script>`. <== `_headers` sets
 * `script-src 'self'` and an inline block is silently blocked, which on a page
 * like this looks exactly like the module failing to load.
 *
 * ==> WHY THIS EXISTS AT ALL: `textContent` CANNOT SEE A CLIP. <== `NOW.md`
 * records the landfall sort reading `18 of 3` on a phone while every node
 * assertion in the repo agreed the DOM said `18 of 31` — the column was
 * `overflow: hidden` and the browser threw the last character away at paint.
 * The merged row is the same shape at a bigger size: a figure now shares one
 * grid cell with a rank sentence and an SVG, inside a `grid-template-columns:
 * auto 1fr` list where the other rows still take two columns. Whether that
 * clips, and whether a spanning cell widens the label column for every row
 * above it, are questions only a layout engine can answer.
 */
import { applyTokens } from '../app/theme-switch.js';
import { forceMode, MODE } from '../config/theme.js';
import { parseHurdat2 } from '../lib/hurdat.js';
import { stormFacts } from '../lib/season-facts.js';
import { rankStorm, rankingsFileName } from '../lib/rankings.js';
import { rankMarks, rankFootnoteHtml } from '../ui/season-rank-markup.js';
import { peakHtml, lifeHtml, changeHtml } from '../ui/season-detail-markup.js';
import { movementHtml } from '../ui/season-track-markup.js';
import { SEASONS } from '../config/constants.js';

/* ==> THE TYPE SCALE IS NOT IN A STYLESHEET, SO IT HAS TO BE FETCHED. <==
 * `--type-small` and its siblings are declared in `index.html`'s own `:root`
 * block, not in `ui/panels.css`, so a page that merely links the stylesheets
 * gets every rule that READS them and none of their values. Same trap, same
 * fix, same reason as `tools/seasons-row-harness.js`, which cost one confusing
 * red run before it was understood. */
const shell = await (await fetch('/index.html')).text();
const block = shell.match(/<style[^>]*>([\s\S]*?)<\/style>/i);
if (!block) throw new Error('[season-figure-harness] no <style> block in index.html');
const sheet = document.createElement('style');
sheet.textContent = block[1];
document.head.appendChild(sheet);

/* Sepia, because the archive forces it and this row is only ever seen in it.
 * AFTER the scale, because `applyTokens` writes onto the same `:root`. */
forceMode(MODE.SEPIA);
applyTokens();

/* ==> KATRINA, BECAUSE SHE RANKS ON EVERY STATISTIC THE ARCHIVE HOLDS. <==
 * 499 storms of 3,266 carry all seven marks and she is one of them, so this
 * page draws the busiest version of the row that exists. A storm with two
 * marks would leave five of the seven bars unmeasured. */
const index = await (await fetch('/seasons/index.json')).json();
const { file } = rankingsFileName(index.basins);
const TABLE = await (await fetch(`/seasons/data/${file}`)).json();
const text = await (await fetch(`/seasons/data/${index.basins.atlantic.seasons['2005']}`)).text();
const storm = parseHurdat2(text).storms.find((s) => s.id === 'AL122005');
const facts = stormFacts(storm);

const system = 'imperial';
const ranked = rankStorm(facts, TABLE, 'atlantic', system);
const marks = rankMarks(ranked, { system });

/* The four sections that own a ranked figure, plus the footnote that governs
 * them — assembled the way `ui/view-season-detail.js` assembles them. */
document.getElementById('body').innerHTML = [
  peakHtml(facts, system, marks),
  lifeHtml(facts, marks),
  changeHtml(facts, system, { windowHours: SEASONS.intensificationWindowHours }, marks),
  movementHtml(facts, system, {
    floorKt: SEASONS.trackSpeedFloorKt,
    maxLegHours: SEASONS.trackSpeedMaxLegHours,
    distanceFloorNm: SEASONS.trackDistanceFloorNm,
    cycloneShareMax: SEASONS.trackDistanceCycloneShareMax,
  }, marks),
  rankFootnoteHtml(ranked, { year: 2005 }),
].join('');

document.body.dataset.ready = 'true';
