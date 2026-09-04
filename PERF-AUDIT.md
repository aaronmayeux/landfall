# PERF-AUDIT.md — what is slow, measured, and what to do about it

**Measured 2026-08-19** against the live deploy from real Chrome on Aaron's Mac,
plus D1 `landfall-telemetry` field data and a full read of the boot, data and
service-worker paths. Two storms were live: **Lala** (`nhc:cp012026`, Central
Pacific) and **SAUDEL** (`gdacs:1001305`, West Pacific).

**PRESSURE-TESTED 2026-08-19 by a second session**, in the locked sandbox, with
no browser and no internet beyond GitHub. That review re-checked every `file:line`
against the file, re-derived every module number with `tools/module-graph.mjs`
instead of trusting the written one, and **found five items that were wrong**.
One of them shipped a blank screen. What follows is the corrected document; the
corrections are listed together in the next section so nothing is quietly
rewritten.

This file is the finding. `tools/perf-audit.mjs` is the instrument that
re-derives it, and `.github/workflows/perf-audit.yml` runs that nightly on the
GitHub runner, which has the open internet the sandbox does not.

---

## STATE OF THE MEASUREMENT — NO RUN HAS EVER RECORDED

**The `perf-history` branch does not exist.** `git ls-remote origin` returns
nothing matching it. The workflow was committed on 2026-08-19 and its nightly
cron is `10 7 * * *`, so the first scheduled run has not happened yet and no
hand-triggered run has either.

**Nothing below is blocked on it, but §7 is.** Trigger it:

```
Actions -> perf-audit -> Run workflow
```

Then read the result from the sandbox with plain git — the branch is the only
channel that reaches both the runner and the sandbox, which is exactly why the
workflow writes one:

```
git fetch origin perf-history && git show origin/perf-history:runs/
```

**Expect the first run to FAIL, and that is correct.** `perf-budget.json` sets
`colorNulls: 0` and NOW.md item 0d says they happen dozens of times per load. The
job writes the JSON before it fails, so the measurement survives the failure.

---

## WHAT THE 2026-08-19 REVIEW CHANGED

Five substantive errors, plus about ten citations that had drifted by one to
three lines. The citation drift is corrected silently below. The five are not.

**1. Tier 1 item 5 was a blank screen.** It said "delete the dead `data/surge.js`
import" from `main.js:53`. **`data/surge.js` is not dead.** `fixtureAdvisory()`
is called synchronously at `main.js:651` and again at `main.js:1051`. Deleting
the import is a `ReferenceError` on **every** load, not just `?surge=milton`.
The module is *inert*, which is not the same thing. It is worth 1 module and
9 KB out of 167 and 3,034 KB. **Item deleted from the plan entirely** rather
than demoted — the payoff never justified the care it needs.

**2. Tier 1 item 2 was not a one-liner.** `underRateLimit(request, opts)` at
`functions/api/_rate-limit.js:62` **has no `context`**, so it cannot call
`context.waitUntil`. Making the counter write non-blocking means changing the
signature and the call site at `functions/api/_middleware.js:98`. Two files, and
it moves to Tier 2 with the real shape written out.

**3. "One of four routes with no upstream abort budget" was wrong — it is
fourteen.** Counting only routes that fetch upstream, and excluding the `_`
helpers, the `inspect` routes and `replay`: `cap/alerts`, `gdacs/geometry`,
`imagery/radar-coverage`, `imagery/radar-frames`, `imagery/radar`, `jtwc/abpw`,
`jtwc/warning`, `nhc/adeck`, `nhc/advisory`, `nhc/genesis`, `nhc/mapserver`,
`nhc/outlook`, `tcgp/adeck`, `tcgp/storms`. Tier 2 item 11 was scoped at under a
third of its real size and is **rescoped to the five on the boot path**.

**4. Every module saving in §3 was inflated, some to zero.** Re-derived with
`node tools/module-graph.mjs` and a per-edge cut analysis:

| claim in the original | measured |
|---|---|
| "eight more modules... ~30 modules off boot" | **3 modules / 36 KB** once the unsafe ones are removed |
| `app/views.js` "owns 45 modules / 849 KB — 27%" | **33 modules / 656 KB — 20%** |
| combined "169 → 94, 3,050 → 1,710 KB, 44%" | **167 → 108, 3,034 → 1,947 KB, 35%** |
| "collapses waves 4 and 5" | **6 waves → 5.** One wave, not two. |

The 45/849 figure counted a subtree including modules that are also reached from
elsewhere, so cutting the edge does not remove them. `data/adeck.js` and
`data/ships.js` save **literally zero modules and zero bytes** for the same
reason. Three more — `app/bundle-pipeline.js`, `ui/first-run.js`,
`map/imagery.js` — are constructed **unconditionally at boot**
(`main.js:291`, `:1179`, `:616`), so making them dynamic just moves the `await`
into the boot path. **Tier 2 item 12 is gutted.** The drawer views survive and
get bigger by comparison, which is the useful half of this finding.

**5. §7's payoff is unproven, and the document never argues for it.** This is the
important one — see the pressure test in §7 below. The whole 1,899 ms is
attributed to `171 × 11.17 ms` of service-worker **pickup gap**. If that gap is
the browser dispatching a fetch event rather than the network answering it, a
version gate does not remove it: you would spend a day and recover the ~30 ms of
handling, not the 1.9 s of span. The A/B already in this file does not settle it,
because both arms were network-bound. **One workflow run does settle it, with no
code change**, because `tools/perf-audit.mjs:149` already records `workerStart`
per resource into the raw JSON. **Do not start §7 before that run lands.**

**One more thing, not an error but worth saying:** three different module counts
appear in the original — 167, 169 and 171. They mean different things and are
now labelled. **167** is our own ES modules (`tools/module-graph.mjs`). **171**
is what was seen on the wire, which additionally counts `index.html`, `sw.js`
and `surge/boot.js`. **169** was a typo for 167.

