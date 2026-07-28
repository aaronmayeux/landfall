# NOW.md — what's in flight

> **TRIM/AUDIT TRIGGER: 300 LINES.** Past that, this file gets a full read and a
> cut list before anything else is added. A trigger, not a ceiling — the point is
> a periodic honest audit, never compressing a finding on the day it was made.
>
> **WHY 300 AND NOT §12's 700.** A source file is navigated by jumping to the
> part you need; this one is read front to back at session start. Past roughly
> 300 lines that reading turns into searching, and searching only finds what you
> already knew to look for — which is exactly backwards for the file whose job is
> naming the things you DIDN'T know about.
>
> **THE FIRST SCREEN IS THE PRODUCT.** `IN FLIGHT` and `NEXT UP` stay short
> enough to read at a glance, because this file's whole job is orienting the
> next session in its first minute. Length accumulates BELOW them.
>
> **An item leaves this file in exactly two ways.**
> 1. **It lands** — delete it here, and add one or two sentences to the relevant
>    spec file describing what *is*, not what happened.
> 2. **It dies** — delete it. No tombstone, no "investigated and dismissed".
>
> **Not a log.** No dates on things, no completed section, no history. If you want
> to know what happened, that's what `git log` is for.
> **Not a decision tree.** Keep an item to a line or two where a line or two is
> honest. An item needing several paragraphs is a spec entry wearing a TODO's
> clothes — write it in the spec and leave a pointer here.
> **Never a place to record a rule.** Rules go in SPEC.md.

---

## IN FLIGHT

**The boot mark is a hand-drawn stand-in.** Aaron judged it on glass and it goes.
**He is providing a real SVG of the Landfall logo to replace it** — drop it into
the `#boot-mark` block in index.html, keep the counter-clockwise spin and the
reduced-motion fallback. Until then the app opens on a redraw that does not match
its own icon.

## NEXT UP — two passes, in this order

**1. CLOUDFLARE — DONE, AND IT ENDED IN CODE, NOT CLICKS.**
- **Web Analytics STAYS.** There is no off switch: the site was created by Pages,
  the account-level Manage-site page defers to Pages, and the Pages project has no
  such row. The only kill is an API call clearing the project's analytics tag.
  Keeping it is the better call anyway — its Debug View names the exact element
  behind a slow interaction (`canvas.maplibregl-canvas`,
  `button.nudge-action`), which `lib/perf.js` cannot do. **So the two RUM hosts
  get ALLOWED in the CSP** rather than blocked, and that must land in `_headers`
  BEFORE the policy is enforced.
- **There is no Cloudflare zone on this account** — Domains is empty, so
  zone-level rate limiting rules do not exist as an option. Rate limiting moves
  into `functions/api/_middleware.js` using the Workers rate-limit binding, in
  pass 3. Better anyway: it can return the app's own error shape so the layer
  drawer shows a real message with a retry instead of Cloudflare's generic 429.
- **CSP flip out of Report-Only still owed**, in pass 3, same edit as the RUM
  hosts, after one clean session with imagery on and a storm selected.

**2. RESPONSIVENESS.** INP is 320 ms on the map canvas and 280 ms on the
disclaimer nudge against a 200 ms bar (Web Analytics, last 24 h — but the counts
are 2 and 1, so read them as "still over" and nothing more).
Cause is measured, not guessed: every tap re-derives the coastal band and re-runs
the label-collision search over every storm, **two or three times**, because
`map/layers/registry.js:189` marks a def changed whenever it merely HAS a
`setPair` hook. Four fixes, ~40 lines: guard that flag; memoize `coastRings`
(`map/coast-source.js:67` re-decodes every loaded basemap tile on the main
thread, uncached) and early-out `bandFor` on a cache hit; defer ambient label
placement onto the existing debounced path; coalesce the storm-detail panel's
double `renderAll`. **The disclaimer nudge button's 496 ms needs no fix of its
own** — its handler is a few milliseconds and it is queued behind boot long
tasks these fixes shorten. Same pass: coalesce in-flight imagery requests so a
duplicate 768×768 frame is not fetched and pixel-walked twice.

**3. LOAD SPEED, MEASURED.** The cold-load import staircase is 101 modules
discovered across 5 sequential round trips, and `_headers` forces `no-cache` on
all of them, so a repeat visit still pays those trips as conditional requests.
Candidate fix is `<link rel="modulepreload">` emitted and kept honest by
`tools/check-syntax.mjs` (which already resolves every import; its regex needs
widening to catch bare and re-export forms, or it silently drops
`map/layers/cone.js` and six siblings). **MEASURE FIRST** — nothing in the repo
can time a cold load today, so write that script before touching index.html, and
"not worth it" is an acceptable answer. Two things ride along: `/app/*` is
MISSING from `_headers` entirely, so five modules including `app/views.js` ship
with no cache instruction at all (the mixed-version shape, see `_headers:141`);
and `tools/detail-disclaimer-check.mjs` waits on `load`, which waits on basemap
tiles it cannot reach offline — `tools/ended-check.mjs:117` has the pattern to
copy, and `tools/disclaimer-layout-check.mjs` has the same bug. **Also in this
pass, both from the Cloudflare item above:** allow the two RUM hosts in the CSP
and flip it out of Report-Only in the same edit, and add per-IP rate limiting to
`functions/api/_middleware.js`.

## HELD FOR WEATHER

**Watch DOLPHIN (12W) finish.** The `declared` end path has never fired on a real
storm. A real JTWC final warning proves it. If JTWC walks away mid-sequence as it
did with NOUL, build the JTWC-absence rule — a GDACS storm absent from a credible
JTWC index across `ENDED.absentConfirmations` clean polls, **gated on the storm
already being `silent`**. Detection is client-side; the app must be open.

**Surge (Phase 6 step 3) and wind arrival (step 4) are HELD FOR A STORM NEAR
HOME, not blocked.** Against a storm half a planet away there is no telling a
right answer from a plausible one. Surge is bands only (no watch/warning vector
product exists); wind arrival fetches layers 18/19 and never computes; the
at-home exposure timeline lands after both.

## SCOPED, NOT STARTED

**Multi-hazard expansion** — earthquakes, volcanoes, wildfire, flood, drought,
in that order. Full spec in `SPEC-HAZARDS.md`, payloads under `samples/`,
blockers in §26.

**No new layers until Landfall has been used during a real storm** — anything
added now is a guess about what will matter in September.

## KNOWN AND ACCEPTED

- **The LCP tail** — ~6% Poor, P99 8.6 s. Best leads: a Windows session with
  `longtask_ms` 27086, and an Android phone blocking 483 ms across 3 long tasks
  at startup. Pass 3 either moves this or proves it is something else.
- **`overallStatus` returns `ok`, not `clear`, when only ended storms are held.**
  Deliberate — `clear` would fire an all-clear while a grey dot sits on the globe.
- **Ended storms keep their track but not their wind swath.** Cosmetic; nobody
  has asked for it.
