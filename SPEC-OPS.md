# SPEC-OPS.md — Landfall hardening, scale, and the money question

**This is §17 of the Landfall spec.** What has to be true for a stranger to
arrive on a shared link during a landfall: honest framing, a locked front door,
no third party on the critical path, telemetry that respects them, and a cost
floor that cannot run away.

> **Rules for this file, same as every spec file in this repo.**
> **Not a log.** It describes the app as it is right now. When a fact goes stale,
> delete it and replace it. No "update:" notes, no history, no as-of dates on
> things that are simply true.
> **Not a decision tree.** Record the outcome, not the alternatives considered or
> the route taken to get there. Fences ("do not re-propose X") live in SPEC.md's
> SETTLED list, one line each.
> **Section numbers are permanent addresses.** ~950 code comments cite them.
> A section may move between files; it may never be renumbered.

`[DECIDE]` marks an open decision. `[VERIFY]` marks a fact we haven't tested.
Nothing marked `[VERIFY]` may be treated as confirmed.

---

## 17. Public operation

### The design case

A shared link during a Cat 4 landfall: thousands of strangers, most on phones,
most arriving in the same ten minutes, most of them frightened. Three properties
matter that did not matter for one user — and performance-and-feel still
overrides all three.

1. **Nobody can be misled.** A stranger has no idea this is a hobby project.
2. **Nothing gets billed into the ground**, and NOAA does not get a firehose
   pointed at it wearing our name.
3. **Aaron finds out it is broken from a notification, not from a stranger.**

### 17.1 The disclaimer

**Never let absence read as safety (§5), applied to the app itself.** Landfall
renders real hazard data next to real decisions; a missing disclaimer is that
failure one level up.

`ui/disclaimer.js` owns the wording as one frozen export, so no surface retypes
it. Plain language, no legalese (§1).

**==> IT SENDS THE READER TO THEIR OWN AGENCY, NOT TO OURS. <==** Changed
2026-08-20. Both sentences said *"always follow the National Hurricane
Center"*, which is the right instruction in Florida and the **wrong** one in
Manila, Brisbane or Réunion — NHC has no jurisdiction there, publishes nothing
about their storm, and following it instead of PAGASA is worse than no advice.
The app has been global since §50; this line had not caught up. It now reads
*"always follow your national weather agency and your local emergency
management."*

**"YOUR NATIONAL WEATHER AGENCY" BECAUSE IT RESOLVES ITSELF.** We cannot name
the right agency for an unknown reader — home is a point on a globe, not a
jurisdiction, and deriving one from it would be inventing authority. The reader
knows theirs.

**AND THE LINK IS LABELLED `National Hurricane Center (US)` FOR THE SAME
REASON.** The first-run strip and Settings render that label as a bare link
directly beneath the sentence. Unqualified it reads as an ANSWER to it — *here
is your national weather agency* — which is the one misreading that could send
somebody to the wrong forecast mid-storm. The two characters make it an example
belonging to one country.

**ON THE STORM PANEL THE LINK FOLLOWS THE STORM'S SOURCE AND IS NOT ALWAYS THE
NHC.** It was hardcoded, so a Philippine typhoon's footer offered a US agency
with no jurisdiction over it, publishing nothing about it — a live link pointing
somewhere confidently irrelevant, which is worse than a dead one. Aaron on glass
2026-08-20.

**AND THE FIX IS NOT "GUESS THE RIGHT AGENCY."** A storm's position is not a
jurisdiction any more than home is, and inventing one is how you send somebody
to the wrong forecast. So the link answers a different question, and one we can
actually answer: **where the numbers on this panel came from.** The sentence
above it already tells the reader to follow their own agency; the link stops
pretending to be that answer and becomes provenance. On an NHC storm the two
coincide, which is why the old behaviour read as correct for as long as it did.

`DISCLAIMER.sourceLink(source)` owns the table — NHC to `nhc.noaa.gov`, GDACS to
`gdacs.org`. **An unrecognised source returns `null` and the footer renders with
no link at all**: not a fallback to NHC, which is the bug, and not a guessed
third URL either. A link nobody verified is worse than none.
`tools/detail-disclaimer-check.mjs` still finds the NHC in the footer through
the label, on an NHC storm.

**THE TEST FOR ANY FUTURE EDIT, BOTH HALVES:** does the sentence stay true if a
source is added or dropped, and does it stay true for a reader anywhere on
Earth? The wording before each of these two corrections failed one of them.

Three surfaces:

- **First run** — a strip shown IMMEDIATELY, with **no dismiss X and no
  timeout**; the only way past it is the button. The home nudge is CHAINED
  BEHIND it (`ui/first-run.js`), not racing it. Same one-time guarded-localStorage
  mechanism as the other nudges — **not a new store** (§12's extract-on-third
  counter still stands at two).
- **Permanently, in Settings** — plus the sources, the privacy statement and the
  copyright line. Settings is where people already look for "what is this," it is
  where the install door lives, and it is reachable by tap, click and keyboard.
  **Not the credits pill:** it is a licensing surface — a list of who owns
  what — and a paragraph about what the app is for is a different kind of
  statement that would read as one more credit. (The reason recorded here used
  to be mechanical: the pill measured a single unwrapped line and a paragraph
  broke the measurement. That stopped being true on 2026-08-20 when the label
  was made to wrap. The decision stands on the first reason, which was always
  the better one.)
- **The storm detail panel footer** — `DISCLAIMER.short` plus a live link to
  whichever source this storm came from (above), rendered last in
  `ui/view-storm-detail.js`'s body, **including on the ghost form**, since a storm that has left the feed is exactly when a reader is
  most likely to be looking at something out of date. This is the highest-value
  placement of the three: the other two speak at the moment of ARRIVAL, this one
  at the moment of DECISION.

**It is a footer, not a pinned banner, and that is deliberate.** The stamp above
it is pinned while the body scrolls; two more lines up there cost reading height
on the phone that has the least of it, and would inherit the stamp's freshness
coloring (`fresh`/`aging`/`stale`/`silent`), which the disclaimer has nothing to
do with. Styled muted and rule-separated for the same reason: it is always true,
so it must never compete with the ghost note or the stale warning, both of which
mean *something is wrong right now*.

**Two regression guards, and they exist because the app's normal test harness
cannot see this screen.** `tools/detail-disclaimer-check.mjs` stubs
`/api/nhc/storms` with one synthetic major hurricane in NHC's own `activeStorms`
shape, then measures the footer at 375/390/430/768/1280 — present, says
"unofficial", names the NHC, non-zero height, inside the viewport, 44 px link
target, reachable by scrolling. Without the stub, `headless-check.mjs` reports
"0 storms" (the sandbox cannot reach NOAA), so every assertion about the busiest
screen in the app runs against an empty list.

**A test that only runs when a real hurricane exists is a test that does not
run.**

`tools/disclaimer-layout-check.mjs` asserts at six widths (375 → 1280) that the
acknowledge button is inside the panel, inside the viewport, horizontally
centred, and ≥44 px tall. The button is centred at **every** width — one rule,
one thing to verify.

**THE RULE THAT EARNED THAT CHECK: reusing a class for its LOOK inherits its
LAYOUT too.** `.nudge` carries `flex-wrap: wrap` and `justify-content: flex-end`
under `@media (max-width: 480px)`, which are correct for the ROW-shaped pill
nudges they were written for. The disclaimer strip borrows `.nudge` for its glass
styling but is a COLUMN, and on a column container `flex-wrap: wrap` sends
overflow into a NEW COLUMN BESIDE the first — the button left the panel entirely
at 390 px while looking perfect on desktop. Both properties are now stated
explicitly on `.nudge-disclaimer` with a comment saying why removing them breaks
it. Every flex property on a borrowed class has to be re-read against the new
axis.

### 17.2 The inspect routes are gated

`/api/nhc/inspect`, `/api/gdacs/inspect`, `/api/jtwc/inspect` and
`/api/imagery/inspect` stay deployed — they are the standing answer to "the
sandbox cannot reach the source." But an unauthenticated relay anyone can drive
is **an open proxy pointed at NOAA under our User-Agent**.

`functions/api/_inspect-guard.js` is imported by all four. The gate runs FIRST,
before parameter parsing and before any upstream fetch, so an unauthorised caller
never causes a request to NOAA. Refusal is **404, not 403** — a 403 advertises
that something is there. It **fails CLOSED** on a missing key: without
`INSPECT_KEY` the routes refuse everyone, including us.

### 17.3 No third party on the critical path

MapLibre and Three are **vendored** into `./vendor/`, version in the filename,
pulled from the npm tarballs. A CDN blip during a storm is a black screen for
anyone without a warm cache. `sw.js` treats `/vendor/` as cache-first; **no
cross-origin host is cache-first any more.**

This also made the headless checks work at all: the sandbox's egress proxy blocks
unpkg, so before vendoring the app never booted under test and every check
reported "no drawer header." **A dependency on a CDN was also a dependency for
every test that ever ran.**

**Two rules from the deploy where `.gitignore` silently ate all three vendored
files** — `git add -A` skipped them, the push reported success, and the deployed
site served an index.html referencing scripts that were not there:

1. **A deploy is not verified by a successful push.** Confirm the files exist in
   the remote tree — `git cat-file -e origin/main:<path>` per file — before
   calling anything deployed. A checklist of files you EXPECT to land catches a
   missing one; scanning `git status` for problems does not, because the evidence
   is an absence.
2. **Adding a path that application code loads means checking it is not
   ignored.** `git check-ignore -v <path>` costs one second. An ignore rule
   outlives the reason for it — `vendor/` meant "local scratch" for months and
   then meant "shipped code" without anyone editing the file.

**AND A CACHE-FIRST PATH TURNS A TRANSIENT 404 INTO A PERMANENT ONE.** While
`vendor/` was missing, Cloudflare Pages answered `/vendor/maplibre-gl-5.6.0.js`
with the **`index.html` fallback, as HTML, with `res.ok` TRUE**. The service
worker stored an HTML page under a `.js` filename and kept serving it after the
real file deployed, because the entire point of cache-first is never asking
again. Invisible from the server side, where everything measured healthy.

**`res.ok` DOES NOT MEAN `res` IS WHAT YOU ASKED FOR.** Any host with an SPA
fallback answers a missing asset with a 200 and a web page. `typeMatchesUrl()`
refuses an HTML response to a `.js`/`.css`/`.json`/`.png` request **on the way IN
and on the way OUT**, so an already-poisoned cache heals itself instead of
needing the new worker to activate first. Validate the kind, not just the status,
and validate it on read as well as write — or the fix only reaches devices that
were never broken. Bumping `VERSION` to drop every prior cache wholesale is the
documented hammer for a cache already poisoned.

### 17.4 `_headers` and the CSP

The `connect-src` list is built by reading actual fetch call sites and `ENDPOINT`
constants, never from memory. The non-CSP headers enforce immediately — they
cannot break a static map app.

**EVERY FILE THE BROWSER LOADS CARRIES AN EXPLICIT `Cache-Control`, AND THE
REASON IS A SAFETY ONE.** Three lifetimes, no fourth:

| What | Rule | Why |
|---|---|---|
| `/vendor/*` | `max-age=31536000, immutable` | version is in the filename, the URL can never mean something new |
| everything else we serve | `no-cache` | store it, but revalidate before use — an ETag makes that a 304 |

`no-cache` is not `no-store`. The file is still cached; it just cannot be used
without asking. The worker's own Cache API copy is what makes the app fast
offline and is untouched by this.

**WHAT THIS EXISTS TO PREVENT.** With no rule at all — the state this file was
in — a browser invents its own lifetime, and `sw.js`'s `networkFirst()` calls
plain `fetch()`, which consults the HTTP cache *before* the network. The worker
believed it had gone to the network while the browser answered from disk.
`index.html` was pinned fresh and was therefore free to import stale modules
underneath it. Seen live: a storm drawn grey and correctly ended in the list
while the globe drew her pink at full Cat-4 height — §9's two channels
disagreeing about a hurricane, arriving through the HTTP layer.

The fix is deliberately in **two places that do not depend on each other**: the
header binds a well-behaved cache, and `cache: 'no-cache'` on the worker's own
fetch binds the fetch regardless of the header. Either alone would work today;
together neither can be silently undone.