---

## READ THIS BEFORE TRUSTING A NUMBER

**Four caveats, stated up front rather than buried, because three of them
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

4. **AND THAT A/B DOES NOT PROVE WHAT §7 NEEDS IT TO.** Both arms went to the
   network for every module. Neither arm measured what a module costs when it is
   served from CacheStorage without asking, which is the thing §7 proposes to
   sell. The A/B rules out "delete the worker". It does not rule in "version-gate
   the worker". That gap is why §7 now carries a pressure test.

---

## THE HEADLINE

**A returning visitor re-validates all 167 application modules over the network,
one at a time, on every single load. That costs about two seconds before any
data request is even issued.**

It is not the module graph's depth, not the network, and not the service worker
existing. It is that nothing our app ships is allowed to be served from a cache
without asking the network first.

**§7 is the proposed fix and it is a good idea whose payoff has not been
measured. Measure it first — one workflow run, no code.** The Tier 1 and Tier 2
work below is worth doing regardless of how that measurement lands.

---

## 1. Every warm load revalidates 167 modules over the network

**MEASURED.** Warm load, everything already cached, fast Mac, no VPN:

| | |
|---|---|
| requests for our own JS, on the wire | **171** (167 ES modules + `index.html`, `sw.js`, `pwa.js`, `surge/boot.js`) |
| all of them via the service worker | **171 of 171** |
| service worker pickup gap | **11.17 ms**, near-constant |
| service worker handling, per module | **~30 ms**, near-constant |
| span, first pickup to last | **1,899 ms** |
| module staircase (first request → last byte) | **1,960 ms** |
| first `/api/` call issued at | **2,459 ms** |

171 × 11.17 ms = 1,899 ms, which is the observed span to three significant
figures. **What that arithmetic does NOT tell you is which of the two numbers is
the cause** — whether the 11.17 ms spacing is the browser's dispatch rate (in
which case it survives any caching change) or the downstream consequence of the
~30 ms of network handling. §7 depends entirely on the answer and the answer is
one workflow run away.

**WHY, IN CODE.** All verified against the file on 2026-08-19.

- `sw.js:72` — `IMMUTABLE_PATHS = ['/vendor/']`. **Only vendor is cache-first**
  (the test is at `sw.js:102`).
- `sw.js:107` — everything else same-origin goes to `networkFirst`.
- `sw.js:185` — `fetch(req, { cache: 'no-cache' })`, a **forced revalidation**
  that deliberately bypasses the browser's own disk cache. Navigations are
  exempt on purpose and the reason is in the comment.
- `sw.js:187` — `await caches.open(CACHE)` on the critical path of every
  response. 167 awaited IndexedDB handle opens per load.
- `sw.js:188` — `cache.put(req, res.clone())` writes every module back on every
  load, byte-identical to what is already there.
- `_headers:171-223` — `Cache-Control: no-cache` on `/main.js`, `/pwa.js` and
  the `app/ config/ data/ lib/ map/ proto/ tools/ ui/` directories, belt-and-braces
  with the above. *(The original said `171-200`, which stops at `/map/*` and
  omits `/ui/*` — the directory holding all seven drawer views §3 is about.)*

**AND THE REASON IS GOOD, WHICH IS WHY THIS IS NOT A ONE-LINE FIX.** The comment
at `sw.js:161-184` records a real, observed bug: `index.html` is pinned no-cache
while modules were not, so the shell was always fresh and free to import stale
modules underneath it. The app ran a **mixed version** — an ended storm drawn
grey in the list and pink at full height on the globe. `no-cache` is what closed
that. **Do not simply delete it.**

The comment also records the mitigation that is already in place and that §7
leans on: *"`no-cache` forces a revalidation, not a re-download: with an ETag the
answer is a 304 and almost no bytes."* So the ~30 ms per module is a round trip,
not a transfer. That is why the staircase costs two seconds while
`transferKB` stays small.

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

### 1b. The harness records the deciding number but does not report it

`tools/perf-audit.mjs:149` already captures `worker: r.workerStart || 0` for
every resource, so **the raw JSON on the `perf-history` branch answers §7's
question**. `summarise()` in `tools/perf-instrument.mjs:124` never surfaces it —
it reports counts, bytes and the span, and throws the per-request worker timing
away. Reading it back out of the JSON needs no code change and no browser. See
§7.

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
body.** They are global rosters, fetched lazily from inside the join functions
that `fetchGdacsStorms()` awaits in sequence — `withJtwcWinds(live)` at
`data/gdacs.js:402` and `withCarqHistory(enriched)` at `data/gdacs.js:420`.
The actual index fetches are one level down, at `data/jtwc-wind.js:44`
(`await getJtwcIndex()`) and `data/carq.js:92` (`await getTcgpIndex()`).

Both index modules memoise on a TTL **and dedupe concurrent callers**
(`data/jtwc-index.js:57`, `data/tcgp-index.js:44`) and both swallow their own
failures into a `state: 'unavailable'` rather than throwing
(`data/jtwc-index.js:70`, `data/tcgp-index.js:56`). So starting them early
changes no observable behaviour: the later `await` inside the join picks up the
in-flight promise. **Depth 5 → 2, and the awaits never move.**

**Related, two lines:** `data/genesis.js:363` awaits both NHC outlook bulletins
before line `:364` starts `fetchJtwc(now)`, which takes no argument from them
(`data/genesis.js:281`). Depth 3 → 2.

**Biggest single payload:** `/api/gdacs/geometry` at **329,677 bytes decoded /
72,148 on the wire**, and it is one of **fourteen** routes with **no upstream
abort budget** (`functions/api/gdacs/geometry.js:143`) against a source
`config/constants.js:127` calls "legendary 90 s".

