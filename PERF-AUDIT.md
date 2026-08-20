# PERF-AUDIT.md — what is slow, measured, and what to do about it

**Measured 2026-08-19** against the live deploy from real Chrome on Aaron's Mac,
plus D1 `landfall-telemetry` field data and a full read of the boot, data and
service-worker paths. Two storms were live: **Lala** (`nhc:cp012026`, Central
Pacific) and **SAUDEL** (`gdacs:1001305`, West Pacific).

This file is the finding. `tools/perf-audit.mjs` is the instrument that
re-derives it, and `.github/workflows/perf-audit.yml` runs that nightly on the
GitHub runner, which has the open internet the sandbox does not.

---

## READ THIS BEFORE TRUSTING A NUMBER

**Three caveats, stated up front rather than buried, because two of them
invalidate work already in this repo.**

1. **A Mac is the fastest platform we have.** `SPEC-NEXT.md` §52: Mac first
   paint 204 ms against Windows' 684. Every timing below taken on Aaron's Mac
   FLATTERS. They are useful for ATTRIBUTION — what is slow and why — and are
   not field magnitudes. D1 is where magnitude lives.

2. **Part of this session measured a BACKGROUNDED tab.** Chrome throttles a
   hidden tab and the app never built its map at all: `styleLoaded: false`, zero
   sources, zero layers, zero requests to `tiles.openfreemap.org`. Anything
   below that depends on the map having rendered is marked **UNMEASURED** and
   was deliberately left for the runner rather than guessed at. The boot and
   data findings do NOT depend on rendering and stand.

3. **One hypothesis in this audit was WRONG and the control caught it.** The
   first read of the data said "the service worker is a serialised queue, remove
   it". The A/B — unregister the worker, keep the HTTP cache, reload — made the
   staircase WORSE: **2,322 ms without the worker against 1,960 ms with it**,
   because 169 modules fell back to direct network revalidation. The worker is
   not the villain. The correct finding is §1 and it is a better one.

---

## THE HEADLINE

**A returning visitor re-validates all 167 application modules over the network,
one at a time, on every single load. That costs about two seconds before any
data request is even issued.**

It is not the module graph's depth, not the network, and not the service worker
existing. It is that nothing our app ships is allowed to be served from a cache
without asking the network first.

**The recommended fix is §7 — ask once about the whole app instead of 167 times
about its parts. No build step, and it keeps the guard that stopped the
mixed-version bug.**

---

## 1. Every warm load revalidates 167 modules over the network

**MEASURED.** Warm load, everything already cached, fast Mac, no VPN:

| | |
|---|---|
| our modules requested | **171** |
| all of them via the service worker | **171 of 171** |
| service worker pickup gap | **11.17 ms**, near-constant |
| service worker handling, per module | **~30 ms**, near-constant |
| span, first pickup to last | **1,899 ms** |
| module staircase (first request → last byte) | **1,960 ms** |
| first `/api/` call issued at | **2,459 ms** |

171 × 11.17 ms = 1,899 ms, which is the observed span to three significant
figures. This is a queue, and the thing being queued is a network round trip per
module.

**WHY, IN CODE.**

- `sw.js:72` — `IMMUTABLE_PATHS = ['/vendor/']`. **Only vendor is cache-first.**
- `sw.js:107` — everything else same-origin goes to `networkFirst`.
- `sw.js:185` — `fetch(req, { cache: 'no-cache' })`, a **forced revalidation**
  that deliberately bypasses the browser's own disk cache.
- `sw.js:187` — `await caches.open(CACHE)` on the critical path of every
  response. 167 awaited IndexedDB handle opens per load.
- `sw.js:188` — `cache.put(req, res.clone())` writes every module back on every
  load, byte-identical to what is already there.
- `_headers:171-200` — `Cache-Control: no-cache` on every source directory,
  belt-and-braces with the above.

**AND THE REASON IS GOOD, WHICH IS WHY THIS IS NOT A ONE-LINE FIX.** The comment
at `sw.js:159-183` records a real, observed bug: `index.html` is pinned no-cache
while modules were not, so the shell was always fresh and free to import stale
modules underneath it. The app ran a **mixed version** — an ended storm drawn
grey in the list and pink at full height on the globe. `no-cache` is what closed
that. **Do not simply delete it.**

The fix is to make the number of things needing revalidation small, not to stop
revalidating.

