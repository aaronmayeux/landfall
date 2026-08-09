/**
 * section-state.js — which collapsible sections the user has closed.
 *
 * ONE RECORD, ONE STORAGE KEY, AND — AS OF NOW — ONE CALLER AGAIN.
 *
 * It was inline in `ui/view-storm-detail.js` until §45's watch-list section
 * needed the same record, which is the point §12 says to extract rather than
 * copy. The watch list then stopped collapsing at all (Aaron, 2026-08-09), so
 * the second caller is gone.
 *
 * KEPT AS A MODULE ANYWAY, and not folded back in. §12's rule is "extract at
 * the second use", not "re-inline the moment it drops to one" — and the thing
 * it owns is a STORAGE KEY, which is exactly the kind of thing that should
 * have one owner regardless of how many callers it currently has. The parsing
 * rules below (an array is junk, `null` is junk, a throw is session-only) are
 * decisions somebody made once; they should not have to be rediscovered by
 * whoever adds the next collapsible section.
 *
 * FAILURE IS SESSION-ONLY, NEVER FATAL. Private-mode Safari throws on write
 * and can throw on read; a hand-edited or truncated record parses to junk.
 * Both degrade to "nothing is collapsed", which is a working app with the
 * sections open — never an exception on a surface someone is reading during a
 * hurricane.
 *
 * Imports config/ only. No DOM beyond `localStorage`.
 */

import { STORAGE_KEY } from '../config/constants.js';

/** The whole record, `{ sectionId: true }` for collapsed. Always an object. */
export function readSections() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY.sections));
    /* `typeof null === 'object'`, and an array would happily accept string
     * keys and then serialise back as `[]`. Both are junk this must not
     * hand out as a record. */
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  } catch {
    return {};
  }
}

export function writeSections(record) {
  try {
    localStorage.setItem(STORAGE_KEY.sections, JSON.stringify(record));
  } catch {
    /* session-only */
  }
}

/**
 * Has the user made an explicit choice about this section?
 *
 * SEPARATE FROM "IS IT COLLAPSED", DELIBERATELY. A section that has never been
 * touched must fall to its default, and `record[id] === undefined` is the only
 * thing that can tell "never touched" from "deliberately opened" — both of
 * which are falsy and would collapse into one answer if this were a boolean.
 */
export const hasChoice = (record, id) => Object.prototype.hasOwnProperty.call(record, id);

/** Collapsed state for a section: the user's choice if they made one, the
 *  caller's default if they did not. */
export function isCollapsed(record, id, fallback = false) {
  return hasChoice(record, id) ? !!record[id] : !!fallback;
}