---

## 3. Zero dynamic imports anywhere in the application

167 modules, 6 waves, 3,034 KB of our own JS — **re-derived 2026-08-19 with
`node tools/module-graph.mjs`, matches** — and **not one `import()`**.
Everything the app can ever do is linked before the globe draws a frame.

### 3a. The drawer views are the real prize

`app/views.js:45-51` statically imports all seven drawer views and constructs
all seven at boot (`app/views.js:553` onward). `main.js:1197` states the design
intent outright:

> *"NOTHING OPEN ON LAUNCH, at any width."*

The constructors are cheap — they build DOM in `enter()`/`mount()`, not at
construction. **The cost is import, not construction**, which is exactly what
`import()` fixes. `ui/drawer.js:354` already has a `register(def)` API and
`ui/drawer.js:295` a `go(id, arg)`, so the seam exists.

**MEASURED, not asserted.** Cutting all seven edges from `app/views.js`:

```
BASELINE          167 modules  3034 KB  6 waves
SEVEN VIEWS CUT   134 modules  2378 KB  5 waves   (saves 33 modules / 656 KB)
```

**33 modules and 656 KB — 20% of the graph — and it collapses one wave, not
two.** The original's 45 / 849 / 27% counted modules that are also reached from
elsewhere, so cutting the edge does not remove them.

### 3b. The other eight are mostly worthless, and the review says so

The original listed eight more modules "gated behind data or a user action that
cannot fire at boot". Measured one edge at a time:

| module | modules saved | KB saved | verdict |
|---|---|---|---|
| `app/bundle-pipeline.js` (`main.js:33`) | 6 | 114 | **NO.** `createBundlePipeline(...)` is called unconditionally at `main.js:291`. Lazy-loading moves an await into boot. |
| `map/imagery.js` (`main.js:41`) | 6 | 105 | **NO.** `addStormImagery(map, ...)` is called unconditionally at `main.js:616`, inside the style-ready path. |
| `ui/first-run.js` (`main.js:44`) | 1 | 8 | **NO.** `createFirstRun({...})` is called unconditionally at `main.js:1179`. |
| `data/surge.js` (`main.js:53`) | 1 | 9 | **NO — this one breaks the app.** See the corrections section. |
| `data/adeck.js` (`main.js:65`) | **0** | **0** | **NO.** Shared subtree; the edge cut removes nothing. |
| `data/ships.js` (`main.js:66`) | **0** | **0** | **NO.** Same. |
| `map/storm-mesh.js` (`main.js:72`) | 1 | 22 | yes — genuinely post-data, called at `main.js:852`. |
| `data/ended-track.js` (`main.js:69`) | 1 | 8 | yes — called at `main.js:1087`, after a poll. |
| `data/warm.js` (`main.js:64`) | 1 | 6 | yes — called at `main.js:1089`, after a poll. |

**The safe subset is three modules and 36 KB. About 1% of the graph.** That is
not worth a push on its own and it is not worth the risk of an `await` landing
somewhere subtle. Fold it into the drawer-view work or drop it.

**Combined ceiling, if both the views and the safe three are done:**

```
BOTH              108 modules  1947 KB  5 waves   (saves 59 modules / 1087 KB)
```

**167 → 108 and 3,034 → 1,947 KB. 35% of the graph, not 44%.**

---

## 4. What is NOT the problem — do not spend time here

Checked specifically because they are the obvious suspects. All measured.

- **`config/constants.js` is 285 KB but 92% comments** — ~22 KB of real code,
  **2.75 ms** to import. Same shape for `config/tokens.js` (**1.5 ms**) and
  `config/layers.js` (**0.5 ms**). **Parse time is not the problem; module count
  is.** Compression handles the prose.
- **`map/coastline.js`** — 76 KB, 126 rings, **1.4 ms**. Fine as a module.
- **`assets/hazards/population-towns.json`** (1.87 MB) is correctly lazy —
  `config/layers.js:685` sets `default: false` on the `population` layer and it
  is only fetched by `ensurePopulation()`. Not a boot cost. *(It does
  `res.json()` a 1.87 MB body on the main thread when toggled on — a jank
  finding, not a boot one.)*
- **`data/lifecycle.js:1043`** top-level localStorage read — capped at 12 storms
  × 64 points. Sub-millisecond.
- **Hidden-tab polling.** All three repeating timers stop correctly on
  `document.hidden` (`data/store.js:384`, `map/imagery.js:768`,
  `map/radar-layer.js:329`). **This is well built and I found nothing to fix.**
- **modulepreload, moving Three.js off boot, the OpenFreeMap CDN** — already
  settled and rejected in `SPEC.md` / NOW.md. Nothing here reopens them.

---

## 5. Relay and edge

- **`functions/api/nhc/advisory.js:95` — `FRESH_SECONDS = 5 * 60` against a
  5-minute cron** (`worker/wrangler.toml:61`, `crons = ["*/5 * * * *"]`). This is
  the exact DOLPHIN-26 collision `SPEC-DATA.md` §4.13 bans in capitals: *"THE
  CRON CADENCE MUST BE FASTER THAN THE SHORTEST WINDOW IT REFILLS, NEVER EQUAL
  TO IT."* `worker/wrangler.toml:51` asserts the shortest warmed window IS 15
  minutes, which is factually wrong because of this line.

  **VERIFIED EXHAUSTIVELY BY THE REVIEW.** Every `FRESH_SECONDS` in
  `functions/api/` was read and cross-checked against the warm list in
  `worker/src/sources.js`. The routes that ARE warmed run 15 min or longer —
  except this one. Three routes are shorter (`imagery/radar-frames` at 60 s,
  `imagery/satellite` at 5 min, `cap/*` at 10 min) and **none of them is
  warmed**, so none of them collides. **This really is the only one. One
  constant. Highest-confidence fix in this file.**