**CONFIRMED BY FIELD DATA.** D1 `sessions`: **1,991 of 2,036 sessions are
service-worker controlled.** This is not an edge case, it is the product.

### 1a. Both existing perf tools measure the path almost nobody is on

`tools/load-probe.mjs:327` and `tools/boot-profile.mjs:86` both construct their
Playwright context with `serviceWorkers: 'block'`. Every module-staircase number
this project holds was taken with the worker switched off, against a 98%
service-worker population. The comment on 327 says the worker's cache "is a
separate question" — it was never asked. `tools/perf-audit.mjs` runs both arms
and reports the gap.

---

## 2. The data layer is five round trips deep, and nothing needs it to be

**MEASURED ON THE WIRE**, unthrottled, live:

```
2459 ms  /api/nhc/storms          /api/gdacs/events   (parallel)
2563 ms  /api/jtwc/storms         <- awaits gdacs/events
2628 ms  /api/tcgp/storms         <- awaits jtwc/storms
2687 ms  /api/tcgp/adeck?...      <- awaits tcgp/storms
2739 ms  /api/gdacs/geometry?...  <- awaits the deck
```

Five sequential round trips. On this connection that is 280 ms. On a phone at
150 ms RTT it is closer to 750 ms, and it lands on top of §1's two seconds.

**`/api/jtwc/storms` and `/api/tcgp/storms` depend on nothing in the events
body** — they are global index fetches (`data/gdacs.js:402`, `:420`). Both
modules already dedupe in-flight callers and swallow their own failures
(`data/jtwc-index.js:70`, `data/tcgp-index.js:56`), so starting them early
changes no observable behaviour.

**Fix:** `Promise.all([fetchFeed(events), getJtwcIndex(), getTcgpIndex()])`, then
join. Only the per-storm carq decks genuinely need the storm names. **Depth 5 →
2, in about ten lines, zero correctness risk.**

**Related, two lines:** `data/genesis.js:363-364` awaits two NHC outlook
bulletins before starting `fetchJtwc(now)`, which takes no argument from them
(`:281`). Depth 3 → 2.

**Biggest single payload:** `/api/gdacs/geometry` at **329,677 bytes decoded /
72,148 on the wire**, and it is one of four routes with **no upstream abort
budget** (`functions/api/gdacs/geometry.js:143`) against a source
`config/constants.js:127` calls "legendary 90 s".

---

## 3. Zero dynamic imports anywhere in the application

167 modules, 6 waves, 3,034 KB of our own JS (`node tools/module-graph.mjs`),
and **not one `import()`**. Everything the app can ever do is linked before the
globe draws a frame.

**`app/views.js` alone owns 45 modules / 849 KB — 27% of the boot graph.** It
statically imports all seven drawer views (`app/views.js:45-51`) and constructs
all seven at boot (`:553` onward). `main.js:1197` states the design intent outright:

> *"NOTHING OPEN ON LAUNCH, at any width."*

The constructors are cheap — they build DOM in `enter()`/`mount()`, not at
construction. **The cost is import, not construction**, which is exactly what
`import()` fixes. `ui/drawer.js:354` already has a `register(def)` API and `:295`
a `go(id, arg)`, so the seam exists.

Waves 4 and 5 — the two deepest, 8 modules — exist **only** to serve drawer
panels. Splitting `app/views.js` collapses them.

**Eight more, each gated behind data or a user action that cannot fire at boot:**
`map/imagery.js` (`main.js:41`), `data/warm.js` / `data/adeck.js` /
`data/ships.js` (`:64-66`, both owning layers ship **off**), `data/ended-track.js`
(`:69`), `map/storm-mesh.js` (`:72`), `ui/first-run.js` (`:44`),
`app/bundle-pipeline.js` (`:33`), and **`data/surge.js` (`:53`) which is inert in
production** — it reads a global only `?surge=milton` sets. 9 KB of dead weight
on every real load.

**Combined: 169 → 94 modules, 3,050 → 1,710 KB. 44% of the graph off the boot
path.**

---

## 4. What is NOT the problem — do not spend time here

Checked specifically because they are the obvious suspects. All measured.

- **`config/constants.js` is 285 KB but 92% comments** — ~22 KB of real code,
  **2.75 ms** to import. Same shape for `config/tokens.js` (**1.5 ms**) and
  `config/layers.js` (**0.5 ms**). **Parse time is not the problem; module count
  is.** Compression handles the prose.
