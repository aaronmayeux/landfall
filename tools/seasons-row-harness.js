/**
 * The harness's own script. A SEPARATE FILE, not an inline <script>: `_headers`
 * sets `script-src 'self'` and an inline block is silently blocked, which on a
 * page like this looks exactly like the module failing to load.
 */
import { applyTokens } from '../app/theme-switch.js';
import { forceMode, MODE } from '../config/theme.js';
import { rowHtml } from '../ui/seasons-board-markup.js';

/* ==> THE TYPE SCALE IS NOT IN A STYLESHEET, SO IT HAS TO BE FETCHED. <==
 * `--type-small` and its siblings are declared in `index.html`'s own `:root`
 * block, not in `ui/panels.css`, so a page that merely links the stylesheets
 * gets every rule that READS them and none of their values. The column tracks
 * below are `calc(var(--type-small) * n)`; with the variable absent the calc is
 * invalid, the whole `grid-template-columns` declaration is dropped, and the
 * row silently falls back to content-sized columns — which is exactly the bug
 * this harness exists to catch, arriving from the harness instead of the app.
 * It cost one confusing red run before it was understood.
 *
 * Pulled out of the shipped file rather than copied, for the reason
 * `tools/drawer-head-harness.html` exists as a warning: a copy looks right on
 * the day it is written. */
const html = await (await fetch('/index.html')).text();
const block = html.match(/<style[^>]*>([\s\S]*?)<\/style>/i);
if (!block) throw new Error('[seasons-row-harness] no <style> block in index.html');
const sheet = document.createElement('style');
sheet.textContent = block[1];
document.head.appendChild(sheet);

/* Sepia, because the archive forces it and the row is only ever seen in it.
 * AFTER the scale, because `applyTokens` writes onto the same `:root`. */
forceMode(MODE.SEPIA);
applyTokens();

/* The widest and narrowest of everything, on purpose: the longest date range
 * the formatter can produce, the shortest, the widest badge and the narrowest,
 * with and without a landfall mark. A harness of similar rows would prove
 * nothing — the bug was rows DIFFERING. */
const CASES = [
  ['ANDREA', 'TS', 0, Date.UTC(2025, 5, 22), Date.UTC(2025, 5, 25)],
  ['MAY-EDGE', 'CAT 5', 5, Date.UTC(2025, 4, 28), Date.UTC(2025, 4, 30)],
  ['CHANTAL', 'TS', 1, Date.UTC(2025, 6, 4), Date.UTC(2025, 6, 7)],
  ['GABRIELLE', 'CAT 4', 0, Date.UTC(2025, 8, 17), Date.UTC(2025, 8, 28)],
  ['IMELDA', 'CAT 1', 2, Date.UTC(2025, 8, 26), Date.UTC(2025, 9, 6)],
  ['A-VERY-LONG-STORM-NAME-INDEED', 'CAT 5', 0, Date.UTC(2025, 9, 1), Date.UTC(2025, 9, 2)],
  ['UNGRADED', '?', 0, Date.UTC(2025, 10, 3), Date.UTC(2025, 10, 3)],
];

/* A tropical storm is category 0 in `lib/category.js`, not null — null is the
 * UNKNOWN case, which renders as a dash and is a real archive outcome worth
 * having one of in here. */
const CAT = { TS: 0, 'CAT 1': 1, 'CAT 2': 2, 'CAT 3': 3, 'CAT 4': 4, 'CAT 5': 5, '?': null };

const rows = CASES.map(([name, badge, landfalls, firstTime, lastTime]) => rowHtml({
  storm: { id: name, name },
  facts: {
    peakCategory: CAT[badge],
    landfalls: Array.from({ length: landfalls }, (_, i) => ({ i })),
    firstTime,
    lastTime,
  },
  on: false,
})).join('');

document.getElementById('body').innerHTML = `<ul class="seasons-roster">${rows}</ul>`;