- **`/api/nhc/mapserver` is not warmed, and the recorded reason is obsolete.**
  `worker/src/sources.js:30-35` refuses on the grounds that layer ids need block
  math — but `functions/api/nhc/mapserver.js:27-37` says the switch to the
  summary service made those ids fixed constants and *"warming this route is now
  a plain question of whether it is worth it, not a correctness trap."* The
  Worker never got the memo. It is the largest payload class in the app, **cold
  in every colo**, and it is 9 requests per NHC storm.

- **`worker/src/index.js:73` — `MAX_DERIVED = 64`, and `:270-275` concatenates
  `nhc, jtwc, gdacs, tcgp` then `:289` slices.** TCGP is always what gets
  dropped, and TCGP is stage 4 of §2's chain. A busy September trips it.
  Raise to 128 **and interleave**, so a cap truncates evenly instead of
  decapitating one source.

- **`functions/api/_rate-limit.js:85` awaits a `cache.put` before every relay
  request runs.** The counter is already documented as approximate and fails
  open, so the write does not need to block. **This is NOT the one-liner the
  original claimed** — `underRateLimit(request, opts)` at
  `functions/api/_rate-limit.js:62` receives no `context` and therefore cannot
  call `context.waitUntil`. The fix threads it through from
  `functions/api/_middleware.js:98`. Two files, still small, moved to Tier 2.

- **`nhc/storms.js:70-74` and `gdacs/events.js:118-122` send no `Cache-Control`
  at all** — both `baseHeaders` helpers set only `Content-Type` and
  `Access-Control-Allow-Origin` — while §4.13 claims every relay route sends
  `no-store`. Two lines. **Verified.**

- **Only two routes serve stale and refresh behind the response.** The
  `pullUpstream(...)` helper is defined at `nhc/storms.js:82` and
  `gdacs/events.js:147` and is called under `waitUntil` from the stale and warm
  branches of both (`nhc/storms.js:231`, `:247`; `gdacs/events.js:267`, `:280`).
  *(The original said `waitUntil` "exists nowhere else", which is not true —
  27 route files use it, mostly to write a cache entry after responding. What is
  unique to these two is the serve-stale-then-refresh SHAPE.)* Everywhere else,
  including `gdacs/geometry.js` and `nhc/advisory.js`, a reader arriving after
  expiry `await`s upstream with a valid last-good copy one `cache.match` away.
  §4.13's own parity rule — *"no data behaviour is finished until both sources
  have it"* — was applied to the lists and stopped there.

- **Return-to-visible is unthrottled in all three places.** `data/store.js:402`
  calls `pollAll()`, `map/imagery.js:775` calls `refreshAll()`,
  `map/radar-layer.js:336` calls `loadFrame()`, each with no minimum age check.
  A phone app-switching ten times re-runs the whole ~11-request poll each time,
  against the 120/min per-IP budget at `functions/api/_middleware.js:63` shared
  across a carrier NAT. A minimum-age guard is ~5 lines per site.

- **Fourteen routes have no upstream abort budget.** Full list in the
  corrections section. Five are on the boot path and those are the ones worth
  doing: `gdacs/geometry`, `tcgp/storms`, `nhc/mapserver`, `nhc/outlook`,
  `nhc/genesis`.

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
  traced, never counted. `tools/perf-instrument.mjs:48` hooks `console.error` and
  counts them, and keeps the first five messages so the property can be
  identified. **The budget is set to 0, so this one fails CI until it is fixed.**
  Console was clean on a load where the map never built, which tells us it is
  map-related and nothing more.
- **What a module costs when it is served from cache instead of the network.**
  Added by the review. This is §7's whole case and nothing has measured it. See
  §7 — the data is already in the JSON the first run writes.

### 6a. `dimCoast` — the one UNMEASURED item that is now CONFIRMED from code

The original listed this as "believed to throw". **The review confirmed it
without a browser.**

`map/layers/surge.js:159` is `dimCoast`, and `:173` wraps the existing paint
value: `['*', original, OPACITY.surgeCoastDim]`. `COAST_LAYERS` at
`map/layers/surge.js:155` is `['coast-glow', 'coast-core']`, and both of those
layers set `line-opacity` from `byZoom([...])` — `map/style.js:865` and
`map/style.js:885`. `byZoom` produces a **zoom interpolate**, and MapLibre
forbids a zoom expression anywhere except the top level of a `step` or
`interpolate`. So `setPaintProperty` throws on every call and the coast has
never once dimmed.

**And `tools/test-surge.mjs` passes over it** — 1,481 assertions green, confirmed
by running it in the sandbox. `tools/test-surge.mjs:240` drives `dimCoast` with a
stub map that does not validate expressions. **The fix is to scale the
interpolate's OUTPUT stops rather than wrap the whole expression.** The test is
half the fix and it is the half worth doing first: make it fail, then make it
pass. `tools/test-maplibre-api.mjs` exists for exactly this class of bug and is
the natural home for the assertion.

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
parts.** Ship a tiny version file — one line, a build id or the commit sha. The
service worker fetches only that, `no-cache`, on activation and on each
navigation:

- **Version unchanged** → serve all 167 modules straight from CacheStorage.
  Zero network, zero revalidation.
- **Version changed** → treat the cached copies as dead, refetch, repopulate,
  and carry on. Exactly today's behaviour, but once per deploy instead of once
  per load.

**WHY THIS DOES NOT REOPEN THE MIXED-VERSION BUG.** `sw.js:161-184` records the
real failure: `index.html` was pinned no-cache while modules were not, so a fresh
shell imported stale modules underneath it and the app ran two versions at once —
seen live as an ended storm grey in the list and pink on the globe. The guard
that closed it was "always ask". A version gate keeps the guard and moves it: the
app still verifies it is current on every single load, it just does it with one
request that covers everything rather than 167 that each cover one. **A partial
update becomes impossible rather than merely unlikely** — today, 167 independent
revalidations can in principle half-succeed; a single gate is all-or-nothing.