- **`map/coastline.js`** — 76 KB, 126 rings, **1.4 ms**. Fine as a module.
- **`assets/hazards/population-towns.json`** (1.87 MB) is correctly lazy —
  `config/layers.js:685` defaults it off and it is only fetched by
  `ensurePopulation()`. Not a boot cost. *(It does `res.json()` a 1.87 MB body on
  the main thread when toggled on — a jank finding, not a boot one.)*
- **`data/lifecycle.js:1043`** top-level localStorage read — capped at 12 storms
  × 64 points. Sub-millisecond.
- **Hidden-tab polling.** All three repeating timers stop correctly on
  `document.hidden` (`data/store.js:384`, `map/imagery.js:767`,
  `map/radar-layer.js:328`). **This is well built and I found nothing to fix.**
- **modulepreload, moving Three.js off boot, the OpenFreeMap CDN** — already
  settled and rejected in `SPEC.md` / NOW.md. Nothing here reopens them.

---

## 5. Relay and edge

- **`functions/api/nhc/advisory.js:95` — `FRESH_SECONDS = 5 * 60` against a
  5-minute cron.** This is the exact DOLPHIN-26 collision `SPEC-DATA.md` §4.13
  bans in capitals: *"THE CRON CADENCE MUST BE FASTER THAN THE SHORTEST WINDOW IT
  REFILLS, NEVER EQUAL TO IT."* Every other warmed per-storm route is 15 min.
  `worker/wrangler.toml:51` asserts the shortest warmed window IS 15 minutes,
  which is factually wrong. **One constant. Highest-confidence fix in this file.**

- **`/api/nhc/mapserver` is not warmed, and the recorded reason is obsolete.**
  `worker/src/sources.js:30-35` refuses on the grounds that layer ids need block
  math — but `functions/api/nhc/mapserver.js:27-35` says the switch to the
  summary service made those ids fixed constants and *"warming this route is now
  a plain question of whether it is worth it, not a correctness trap."* The
  Worker never got the memo. It is the largest payload class in the app, **cold
  in every colo**, and it is 9 requests per NHC storm.

- **`worker/src/index.js:73` — `MAX_DERIVED = 64`, and `:270-275` concatenates
  `nhc, jtwc, gdacs, tcgp` then `:289` slices.** TCGP is always what gets
  dropped, and TCGP is stage 4 of §2's chain. A busy September trips it.
  Raise to 128 **and interleave**, so a cap truncates evenly instead of
  decapitating one source.

- **`_rate-limit.js:85` awaits a `cache.put` before every relay request runs.**
  The counter is already documented as approximate and fails open. `waitUntil`
  it. One line, removes a serial prefix from all ~44 boot requests.

- **`nhc/storms.js:70-74` and `gdacs/events.js:118-122` send no `Cache-Control`
  at all**, while §4.13 claims every relay route sends `no-store`. Two lines.

- **Only two routes serve-stale-then-refresh.** `waitUntil(pullUpstream…)` exists
  in `nhc/storms.js` and `gdacs/events.js` and nowhere else, so the geometry and
  per-storm routes make the reader wait at expiry with a valid last-good copy one
  `cache.match` away. §4.13's own parity rule — *"no data behaviour is finished
  until both sources have it"* — was applied to the lists and stopped there.

- **Return-to-visible is unthrottled in all three places**
  (`data/store.js:397`, `map/imagery.js:775`, `map/radar-layer.js:336`). A phone
  app-switching ten times re-runs the whole ~11-request poll each time, against
  `_middleware.js:61`'s 120/min per-IP budget shared across a carrier NAT. A
  minimum-age guard is ~5 lines per site.

---

## 6. UNMEASURED — needs the runner, and the harness now does it

These are real questions this session could not answer, because the tab was
backgrounded and the map never built. **`tools/perf-audit.mjs` measures every one
of them.** Do not guess at them from a code read.

- **Radar tile volume per load and per pan.** NOW.md item 0b calls the "lighter
  than before" expectation *"a prediction, not a measurement"*. It still is. The
  harness counts tiles on load, pans one viewport, and counts again — the pan
  number is the one that decides whether the layer is affordable.
