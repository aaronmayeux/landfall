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

**==> SHIPPED AND UNSEEN: EVERY RELAY ROUTE NOW REBUILDS ITS CACHE HIT, AND
GDACS FINALLY REPORTS ITS OWN AGE. <==** Eight routes converted, three left
publishing a cache directive on purpose, `SPEC-OPS.md` §17.7. GDACS was stamping
the storm list with the phone's clock, so the "GDACS feed delayed" branch was
unreachable code and NHC was silently the only feed that could raise the banner;
`data/gdacs.js` reads the relay's header now, same as `data/nhc.js`.

**Judge on glass, in this order:**

1. **Does the delayed banner ever fire wrongly now?** The false-alarm ceiling
   went from 90 minutes to 60 with the third clock gone, so it has real margin —
   but GDACS can raise it for the first time ever, and a source that has never
   been able to complain is a source whose complaints have never been seen.
2. **`X-Landfall-Cache` on any relay response** names which of five layers
   answered. Never opened. One header read answers questions that have cost
   whole sessions of inference.
3. **Whether the warm store's key count comes back down.** `KEY_TTL_SECONDS` is
   48 h, so dead storms' keys should drain within two days of a storm ending.
   `GET /api/nhc/inspect?warm=1&key=...` now answers this in one screen: one row
   per route family, and `staleOverTtl` should read **zero**. It read 184 keys
   with the oldest 12.3 days on 2026-08-07, which is what the expiry is for.

**==> SHIPPED AND UNSEEN: THE WHITE RING ON EACH STORM'S FIRST FORECAST DOT. <==**
Marks which end of a track is the future. As-built is `SPEC-MAP.md` §7.5.

White at 3 px against the dark 1.5 px every other dot wears. **Equalising the
widths was tried and reverted on glass** — at 1.5 px the white stops carrying.
Settled. The open question is unchanged: does it read as *start of forecast*
rather than a second storm marker, since the glyph sits roughly 40 nm away.

**==> THE CONE'S FLANKS ARE STILL FACETED, AND THE SPLINE CANNOT FIX THEM. <==**
Shipped 2026-08-08 and judged on glass the same day: it rounded the nose cap and
left the long edges alone. MEASURED — 16 segments longer than ~55 km carry
**81.6% of the published outline's perimeter**, four of them 5.2° (≈570 km)
each, and the breaks between them are mostly under 2°. Those legs are PUBLISHED,
not ours; an interpolating spline through them returns them unchanged, because
it takes its direction from a vertex's neighbours and along a 570 km leg every
neighbour says "straight". As-built is `SPEC-MAP.md` §7.9.

**The rebuild is on branch `cone-sweep-wip`, NOT on main.** It treats the cone as
what it is — a growing circle slid along the smoothed track — and on a
near-straight cone it works: +6.1% area, worst undercut ~1 km, flanks that bend.

**IT IS PARKED ON ONE FINDING, AND THE FINDING IS THE DECISION.** A published
cone is not the union of the forecast-hour discs, it is their HULL: the source
fills the waist between consecutive circles with the two lines pulled taut
around them. On the INSIDE of a bend that taut line cuts straight across, while
a circle swept along a curve stays a fixed distance from it. So containing the
published cone forces the inner flank to BE that straight line — there is no
smooth shape that both contains the published cone and hugs it. Measured on a
hard recurve: the sweep alone undercuts published area by 8.2%.

**So the choice is: smooth outer flank only (contains, safe, half the win), or
both flanks smooth (undercuts the published cone on the inside of a bend).**
Aaron's call — he has already said outward-only, made before this cost was
known.

**It marks tau 0, not the current position.** Tau 0 is the analysis time, up to
three hours behind the glyph. `SPEC-MAP.md` §7.4 carries the distinction. Do not
collapse them — they are close enough on a globe to look like one thing.

## NEXT UP

**==> THE TELEMETRY WAS LYING AND IT IS NOT ANYMORE. READ THIS BEFORE ANY OTHER
NUMBER IN THIS FILE. <==** `timings_ok` has collected real values. **Only rows
where it equals 1 are measurements.** Everything below is that slice, 2026-08-07,
94 sessions across 20 devices:

| | iPhone | Android | Linux | Mac | **Windows** |
|---|---|---|---|---|---|
| Boot veil lifts | 1,158 | 1,209 | 829 | 596 | **2,764** |
| Storms on screen | 2,132 | 2,219 | 1,279 | 799 | **4,670** |
| Blocked | *(blind)* | 430 | 884 | 17 | **3,210** |
| Worst tap | 18 | 115 | 146 | 45 | 131 |

**1. WHAT WINDOWS IS DOING FOR 3.2 SECONDS. NOBODY HAS LOOKED, AND IT IS NOW THE
ONLY REAL PERFORMANCE PROBLEM LEFT.** 21 clean sessions across **7 stranger
machines**, so it is not one weird PC. Worst single session: **29,604 ms** of
blocking. Everything else on the table clears its bar; this does not.

**2. WHAT A MAPLIBRE FRAME COSTS — STILL UNMEASURED, AND STILL THE GATE.**
`attachIdleRotation` calls `setCenter` per frame below `DIVE.zHandoff`, so a
resting globe drives a full map repaint. **Moving water pays it too**, at map
zoom, via `triggerRepaint()`. Measured: drift pinned, zero MapLibre renders per
second; unpinned, one per frame. **Nobody has measured what one of those frames
costs**, and it needs a real device with a real basemap — the sandbox has no
tunnel to one. The four rules the fix has to follow are written out in
**SPEC-MAP.md §9.7** — measured in the Deep prototype before it was cut, kept
because the problem is Landfall's. Prime suspect for item 1.

**HALF OF IT IS ALREADY GONE AND IT WAS THE FREE HALF.** Past `DIVE.zHandoff` the
loop used to schedule a frame anyway and throw the reading away. It stops now;
`tools/test-idle-drift.mjs` asserts the frame counts. **This does not touch the
repaint above**: `setCenter` is what `map/globe-follow.js` mirrors, so it is also
what makes the visible rotation happen and cannot simply be skipped.

**3. THE BOOT SCREEN IS NOT A FOUR-SECOND PROBLEM ON A PHONE.** `perfMark('globe')`
and `boot.done()` are the same moment in `main.js`, so `t_globe_ms` **is** the
veil lift — and on real hardware it is **1.2 s on iPhone and Android**. The 3,982
ms figure came from `tools/load-probe.mjs` at 4x throttle and was never a user
number. Windows' 2,764 ms is item 1 wearing a different hat.

The 4096x2048 land texture is still **511 ms in `texImage2D` plus 202 ms
rasterising** on every cold load (`tools/boot-profile.mjs`). Worth removing, on
memory and retheming grounds as much as speed — but it is **not urgent and not
user-facing**, and the answer is filled triangles (SCOPED, below), not a smaller
canvas. `claude/backlog.md` has the measurement that kills halving it.

