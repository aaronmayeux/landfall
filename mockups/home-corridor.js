/* home-corridor.js — behaviour for mockups/home-corridor.html.

 * ==> IT IS AN EXTERNAL FILE BECAUSE THE LIVE CSP REFUSES AN INLINE ONE. <==
 * `_headers` sends `script-src 'self'` with one pinned hash and no
 * 'unsafe-inline'. This page shipped with its script inline and had therefore
 * been DEAD on the deployed site for as long as the CSP has been enforced —
 * the layout drew, the styling drew (style-src does allow inline), and nothing
 * moved. Found on 2026-08-26 by tools/mockup-csp-check.mjs, not by looking.
 *
 * SPEC-OPS.md §17.4 carries the rule. Nothing here is app code.
 */
document.querySelectorAll('[data-t]').forEach(b=>b.addEventListener('click',()=>{
  document.querySelectorAll('[data-t]').forEach(o=>o.setAttribute('aria-pressed',String(o===b)));
  document.documentElement.dataset.theme=b.dataset.t;}));