- **Idle frame pacing.** `attachIdleRotation` calls `setCenter` per frame below
  `DIVE.zHandoff`, so a resting globe drives a full map repaint. The harness
  samples 2 s of frame intervals and reports the p95 and drop rate, not the mean.
- **The colour-null count.** NOW.md item 0d — *"dozens of times per load"*, never
  traced, never counted. The harness hooks `console.error` and counts them, and
  keeps the first five messages so the property can be identified. **The budget
  is set to 0, so this one fails CI until it is fixed.** Console was clean on a
  load where the map never built, which tells us it is map-related and nothing
  more.
- **`dimCoast` throwing.** `map/layers/surge.js` wraps a zoom `interpolate` in
  `['*', original, OPACITY.surgeCoastDim]`; MapLibre forbids a zoom expression
  below the top level of a step/interpolate. Believed to throw on every call so
  the coast never dims — **and `tools/test-surge.mjs` passes over it**, because it
  drives `dimCoast` with a stub map that does not validate expressions. The test
  is half the fix and it is the half worth doing first: make it fail, then make
  it pass.

---

## THE PLAN, ranked by (value / effort)

Everything in tiers 1 and 2 is doable **from the locked sandbox with no
internet** — it is all local edits plus `node tools/check-syntax.mjs` and the
zero-dependency suites. Tier 3 needs a decision or a measurement first.

### Tier 1 — one-liners, no risk, do them in a single pass

| | Fix | Where |
|---|---|---|
| 1 | `FRESH_SECONDS` 5 → 15 min; fix the `wrangler.toml:51` claim | `functions/api/nhc/advisory.js:95` |
| 2 | `waitUntil` the rate-limit counter write | `functions/api/_rate-limit.js:85` |
| 3 | Add the missing `Cache-Control` header | `nhc/storms.js:70`, `gdacs/events.js:118` |
| 4 | Hoist `caches.open` to a module-scope memoised promise | `sw.js:150`, `sw.js:187` |
| 5 | Delete the dead `data/surge.js` import from the boot graph | `main.js:53` |
| 6 | `MAX_DERIVED` 64 → 128 and interleave the four rosters | `worker/src/index.js:73`, `:270` |

### Tier 2 — small, contained, high value

| | Fix | Expected |
|---|---|---|
| 7 | Parallelise the GDACS index chain | data depth **5 → 2** |
| 8 | Parallelise `fetchJtwc` in genesis | depth 3 → 2 |
| 9 | Minimum-age guard on the three visibility refetches | battery; removes the likeliest 429 source |
| 10 | Skip `cache.put` when the ETag is unchanged | ~167 CacheStorage writes per load gone |
| 11 | Upstream abort budgets on the four unbudgeted routes | bounds the cold-colo tail |
| 12 | Dynamic-import the eight post-data / user-gated modules | ~30 modules off boot |
| 13 | Make `dimCoast`'s test fail, then fix the expression | a feature that has never once run |

### Tier 3 — the real wins

**#14 IS THE RECOMMENDED NEXT MOVE.** It is smaller than bundling, reversible,
needs no toolchain, and takes the cost off the 98% who are repeat visitors.
Bundling is kept below it, with a number attached, rather than assumed.

| | Fix | Why |
|---|---|---|
| **14** | **Version-gate the service worker — see §7. PREFERRED.** | Turns 167 revalidation round trips into **one** for a repeat visitor, with **no build step** and no change to how the repo works. |
| 15 | Dynamic-import the seven drawer views | 45 modules / 849 KB / 27% of the graph, and it collapses the two deepest waves. ~15 call sites in `main.js` become optional-chained. Lift `homeMarker` out first — it genuinely draws at boot. |
| 16 | Batch the 9-layer mapserver fan-out at the relay, then warm it | 27 boot requests → 3, warm instead of cold per colo. Biggest absolute win on the data side. Must preserve per-layer independence and per-layer cache slots. |
| 17 | ETag + `no-cache` across the relay | Turns full-body transfers into 304s with no correctness change. Medium, touches every route. |
| 18 | **Bundle. Only if §7 leaves time on the table.** | The complete fix for §1 — 167 requests become ~3, on first visit as well as repeat. It is also the only item here that ends "no build step, ever", so it should be bought with a measurement, not a hunch. |

**Do not do #18 before doing #14 and re-running the audit.** Bundling is the
most expensive change in this file and the only one that ends the no-build rule.
It should be bought with a measured before-and-after, and the harness exists so
that number costs one workflow run.