### ==> THE PRESSURE TEST. DO NOT START THIS BEFORE RUNNING IT. <==

**The claim §7 sells is that the 1,899 ms span is network. It has not been
measured, and the arithmetic in §1 is equally consistent with the opposite.**

- If the **11.17 ms pickup gap** is the browser dispatching a fetch event to the
  worker, it is paid whether the worker answers from cache or from network. A
  version gate then saves the ~30 ms of handling and leaves the 1.9 s span
  roughly where it is. **§7 would be a day spent for a small win.**
- If the 11.17 ms spacing is the downstream *consequence* of 30 ms of network
  work queueing up, the gate collapses the whole staircase to disk-read speed
  and **§7 is the best item in this file by a distance.**

**The existing A/B does not distinguish these.** Both arms went to the network
for every module; that experiment rules out deleting the worker and rules in
nothing.

**The experiment costs one workflow run and zero code.**
`tools/perf-audit.mjs:149` already records `worker: r.workerStart` for every
resource into the raw JSON, and `/vendor/` is **already cache-first in the
shipping build** — so the deployed app contains its own control group. Once
`perf-history` has a run in it, from the sandbox:

```
git fetch origin perf-history
git show origin/perf-history:runs/<newest>.json > /tmp/run.json
```

Then compare, for the `warm-sw` arm, the per-resource `start`, `worker` and `end`
of the two `/vendor/` files (served from cache, no network) against our own
modules (revalidated). **If a cache-served resource still shows ~11 ms of
worker-dispatch spacing and ~11 ms of total cost, the gap is dispatch and §7 is
oversold. If a cache-served resource is near-free while ours cost 30 ms, §7 is
worth the day.** Two vendor files is a thin control, but it is free and it is
already deployed.

**A cheaper half-step if the answer is ambiguous:** add one directory — say
`/lib/` — to `IMMUTABLE_PATHS` behind a hashed query string, deploy, and
re-measure. That buys the answer on ~30 real modules for an hour's work instead
of a day's.

**What it costs if it goes ahead.** First visit is unchanged — 167 requests
either way, because there is nothing cached yet. The visit immediately after a
deploy is unchanged for the same reason. Everything in between, which is **1,991
of 2,036 measured sessions**, pays one request instead of 167.

**What to watch.** The gate must be checked before any module is served from
cache, or a stale bundle wins a race against its own invalidation. And the
version file must be genuinely uncacheable — it is the one thing in the app that
cannot be allowed to go stale, because everything else now trusts it.

**Effort:** contained, inside `sw.js`, roughly a day including a test that fails
when the gate is bypassed. **No build step. No change to how the repo is laid
out. Reversible by deleting it.**

### And bundling, kept honest

**Do not do #18 before doing #14 and re-running the audit.** Bundling is the most
expensive change in this file and the only one that ends the no-build rule. It
should be bought with a measured before-and-after, and the harness exists so that
number costs one workflow run.

---

## THE PLAN — GROUPED INTO PUSHES, WITH A VERIFICATION ROUTE FOR EVERY ITEM

**Every deploy costs a Cloudflare build and a look, so the invisible work is
batched and each visual change gets its own push.**

### How to read the verification tags

| tag | meaning |
|---|---|
| **[S]** | **Sandbox.** A zero-dependency `tools/test-*.mjs` or `check-syntax` proves it before the push. CI picks up any new `tools/test-*.mjs` with no edit to `ci.yml` (`ci.yml:139`). |
| **[R]** | **Runner.** Needs `perf-audit.yml` or a CI job with open internet. Proved after the push, not before. |
| **[G]** | **Glass.** Aaron looks at the deployed app. Named screen, named storm, named right-vs-wrong. |
| **[—]** | **No route.** Cannot be proved by anything. **Nothing with this tag is allowed in Tier 1 or 2.** |

### ==> THE VPN TRAP — READ BEFORE ANY "GO AND LOOK" STEP. <==

**An empty-cache hard reload on the work PC triggers GlobalProtect and makes the
site look dead.** Every look below is written phone-first for that reason. If a
deploy looks broken:

1. **Check on the phone, on cell data, with wifi off.** That is the verdict.
2. Only if the phone also fails is the deploy actually broken.
3. Never conclude a deploy failed from the work PC. Ever.

And: **a successful Cloudflare build is not a successful deploy.** Check *where*
before *whether* — confirm the version you are looking at is the one you pushed.

---

### PUSH 0 — NO CODE. DO THIS FIRST, IT COSTS FOUR MINUTES.

**Actions → perf-audit → Run workflow.** Leave the inputs at their defaults.

**Expect it to go red.** `colorNulls` is budgeted at 0 and NOW.md item 0d says
they happen dozens of times per load. The JSON is written before the failure, so
the run is still good.

**What it buys, all of which is currently guesswork:**

- the first real numbers from a throttled, phone-shaped browser instead of a Mac
- the radar tile count on load and after one pan — NOW.md 0b, never once watched
- the colour-null count and the first five messages, which names the property
- idle frame pacing p95
- **the §7 pressure test** — the `worker` field per resource, vendor vs ours

**Then calibrate `tools/perf-budget.json` from the result, in its own commit.**
The file says its numbers are placeholders and it is right. A budget nothing can
fail is decoration.

**Nothing else in this plan is blocked on Push 0 except §7.** Start Push A while
it runs.

---

### PUSH A — THE INVISIBLE BATCH. NOTHING TO LOOK AT. ONE DEPLOY.

Server-side and worker-side only. **No visual change of any kind**, so there is
no glass step — verify by CI going green and by the next perf-audit run.

**A1. The DOLPHIN-26 collision.** [S]