**A NEW TOP-LEVEL SOURCE DIRECTORY NEEDS A LINE IN `_headers`.** The rules are
listed by directory rather than as a `/*.js` glob so they can never reach into
`/vendor/*` and undo the immutable rule. Nothing validates the list, and the
symptom of forgetting is a module that silently goes stale.

**That is not hypothetical — `app/` proved it.** The directory was created after
this block was written, nobody added the line, and its five modules including
`app/views.js` (which owns every drawer view) shipped with no `Cache-Control` at
all until 2026-07-29. The mixed-version shape described above, in the
composition layer. `tools/load-probe.mjs` serves the real `_headers` and will
show a module answering with no cache instruction — but only if somebody looks.

**THE CSP IS ENFORCED.** It shipped Report-Only first, deliberately — a wrong
CSP does not degrade the app, it breaks it for everyone at once on the deploy
nobody is watching — and was flipped on 2026-07-29 after running clean.

**`node tools/csp-check.mjs` is what makes that claim checkable.** It parses the
policy out of `_headers` rather than carrying its own copy (a checker with its
own idea of the policy passes while the deploy fails), serves the app locally
under that exact policy ENFORCED, and fails on any `securitypolicyviolation`
across boot and all four drawer views at both widths. It runs offline, which is
also its limit: **no tiles, no storm data, no imagery**, so the two paths most
likely to reach an unlisted host are the two it cannot cover. A green tick means
the shell is clean, not that the app is.

**IF THIS POLICY EVER NEEDS CHANGING, GO BACK TO REPORT-ONLY FIRST.** The ladder
is: add the entry Report-Only, watch one clean session at both widths with a
storm selected and imagery on, then flip. Editing an enforced policy directly
skips the rung that exists to catch the mistake.

**==> A NEW PAGE UNDER `mockups/` MUST PUT ITS SCRIPT IN AN EXTERNAL `.js`
FILE, AND THE SYMPTOM OF FORGETTING LOOKS LIKE A DATA BUG. <==** `script-src`
is `'self'` plus ONE pinned hash — `index.html`'s own inline boot script — and
carries no `'unsafe-inline'`. An inline `<script>` on any other page is refused
by the live CSP. `style-src` DOES allow inline, so the page renders: the layout
draws, the controls draw, the chrome is styled, and every panel is empty. It
reads as "the data did not load" and it is nothing of the kind.

**IT HAS NOW HAPPENED TWICE, AND THE SECOND TIME IS THE FINDING.**
`mockups/environment-ribbon.html` hit it, was fixed, and wrote the warning into
its own file header. `mockups/seasons-wall.html` hit the identical wall on
2026-08-26 with that warning sitting in a sibling file nobody had reason to
open. **A rule recorded inside one artifact does not reach the next one** —
that is why it is here. Same-origin `.js` is permitted and needs no policy
change, so the fix is always the split, never a CSP edit.

**`node tools/mockup-csp-check.mjs` IS THE GATE, AND WRITING IT FOUND THREE
MORE DEAD PAGES.** It reads the policy out of this file, stamps it onto every
response, boots every `mockups/*.html` and fails on any violation — the dev
server sends no headers at all, which is precisely the blind spot that let this
ship twice. Its first run reported `home.html`, `home-round2.html` and
`home-corridor.html` as blocked: **all three had been dead on the deployed site
for as long as the CSP has been enforced, and nobody had noticed**, because a
mockup nobody opens fails silently forever. All six pass now. It needs
Playwright and a server on 8099, so it runs through `tools/with-server.sh` and
in CI's browser job rather than in the pre-push hook.

**NEVER EDIT THE CSP TO MAKE A MOCKUP WORK.** The fix is always the split.

**THE TWO CLOUDFLARE RUM HOSTS ARE ALLOWED, NOT BLOCKED** —
`static.cloudflareinsights.com` on `script-src`, `cloudflareinsights.com` on
`connect-src`. Cloudflare INJECTS its Web Analytics beacon into every response
and there is no dashboard switch to stop it (§3), so the choice was never
"beacon or no beacon" — it was "a beacon that works, or a CSP violation on every
single load". It also earns the entries: the Debug View names the exact ELEMENT
behind a slow interaction, which `lib/perf.js` cannot do at any price.

### 17.5 Telemetry

**Aaron cannot otherwise know the app is broken for anyone else.** Under public
traffic the app can be dead for an entire region and the first signal is somebody
complaining.

Built on **Cloudflare D1** — binds directly to the existing Pages Functions,
needs no entitlement, free plan, no new vendor. `claude/telemetry-d1-sink` in the
project notes is the reading guide; this section is the contract.

- `lib/telemetry.js` — `error`, `unhandledrejection`, and the signal that
  actually matters: **§5 state transitions.** A feed flipping to `unavailable`
  throws no exception anywhere, so a crash reporter would see a perfectly healthy
  app. Batched through `navigator.sendBeacon`, never blocks a frame, never throws
  — a telemetry module that can break the app is worse than none. main.js reports
  **transitions only, never the steady state**, so "nhc is still down" does not
  arrive every five minutes and bury the moment it broke.
- `functions/api/beacon.js` — strict allowlist of event types, hard length caps,
  silently drops everything else. Not an open write path. It chooses the sink;
  `functions/api/_telemetry-store.js` owns the D1 schema and writes, so a storage
  change never edits the file that enforces the privacy allowlist.
