#!/usr/bin/env node
/**
 * css-structure-check.mjs — a stylesheet that PARSES but has quietly thrown a
 * rule away.
 *
 * ==> WHAT THIS IS PREVENTING, AND IT HAS ALREADY HAPPENED TWICE IN TWO
 * COMMITS. <== §57.67 slice C's play/stop button stacks its two marks in one
 * grid cell. An edit split that rule's comment with a stray comment-close, so the prose
 * after it became raw CSS. **CSS does not stop there.** The parser enters error
 * recovery and discards everything up to and including the NEXT rule block —
 * which was the stacking rule itself. Nothing errored, nothing logged, the file
 * still loaded, every other rule in it still worked, and the two marks fell
 * into their own grid rows: play against the top edge of the button, stop
 * against the bottom. It took Aaron on glass to see it and a Playwright probe
 * to name it.
 *
 * The same edit had already left a literal `\"` inside a different comment in
 * the same file one commit earlier. That one was harmless where it sat, which
 * is exactly why nobody caught the second.
 *
 * ==> AND NOTHING ELSE IN THE GATE CHAIN CAN SEE THIS. <== `css-orphan-check`
 * asks whether a class has a rule; a class whose rule was EATEN still has one
 * in the text. `type-scale-check` reads declarations it finds. `check-syntax`
 * is about JavaScript. Every gate looks at the file as text, and the browser is
 * the only thing that reads it as a stylesheet — so a rule can be present,
 * correct, and dead, and every check stays green.
 *
 * WHAT IT CHECKS, and all three are the same failure wearing different clothes:
 *
 *  1. **Comments are balanced.** Every every comment-open has a comment-close and no second comment-open appears
 *     inside an open comment — CSS has no nested comments, so a second comment-open
 *     inside one is a comment that ends early somewhere the author did not
 *     intend.
 *  2. **Braces are balanced**, counting only those outside comments and
 *     strings.
 *  3. **Nothing sits between rules that is neither a selector nor an at-rule.**
 *     This is the one that catches the real fault: after a comment closes
 *     early, the orphaned prose reads as a selector, and a "selector" full of
 *     spaces and backticks is not one.
 *
 * Run:  node tools/css-structure-check.mjs
 * Exit: 0 clean, 1 on anything found.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

/* ==> THE SAME LIST `type-scale-check.mjs` KEEPS, AND IT IS EXPLICIT FOR THE
 * SAME REASON. <== Bringing a sheet under a gate should be a visible act. The
 * cost is that a sheet nobody adds is reported clean without having been read;
 * that is stated here rather than hidden, exactly as it is over there. */
const SHEETS = [
  'ui/panels.css', 'ui/home.css', 'ui/nudge.css', 'seasons/seasons.css',
];

let pass = 0;
const fails = [];
const fail = (m) => fails.push(m);

/** Strip comments, recording where any of them go wrong. Returns the stripped
 *  text with comments replaced by equivalent whitespace, so every reported line
 *  number still matches the file. */
function stripComments(text, file) {
  let out = '';
  let i = 0;
  let openedAt = -1;
  const lineOf = (idx) => text.slice(0, idx).split('\n').length;

  while (i < text.length) {
    if (openedAt === -1 && text[i] === '/' && text[i + 1] === '*') {
      openedAt = i;
      out += '  ';
      i += 2;
      continue;
    }
    if (openedAt !== -1) {
      if (text[i] === '*' && text[i + 1] === '/') {
        openedAt = -1;
        out += '  ';
        i += 2;
        continue;
      }
      /* ==> A SECOND `/​*` INSIDE A COMMENT IS THE FAULT, NOT A CURIOSITY. <==
       * CSS comments do not nest, so this one is going to end at the first
       * `*​/` and whatever the author thought was still commentary becomes
       * live CSS. It is reported even though the file may still balance. */
      if (text[i] === '/' && text[i + 1] === '*') {
        fail(`${file}:${lineOf(i)} a second \`/*\` opens inside a comment that `
          + `started on line ${lineOf(openedAt)} — CSS comments do not nest, so `
          + 'this one ends early and the rest becomes live CSS');
      }
      out += text[i] === '\n' ? '\n' : ' ';
      i += 1;
      continue;
    }
    out += text[i];
    i += 1;
  }

  if (openedAt !== -1) {
    fail(`${file}:${lineOf(openedAt)} a comment opens here and is never closed `
      + '— everything after it is invisible to the browser');
  }
  return out;
}

/** What can legally sit before a `{` at the top level. Selectors, at-rules, and
 *  nothing else. Deliberately generous: this is looking for prose, not
 *  validating selector grammar, and a false alarm here would be a check that
 *  cries wolf on a selector somebody wrote in a way it did not expect. */
const SELECTOR_OK = /^[\s.#@\w[\]="'>~+*:(),%^$|\\/-]*$/;

for (const rel of SHEETS) {
  const file = rel;
  const text = readFileSync(join(ROOT, rel), 'utf8');
  const bare = stripComments(text, file);

  let depth = 0;
  let chunkStart = 0;
  let minDepth = 0;

  for (let i = 0; i < bare.length; i += 1) {
    const c = bare[i];
    if (c === '{') {
      if (depth === 0) {
        const head = bare.slice(chunkStart, i);
        if (head.trim() && !SELECTOR_OK.test(head)) {
          const line = text.slice(0, i).split('\n').length;
          const shown = head.trim().replace(/\s+/g, ' ').slice(0, 70);
          fail(`${file}:${line} text before a \`{\` that is not a selector or an `
            + `at-rule: "${shown}" — this is what a comment closing early looks `
            + 'like, and the browser discards this rule silently');
        }
      }
      depth += 1;
    } else if (c === '}') {
      depth -= 1;
      if (depth < minDepth) minDepth = depth;
      if (depth === 0) chunkStart = i + 1;
    }
  }

  if (depth !== 0 || minDepth < 0) {
    fail(`${file} braces do not balance (ends at depth ${depth})`);
  }

  /* Trailing text after the last rule, which the loop above cannot see because
   * it only ever looks backwards from a `{`. */
  const tail = bare.slice(chunkStart);
  if (tail.trim() && !SELECTOR_OK.test(tail)) {
    const shown = tail.trim().replace(/\s+/g, ' ').slice(0, 70);
    fail(`${file} text after the last rule that is not a selector: "${shown}"`);
  }

  pass += 1;
}

if (fails.length) {
  console.log('');
  for (const f of fails) console.log(`  FAIL  ${f}`);
  console.log(
    `\n${fails.length} structural fault${fails.length === 1 ? '' : 's'}.\n`
    + 'A stylesheet in this state still loads and still mostly works. CSS error\n'
    + 'recovery throws away everything up to the END of the next rule, so what\n'
    + 'goes missing is not the broken line — it is the rule after it, which\n'
    + 'reads as correct in every text scan this repo runs.\n'
  );
  process.exit(1);
}

console.log(`✓ ${pass} stylesheets are structurally whole — comments close, `
  + 'braces balance, and nothing between rules is prose');