`functions/api/nhc/advisory.js:95`

```
const FRESH_SECONDS = 5 * 60;
```
→
```
const FRESH_SECONDS = 15 * 60;
```

Then fix the claim it falsifies. `worker/wrangler.toml:51` currently reads:

```
# been 30 since 2026-08-01. The shortest FRESH window now warmed is 15 minutes
```

That sentence becomes true the moment the constant changes, so **the edit is to
the constant and the comment stays** — but add a line naming advisory explicitly
so the next session can see the invariant is deliberate rather than lucky.

*Verification:* add an assertion to `tools/test-relay-mirrors.mjs`, which already
exists to stop exactly this class of hand-copied drift and already guards "four
cache lifetimes". Assert that every warmed route's `FRESH_SECONDS` is **strictly
greater** than the cron interval. That test fails today and passes after the
edit — which is the only kind of test worth adding.

**A2. Missing `Cache-Control` on the two list routes.** [S]

`functions/api/nhc/storms.js:70-74` and `functions/api/gdacs/events.js:118-122`
are both:

```
const baseHeaders = (extra = {}) => ({
  'Content-Type': 'application/json; charset=utf-8',
  'Access-Control-Allow-Origin': '*',
  ...extra,
});
```
→
```
const baseHeaders = (extra = {}) => ({
  'Content-Type': 'application/json; charset=utf-8',
  'Access-Control-Allow-Origin': '*',
  'Cache-Control': 'no-store',
  ...extra,
});
```

`...extra` stays last so the per-branch `s-maxage` headers still win where they
are set deliberately.

*Verification:* `tools/test-relay-mirrors.mjs` again, or a new
`tools/test-relay-headers.mjs`. CI picks it up automatically.

**A3. `MAX_DERIVED` and the interleave.** [S]

`worker/src/index.js:73`

```
const MAX_DERIVED = 64;
```
→
```
const MAX_DERIVED = 128;
```

And `worker/src/index.js:270-275`:

```
  let derived = [
    ...nhcDerived(parse('nhc/storms') || {}),
    ...jtwcDerived(parse('jtwc/storms') || {}),
    ...gdacsDerived(parse('gdacs/events') || {}),
    ...tcgpDerived(parse('tcgp/storms') || {}),
  ];
```

becomes a round-robin interleave of those four arrays, so that when the cap does
trip it truncates all four evenly instead of decapitating TCGP. **Raising the cap
without interleaving fixes today and not September** — do both or neither.

*Verification:* `tools/test-warm-cycle.mjs` already asserts on `summary.dropped`
and `summary.derived` (`tools/test-warm-cycle.mjs:151`). Add a case with more
than 128 derived entries across four sources and assert every source survives the
cap. Runs in the sandbox in under a second.

**A4. The rate-limit counter write.** [S]

**Not the one-liner the old plan claimed.** `functions/api/_rate-limit.js:62` is
`underRateLimit(request, {name, windowSeconds, maxRequests})` — no `context`, so
no `waitUntil`. Two edits:

- `functions/api/_middleware.js:98` — `await underRateLimit(request, RATE)`
  becomes `await underRateLimit(request, RATE, context)`
- `functions/api/_rate-limit.js:62` — take a third parameter and wrap the
  `await cache.put(...)` at `:85` in `context.waitUntil(...)`, dropping the
  `await`. Keep the `try/catch` fail-open exactly as it is.

**Do not simply delete the `await`** — a floating promise in workerd can be
cancelled when the response returns, which would silently stop the counter
incrementing and turn the rate limit off. `waitUntil` is what makes it safe.

*Verification:* [S] `node tools/check-syntax.mjs`, plus a small test asserting
the function still returns `{ok:true}` when `context.waitUntil` is absent
(it is called from tests without one).

**A5. Abort budgets on the five boot-path routes.** [S]

`gdacs/geometry.js`, `tcgp/storms.js`, `nhc/mapserver.js`, `nhc/outlook.js`,
`nhc/genesis.js`. Copy the shape already in `functions/api/nhc/storms.js:68`
(`UPSTREAM_BUDGET_MS = 10 * 1000` and a `signal`). The other nine unbudgeted
routes are real but off the boot path — leave them.

*Verification:* [S] a test asserting each of the five defines a budget, in the
same file as A2's header test. Cheap and it stops the list regrowing.

**WHAT TO DO AFTER PUSH A LANDS:** nothing visual. Confirm the Cloudflare build
went green and confirm the app still loads on the phone. That is the whole check.
**If the phone loads the app and shows storms, Push A is done.**

---

### PUSH B — THE DATA CHAIN. ONE DEPLOY, ONE SHORT LOOK.

**B1. Parallelise the two global indexes.** [S] then [G]

`data/gdacs.js` — add two imports after `:32`:

```
import { withCarqHistory } from './carq.js';
```
→
```
import { withCarqHistory } from './carq.js';
import { getJtwcIndex } from './jtwc-index.js';
import { getTcgpIndex } from './tcgp-index.js';
```

Then `data/gdacs.js:310-311`:

```
export async function fetchGdacsStorms() {
  const { json, relayStale, fetchedAt } = await fetchFeed(`${ENDPOINT.relay}/gdacs/events`);
```
→
```
export async function fetchGdacsStorms() {
  /* ==> THE TWO GLOBAL INDEXES DEPEND ON NOTHING IN THE EVENTS BODY. <==
   * Both memoise on a TTL and dedupe concurrent callers, so kicking them off
   * here costs nothing and the awaits below pick up the in-flight promise
   * instead of starting a round trip. The awaits do not move: they stay in
   * withJtwcWinds (data/jtwc-wind.js:44) and withCarqHistory (data/carq.js:92),
   * so every failure path is exactly the one that was there before. */
  getJtwcIndex().catch(() => {});
  getTcgpIndex().catch(() => {});
  const { json, relayStale, fetchedAt } = await fetchFeed(`${ENDPOINT.relay}/gdacs/events`);
```