- `lib/perf.js` — browser timings plus the app's OWN milestones: `scripts` (the
  vendored MapLibre + Three have finished running), `globe` (map became
  touchable), `data` (a source left `loading`), `storms` (something painted).
  **The gaps split the blame — fcp→scripts is the browser digesting 1.5 MB of
  library, scripts→globe is us building the map, globe→data is the network,
  data→storms is ours.** `scripts` was added 2026-08-14 because fcp→globe was
  the largest stage of the load on every platform and one number spanning both
  halves could not choose between two unrelated fixes.
  Also **two separate blocked-time pairs and a duration**: `longtask_n`/`_ms`
  cover the WHOLE VISIT, `boot_longtask_n`/`_ms` stop at the last milestone, and
  `visit_ms` is the denominator for the first pair. **Never compare a
  whole-visit figure against a load timing** — doing so produces rows apparently
  reporting 74 seconds of freeze inside an 11-second load, which reads exactly
  like a broken counter and was read as one.
  Also worst interaction latency, connection quality, `ref_host` (the referring
  site name, hostname only — see §17.5's privacy contract below), and **WebGL
  context loss**, the standing hypothesis for the iPhone tail: Safari takes the
  context away under memory pressure and from outside it looks identical to
  "slow".
  **iOS reports zero blocked time on every row because Safari has no long-task
  observer at all.** That is "not measured", not "fast", and it has been misread
  as good news.
- `tools/test-recompute-budget.mjs` — **the counting harness.** Web Analytics
  says an interaction is slow; it cannot say what ran twice. This drives the
  real `registry.js` and the real layer files against a stub map that counts
  `querySourceFeatures` and `setData`, and holds the budget for a no-op pair
  push at **zero** of each. It also proves the coast memo decodes once per
  substrate generation, that `bandFor` short-circuits on an unchanged one, and
  that two asks for the same imagery URL make one request. **A cost this shape
  is invisible in review** — every individual call is defensible, and only the
  count is wrong — so it has to be asserted as a number or it comes back.
- `lib/usage.js` — plain counts. Storms opened, advisories read, layers toggled,
  retries. **Counts only** — no order, no timestamps, no arguments; never which
  storm, never which layer. A sequence with times attached is a behavioural
  fingerprint.
  **One exception, and it is a set rather than a sequence: `retry_which`.** Four
  Retry buttons share the single `retry` counter, so a press said only that
  something broke. The names of the buttons pressed — `storms`, `geometry`,
  `env`, `rain` — ride beside the count in one small text column, emitted in a
  fixed order so one answer cannot arrive as two. Presses go through
  `countRetry()`, never `count('retry')`. **A counter per button is the shape
  this deliberately is not**: that is a new column every time a Retry is added,
  and adding a fifth button here costs one word in two allowlists and no
  `ALTER TABLE`. `RETRY_BUTTONS` is written out by hand in `lib/usage.js` and
  again in `functions/api/beacon.js`, which cannot import each other;
  `tools/test-session-row.mjs` is what keeps the two in step.

**`lcp_ms` IS NOT STRUCTURALLY ZERO. THAT CLAIM WAS WRONG AND IT WAS LOAD-BEARING.**
This file used to say a WebGL canvas is not an LCP candidate and this app is
nothing but canvas above the fold, so no entry exists. Queried against D1 on
2026-07-29:

```
105 sessions   70 with a real lcp_ms   35 zero   min 77 ms   max 44,460 ms
```

Two thirds of sessions carry a value, and the largest is **forty-four seconds**.
The reasoning was wrong because the premise was wrong: there IS DOM above the
fold. `tools/load-probe.mjs` names the element Chrome actually picks —
`button#storm-pill`.

**IT IS STILL THE WRONG NUMBER TO CHASE, FOR THE OPPOSITE REASON.** That button
sits UNDER `#boot`, which is `position: fixed; inset: 0; z-index: 100` and
fully opaque. **Chrome's LCP algorithm does no occlusion test**, so it happily
reports an element nobody can see, at ~340 ms, while the screen shows a spinning
mark for seconds afterwards. Lab measurement on a 4x-throttled phone: LCP 340 ms,
boot veil actually lifting at **3,982 ms**. A 10x gap.

So `lcp_ms` is not absent, it is CONFIDENTLY WRONG — the §5 shape, arriving
through our own telemetry. Keep using `t_globe_ms` and `t_storms_ms`. The column
stays because it is one integer and dropping it costs a D1 migration for no gain.

**WHAT THE SAME QUERY SAYS ABOUT PLATFORMS, which matters more:**

| platform | n | avg lcp | max lcp | avg longtask | max t_globe |
|---|---|---|---|---|---|
| android | 35 | 542 ms | 1,596 ms | 418 ms | 5,878 ms |
| macos | 33 | 571 ms | 1,316 ms | 57 ms | 4,364 ms |
| **windows** | **26** | **4,389 ms** | **44,460 ms** | **1,917 ms** | **44,151 ms** |
| ios | 10 | 628 ms | 3,212 ms | 0 ms | 2,889 ms |

**Windows is the tail**, by an order of magnitude, on every column at once —
and `t_globe_ms` tracking `lcp_ms` to within 300 ms at the maximum says the
whole boot took 44 seconds, not that one metric misfired.

**AND iOS'S ZERO IS AN INSTRUMENTATION GAP, NOT GOOD NEWS.** All ten WebKit
sessions report `longtask_n = 0`: WebKit does not implement the `longtask`
PerformanceObserver at all. Reading that column as "iPhones never block" is
exactly the mistake this file exists to stop. Blink reports long tasks; WebKit
cannot.

One thing deliberately NOT explained: 32 of 93 Blink sessions also report zero
`lcp_ms`. No theory here is worth more than the measurement that would settle
it, so none is offered.

**ONE ROW PER VISIT, AND THE PHONE DOES THE ARITHMETIC.** Both modules accumulate
in memory and are read once, at the end of the visit. A visitor who taps two
hundred times is one row with bigger numbers. **The rule for anything added
later: if it can happen more than once, store an aggregate, never a list.**

**THE SUMMARY IS SENT ONCE, AT THE FIRST BACKGROUNDING.** `visibilitychange` →
hidden is the only end-of-visit signal mobile Safari reliably gives, and a phone
user backgrounds an app constantly; sending on every hide would inflate every
count, and with no session id those rows could never be collapsed. Load timings
are complete long before the first hide. **The cost: actions after the first
background are not counted, so usage numbers are a FLOOR, not a total.**

**THE DE-DUP KEY CONTAINS STATUS, AND THAT IS NOT OPTIONAL.** telemetry.js
collapses repeated events so one exception per frame is not six hundred reports.
The key must contain everything that makes two events DIFFERENT. Keyed on the
source name alone, `ok` and `unavailable` both collided with the `loading`
already queued and were discarded as repeats — **a dead feed reported as still
loading.** Any field added later that changes what an event means goes in the key.

**THE PRIVACY CONTRACT, AND IT IS ABSOLUTE. Home coordinates NEVER leave the
device.** Not exact, not coarsened, not rounded, not hashed, not bucketed into a
region. No IP retention beyond what Cloudflare does at the edge on its own. No
accounts, no name, no user identifier. **Any beacon field is guilty until proven
it cannot be joined back to a person.** Stated plainly in the settings drawer:
your location stays on your phone.

**GEOGRAPHY STOPS AT `country`, AND A US-STATE COLUMN WAS PROPOSED AND REFUSED
ON 2026-08-14.** After a forum post tripled the day's traffic, state was
suggested so the spike could be located. It is exactly the "bucketed into a
region" the paragraph above forbids, and the reason the rule is written down is
that a useful-seeming field is how a promise like this gets broken one column at
a time. Cloudflare hands `cf.region` to the edge for free, which is what makes
refusing it a decision rather than a limitation. **No city, no region, no colo,
no IP** — colo in particular looks harmless and is a near-neighbourhood in a
small country. Reversing this needs the same bar the `device` number cleared:
an explicit argument, in writing, signed off — not a commit.

**`ref_host` — THE REFERRING SITE NAME, AND IT IS NOT A LOCATION FIELD.** Added
2026-08-14 for the question state was refused for: where a traffic spike came
from. Before it, the 2026-08-14 arrival could only be inferred from the
phone-versus-laptop ratio, which is guesswork dressed as analysis and would have
been wrong had the same spike come from a newsletter. **Hostname only.** The
path and query are discarded on the device by `new URL(...).hostname` — a
referring URL's tail can carry search terms, thread titles, or a pasted token,
and `reddit.com` cannot. `beacon.js` then accepts it only if it still looks like
a hostname, **shape-checked and discarded rather than clipped**, because it is
the one free-form string on the row and clipping to 64 characters still stores
64 characters of anything. Same-origin and direct visits store the empty string,
which is the common case. It clears the bar because a site name is a property of
the LINK, identical for everyone who arrived the same way, and cannot be joined
back to a person.

**THERE IS ONE CROSS-VISIT IDENTIFIER, AND THE OLD "NONE" LINE IS RETIRED.**
`lib/device-id.js` mints 64 random bits once per browser, keeps them in
localStorage under `landfall.device`, and sends them in the beacon ENVELOPE.
Without it every `sessions` row was an island and the table could not tell 267
strangers from one person visiting 267 times — the only two questions it is ever
asked. It identifies a browser, it is invented rather than measured off the
hardware, it never touches `events` or `source_rollup`, and clearing site data
makes the device a new device. `functions/api/beacon.js` accepts exactly sixteen
lowercase hex characters and discards anything else, so the column cannot hold
caller text. **It is still personal data** and falls under the same honest note
and the same escape hatch as the device-characteristic columns below. Disclosed
to the user in the settings drawer alongside the home-location line.

The `sessions` row does carry device characteristics — screen size, pixel ratio,
device memory, core count, connection quality — added deliberately, because
without them there is no way to ask whether slow iPhones are simply OLD iPhones.
There is still **no user id, no name and no user agent string**; the
highest-entropy field of the lot was left out in favor of a six-value
`platform` bucket. The honest note: those five fields together are a device
fingerprint, and regulators generally treat a fingerprint as personal data even
with no name attached — as they do the `device` number above. **If this is ever
reversed, drop the five device columns and the `device` column, delete
`lib/device-id.js`, and the rest of the table stands on its own.**

**`timings_ok` DECIDES WHETHER A ROW IS A MEASUREMENT AT ALL — READ IT BEFORE
AVERAGING ANY MILLISECOND COLUMN.** `hidden_at_start` and `first_hidden_ms`
arrived as `ALTER TABLE ADD COLUMN` with a default of `0`, so every row written
before them reads exactly like a row that was checked and found clean. That is
§5's failure turned inward — an absence wearing a healthy answer's costume — and
on 2026-08-05 it produced a confident, wrong platform comparison drawn entirely
from unchecked rows. Validity is therefore one column with three values, derived
in `beacon.js` and never sent by the client: **0 unknown** (pre-flag, exclude
from timings), **1 clean** (the page was visible for the whole boot), **2
interrupted** (hidden before the boot finished, or no milestone reached at all
— the clock lied, the visit still counts). **A hide AFTER the boot finished is
not an interruption:** the hide is how a visit ends on a phone, so a rule that
invalidated any hide at all left only desktop tabs and produced a second wrong
platform reading inside the same hour. The comparison is against the last
milestone the boot reached. Historical rows were backfilled; the 193 written
before 2026-07-31 are `0` and stay that way. **Usage analysis uses all three.
Timing analysis uses `timings_ok = 1` and nothing else.**

**AND A FLAT SIXTY-SECOND CEILING UNDERNEATH THE VISIBILITY RULE, added
2026-08-14.** The rule above is sound and catches what it was built for. It
cannot catch a phone whose **screen locks mid-load**: iOS does not reliably fire
`visibilitychange` for a lock, so `hidden_at_start` and `first_hidden_ms` both
read `0` and the row looks pristine while the clock ran in a pocket. A real iOS
row recorded **368 seconds to first paint** and was stored as clean; one such row
moves a platform average on its own. So a second, blunter test sits under the
clever one — no honest boot takes longer than a minute. It cannot say WHY the
clock is wrong and does not need to; its job is to stop an impossible number
being stored as a fact. Sized above the slowest genuine load in the table (35 s,
2G Android) and well below the screen locks. **Deliberately not the same
constant as the anti-abuse clamp**, which is measured in hours and answers a
different question.

**THE PRIVACY CONTRACT IS ENFORCED BY A TEST, NOT BY A COMMENT.**
`tools/privacy-check.mjs` sets a real home, forces each event kind, intercepts
every `/api/beacon` POST and **parses** each payload, walking every numeric value
and failing on anything within a degree of home. It does not pattern-match:
regexes flagged `"30"` — the truncated latitude — which was really `(:311:30)`,
the line:column of a stack frame, and **no amount of pattern sharpening separates
a JSON number from a number inside a string.** Parsing is both correct and a
stronger assertion than any list of rounded forms somebody thought to write down.

**Sampling.** `TELEMETRY.sampleRate` is 1.0 — every visit reports. The numbers:
D1's free tier is 100,000 rows written/day and "rows written" counts index
updates, so on this schema a `sessions` insert costs 4 and a `source_rollup`
upsert about 2 — a visit is `1×4 + 4×2 ≈ 12 rows`. A 386-visit day is ~4,600
rows, under 5% of budget; **the ceiling is roughly 8,300 visits/day.**

**The flood case is not errors, it is state transitions, and they are GLOBAL.**
An error is per-session and rare. When NHC flips to `unavailable`, every session
on the site reports it within one `visibilitychange`: five thousand readers, five
thousand beacons, one fact. `source_rollup` is a COUNTER, not a log — a per-minute
row keyed by source, status, app, country, standalone and reason — so that becomes
a handful of rows with a big `n`, which is also the more useful answer.

**HONEST LIMIT: the rollup bounds STORAGE and QUERY COST, not the write quota.**
An upsert is still a row written. **`sampleRate` is the only lever on write
volume.** If sustained traffic passes a few thousand a day, drop it to 0.25;
0.05 is the floor worth having.

Without a `TELEMETRY_DB` binding the console fallback applies and is a supported
state, not a fault. It loses history, which is exactly what D1 buys back.

### 17.6 The app has a failure state for its own boot

`ui/boot-failure.js`. §5 is enforced for every feed, every layer and every async
surface, and the one place it must not be missing is startup: a dead feed still
leaves an app that can explain the dead feed; a dead boot leaves a black screen,
and a stranger who followed a shared link during a storm cannot tell whether the
problem is them, their browser, or the site.

- `hasWebGL()` runs BEFORE boot, so the likeliest cause is NAMED rather than
  surfacing as an opaque throw from inside MapLibre. Both engines need a context
  — MapLibre renders the map on WebGL and Three draws the clear globe — and
  **Brave on Android refuses one under fingerprinting protection** while the
  identical build runs fine on macOS and iOS. `boot()` is additionally wrapped,
  so an unknown failure still gets a screen.
- **It names a cause only when it detects one.** A wrong diagnosis sends someone
  to change a setting that was not the problem — worse than "something went
  wrong", because it costs time and trust.
- **It imports NOTHING, not even tokens.** It runs when the app has failed, so it
  cannot depend on anything that might be part of the failure (`applyTokens()`
  may be what never ran). Its handful of literal colors are the ONE sanctioned
  exception to §9's zero-hardcoded-hex rule.
- 44 px target and a real focus ring on retry: §10 applies to the failure screen
  exactly as much as to the app.
- The real error goes to `console.error` and is never rendered — people get human
  language (§5), but discarding it would make a genuine bug undebuggable.

**An app that enforces honest failure states everywhere except its own startup
has not enforced them.**

### 17.7 The origin collapse — one fetch per feed, globally

**`caches.default` is PER-DATACENTER.** Cloudflare has 300+ colos, so
`s-maxage=300` never meant "NOAA is fetched once per five minutes" — it meant up
to ~300 times per five minutes, at any traffic level. It also means the first
visitor in every region eats a full round-trip to NOAA: exactly the person
arriving on a shared link during a storm.

**As built: one cron Worker fetches each feed once globally into KV; Pages
Functions read KV.** Every relay route reads **L1** `caches.default` (per-colo,
free) → **L2** KV (global, warmed) → **L3** upstream. On failure: colo last-good →
the KV copy it declined as unfresh, flagged stale → an honest 502.

**L3 IS NOT A FALLBACK, IT IS WHY THIS IS SAFE.** Every route keeps its original
upstream path intact. Missing binding, empty namespace, Worker never deployed,
cron dead for three days — each degrades to **exactly pre-collapse behaviour**
rather than going dark. A Worker outage is a performance regression, not an
outage.

**CORS-open is a permission, not a capacity plan.** The reason to relay a feed is
whichever arrives first: the browser can't reach it, or we can't responsibly
point a crowd at it. `ENDPOINT` in `config/constants.js` was organised around
"CORS-blocked vs CORS-OK" for months, which is the wrong axis — and it hid the
fact that GDACS's event list and NOAA's MapServer (one metadata call plus nine
layer queries **per storm, per reader**) were being fetched straight from the
browser. Both now go through `functions/api/gdacs/events.js` and
`functions/api/nhc/mapserver.js`, forward-and-cache only, with every field rule
still running client-side.

- **The MapServer route builds the WHERE clause itself** rather than accepting
  one. It takes a validated bin number, exactly as `advisory.js` takes a bin.
  Accepting a caller's `where` string would make it an arbitrary query proxy into
  a federal service — 17.2's open-proxy problem on a bigger endpoint.
- **It forwards ArcGIS's 200-with-error verbatim and refuses to cache it**, so
  the client can mark that layer `unavailable` rather than empty. Converting it
  to a 502 would erase the distinction between a layer that failed and a layer
  with nothing in it (§5).

**Cron triggers do not work on Pages Functions**, so the warm loop is a small
standalone Worker beside the Pages project, both binding the same KV namespace.
**Do not migrate Pages to Workers for this** — that risks a deployment that
currently works, for one feature. Being a separate deploy is a safety property:
a broken build in `worker/` fails only `worker/`.

**===> IT WARMS BY FETCHING OUR OWN RELAY ROUTES, NOT THE UPSTREAM SOURCES. <===**
Two routes do not forward their upstream verbatim: `/api/jtwc/storms` builds a
name lookup from the RSS plus every warning product, and `/api/nhc/adeck` filters
a multi-megabyte deck to the five-model shortlist. A Worker fetching upstream
directly would need a second copy of both, in a runtime that renders nothing,
across a deploy boundary where drift is invisible. Calling our own routes means
**one implementation of every parse**, and what lands in KV is byte-identical to
what the route would have served.

**Pages Functions NEVER write to KV.** One writer, always. If a Function wrote
its upstream result back, 300 colos would each write the same key and the write
storm is rebuilt with a bill attached. There is no `kvWrite` in
`functions/api/_kv-cache.js` on purpose. That rule is what makes the write budget
a number you can calculate in advance instead of a function of traffic.

**Write-if-changed decides what the WRITE MEANS, not whether one happens.** The
hash lives in each key's KV **metadata**, and `list()` returns every key's
metadata without any of their values — so one list call per cycle yields every
previous hash and stamp without reading back a single 400 kB geometry blob.
Steady state is twelve keys re-stamped per cycle, of which zero are content
changes on a quiet day.

**==> EVERY KEY IS WRITTEN WITH A 48-HOUR `expirationTtl`, AND WITHOUT IT THE
NAMESPACE ONLY EVER GROWS. <==** Measured 2026-08-07: **184 keys, the oldest
12.3 days stale**, belonging to storms that had ended weeks earlier — against a
budget written for twelve. GDACS numbers geometry per *advisory*
(`episodeid=31` on one event), so a storm running thirty-one advisories leaves
thirty-one keys behind. `loadHashes()` then pages all of them, 288 times a day,
forever. **The expiry costs the live data nothing**: anything still being derived
is rewritten every cycle, which resets its clock, so only keys nothing derives
any more age out. Zero delete calls and no cleanup job. **Why 48 and not 9:**
nine hours is the longest window any route will still *use* a KV copy for
(`STALE_SECONDS`), so everything past it is already declined — the only thing a
longer number buys is surviving a dead cron, and a drained namespace is not an
outage, it is L3 doing its job. `KEY_TTL_SECONDS` in `worker/src/kv.js`.

**==> ONE STAMP, AND IT IS REFRESHED EVERY CYCLE WHETHER THE BYTES MOVED OR
NOT. <==** `fetchedAt` means **when did we last reach upstream** — never "when
did this content change". Three things ask exactly that question and all three
read this one field: `kvRead`, deciding whether the warm copy is current; the
route, which forwards it as `X-Landfall-Fetched-At`; and `ui/status.js`, which
says "feed delayed" past `RELAY_AGE.delayedAfter`.

**Refreshing it only on a content change is the wrong ruler and it fails in both
directions.** A 6-hourly advisory against a 5-minute window is judged stale ~98%
of the time, so every route declines the warm copy and every colo goes to the
origin twice an hour — the exact load Pass B exists to delete. And a quiet
ocean's `{"activeStorms":[]}` never changes at all, so the stamp freezes and
reaches the client looking like ~72 consecutive failed refreshes, putting a
"feed delayed" banner over a perfectly healthy relay. **Crying wolf is not the
safe direction to fail:** a strip that shouts at nothing is a strip people learn
to ignore, which costs the one outage it exists for.

**==> A ROUTE NEVER HANDS BACK A STORED CACHE ENTRY VERBATIM. IT REBUILDS THE
RESPONSE. <==** The slot Responses carry `Cache-Control: s-maxage=…` so
`caches.default` knows how long to keep them; returning one unchanged publishes
that directive to the public internet, and **Cloudflare's edge honours it** —
measured live, `Cf-Cache-Status: HIT` on a URL the browser had never requested,
serving a four-day-old stamp for a further half hour *after* the fix for it had
deployed. **The client cannot escape it either:** a request sending both
`Cache-Control: no-cache` and `Pragma: no-cache` still got a 24-minute-old HIT,
because Cloudflare's edge ignores request-side no-cache. `data/relay.js`'s
`cache: 'no-store'` binds the browser and nothing past it.

It matters even when nothing is broken, because the clocks **stack**: KV is
judged fresh up to `FRESH_SECONDS` old, that already-aged stamp is then copied
onto a slot with a *new* `FRESH_SECONDS` lifetime, and the edge added a third.
30 + 30 + 30 is exactly `RELAY_AGE.delayedAfter`, so the app could cry "feed
delayed" in normal operation with every layer healthy. Rebuilding removes the
third clock and puts the ceiling at 60 minutes. **As built on every relay route;
`tools/test-relay-fallback.mjs` asserts it on all seven in its table with no
exemptions.** `tcgp/storms` leaked on its *upstream* path too — it built one
Response carrying `s-maxage`, cached a clone and served the original — so the
stored copy and the served copy are now built separately everywhere.

**==> THREE ROUTES PUBLISH A CACHE DIRECTIVE ON PURPOSE, AND THE TEST THAT
DECIDES IT IS ONE QUESTION: DOES THE ANSWER CHANGE ON ITS OWN OVER TIME? <==**
`/api/geocode` (an address resolves to the same point next month, which is why
its window is thirty days) and the two `/api/imagery/` routes (a radar or
satellite frame is the same frame for everyone who asks inside its window).
There is no staleness for the edge to hold, and an edge hit costs no Mapbox
lookup and no NOAA request. **The imagery routes could not be converted anyway:**
they carry PNG bytes, and rebuilding — one `text()` on a data route — would
decode binary as UTF-8 and corrupt the image. Their directive is also
`public, max-age=…`, written for the browser, not the `s-maxage` written for the
cache slot. **Do not "fix" these three.** For a storm, an advisory or a radar
*timestamp*, the answer to that question is yes and the edge must not hold it.

**The five layer names live in `functions/api/_cache-path.js` and nowhere else.**
Twelve routes had been about to grow twelve private copies of the same five
strings, which is twelve chances for one to say `last_good` and for a header read
to quietly stop matching. Routes with no KV behind them simply never emit `kv` or
`kv-stale`.

**Every relay response says WHICH layer answered.** `X-Landfall-Cache` is one of
`fresh` (this colo's slot), `kv` (the warm copy inside its window), `last-good`
(the 9-hour slot, refreshing behind the response), `kv-stale` (the warm copy
declined as too old but served anyway, §5) or `upstream` (a real fetch just
happened). `X-Landfall-Fetched-At` says *when* a copy was pulled and never
*where* it came from, and an hour-old stamp is routine off one path and alarming
off another — every diagnosis of these routes before this header was an
inference about which branch had run.

**`GET /api/nhc/inspect?warm=1` is the warm store's one readable surface**
(gated like every inspect route, §17.2): whether `LANDFALL_CACHE` is bound *on
the Pages project*, then **one row per route family** with a count and its
oldest and newest stamp, against the 30-minute fresh window and the 90-minute
banner threshold. **Grouped, not listed, because this is read on a phone while
something is going wrong** — one family can hold hundreds of keys whose names are
300-character encoded URLs. `&all=1` adds every individual key for the rarer
question. `staleOverTtl` should read **zero**; anything else means keys are being
written without an expiry, or by something that is not the cron. **A cron summary
cannot answer this** — every route short-circuits the KV read on a warm request,
so a perfectly healthy cycle proves the write side and says nothing about the
read side. It costs one `list()` call and reads back no values.

**§5 is still enforced — it is the FETCH failing, not the bytes sitting still.**
A source that has stopped updating must not read as a source that is fine, and
it cannot: if the cron cannot reach a route, nothing re-stamps, the entry ages
out of every window, and the routes go upstream themselves. **A calm ocean is
not an outage**, and a stamp that only moved on change could not tell those two
apart. **A KV entry with no `fetchedAt` is treated as STALE, never fresh** — an
unstamped value cannot be aged, and defaulting an unknown age to "current" is
absence read as safety.

**==> THERE IS NO SECOND "WHEN DID THE CONTENT CHANGE" STAMP, AND ONE WAS
BUILT AND REMOVED THE SAME DAY. <==** It had no reader: storm age comes from the
storm's own `lastUpdate` field, not from this namespace, and the `written` count
already records that a change happened, with a timestamp, in the Workers Logs.
Building it also broke the field that *does* have readers — the half-finished
version routed `X-Landfall-Fetched-At` at content-change time and produced the
false-delay banner above. **A field nobody reads is the `X-Landfall-Empty`
mistake with a bill attached.** Do not reintroduce it without naming the reader
first.

**The write budget is now key-count × cron cadence, not weather.** About 3,500
writes/day at twelve steady-state keys on a five-minute cron, and roughly 9,000
in a busy season. **The account is on the $5/month Workers Paid plan — 1M
writes/month, about 33,000/day — so this runs at under a third of the allowance
at peak.** It would NOT fit the free tier's 1,000/day, which is worth knowing
before anyone adds keys or shortens the cron: both multiply this number
directly. That headroom is the price of the shared store being read instead of
paid for and bypassed. The `written` / `restamped` split in the cycle summary is
what keeps the old signal: `written` still counts real content changes, so the
log still answers "how much weather happened".

**Two list feeds have never benefited from write-if-changed and never will.**
`/api/jtwc/storms` and `/api/tcgp/storms` put their own `fetchedAt` **inside the
JSON body**, so their bytes differ every cycle. They were already writing on
every cycle before the two-stamp change, and they were the only two keys that
never went falsely stale.

**`kvRead` fails OPEN and `isWarmRequest` fails CLOSED**, in the same file, on
purpose: a missing cache binding must cost a user nothing, and a missing gate
must not hand a bypass to everyone. **A cache is a convenience; a gate is a
gate.**

**The warm-bypass header is gated on `WARM_KEY`.** Without the bypass the
Worker's request is ordinary — the route answers from the KV copy the *previous*
cycle wrote, the Worker stores what it already stored, and the loop confirms its
own last answer forever while never contacting the source again, with every
dashboard green. At a 5-minute cron against a 5-minute fresh window that is the
boundary every cycle lands on. It needs a secret because **an ungated cache
bypass is a lever any stranger pulls to drive uncached traffic through us at
NOAA, at whatever rate they like, under our User-Agent.**

**The genesis outlook is warmed with two keys and a gate, and it is the only
entry that can refuse its own write.** `nhc/genesis/areas` holds what NHC's
outlook layer last said, including a genuine all-clear; `nhc/genesis/areas/last-good`
holds the last answer that actually had areas in it. The second one is the
memory that decides whether an empty layer is an all-clear or an outage
(§45.5), and it is warmed **because a per-colo memory is empty in the colo that
matters**. Measured 2026-08-11: the held branch shipped at 02:48Z and at 04:26Z
the relay still served a false all-clear, because that datacentre had never seen
a real answer and so had nothing to hold.

**Neither key is written while the route is holding, and that absence IS the
clock.** `worker/src/kv.js` re-stamps `fetchedAt` every cycle, changed bytes or
not. A held body written back would therefore restamp its own age every five
minutes: it would never grow older, `HELD_SECONDS` would never elapse, and the
outlook would freeze on its last real answer permanently — with every count in
the cycle summary reading healthy. The route states `X-Landfall-Held` and
`X-Landfall-Genesis-Areas` on the wire and the writer's gate reads those, so the
judgement of what counts as a good answer stays in the one file that owns it.
Withheld paths are **named** in the summary (`withheldPaths`), for the same
reason `skippedPaths` and `failures` are: a cycle that quietly stopped writing
one key looks exactly like a cycle that worked.

**Deliberately NOT warmed, so nobody "finishes" the list later:**
`/api/nhc/mapserver` — its keys are the output of §4's block math plus a
resolve-by-name pass, and warming it needs that arithmetic in a second copy,
where drift points a confident cone at the wrong storm (§7's
wrong-but-plausible-layer failure). Also `/api/imagery/radar` and `/api/geocode`
(no finite key set) and the four `/inspect` routes. Colo caching already took
MapServer from per-reader to per-colo, which was the ~30× that mattered. If the
last 300× is ever worth it, the honest way is to have the Worker call the route
rather than reimplement it.

**Two verification rules that cost real time to learn:**

- **READ `reachedSource`, NOT `ok`.** With a mismatched `WARM_KEY` the routes
  still answer 200, the Worker stores what it already stored, and `ok: true`,
  `failed: 0`, `restamped: 12` all read healthy while no source is ever contacted
  again. `X-Landfall-Fetched-At` tells the two apart for free — stamped NOW on an
  upstream fetch, carrying the old stamp when served from KV — and the summary
  leads with a plain `BYPASS REFUSED` warning naming the affected routes.
  **`bypassUnknown: 2` is expected, not a fault** — `/api/jtwc/storms` and
  `/api/tcgp/storms` carry their `fetchedAt` in the JSON body rather than a
  header, so there is nothing for the detector to read.
- **EVERY BAD OUTCOME IN THE SUMMARY IS NAMED, NOT JUST COUNTED.** `failures`
  names what threw, `servedFromCache` names what refused the bypass, and
  `skippedPaths` names what answered 200 with an empty body and was therefore
  refused storage. A skip is the quiet one: that key keeps whatever it held last
  and stops tracking the world, so `skipped: 1` across nineteen keys is a number
  nobody can act on — the §5 silence problem one level up, where the cycle reads
  healthy and one feed is dark. The derived cap logs its own line when it trips,
  for the same reason.
- **A binding name typo does not throw.** It resolves to `undefined`, `kvRead`
  returns null forever, every route quietly falls through to upstream, and the
  whole pass deploys successfully and does nothing. `LANDFALL_CACHE` is spelled
  identically in `wrangler.toml`, `functions/api/_kv-cache.js` and
  `worker/src/index.js`, and `tools/test-kv-keys.mjs` asserts all three agree.
- **`tools/test-kv-keys.mjs` also caught the writer validating the GDACS host
  with `startsWith()` on the raw string while the route checked `u.hostname` on
  the parsed URL.** They disagree on `:443`. **Parse first, then judge the parsed
  parts. Never judge the string.**

**The checker was skipping the two most-imported files under `functions/`.** In
this project a leading `_` has always meant "scratch, not shipped"; in Cloudflare
Pages Functions it means "**not a route**" — a shared module the real routes
import. Worse than a parse gap: the link pass does `if (!known) continue`, so
every named import from those files was unverified too, and a typo'd `kvRead`
would have printed a green tick and blanked the relay. The collector is now
directory-aware. **Verify the verifier, then verify what the verifier skips.**

**One admitted tension with §2's no-build-step rule.** `worker/` has a
`package.json` and a wrangler dependency. A Worker with a cron trigger cannot be
deployed from a static repo, and authoring it in the dashboard would put shipped
code outside git. The toolchain is confined to that one folder, the app still has
none, and `worker/src/` has zero runtime dependencies.

**Still true:** NHC and GDACS are public-good endpoints, and pointing real traffic
at them through a proxy is a different relationship than one person polling for
himself. Cache hard, keep the honest User-Agent, and **never let a client-side bug
become a poll storm** — the origin collapse makes that structurally impossible
upstream, which is half its value. Storm-name glyphs and basemap tiles both come
from OpenFreeMap (§11), so the map is third-party end to end by choice;
self-hosting fonts only matters if the whole basemap moves.

### 17.8 The Cloudflare setup, recorded so it can be rebuilt

1. **KV namespace `LANDFALL_CACHE`**, id in `worker/wrangler.toml`. The id is a
   resource identifier, not a credential — it grants nothing without an API token
   on the account, so it belongs in the repo. `WARM_KEY` and `MAPBOX_TOKEN` are
   credentials and live in Cloudflare only.
2. **Worker `landfall-warm`** (`*/5 * * * *`) via Workers Builds, git-integrated
   to this repo with **root directory `/worker`**. `git push` deploys it, same
   loop as Pages. Cloudflare labels that field **"Path"**, under Advanced
   settings — it is not called root directory anywhere in the form.

   **Its `[observability]` block is in `wrangler.toml`, NOT the dashboard
   toggle.** Both exist and do the same thing, but Workers Builds deploys by
   applying that file, so a setting absent from it resets to default on the next
   push — the dashboard toggle survives until the next `git push` and then
   silently switches off, taking with it the logs you would use to notice.
   `console.log` reaches the REAL-TIME stream regardless and always has; the
   persisted copy is what makes a five-minute unattended cron readable after
   the fact instead of only while somebody watches.
3. **`WARM_KEY`** as a secret on the Worker AND an environment variable on the
   Pages project. Both sides, same value.
4. **KV binding `LANDFALL_CACHE`** on the Pages project.
5. **`INSPECT_KEY`** — any long random string. Until it exists the four inspect
   routes 404 for everybody; after it exists they are reached with `?key=<value>`.
6. **D1 binding `TELEMETRY_DB`** → database `landfall-telemetry`. Production AND
   Preview. Optional and safe to defer; verify with
   `GET /api/beacon?key=<INSPECT_KEY>`, which reports `sink: "d1"` once it
   resolves.

**BINDINGS ARE SET IN THE PAGES DASHBOARD, NOT IN `wrangler.toml`** (SETTLED,
SPEC.md). Cloudflare's own safe migration path, if it ever has to happen, is
`wrangler pages download config` first.

**A binding only applies to NEW builds.** Adding one does nothing to an
already-built deployment; force a rebuild afterwards. An empty commit works.

**ADDING A BINDING IS A DEPLOY-PIPELINE CHANGE, NOT AN ADDITIVE ONE.** Pages
Functions publish as a **single Worker**, so one binding that cannot resolve fails
the whole deploy — storm feeds, geometry relay, geocoder, everything. An Analytics
Engine binding is the worked example (SETTLED, SPEC.md): it silently blocked every
deploy for five commits. **THE RULE THIS SETTLES: Landfall's ability to ship
a fix during a storm must never depend on a diagnostics feature.** Optional,
always.

**A pricing page answers what something COSTS, never whether you can turn it on.
A platform feature's availability is a property of YOUR account, not of the
product.** Check the dashboard before writing an instruction that assumes a
feature exists.

**When a push does not appear on the site, READ THE BUILD LOG FIRST** — not the
caches, not the git state, not the integration. It is one screen and it names the
error outright. And **compare what the SITE serves against what the REPO holds,
never against what you pushed**: a successful `git push` says nothing about what
is deployed, and one fetch against the live app kills every client-side theory at
once.

**Deleting the code that reads a secret does not retire the SECRET, and deleting
a Cloudflare variable does not revoke the token it holds.** Three separate
actions. **Scope a throwaway credential with an expiry and the cleanup you forget
stops mattering.**

### 17.9 Money, and the two things that can bill

**KV writes.** Free tier is 1,000/day. The three list feeds alone on a 5-minute
cron are 864/day before a single storm exists, and change-detection does not help
them much because a list feed's own timestamp moves. Realistic across a busy
season is **~1,200–1,500/day** — an estimate that is only meaningful because
`KEY_TTL_SECONDS` bounds the key count; without an expiry the namespace grows
without limit and every projection here goes stale on its own. So expect the
**$5/mo Workers Paid plan**
(1M writes/month). That $5 is the cheapest possible insurance against the
invocation spike this whole design exists to prevent. **Decide it before the
storm, not during it.**

**Mapbox geocoding, and there is no spend cap underneath it.** Mapbox accounts do
not support a spending cap, a usage limit that cuts service off, or configurable
usage alerts. **Past the free tier, service does not stop — billing begins.** The
only automatic signal is a courtesy email the first time usage exceeds the free
tier in a cycle. So the in-code limiter is not the first line of defence with a
backstop behind it; it is the only line.

Sized rather than feared: temporary geocoding is free to 100,000 requests/month,
then $0.75 per 1,000. Setting a home address costs 3–8 requests (debounced at
250 ms, 3-character minimum) and many people never set one — geolocation and
drop-a-pin are free paths. **The exposure is deliberate abuse, not success.**

- **`functions/api/geocode.js` checks its 30-day result cache BEFORE the rate
  limiter**, so the limiter counts **billable** lookups instead of requests. The
  other order charges a caller for a lookup that never touched Mapbox — worst for
  everyone behind one mobile carrier's NAT, who share a single `CF-Connecting-IP`
  and would collect 429s during exactly the traffic spike this exists for. That
  reorder is what made the cap affordable at 15/min/IP.
- **The per-colo undercount is an AGGREGATE undercount.** One abuser's requests
  land in one or two colos, so per-IP counting works close to as intended against
  a single attacker, which is the threat this was ever for. A Durable Object
  would fix the distributed case and is not worth building.
- **THE EMERGENCY LEVER: delete `MAPBOX_TOKEN` from the Pages environment
  variables.** Address search degrades to `geocode_not_configured`, a handled
  state with its own honest message, and both other ways to set a home keep
  working. A 30-second kill switch for the only endpoint on the site that bills.

**RATE LIMITING IS IN CODE, IN `functions/api/_middleware.js`.** Pages runs it
in front of every `/api/` route: 120 requests per minute per IP, counted in
`caches.default`, refusing with the app's own `{error: 'rate_limited'}` shape
plus `Retry-After` so `data/relay.js` sees a failure it understands instead of a
generic 429 page. `data/relay.js` treats 429 as the one RETRYABLE 4xx —
everything else in that range means "no data", but this one means "ask again
shortly", and our own relay now issues them.

**It is NOT the Workers rate-limit binding, which is not supported for Pages
Functions** (checked against Cloudflare's own supported-bindings list: KV, D1,
R2, Durable Objects, Hyperdrive, Vectorize, Analytics Engine, service bindings,
env vars — no rate limiting). The counter is the one `functions/api/geocode.js`
already used to protect the Mapbox bill, extracted to `_rate-limit.js` so there
is one implementation rather than two that drift. **It is per-colo and
approximate** — read that file's header before trusting it as a global limit,
because it is not one.

**WAF rate limiting rules are not available on this project and cannot be turned
on.** They are created per zone, and `getgravitate.app` is not a Cloudflare zone
(§3) — the domain is registered at Namecheap and `landfall` reaches Pages by a
CNAME. The account holds the Pages project, the Worker, KV and R2, and no domains
at all. Getting the rules means moving the nameservers to Cloudflare, which means
recreating every DNS record for a domain whose apex serves a separate, unrelated
site — and the free tier buys exactly ONE rule, IP-only, on a fixed 10-second
window. Wrong trade.

### 17.10 Push notifications are the one v2 feature that needs server state

"A storm is tracking toward your home" is probably the feature that earns a
permanent home-screen slot. **Web Push works natively** — Chrome/Android, and
iOS 16.4+ for PWAs installed to the home screen (confirm the current iOS
constraint when it is built, not from memory) — and can be sent straight from a
Cloudflare Worker. No third-party push vendor is needed.

It requires storing push subscriptions server-side, which is the one place
per-user server state is genuinely justified. **It is a deliberate §2 amendment,
decided in the open, not a side effect of a build.**

### 17.11 The PWA — service worker, icons, and the install door

`manifest.webmanifest` (standalone, dark, `id`/`start_url`/`scope` all `./`),
`sw.js`, and `pwa.js` (registration after `load`, in its own file — main.js is
wiring only), plus the apple-\* metas and a black-translucent status bar in
`index.html`.

**APP CODE IS NETWORK-FIRST, NOT STALE-WHILE-REVALIDATE.** SWR would serve the
OLD copy first on every load, which on a push-then-check-the-phone loop
guarantees "pushed the fix, phone still shows the bug" on every single deploy.
Network-first costs nothing while online and falls back to cache offline. SWR's
spirit survives only where it is safe: `/vendor/` and `/seasons/data/` are
cache-first because a version-pinned local file cannot mean something new
(17.3). The season files carry NOAA's revision stamp in the filename, so they
qualify on identical grounds (§58.4) — and without that entry they fell into
network-first, which fetches `cache: 'no-cache'` and would have forced a
revalidation round trip on files `_headers` had just declared immutable for a
year. **The worker silently overriding the header is the failure shape to watch
for whenever a path is added to either file and not the other.**

**EVERY CACHE-FIRST PATH MUST HAVE ITS FILE EXTENSION IN `typeMatchesUrl()`.**
Cache-first is what turns a transient 404 into a permanent one — Cloudflare
Pages answers a missing file with `index.html` at 200, and a path that never
asks twice will serve that page forever. `txt` was added alongside
`/seasons/data/`; a season file poisoned this way is worse than the vendor case
that prompted the guard, because there is no MIME error, just a parser finding
no storms and an archive that looks EMPTY rather than broken. Asserted by
`tools/test-sw-routing.mjs`, which runs the real `sw.js` in a VM and fails when
a cache-first path has no guarded sample.

**DATA IS NEVER TOUCHED BY THE WORKER.** `/api/`, NOAA, GDACS, OpenFreeMap tiles
and fonts all pass straight through. Freshness, staleness banding and §5's state
distinctions belong to `data/store.js`; a cache below it cannot tell "stale but
honest" from "stale and lying". `/tiles/` is excluded too, so a revived R2 proxy
cannot silently grow unbounded cache quota.

**NO PRECACHED FILE LIST.** With no build step a hand-maintained module list WILL
go stale. The runtime cache captures what the app actually loads, so offline
works from the first controlled load — install, open once, offline works. The
precache floor is `./` plus the manifest plus one icon. **NOTHING UNDER
`seasons/data/` MAY EVER JOIN IT** — that is 22 MB of history, and precaching
it would charge every visitor the archive's full download at install time for a
feature most sessions never open. It is cache-first, which is the opposite
bargain: paid once, by the people who actually enter the archive. SW constants live at the
top of `sw.js`, not `config/constants.js`: a worker cannot import the app's
modules. Contained, documented Tuning deviation.

**Icons** are generated by `tools/make-icons.py` from
`assets/source/app-icon-512.png`, which is the master for the whole set — 192/512
transparent `purpose: any`, 192/512 maskable at 72% over a solid backdrop,
180×180 flattened apple-touch-icon, 32 px favicon. The PNGs are committed;
Python + Pillow is tooling, not toolchain. **Vectorising is not needed** — iOS
ignores SVG for home-screen icons and Android's maskable icons are PNG in
practice; SVG would only buy a browser-tab favicon.

**The iOS backdrop is ocean `#070D18`, not the icon's navy.** The spiral's arms
ARE the navy `#173B5F`; on a navy backdrop half the artwork vanishes. Maskable
icons use the same backdrop so the two platforms match.

**The artwork IS the map symbol now, but only as a vector.** `map/glyph.js`
draws a white shape the mesh tints per storm — one drawing serving every
Saffir-Simpson category and the grey outage state for free. The BITMAP still
cannot do that job and never will: a full-color PNG cannot be tinted (teal ×
category red is mud), and reducing it to a silhouette throws away the color
that made it worth using. What changed on 2026-07-29 is the source — the mark's
five outlines are traced vector paths, so the mesh tints them exactly as it
tinted the old hand-drawn spiral. The remaining objection, that the artwork
becomes a lump at the 12–24 px the glyph occupies on a phone, was measured and
is answered by `SIZE.glyphArmWeight` (see SPEC-MAP §9.13), not waved away. **The
PNGs are still icons only** — home screen, favicon, splash. Nothing in the
render path loads one.

#### First-run nudges and the install door

Two one-time hints, sequenced, never nagging. Each shows once ever; acting,
dismissing, or reaching the same end through any other door retires it
permanently (guarded localStorage under `STORAGE_KEY.firstRun` — **not a third
prefs store**; no subscribers, no validated values, and §12's extract-on-third
counter still stands at two).

1. **Home nudge**, `FIRST_RUN.homeNudgeDelayMs` after boot, because the entry
   moment belongs to the globe. A chip under the status strip; [Set home] opens
   the home view. **It never touches the OS location dialog**, so §8's "never
   prompted on first launch" holds — the nudge is a signpost, not a prompt.
2. **Install hint, gated on home being SET** — the moment the user has invested,
   not the first web visit.

**AND A PERMANENT DOOR IN SETTINGS**, on the **same `pwa.js` seam**, never a
second one. The nudge is one-time by design — a hurricane app that nags is the
wrong brand — which otherwise leaves anyone who dismissed it, or whose browser
announced installability after the moment passed, with no way to install at all.

**`beforeinstallprompt` IS NOT A CAPABILITY TEST.** It is a notification that the
browser is willing to show a dialog *right now*. It does not fire when the app is
already installed, it does not fire on every load, and **there is no API anywhere
that answers "could this browser install me."** A row that derived "this browser
can't install web apps" by elimination shipped and was wrong on Chrome for macOS,
which installs PWAs perfectly well. **Absence of a signal is not evidence of
absence of a capability** — the same shape as reading a dead feed as an
all-clear. So the row never claims incapability. Three states:

- **Installed** — genuinely detectable (`display-mode: standalone` /
  `navigator.standalone`). The whole block is REMOVED. This is the one honest
  exception to "rows dim, they never disappear": a disabled "Installed" button is
  permanent furniture offering an action that can never be taken again.
- **Ready** — a prompt is captured (listener at module scope in `pwa.js`, because
  the event predates the UI). The real button, opening the real dialog.
- **Manual** — everything else. Not "you can't" but **here is how**, as numbered
  steps for iOS Safari / Android / desktop, chosen by capability shape
  (`standalone` in navigator, then `maxTouchPoints`), **never by parsing a
  user-agent** (§10). If a prompt lands later, the subscription upgrades the
  block in place.

**Amber, not red, and its own token.** Red is spoken for by §6 (failure — dead
feeds, errored layers, the status chip), and a call-to-action wearing it would
mean red stops reliably saying "something is broken". `--install-cta` is also
deliberately NOT `--stale`, which means "this data is older than it should be" —
same family, separate name, so changing one never moves the other.

Chip styling is `ui/nudge.css`: the status-chip glass language, tokens only,
44 px targets, focus rings, host is `aria-live="polite"`. **The status strip
always outranks a nudge** — truth above advice.

### 17.12 IP, copying, and monetization

**Landfall's client code CANNOT be protected, and no effort should be spent
trying.** Every line ships to the browser, and there is no minification or
obfuscation step (SETTLED, SPEC.md).

What actually holds:

1. **Copyright is automatic and already held.** No LICENSE file means all rights
   reserved — the strongest default (SETTLED, SPEC.md). The copyright line lives
   in the Terms view.
2. **The NAME is the commercial asset, not the code.** A clone can copy the JS;
   it cannot call itself Landfall. Worth a trademark search before spending
   anything — "landfall" is a common weather term and is in use by an existing
   games company, so clearance is not assumed.
3. **Server-side is the only real technical moat.** Anything computed in a
   Function is invisible to a copier. If Landfall monetizes, that is where the
   paid features go — and not before: moving free features server-side costs
   money, adds latency, and breaks offline.
4. **Making the repo private buys little.** It holds no secrets, so it protects
   nothing the shipped bundle does not already reveal; it only forces a copier to
   reverse-engineer rather than clone. **Whichever state it is in, verify the
   Cloudflare Pages GitHub integration still has access** — flipping a repo
   private can silently drop it, and the failure looks like "I pushed and nothing
   deployed."
5. **THE ACTUAL MOAT IS THIS DOCUMENT.** Every hard-won fact in the spec — that
   GDACS `severity` is a forecast peak and not current wind, that
   `publicAdvisory.url` served a six-week-dead storm, that `+9` is the rasterized
   layer, that `beforeinstallprompt` is not a capability test — cost a day each.
   A copier gets a snapshot of the code and none of the reasoning, and walks into
   every one of those walls unaided.

**If it monetizes, the boundary is set here in advance: core hazard information
stays free forever.** Charging for hazard data during a disaster is indefensible,
and it is also the peak-cost moment — the two failures arrive together. Revenue
comes from convenience and depth: push alerts, multiple saved locations, history,
expert layers. That is the same set that has to live server-side anyway, so the
moat and the product boundary are the same line.

### 48.13 The rainfall probe

`tools/rain-probe.mjs` and `.github/workflows/rain-probe.yml` are the survey
that produced every measured figure in §48. The workflow triggers on a push to
the `rain-probe` branch — **not** on a schedule and not on dispatch, because a
fine-grained PAT can push but cannot dispatch (measured: HTTP 403 on the
`/dispatches` endpoint), so a push is the only way a cloud session can start a
runner. Results land on `rain-probe-results`, which like `archive` is data: one
orphan commit, force-pushed, never merged.

Re-run it by pushing the branch again.

**Both files and both branches are disposable and are being kept until §48 is
judged on glass.** The fixtures the suite needs are copied into `samples/rain/`
and no test reads the branch, so deleting them breaks nothing — but they are
the only way to re-measure this API from a sandbox that cannot reach it, and
the first storm near a home is exactly when that will be wanted.

---

## 18. Research from a sandbox with no internet

A cloud session reaches **github.com and registry.npmjs.org and nothing else**.
Measured: nhc.noaa.gov, gdacs.org, api.cloudflare.com, tiles.openfreemap.org and
landfall.getgravitate.app itself are all blocked. `curl` cannot fetch a payload
and cannot reach our own live app. A session that believes it measured a feed
with `curl` is wrong.

There are four ways across, they do DIFFERENT JOBS, and using one for another
one's job is the failure this section exists to prevent.

### 18.1 Live web search — DISCOVERY

A real search engine, not a list of URLs already known. **This is the only
transport that can answer "what exists that nobody here has heard of"**, which
is the entire point of a research pass. Any pass whose output is "here is what
I already knew about, tidied up" used the wrong tool.

It finds NAMES. It does not establish that a source is real, current, free,
machine-readable, or shaped the way a page claims. Everything it turns up is a
candidate and is written down as one.

### 18.2 WebFetch — TRIAGE

Reads a named page from anywhere. **It shows no response headers and runs a
small model over the body, so anything large comes back APPROXIMATED rather
than verbatim.** Right for a small JSON body, an API index, a licence page, or
"is this thing up". Never right for a wind field, and never the basis for a
sentence containing a figure that will end up on the screen.

**==> IT STRIPS QUERY PARAMETERS, WHICH RULES OUT EVERY ArcGIS `/query`
ENDPOINT. <==** Measured 2026-08-19 against NHC_PeakStormSurge: fetching
`.../2/query?where=1=1&outFields=*&f=pjson` came back as the service
directory's blank HTML **query form**, not a result set — the parameters never
reached the server. The same limit blocks `?f=pjson` anywhere, so a renderer's
keyed field, a feature count, and anything else living only in the JSON view
are out of reach from a session.

**What it CAN read is the ArcGIS directory's HTML** — service description,
layer list, the full field list with types, and a renderer's values and labels.
That is enough to confirm a field EXISTS and enough to kill a wrong assumption.
It is not enough to confirm which field a renderer keys on. Past that is the
archive runner's job.

### 18.3 The archive runner — EXACT BYTES

A GitHub Actions runner has open internet. `tools/archive-fetch.mjs` fetches a
list of sources hourly and commits the raw bytes plus every response header to
the `archive` branch, where a session reads them with plain git:

    git fetch origin archive && git show origin/archive:latest/<file>

**Adding a source is one entry in that list.** Binary comes back base64 with a
`.b64` suffix and decodes to the real file — the outlook KMZ is a working zip
in the branch today. This is how a candidate becomes a measurement.

**Three phases run AFTER the flat list, each reading what the phase before it
WROTE.** Per-storm geometry is derived from the event list; surge cards and
impact exports are derived from the event records that produced; and
`aoi_surge` polygons are derived from the surge cards. A URL that lives inside
a payload cannot be in a static list, and the alternative — hardcoding an id
that changes every bulletin — is a source that silently 404s.

**Every derived phase is capped and round-robins across storms**, so one storm's
three models cannot eat a budget of six and leave the other basin unread. The
`aoi_surge` pass is deliberately uncapped: it is bounded by how many storms
publish one at all, which on 2026-08-19 was one of three.

**EVERY RELAY ROUTE IS ARCHIVED, OR IS EXCUSED IN WRITING.** The archive
captures upstream bytes *and* our relay's own answer for the same source, and
the second is the one that settles a bug report. **The app never reads an
upstream URL.** An upstream copy proves what NOAA or the Navy published; only
the relay copy proves what a phone was handed, and that includes the relay's
`state`, its `X-Landfall-Cache` path, and how old the answer it served was.

`tools/relay-archive-check.mjs` enforces it, off the route files in
`functions/api/` rather than off the call sites — the app addresses its relay
three different ways and a scanner that knows one of them reports a clean bill
of health over the two it cannot see. A route is archived, or it is named in
that file's `EXCUSED` map with a sentence saying why no fixed hourly URL for it
exists. Diagnostic probes and the telemetry sink are excused by kind; per-storm
routes are excused individually, because "needs a parameter" stops being a
reason the moment somebody derives it and the entry should then read as a
to-do.

**IT DOES NOT CATCH A HALF-CAPTURED BUNDLE, AND TWICE THAT WAS THE THING THAT
MATTERED.** The relay check asks whether a route is archived at all, not whether
the archive covers the same product the app reads. Both gaps found the same way,
on 2026-08-21:

- **NHC layer 11.** `NHC_STORM_LAYER` held eight of the nine layers in
  `SUMMARY_LAYER` and the missing one was `pastTrack` — the line every "track
  doubles back" console warning is about. Past POINTS were archived and past
  LINE was not; they are different products with different vertex counts, so
  the archive answered the question next door to the one being asked.
- **The a-deck.** The TCGP roster was archived — the response that maps a storm
  to a deck filename — and no deck was. A session investigating model tracks
  drawing from the wrong origin could not tell a parse fault from a stale cycle
  from a deck the relay never served.

Both are captured now, the decks under `latest/adeck/` via **both** relay
routes, since `data/adeck.js resolveDeck` sends NHC storms to
`/api/nhc/adeck` and everything else to `/api/tcgp/adeck`. **The rule the two
gaps earn: when a source is a SET — layers of a bundle, products of a storm —
archive the whole set or write down which member is excluded and why.** An
archive that covers most of a bundle fails on exactly the day something goes
wrong with the rest.

**A NEW SOURCE FAMILY NEEDS ITS FOLDER IN THE SAME COMMIT.** A source `name`
may carry a folder prefix — `geometry/…`, `ships/…`, `jtwc/…`, `adeck/…` — and
Node does not create an intermediate directory on write. The a-deck family
shipped on 2026-08-21 without its `mkdirSync` line, so the FIRST deck write
threw `ENOENT`, the phase's own try/catch swallowed it, and the run reported
`68/69 sources ok` with no deck and no complaint. Every hour, for a day.
`tools/test-archive-dirs.mjs` reads the fetcher and fails when a prefixed family
has no matching folder.

**AND THE FOLDER ALONE WAS NOT ENOUGH — THE SAME FAMILY THEN KILLED THE JOB FOR
THIRTEEN HOURS.** `archive.yml`'s copy into `latest/` ran a plain `cp` over
everything in `/tmp/new`, skipping a HARDCODED LIST of the three directories
that existed at the time — `geometry/`, `ships/`, `jtwc/` — under a comment
warning that a directory left in the list's blind spot would exit 1 and take the
whole job with it under `set -e`. `adeck/` arrived on 2026-08-22 as the fourth.
Eleven consecutive scheduled runs failed at the same step, the branch stopped
being force-pushed, and the next session found `latest/` still stamped
`23:30:41Z` while the app had moved on through four advisories.

- **The list is gone. The filesystem is asked instead** (`if [ -d "$f" ]`), and
  every directory under `/tmp/new` is rebuilt in `latest/` by ONE loop rather
  than three near-identical named blocks. A new phase in
  `tools/archive-fetch.mjs` now works here the hour it lands, with no second
  edit in a second language.
- **A COMMENT WARNING ABOUT A TRAP IS NOT A GUARD AGAINST IT.** The warning was
  accurate, sat directly above the list, and was read by whoever added the
  fourth folder — or was not, which is the same outcome. §5's rule that an
  unenforced rule regresses applies to shell exactly as it applies to modules.
- **A DEAD HOURLY JOB IS INVISIBLE, AND THAT IS THE EXPENSIVE PART.** A branch
  that stops being force-pushed looks precisely like a branch nobody changed.
  Nothing in the app, the manifest, or a session's normal reading says "the last
  eleven runs failed" — `archive:latest/manifest.json` looked healthy because it
  was the last GOOD one. **Check `fetchedAt` against the wall clock before trusting anything
  from `archive:latest/`**, and if the gap is more than about two hours, look at
  the workflow runs before looking at the data.
- **THE FAILING STEP'S LOG CANNOT BE READ FROM A SESSION.** The Actions API
  answers `/jobs` fine, but `/logs` is a 302 to
  `productionresultssa*.blob.core.windows.net`, which the wall blocks. The run
  list, the job list and each STEP's name and conclusion are all reachable and
  are usually enough to name the failing step; the body is not. Reproduce the
  step locally against a fixture directory tree instead — the whole `run:` block
  is ordinary bash and lifts straight out of the YAML.

**A DERIVED PHASE THAT THROWS MUST NOT LOOK LIKE A QUIET HOUR.** Every derived
phase catches, deliberately — an experiment must never cost us a storm list —
but a catch that only prints to stdout is invisible to every session, because a
session reads the manifest and never the run log. Each catch now records
`{ phase, reason }` in `derivedFailures`, which rides in `archive:latest/manifest.json` beside
`ok` and `unavailable`. **An empty array is the healthy state and is written
every hour**, so nothing has to remember the key exists. §5's silence rule
applies to our own tooling exactly as it applies to the app.

**==> PHASE TWO DERIVES FROM THE RELAY'S COPY OF THE EVENT LIST, NOT GDACS'S.
<==** Measured on the 2026-08-23T22:05Z run. In one snapshot, one runner, one
moment: `archive:latest/gdacs-events.json` aborted at 30,003 ms while
`archive:latest/relay-gdacs-events.json` answered **200 OK in 165 ms**, carrying the same hundred rows and the same six
current storms, each with its own `url.geometry`. Every GDACS-derived phase read
the upstream file and only the upstream file, so `geometry`, `relay-geometry`
and `gdacs-event-detail` all threw and the hour recorded nothing at all about
GDACS — **on the hour whose entire point was that GDACS was unwell.** The
archive failed on precisely the day it was needed and worked on all the days it
was not.

`gdacsEventList()` is the one reader now: relay copy first, upstream as
fallback, throwing with a reason that names BOTH when neither is usable —
because `derivedFailures` is all a session reads, and a message naming one copy
cannot distinguish "GDACS is down" from "our relay is down too". A body that
parses but carries no `features` array counts as unusable, since that is the
shape an error page serialises to.

**The preference is not merely about survival.** §18.3's principle is that the
app never reads an upstream URL, so per-storm URLs derived from the relay's list
are the URLs a phone would actually ask for. The upstream copy is still fetched
and still archived beside it — proving what GDACS published is a different job
from proving what we handed over — it is simply no longer what the rest of the
run depends on. `tools/test-archive-list-source.mjs` guards the order, the
fallbacks and the single reader, mutation-verified five ways.

**IT IS THE SAME MISTAKE THE RELAY MADE THE SAME MORNING, IN THE SAME
DIRECTION.** `functions/api/gdacs/geometry.js` had a correct fallback that could
never execute; this had a correct fallback source it never looked at. **A cache
exists so that upstream being down stops mattering, and anything reaching past
it to the origin has opted out of the protection it is standing next to.**

**`geometryStorms` IS GONE, SPLIT INTO `gdacsGeometryStorms` AND
`nhcTrackLayers`.** One counter was incremented by the GDACS polygon phase AND
the NHC track phase, so a run capturing zero GDACS storms still reported 27 — the
NHC layer files — under a name that reads as GDACS coverage. A session on
2026-08-23 read that number across `history/` to judge exactly that and believed
it. The two phases fail independently by design, so the two numbers have to be
separate or the manifest cannot say which half of phase two is missing. **A
shared counter under a specific name is worse than no number.**

**A CLOUD SESSION CANNOT START THE RUN.** `archive.yml` fires on the hour and
on manual dispatch only, and the fine-grained PAT cannot dispatch (measured:
HTTP 403 on `/dispatches`, §48.13). So the round trip is: add the source, push,
then either wait for the top of the hour or ask Aaron to press Run. Plan a pass
around that gap rather than discovering it mid-session.

**==> THE RELAY'S COPY OF THE GDACS SHAPES IS CAPTURED PER STORM, AND IT IS A
DIFFERENT QUESTION FROM THE UPSTREAM COPY BESIDE IT. <==** Phase two writes
`geometry/gdacs-<NAME>-<id>-e<ep>.json` from gdacs.org and
`geometry/relay-gdacs-geometry-<NAME>-<id>.json` from our own route. The first
proves what GDACS published; the second proves **what a phone was handed**, and
a bug report is only ever about the second one. That gap cost a session on
2026-08-23 — every non-US storm lost its cone, its track and its wind field, and
the trail stopped dead at the relay exactly as it had for the JTWC grading bug
that made this archive cover relay routes at all.

**The finding lives in one header.** `X-Landfall-Cache` names which layer served
the shapes: `kv` (the cron-filled global warm store), `fresh` (that colo's own
cache), `upstream` (this reader paid for the trip to Europe), `last-good` /
`kv-stale` (GDACS failed and the fallback caught it). A `relayGeometry` rollup
in the manifest counts them per run, because the per-storm bodies live in
`latest/` only and are gone within the hour, while the question — *is the warm
store holding, or is every reader queuing behind gdacs.org?* — is only ever
answerable by **diffing that rollup across `history/`**. One run is a snapshot:
a single `upstream` can be ordinary expiry and a single `kv` can be luck.

**AND THE RUNNER'S `fresh` READING IS ABOUT A GITHUB DATACENTRE, NOT A PHONE.**
`caches.default` is per-colo. Only `kv` generalises, because Workers KV is
global — which is lucky, since the warm store is what is being asked about. Do
not quote a `fresh` count as evidence about a device.

**THE URL MUST BE NORMALISED THE SAME WAY THE ROUTE NORMALISES IT.** The route
keys its cache on `new URL(raw).toString()` (`safeUpstream()` in
`functions/api/gdacs/geometry.js`, mirrored by `safeGeometryUrl()` in
`worker/src/sources.js`). Two spellings of one URL are two different keys, so an
archive asking in a different spelling would miss every entry the cron writes
and report `upstream` forever — indistinguishable from a broken warm store, and
a fault in the measuring instrument rather than the thing measured.

**==> AND THE HOSTNAME GOES IN AS A LITERAL, NEVER A CONSTANT. <==**
`tools/relay-archive-check.mjs` finds what this fetcher archives by scanning its
TEXT for `landfall.getgravitate.app/api/…`. A `const RELAY` spliced in with a
template hole breaks the match, and the route silently stops counting as
archived. Hit while writing this entry; caught by the check, which is the check
working.

### 18.4 The Cloudflare MCP — OUR OWN NUMBERS

Live and authenticated, and it does not travel the blocked network. Workers,
D1 (`landfall-telemetry`, `dc08ce89-b597-40da-b5b5-7571a9b30d90`) and arbitrary
SQL all work. KV NAMESPACES are listable; KV VALUES are not readable — cache
contents have to come out of an inspect route's body.

### 18.5 The order, and why getting it backwards is expensive

Search **finds**, WebFetch **triages**, the runner **verifies**, glass
**judges**. Reversed, each step is wrong in its own way: exploring through the
runner costs an hour per guess, and measuring through search or WebFetch
produces an approximation reported as a fact, which is the specific failure
the whole archive branch was built to end.

**Glass is the fourth transport and it is Aaron\x27s.** No tool here can say
whether a layer is beautiful, legible at a glance, or fast enough on a phone.
A research brief ends by naming what still needs a phone.

### 18.6 The telemetry pull — THE SECOND ROAD TO OUR OWN NUMBERS

`tools/cloudflare-telemetry.mjs` runs on the archive runner every hour, asks D1
directly, and commits the answers to `archive:latest/telemetry/`. **It exists
because §18.4 can be absent.** On 2026-08-08 the Cloudflare MCP was simply not
in a session and nobody noticed until someone went looking; a connector that can
silently not be there is a bad single route to the numbers that say whether the
app is healthy. Read them with plain git, no connector, no device:

    git show origin/archive:latest/telemetry/manifest.json

**Read `freshness.json` first.** If `hours_since_newest` has grown past a few
hours while the app is live, every other file there is stale WITHOUT LOOKING
STALE.

**The SQL lives in `tools/telemetry-queries.mjs`, not in the runner.** That
module has no side effects, so it can be imported; the runner cannot, because it
runs on load, talks to the network and exits. The split is what makes
`tools/test-telemetry-queries.mjs` possible, and every rule that test enforces
was previously a comment that had already been broken at least once.

**A COLUMN IS YOUNGER THAN ITS TABLE, AND THE DEFAULT IS NOT AN ANSWER.** This
is the standing trap in this data and the reason two of the three answers below
carry a caveat in their own output rather than in a note somebody has to
remember to read:

| column | added | what an old row holds | what that would mean if believed |
|---|---|---|---|
| `device` | 2026-08-05 | `''` | every earlier day was ONE person |
| `ref_host` | 2026-08-14 | `''` | nine days of traffic arrived direct |

`device = ''` is excluded from every people-count, and `daily-devices` returns
`sessions_without_device` beside it so the hole is visible in the output. A
people-count on a day where that number is not 0 is a FLOOR, not a total.

`ref_host = ''` cannot be cleaned up the same way, because it legitimately means
direct or same-site as well as "older than the column" — the two are genuinely
indistinguishable in the data. It is therefore labelled `(direct, same-site, or
pre-2026-08-14)` and **must never be shortened to "(direct)"**, which would turn
missing data into a finding.

**Who is out there** — `daily-devices` for how many people per day,
`device-roster` for the regulars, `return-rate` for how many came back,
`referrers` for where they come from all time, `referrers-daily` for the shape
of a spike. That last is separate on purpose: the all-time table flattens one
busy day and a steady trickle into the same row, and a spike is exactly what
gets asked about. It is bounded by a `WHERE` on `ts` rather than a `LIMIT`,
because a `LIMIT` on a two-column grouping drops the quietest sources on the
busiest day, and those are the new arrivals worth seeing.

**`device-roster` HAS A 5-DAY FLOOR AND AN 8-CHARACTER TRUNCATION, AND BOTH ARE
PRIVACY CONTROLS.** The archive branch is public and a committed identifier
cannot be recalled. Reporting every device would publish an id fragment plus a
hardware profile for several hundred strangers; devices seen on five or more
separate days are the ones the question is about. Neither the floor nor the
truncation is a display preference — `tools/test-telemetry-queries.mjs` fails
if either is removed, and no query anywhere may `SELECT` a whole `device`.

**What they do with it** — `feature-usage` and `retry-buttons` read the ten
engagement counters written on every session since launch, and `installs` reads
`standalone`. Prefer the `sessions_…` columns over the `total_…` ones: a total
lets one enthusiastic user outvote a hundred casual ones. Neither filters
`timings_ok`, deliberately — a visit with an untrustworthy clock still pressed
real buttons.

**HOW FAST IT FEELS — AND THE ONE COLUMN THAT LIES.** `platform-rollup` reports
`longtask_ms`, and **Safari does not implement the `longtask`
PerformanceObserver**, so `lib/perf.js` never starts it on iOS and the column
keeps its `0` default. That is indistinguishable from a genuinely unblocked
visit, on the largest platform in the table, and it was read and quoted as iOS
being flawless on 2026-09-01. It is not a third column birthday — the column is
as old as the table — but it fails the same way: **a default that looks like an
answer.**

`interaction-stalls` is the companion built only from Event Timing and
navigation metrics, which every engine implements. **If the two tables disagree
about which platform is worst, believe `interaction-stalls`.** The test suite
requires the caveat on any query reporting `longtask_ms` and requires
`interaction-stalls` to exist and to use no `longtask` column.

**Each query runs and reports independently.** One failing because a column
moved must not cost the other fifteen, and a failure lands in the manifest as
`unavailable` with the reason rather than writing an empty file — an empty
result reads as "no traffic", which is the conflation §5 exists to prevent.

### 18.7 The seasons mirror — THE HOURS THAT ARE NOT COMING BACK

`tools/seasons-mirror.mjs`, hourly, onto the **`seasons-live`** branch.
`SPEC-SEASONS-BUILD.md` §57.3 and §57.30 step 3 are what it is for; this
section is how it behaves.

    git fetch origin seasons-live
    git show origin/seasons-live:manifest.json
    git show origin/seasons-live:btk/2026/bal022026.dat
    git show origin/seasons-live:jtwc/2026/wp1726.jsonl

**==> IT IS THE OPPOSITE SHAPE FROM `archive` AND THAT IS THE WHOLE POINT.
<==** §18.3's branch answers *what is the feed serving right now*: one orphan
commit force-pushed every hour, a rolling 72-hour window, no history, and it
therefore cannot grow. Correct for debugging, useless for a season — three days
is not a hurricane season. This one answers *what did the season do*, which
only history can answer, so it **appends real commits and is never force-pushed
except at graduation**.

**What it stores, and the two halves are not equally urgent.**

| path | source | at risk? |
|---|---|---|
| `btk/<year>/b*.dat` | NHC's ATCF b-decks, verbatim | **No.** NOAA republishes the whole thing as HURDAT2 every February |
| `jtwc/<year>/<product>.jsonl` | our own `/api/jtwc/storms`, one JSON line per warning | **Yes.** JTWC deletes its products when a storm ends and its season archives lag badly |

Only the second half is a race. It is captured through **our own relay rather
than the Navy directly**, so the stored track cannot disagree with what a reader
saw on the day — one parser, one answer.

**FOUR RULES IT KEEPS, EACH OF WHICH IS A BUG IF BROKEN.**

1. **§57.13's filter is imported, never restated.** `isRealStorm` from
   `lib/hurdat.js`. Storm numbers 90–99 are invests whose numbers are reused
   several times inside one season, so an unfiltered mirror files three
   different systems under one name and each overwrites the last. 80–89 are
   internal test systems. The branch's manifest names every file dropped and
   why, because an unexplained rejection is one nobody can check.
2. **Conditional GET.** Every b-deck is requested with the stored ETag and
   Last-Modified, so an unchanged file answers `304` with no body. Good manners
   toward a public service, and it hands us rule 3 for free. A `200` is still
   compared by content — not every server sends validators, and some send a new
   one for identical bytes.
3. **A run that changed nothing commits nothing.** Off season that is zero
   commits a day. The decision is made inside the script, because only it knows
   whether bytes moved or the server merely answered again.
4. **==> BUT SILENCE IS NOT A STATUS, AND THE LINE BETWEEN THEM IS HEALTH
   VERSUS ACTIVITY. <==** The manifest is compared on **status, reason, how
   many files the directory listed, which the filter dropped, how many failed,
   how many storms are warned on, and any faults** — never on bytes stored,
   files unchanged, lines added, or the per-file map. A source flipping from
   `ok` to `unavailable` is a commit that says so. A directory gaining an
   invest is a commit. Fetching the same fourteen files again is not.

   **That scope was got wrong once and the runner caught it inside four
   minutes.** The first version compared everything except the timestamp, which
   sounds right — but the per-file detail reads `stored 6551 bytes` on the run
   that fetched a file and `unchanged (304)` on the next, so **every genuine
   change produced a second, empty commit**, carrying a subject line that
   claimed to be a first run. `seasons-live` `b7c2c44` then `f34d4a5`,
   2026-08-24. Activity already forces a commit through the bytes themselves;
   this comparison exists only for the case where nothing happened, and the
   whole question is whether that was a quiet hour or an outage.

   The commit subject names what moved, because `git log` is the only interface
   this branch will ever have — and for the same reason it does not claim to be
   a first run unless there was no previous manifest at all.

**Retention: squashed to one commit at graduation** — §57.34 rule 1, run as
`workflow_dispatch` with `squash` set. It is a button rather than a schedule
because the graduation it follows is a decision.

**`tools/test-seasons-mirror.mjs`** covers the four rules above against the real
relay payload in `samples/seasons/jtwc-storms-2026-08-24.json`, and each
assertion was verified by reintroducing the bug it guards.

### 18.8 The HURDAT2 refresh — THE SETTLED RECORD, BROUGHT IN ONCE A YEAR

`tools/seasons-hurdat.mjs`, `.github/workflows/seasons-hurdat.yml`, monthly.
It is the other half of §18.7: that one captures the season while it happens,
this one takes NOAA's reviewed version once they publish it.

    seasons/data/hurdat2-atlantic-<season>-<revision>.txt
    seasons/data/hurdat2-epacific-<season>-<revision>.txt
    seasons/index.json

**It is the only scheduled job in this repo that commits to `main`**, and that
is why it runs monthly rather than hourly. A push to `main` fires a Cloudflare
Pages build against a 500-a-month cap (§57.33 limit 2); a dozen commits a year
is invisible against it, and the same job on an hourly schedule would eat it.
That ceiling is the whole reason the CURRENT season lives in KV behind a route
(§58) instead of in the repo beside these files.

**==> PICKING THE FILE IS THE HARD PART, AND SORTING THE DIRECTORY IS WRONG.
<==** NOAA leaves every past revision in place — 41 files on the day this was
measured, back to a 2018 vintage — and the newest is not the last one
alphabetically. `hurdat2-atl-1851-2023-042624.txt` sorts after
`hurdat2-1851-2025-02272026.txt` because `a` sorts after `1`, and that one
character is the entire step-0 probe bug. The rule is: match the canonical
shape only, rank by **last season**, break ties on **revision date**. The real
listing is kept at `samples/seasons/listings/hurdat-directory-2026-08-24.html`
and `tools/test-seasons-hurdat.mjs` asserts the trap is still in it, so the
picker is proved against the thing that caught somebody rather than against a
fixture that agrees with it.

**==> THE REVISION STAMP IS IN THE OUTPUT FILENAME, AND §57.35 FIX 11 DID NOT
ASK FOR IT. <==** FIX 11 says the SEASON in the filename is the cache bust.
That holds until NOAA revises a season it has already published, which it does:
the real directory carries **five revisions of the 2022 Atlantic file**, in two
different date widths. Under season-only naming every one of them writes to the
same URL — served `immutable` by `_headers` — so a browser that fetched the
April revision would keep it forever and never see the May correction. FIX 11
has been corrected rather than worked around.

**FOUR RULES IT KEEPS, EACH OF WHICH IS A BUG IF BROKEN.**

1. **Nothing is committed that parses worse than what it replaces.** The
   downloaded file must parse with **zero faults** through `lib/hurdat.js` — the
   same parser the app ships — and carry **at least as many storms** as the file
   already in the repo. HURDAT2 only ever grows; a reanalysis changes a storm's
   numbers, it does not delete a hurricane from history. A truncated download
   trips the row-count check the format itself provides, which is why this is
   the test rather than a byte-size comparison: the file grows every year, so
   there is no size that means complete.
2. **A refusal is a FAILED run, not a quiet skip.** Either NOAA published
   something broken or our parser stopped understanding their format, and both
   are worse than a month with no update. The file already in the repo is left
   exactly as it is.
3. **One file per basin, replaced, never accumulated** (§57.34 rule 3). The
   delete and the write happen in the same run and therefore the same commit.
4. **A naming change is reported, never absorbed.** Anything in that directory
   whose name mentions hurdat and matches no pattern is listed in the run
   summary. Without it, a rename on NOAA's side would make this job find nothing
   and report a cheerful "nothing changed" every month forever.

**`seasons/index.json` IS THE ONE MUTABLE FILE IN THE FEATURE.** It names which
HURDAT2 file to fetch, so February's swap is a data commit rather than a code
change and a deploy. It is compared **without its timestamp** before being
rewritten, or every run would produce an empty commit — the exact fault §18.7
rule 4 shipped and a runner caught inside four minutes.

**==> GRADUATION IS THEREFORE AUTOMATIC FOR THE NHC BASINS, AND §57.30 STEP 3b
SAID IT WOULD BE MANUAL. <==** The step described graduation as "one commit
promotes that year into the repo". Once this job exists there is no such commit
to make: February's file lands on its own, `index.json` gains the new season,
and the app prefers a season present in the index over the live route. **The
only manual step left is squashing `seasons-live`** (§57.34 rule 1), which is
already a button on the `seasons-mirror` workflow. The spec has been corrected.

**==> AND IT CUTS EACH BASIN INTO ONE FILE PER SEASON. <==** `tools/seasons-slice.mjs`,
added 2026-08-24, §57.35 FIX 12.

    seasons/data/atlantic-<season>-<revision>.txt
    seasons/data/epacific-<season>-<revision>.txt

Same bytes, same directory, same `immutable` header, same revision stamp for
the same reason. **Measured on the real 2005 Atlantic season: 119 KB, 14 KB
over the wire, and 14 ms to parse in node.** So opening one year costs a
fourteen-kilobyte fetch and no stored state at all, where the whole basin is
6.75 MB and needs a Worker and a progress bar to be affordable.

**Five rules, and the first two are the ones with teeth.**

1. **Every cut is proved against the whole file before any of them is written.**
   `verifySlices` parses the source, parses every cut, and compares the storms
   **field by field** — not by id, because a re-encoding fault leaves the ids
   identical and the track wrong. A basin that fails is a failed run and
   nothing is written or removed. **A lost storm has no symptom**: a year
   holding 30 storms instead of 31 looks exactly like a quieter year.
2. **The cut is verbatim and filters nothing.** Invests and test numbers
   (§57.13) go into the slice exactly as NOAA wrote them; `lib/hurdat.js` drops
   them at read time on both roads. One rule, one file.
3. **It reconciles rather than reacts**, so it runs whether or not the basin
   file moved. The whole file is `unchanged` in eleven months out of twelve, and
   a slicer that only ran on a fresh download would produce nothing in any of
   them.
4. **One revision on disk, never two** (§57.34 rule 3). A new stamp rewrites
   every season and sweeps every cut carrying the old one, in the same commit.
5. **The app composes no filename.** `index.json` carries `dir` and, per basin,
   a `seasons` map from year to filename. A naming rule written down in two
   places is a rule that will disagree with itself.

**The whole-basin file is NOT replaced by this and must not be deleted.** Step 9
answers "how many storms have passed within 100 miles since 1851", which is
every season at once. **It is now the ONLY reader of the whole file** — step 8's
offline download was the other one and was deleted on 2026-08-25
(`SPEC-SEASONS-BUILD.md` §57.30). The cut removes the whole file from the
ORDINARY path, which is what was blocking a season board from existing before
that machinery does.
