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
it. Plain language, no legalese (§1). Three surfaces:

- **First run** — a strip shown IMMEDIATELY, with **no dismiss X and no
  timeout**; the only way past it is the button. The home nudge is CHAINED
  BEHIND it (`ui/first-run.js`), not racing it. Same one-time guarded-localStorage
  mechanism as the other nudges — **not a new store** (§12's extract-on-third
  counter still stands at two).
- **Permanently, in Settings** — plus the sources, the privacy statement and the
  copyright line. Settings is where people already look for "what is this," it is
  where the install door lives, and it is reachable by tap, click and keyboard.
  **Not the credits pill:** `map/attribution.js` animates its width from a
  measurement of its own single-line label, and a wrapped paragraph inside it
  breaks that measurement.
- **The storm detail panel footer** — `DISCLAIMER.short` plus a live link to the
  NHC, rendered last in `ui/view-storm-detail.js`'s body, **including on the
  ghost form**, since a storm that has left the feed is exactly when a reader is
  most likely to be looking at something out of date. This is the highest-value
  placement of the three: the other two speak at the moment of ARRIVAL, this one
  at the moment of DECISION.

**It is a footer, not a pinned banner, and that is deliberate.** The stamp above
it is pinned while the body scrolls; two more lines up there cost reading height
on the phone that has the least of it, and would inherit the stamp's freshness
colouring (`fresh`/`aging`/`stale`/`silent`), which the disclaimer has nothing to
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

**THE CSP IS REPORT-ONLY.** A wrong CSP does not degrade the app, it breaks it
for everyone at once on the deploy nobody is watching. Report-Only logs
violations and blocks nothing, so waiting costs nothing and flipping early costs
everything. **Flip it after one normal session with imagery on and a storm
selected reports nothing — and not in the days before a deliberate traffic
spike.**

Measured clean on the live site across boot, all four drawer views, the basemap,
MapLibre's blob workers and every additive layer toggle, with a real
`securitypolicyviolation` listener rather than by reading the config. The imagery
segmented control and a live storm selection are the two paths that sweep never
exercised.

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
- `lib/perf.js` — browser timings plus the app's OWN milestones: `globe` (map
  became touchable), `data` (a source left `loading`), `storms` (something
  painted). **The gaps split the blame — globe→data is the network, data→storms
  is ours.** Also long-task count and total, worst interaction latency,
  connection quality, and **WebGL context loss**, the standing hypothesis for the
  iPhone tail: Safari takes the context away under memory pressure and from
  outside it looks identical to "slow".
- `lib/usage.js` — plain counts. Storms opened, advisories read, layers toggled,
  retries. **Counts only** — no order, no timestamps, no arguments; never which
  storm, never which layer. A sequence with times attached is a behavioural
  fingerprint.

**`lcp_ms` IS STRUCTURALLY ZERO FOR THIS APP AND THAT IS NOT A BUG.** A WebGL
`<canvas>` triggers First Contentful Paint but is **not an LCP candidate**, and
above the fold this app is nothing but canvas — there is no element for the
browser to nominate, so no entry exists to observe. Measured in a real Chromium:
FCP at 204 ms, zero `largest-contentful-paint` entries six seconds in. Use
`t_globe_ms` and `t_storms_ms`, which are the app's own answers to the same
question and are populated on every session. The column stays in the schema
because it is one integer and dropping it costs a D1 migration for no gain.

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
accounts, no user identifier, no cross-session id. **Any beacon field is guilty
until proven it cannot be joined back to a person.** Stated plainly in the Terms
view: your location stays on your phone.

The `sessions` row does carry device characteristics — screen size, pixel ratio,
device memory, core count, connection quality — added deliberately, because
without them there is no way to ask whether slow iPhones are simply OLD iPhones.
There is still **no user id, no session id, no cross-visit identifier and no user
agent string**; the highest-entropy field of the lot was left out in favour of a
six-value `platform` bucket. The honest note: those five fields together are a
device fingerprint, and regulators generally treat a fingerprint as personal data
even with no name attached. **If this is ever reversed, drop the five device
columns — the rest of the table stands on its own.**

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
  may be what never ran). Its handful of literal colours are the ONE sanctioned
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

**Write-if-changed is the budget, not an optimisation.** The hash lives in each
key's KV **metadata**, and `list()` returns every key's metadata without any of
their values — so one list call per cycle yields every previous hash without
reading back a single 400 kB geometry blob. Steady state is twelve unchanged keys
per cycle.

**`fetchedAt` is refreshed on a write and never otherwise.** An unchanged payload
is not re-stamped, so a feed that has gone quietly static **ages** in the store
rather than looking eternally current — §5 enforced by infrastructure. And **a KV
entry with no `fetchedAt` is treated as STALE, never fresh**: an unstamped value
cannot be aged, and defaulting an unknown age to "current" is absence read as
safety.

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
  `failed: 0`, `unchanged: 12` all read healthy while no source is ever contacted
  again. `X-Landfall-Fetched-At` tells the two apart for free — stamped NOW on an
  upstream fetch, carrying the old stamp when served from KV — and the summary
  leads with a plain `BYPASS REFUSED` warning naming the affected routes.
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
3. **`WARM_KEY`** as a secret on the Worker AND an environment variable on the
   Pages project. Both sides, same value.
4. **KV binding `LANDFALL_CACHE`** on the Pages project.
5. **`INSPECT_KEY`** — any long random string. Until it exists the four inspect
   routes 404 for everybody; after it exists they are reached with `?key=<value>`.
6. **D1 binding `TELEMETRY_DB`** → database `landfall-telemetry`. Production AND
   Preview. Optional and safe to defer; verify with
   `GET /api/beacon?key=<INSPECT_KEY>`, which reports `sink: "d1"` once it
   resolves.

**BINDINGS ARE SET IN THE PAGES DASHBOARD, NOT IN `wrangler.toml`.** Adding a
Wrangler config file makes it the source of truth for the entire Pages project
and turns the dashboard read-only, which would put `INSPECT_KEY` and
`MAPBOX_TOKEN` at risk. Cloudflare's own safe migration path is `wrangler pages
download config` first.

**A binding only applies to NEW builds.** Adding one does nothing to an
already-built deployment; force a rebuild afterwards. An empty commit works.

**ADDING A BINDING IS A DEPLOY-PIPELINE CHANGE, NOT AN ADDITIVE ONE.** Pages
Functions publish as a **single Worker**, so one binding that cannot resolve fails
the whole deploy — storm feeds, geometry relay, geocoder, everything. **Never add
an Analytics Engine binding:** it needs an account entitlement that is not
self-serve, creating a dataset does not grant it, and the binding silently blocked
every deploy for five commits. **THE RULE THIS SETTLES: Landfall's ability to ship
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
season is **~1,200–1,500/day**, so expect the **$5/mo Workers Paid plan**
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

### 17.11 IP, copying, and monetization

**Landfall's client code CANNOT be protected, and no effort should be spent
trying.** Every line ships to the browser. Minification and obfuscation buy an
afternoon against anyone competent, cost real debuggability, and require the
build step §2 does not have.

What actually holds:

1. **Copyright is automatic and already held.** The repo has **no LICENSE file**,
   which means all rights reserved — the strongest default. **Do not add an
   open-source license.** The copyright line lives in the Terms view.
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