*Two dead hypotheses, do not reopen without new data:* the OpenFreeMap CDN is not
the bottleneck (3982 ms healthy vs 3807 ms unreachable), and preloading was
measured and rejected (see `_headers` and the probe's `--preload` switch).

**4. GDACS IS STILL THE FEED THAT LEAVES PEOPLE ON A SPINNER, THOUGH LESS SO.**
41 of 46 GDACS loads reached `ok` against NHC's 44 of 46. **Zero errors either
side — the misses are sessions that ended still loading**, not failures. Retry
has been pressed **zero times in 193 sessions**, so that recovery path has never
been exercised by a real user. **Two things have landed since these numbers were
taken and both should move them, so re-read before acting:** the stamp fix, and
the two-second rung — a session that used to sit on "Checking the oceans…" for a
minute now says something at two seconds, which is the likeliest reason nobody
ever reached the retry button.

## HELD FOR WEATHER

**Watch DOLPHIN (12W) finish.** The `declared` end path has never fired on a real
storm. A real JTWC final warning proves it. Detection is client-side; the app must
be open.

**Surge (Phase 6 step 3) and wind arrival (step 4) are HELD FOR A STORM NEAR
HOME, not blocked.** Against a storm half a planet away there is no telling a
right answer from a plausible one. Surge is bands only (no watch/warning vector
product exists); wind arrival fetches layers 18/19 and never computes; the
at-home exposure timeline lands after both.

## SCOPED, NOT STARTED

**THE 3D LAND FILL SHOULD BE SHAPES, NOT A PICTURE.** `landTexture` still
rasterises a 4096×2048 canvas and hands it to the GPU; draft-then-upgrade moved
that cost off the first frame but did not remove it. Feeding `RINGS` to the GPU as
filled triangles deletes the canvas, the ~500 ms upload and ~34 MB of GPU memory,
drops the resolution ceiling, and turns retheming into a recolour. Known traps:
rings-inside-rings for inland lakes, the antimeridian with Antarctica worst, and
flat triangles cutting chords through the sphere. `earcut` (~10 KB, no build step)
does the triangulation. **Not during cyclone season, and not in the same pass as
the engine upgrade** — both are surgery on `map/globe3d.js` and two at once makes
a break impossible to attribute.

**==> THE THREE-GLOBE EXPANSION IS GONE FROM THIS FILE BECAUSE IT IS GONE FROM
THE ROADMAP. <==** Cut 2026-08-08. Landfall is a tropical cyclone app. The whole
tree as it stood — Deep, Surface, the volcano and ash pipeline, `SPEC-GLOBES.md`
and `SPEC-HAZARDS.md` — is on the **`worlds`** branch and the **`worlds-v1`** tag.
Nothing was lost. It is simply not what is being built.

**One consequence worth knowing: the three.js r128 → r182+ upgrade is no longer a
gate on anything.** It only ever gated §41–§43's effects. It is now an ordinary
maintenance item — do it when there is a reason, not because something is waiting
behind it.

## KNOWN AND ACCEPTED

- **The dead-code sweep found no dead FILES and 21 dead exported NAMES.** All 106
  modules are reachable from `main.js`. Four of the 21 were `data/volcano-live.js`
  and went with the Deep rip; the two surge formatters belong to Phase 6 step 3
  and stay. `_normalizeNhcStorm` and `_drainForTest` are test seams whose tests
  are gone. **The three worth a second look are eviction functions nothing
  calls** — `evictTcgpIndex`, `evictCarq`, `forgetBand` — three caches that can be
  filled and never emptied. That is a memory question, not a tidiness one, and
  nobody has asked it. **Re-run the sweep**: the rip deleted ~42 modules, so the
  remaining count is stale.
- **Three suites need Playwright and do not run in a bare sandbox**, which is
  expected rather than broken. They DO run once `node_modules` is on the path.

- **iOS's "one in five sees nothing" WAS BACKGROUNDED TABS, and the item is
  dead.** Not one session of 312 is missing `t_globe_ms` — null or zero, any
  platform. What produced it: **22 of 71 iPhone sessions are `timings_ok = 2`**,
  20 of them hidden from the first frame, averaging **322,440 ms** to storms.
  Those rows poisoned every iPhone average this project ever computed. iPhone's
  real position is second fastest. **Filter on `timings_ok = 1` or repeat the
  mistake.**
- **The old Windows numbers were the same artifact and are superseded.** 8.8 s to
  storms and 43-of-62-are-Aaron's came from the unfiltered table; the clean slice
  is in NEXT UP item 1. The disease is real, the size of it was not.
- **Tap responsiveness is fixed and the item is closed.** Every platform is under
  the 200 ms bar on clean rows — worst is Linux at 146 ms, against 376 ms before
  the five fixes. `tools/test-recompute-budget.mjs` holds the counts.
- **iOS's clean long-task numbers are an instrumentation gap.** All 26 WebKit
  sessions report `longtask_n = 0` because WebKit does not implement the
  observer. `ttfb_ms`, `mem_gb` and `conn_type` are blank on WebKit for the same
  reason. Do not read any of those columns as "iPhones never block".
- **`overallStatus` returns `ok`, not `clear`, when only ended storms are held.**
  Deliberate — `clear` would fire an all-clear while a grey dot sits on the globe.
- **Ended storms keep their track but not their wind swath.** Cosmetic; nobody has
  asked for it.
- **`X-Landfall-Empty` DOES NOT EXIST.** `claude/backlog.md` logs it as a header
  written but never read. Searched the whole repo 2026-08-07: there is no such
  string anywhere. The backlog entry is stale, not a finding.
- **GDACS's `alertlevel` never reaches the screen and that is correct.** It is a
  humanitarian-impact score, so it can rate a Cat-5-equivalent Green. Strength
  comes from GDACS's own `severitytext` classification; the alert level is parked
  unrendered in `raw`. Logged because the question keeps getting re-asked, not
  because anything is open.