---

---

## 7. The preferred fix — version-gate the service worker, no build step

**The problem in one sentence: our file names never change, so the browser can
never assume its copy is current, so it has to ask about all 167 of them.**

`/vendor/` already proves the cure. `maplibre-gl-5.6.0.js` carries its version in
the filename, so that URL can never mean something new — which is exactly why
`sw.js:72` is allowed to list it as immutable and serve it from cache forever
without asking. Our own modules have no such guarantee, so `networkFirst` has to
ask every time, and §1 is the bill.

**The fix is to ask ONCE about the whole app instead of 167 times about its
parts.**

Ship a tiny version file — one line, a build id or the commit sha. The service
worker fetches only that, `no-cache`, on activation and on each navigation:

- **Version unchanged** → serve all 167 modules straight from CacheStorage.
  Zero network, zero revalidation. The staircase collapses to disk-read speed.
- **Version changed** → treat the cached copies as dead, refetch, repopulate,
  and carry on. Exactly today's behaviour, but once per deploy instead of once
  per load.

**WHY THIS DOES NOT REOPEN THE MIXED-VERSION BUG.** `sw.js:159-183` records the
real failure: `index.html` was pinned no-cache while modules were not, so a fresh
shell imported stale modules underneath it and the app ran two versions at once —
seen live as an ended storm grey in the list and pink on the globe. The guard
that closed it was "always ask". A version gate keeps the guard and moves it: the
app still verifies it is current on every single load, it just does it with one
request that covers everything rather than 167 that each cover one. **A partial
update becomes impossible rather than merely unlikely** — today, 167 independent
revalidations can in principle half-succeed; a single gate is all-or-nothing.

**What it costs.** First visit is unchanged — 167 requests either way, because
there is nothing cached yet. The visit immediately after a deploy is unchanged
for the same reason. Everything in between, which is **1,991 of 2,036 measured
sessions**, pays one request instead of 167.

**What to watch.** The gate must be checked before any module is served from
cache, or a stale bundle wins a race against its own invalidation. And the
version file must be genuinely uncacheable — it is the one thing in the app that
cannot be allowed to go stale, because everything else now trusts it.

**Effort:** contained, inside `sw.js`, roughly a day including a test that fails
when the gate is bypassed. **No build step. No change to how the repo is laid
out. Reversible by deleting it.**

**Then re-run the audit.** If the staircase is gone, #18 is unnecessary and the
no-build rule survives on merit rather than on principle. If a second is still
sitting there, that is when bundling has earned the argument.

## The instrument

```
node tools/perf-audit.mjs                 # live URL, throttled to a phone-ish device
node tools/perf-audit.mjs --fast          # unthrottled, NOT a user-facing number
node tools/perf-audit.mjs --json out.json --budget
```

Runs three arms — `cold-nosw` (what the old probes measured), `warm-sw` (what
98% of real sessions get), and a radar arm that pans and re-counts. Thresholds
live in `tools/perf-budget.json`; `.github/workflows/perf-audit.yml` runs it
nightly, writes the run to a `perf-history` branch, and fails on a budget breach.

**The budget numbers in `perf-budget.json` are placeholders and say so.**
Calibrate them from the first runner result, in a reviewed commit. A budget
nothing can fail is decoration.

---

## Provenance — what is measured, what is read, what is neither

**MEASURED LIVE** (real Chrome, live deploy, 2026-08-19): the 171-module warm
load and its per-module service-worker timings; the 1,960 ms vs 2,322 ms A/B;
the five-deep API chain and its wire timestamps; the 2,459 ms first-API time;
the `gdacs/geometry` payload size; the two live storms.

**MEASURED FROM D1** (`landfall-telemetry`, `sessions`): 1,991 of 2,036 sessions
service-worker controlled; the §52 platform table.

**READ FROM CODE, citation-verified**: every `file:line` in this document was
checked against the file after being written. Two were wrong on the first pass
and are corrected here — the "NOTHING OPEN ON LAUNCH" quote is `main.js:1197`,
not `:1180`, and the view constructions start at `app/views.js:553`, not `:387`.

**NEITHER — explicitly open**: everything under §6. Those need the runner.
`tools/perf-audit.mjs` measures them; nothing in this file guesses at them.