**The `.catch(() => {})` is load-bearing** — without it these are unhandled
rejections at boot. The real error handling still happens at the awaits.

**B2. Parallelise `fetchJtwc` in genesis.** [S]

`data/genesis.js:363-364`:

```
  const outlooks = await Promise.all(OUTLOOK.basins.map((b) => fetchOutlook(b, now)));
  const [nhc, jtwc] = await Promise.all([fetchNhc(outlooks), fetchJtwc(now)]);
```
→
```
  /* fetchJtwc takes nothing from the outlooks (data/genesis.js:281), so it
   * starts alongside them rather than after them. Depth 3 -> 2. */
  const jtwcPending = fetchJtwc(now);
  const outlooks = await Promise.all(OUTLOOK.basins.map((b) => fetchOutlook(b, now)));
  const [nhc, jtwc] = await Promise.all([fetchNhc(outlooks), jtwcPending]);
```

*Verification:* [S] `tools/test-genesis.mjs` and `tools/test-gdacs-corridor.mjs`
already exist and must stay green — they are the regression net. [R] the next
`perf-audit` run reports `dataSerialDepth`; the budget allows 6 and this should
take it from **5 to 2**.

**==> GO AND LOOK — PUSH B. <==**

**Where:** the app on your phone, on cell data, wifi off. Cold open from the
home-screen icon.

**What right looks like:** the storm list fills with **both** NHC and GDACS
storms, and every West-Pacific / Indian-Ocean storm still shows a **wind speed**
and a **track with a shape to it** — a ridge that climbs, not a flat slab.

**What the bug looks like:** a GDACS storm (anything not NHC-numbered) showing
**no wind number**, or a past track that is a **flat line at one value** across
three days. That means the JTWC or CARQ join lost its index and fell back.

**Which storm:** whichever GDACS storm is live. If none is, this look is not
available and B is verified by [S] and [R] only — say so and move on rather than
inventing a verdict.

---

### PUSH C — THE SURGE COAST DIM. ITS OWN PUSH, BECAUSE IT IS PURELY VISUAL.

**C1. Make the test fail first.** [S]

`tools/test-surge.mjs:240` drives `dimCoast` with a stub map that does not
validate expressions, which is why 1,481 assertions are green over a feature that
has never run. Give the stub a validator that rejects a zoom expression below the
top level, or assert directly that the value handed to `setPaintProperty` is
still a valid `interpolate` and not an `['*', ...]` wrapper.

**Run it and watch it go red before writing the fix.** A test that passes on the
same wrong assumption as the bug is worse than no test.

**C2. Then fix the expression.** [S] then [G]

`map/layers/surge.js:173`:

```
      on && original !== undefined ? ['*', original, OPACITY.surgeCoastDim] : original
```

The replacement scales the interpolate's **output stops** instead of wrapping the
whole expression. `original` is what `byZoom([...])` produced at
`map/style.js:865` (`coast-glow`) and `map/style.js:885` (`coast-core`), so the
fix walks that array and multiplies the output values, leaving the
`['interpolate', ['linear'], ['zoom'], ...]` head intact.

*Verification:* [S] C1's test, now green for the right reason. [R] the colour-null
and console-error count in the next perf-audit run should drop — this throws on
every call today.

**==> GO AND LOOK — PUSH C. <==**

**Where:** `https://landfall.getgravitate.app/?surge=milton` — on the phone, cell
data, wifi off. This is the Milton fixture; it does not need a live storm.

**What right looks like:** the surge polygons draw, **and the coastline behind
them visibly dims** — the glowing coast goes quiet under the hazard so the surge
reads as the thing in front.

**What the bug looks like:** the surge draws and the coastline stays at **full
brightness**, competing with it. That is today's behaviour and has been all
along.

**Also check:** open the browser console on a desktop and confirm the
`setPaintProperty` throw is gone. Do this on the **personal** machine, not the
work PC, and do not hard-reload behind the VPN.

---

### PUSH D — THE VISIBILITY GUARDS. BATTERY, NOT SPEED.

**D1.** Minimum-age guard at three sites, all currently unthrottled: [S]

- `data/store.js:402` — `pollAll()`
- `map/imagery.js:775` — `refreshAll()`
- `map/radar-layer.js:336` — `loadFrame()`

Each becomes "if the last fetch was less than N ago, skip". **N is a new constant
in `config/constants.js` and is defined before the logic that reads it** (§Tuning
— no unexplained numbers). One constant, or three named ones if the cadences
genuinely differ; do not scatter literals.

*Verification:* [S] the three call sites are all in modules with existing tests
(`tools/test-imagery-retry.mjs`, `tools/test-radar-coverage.mjs`). [G] is weak
here — the whole point is that nothing visible changes.

**==> GO AND LOOK — PUSH D. <==**

**What right looks like:** app-switch away and back **ten times in twenty
seconds**. The storm list and the radar stay put, no flicker, no re-spinner.
Then leave it backgrounded for **five minutes**, come back, and the data **does**
refresh. Both halves matter — the first proves the guard works, the second proves
it did not turn the refresh off.

**What the bug looks like:** coming back after five minutes and seeing stale data
with an old timestamp. That means N is too long.

---

### PUSH E — THE DRAWER VIEWS. BIGGEST WIN, OWN PUSH, DO NOT BUNDLE IT WITH ANYTHING.

**33 modules / 656 KB / 20% of the graph / one wave.** Measured, not asserted.

`app/views.js:45-51` become dynamic, registered through the `register(def)` API
that already exists at `ui/drawer.js:354` and reached through `go(id, arg)` at
`ui/drawer.js:295`. Roughly 15 call sites in `main.js` become optional-chained.

