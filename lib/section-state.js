/**
 * section-state.js — which collapsible sections the user has closed.
 *
 * ONE RECORD, ONE STORAGE KEY, TWO CALLERS. It was one caller and inline until
 * §45 added a second (the drawer's "Being watched" section), which is exactly
 * the point at which §12 says to extract rather than copy: the second copy of
 * a `JSON.parse(localStorage.getItem(...)) || {}` is where the two silently
 * start disagreeing about what an unparseable record means.
 *
 * A COLLAPSED SECTION IS A PREFERENCE, AND A PREFERENCE OUTRANKS A HEURISTIC.
 * The watch-list section has a sensible default (open when there are no
 * storms, closed when there are) and this record is what lets a user overrule
 * it permanently. A default that keeps re-asserting itself over an explicit
 * choice is worse than having no default at all.
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