**Lift `homeMarker` out first — it genuinely draws at boot** and must not go
behind a lazy import.

*Verification:* [S] `tools/test-views.mjs` exists and is the net. [R] the next
perf-audit run should show `ourModules` fall from ~167 toward ~134 and
`ourWaves` fall by one. [G] below.

**==> GO AND LOOK — PUSH E. THIS IS THE ONE THAT NEEDS A REAL PASS. <==**

**On the phone, cell data, wifi off.** Open every drawer once, in this order, and
confirm each one opens with **no blank frame and no visible delay**:

1. tap a storm → **storm detail**
2. back → tap an **invest / genesis area** → area detail
3. the **Layers** panel
4. **Settings**
5. **Home** — both the setup flow (if no home set) and the dashboard (if one is)
6. the **storm list** itself

**What right looks like:** each panel appears filled. Same as today.

**What the bug looks like:** a panel that opens **empty and fills a beat later**,
or one that opens **blank and stays blank**. Blank-and-stays is a missing
`await`; empty-then-fills is the lazy import being fetched on demand and is the
expected cost — judge whether it is acceptable on glass. That call is yours.

**Then the keyboard pass, mouse untouched, on a desktop:** Tab through the
storms, Enter to select, Esc to close. Every view must still be reachable. A
lazy-loaded panel that only opens on tap is a bug, not a limitation.

---

## HOW FAR ONE DAY REALISTICALLY GETS

**Push 0 + Push A + Push B is a comfortable day, and Push C if it goes well.**

- **Push 0** is four minutes and one look at the Actions summary.
- **Push A** is five small server-side edits plus two or three new test files.
  One session, no glass, and the phone check is thirty seconds.
- **Push B** is about twelve lines across two files plus a look at one storm.
- **Push C** needs the test made to fail before the fix is written, which is the
  slow part and the point of it.

**Push D and Push E are a second day.** E in particular touches ~15 call sites in
`main.js` and needs a full keyboard pass — starting it late is how a half-migrated
drawer gets pushed.

**§7 is NOT on tomorrow's list.** It is gated on Push 0's JSON and on the
pressure test in §7 giving a clear answer. If that answer says the gap is
dispatch rather than network, §7 should be dropped and the day it would have
cost goes to Push E instead.

---

## The instrument

```
node tools/perf-audit.mjs                 # live URL, throttled to a phone-ish device
node tools/perf-audit.mjs --fast          # unthrottled, NOT a user-facing number
node tools/perf-audit.mjs --json out.json --budget
```

Runs three arms — `cold-nosw` (what the old probes measured), `warm-sw` (what
98% of real sessions get), and a radar arm that pans and re-counts. Each arm
closes its browser context before the next one opens; leaving them open starved
the later arms until the third one could not finish loading at all. Thresholds
live in `tools/perf-budget.json`; `.github/workflows/perf-audit.yml` runs it
nightly, writes the run to a `perf-history` branch, and fails on a budget breach
or a crash.

**It cannot measure the live app from the sandbox** — the deploy is outside the
egress allowlist. Where a sandbox has `/opt/pw-browsers` it CAN run against
`http://127.0.0.1:8099`, which exercises the tool end to end even though the
numbers mean nothing without the basemap and the real feeds. Playwright is
imported dynamically at `tools/perf-audit.mjs:404` so a sandbox without it exits
with a message rather than crashing. **The branch is the only channel that
reaches both the runner and the sandbox** — runner logs redirect to a host the
allowlist blocks — which is why the workflow writes one on every run rather than
only on the nightly, and why a crashed run still writes its partial JSON.

**The budget numbers in `perf-budget.json` are placeholders and say so.**
Calibrate them from the first runner result, in a reviewed commit. A budget
nothing can fail is decoration.

---

## Provenance — what is measured, what is read, what is neither

**MEASURED LIVE** (real Chrome, live deploy, 2026-08-19): the 171-request warm
load and its per-module service-worker timings; the 1,960 ms vs 2,322 ms A/B;
the five-deep API chain and its wire timestamps; the 2,459 ms first-API time;
the `gdacs/geometry` payload size; the two live storms.

**MEASURED FROM D1** (`landfall-telemetry`, `sessions`): 1,991 of 2,036 sessions
service-worker controlled; the §52 platform table.

**MEASURED IN THE SANDBOX, 2026-08-19 REVIEW**: 167 modules / 6 waves / 3,034 KB
from `node tools/module-graph.mjs`; every per-edge saving in §3 from a cut
analysis over the same graph; `node tools/check-syntax.mjs` green on 219 modules;
`tools/test-surge.mjs` green on 1,481 assertions **over a broken feature**;
`tools/test-warm-cycle.mjs` green; the absence of the `perf-history` branch from
`git ls-remote`.

**READ FROM CODE, citation-verified TWICE**: every `file:line` in this document
was checked against the file when written and re-checked by the review. Two were
wrong on the first pass; about ten more had drifted by one to three lines and are
corrected here. The material ones: the `sw.js` mixed-version comment is
`161-184`, not `159-183`; the `_headers` no-cache block is `171-223`, not
`171-200`, and the shorter range omits `/ui/*`; `_middleware.js`'s 120/min is at
`:63`, not `:61`; the in-flight dedupes are at `data/jtwc-index.js:57` and
`data/tcgp-index.js:44`, with the failure swallows at `:70` and `:56`; the
unthrottled return-to-visible calls are at `data/store.js:402`,
`map/imagery.js:775` and `map/radar-layer.js:336`, while the hidden-guards that
work correctly are at `data/store.js:384`, `map/imagery.js:768` and
`map/radar-layer.js:329`.

**NEITHER — explicitly open**: everything under §6, and **§7's entire premise**.
Those need the runner. `tools/perf-audit.mjs` measures them; nothing in this file
guesses at them any more.
