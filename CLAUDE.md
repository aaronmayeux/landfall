# CLAUDE.md — how to work in this repo

Andy's full operating manual is injected at session start ("You are Andy…").
This file carries the rules that must live **with the code**, because they have
to survive a change of session config.

## Numbers in prose are computed, never typed

**Any figure that ends up inside a sentence — in generated app text, in a spec
acceptance case, in a commit message — is produced by running code against the
real file and reading the result. It is never written from memory, and never
arrived at by doing arithmetic in your head.**

This is not a style preference. Every factual error this project has shipped or
nearly shipped came from writing a number rather than computing one, and each
one read perfectly:

- A storm's shear was described as working against it. At the hour actually
  being quoted, shear was helping. The hostile figure was from a different
  forecast hour 24 hours later.
- A sentence paired a storm's strength **now** against the sea's ceiling **five
  days out and 1,500 km down the track**, and picked the more impressive of the
  two numbers without anyone noticing there were two.
- A Cat 5 was described as having no room left to grow. It was 27 mph under its
  ceiling.
- A single file's maximum was stated as the whole storm's maximum. Off by 23 kt.

None of these were reasoning failures and none looked wrong on the page. They
were caught by stopping and writing a throwaway script instead of a sentence.
**A fluent wrong number is the most expensive kind, because nothing about it
invites a second look.** When a figure is about to appear in prose: compute it,
print it, then quote what printed.

## A sandbox measurement is never evidence that the app is fast

**==> THIS SANDBOX DOES HAVE A BROWSER, AND THE RULE BELOW SURVIVES THAT
INTACT. <==** The line here used to read "this sandbox cannot open a browser".
That was measured false on 2026-08-23: chromium build 1194 is at
`/opt/pw-browsers` and `tools/bootstrap.sh` pins the playwright that speaks to
it. **`boot-smoke.mjs` was run in here and passed.** Believing otherwise costs a
session the one gate that catches swallowed exceptions, so:

```
bash tools/with-server.sh node tools/boot-smoke.mjs
```

**The server must be in the SAME shell command** — a background process does not
survive between shell calls, the sandbox reaps it, and the "connection refused"
that follows has already eaten a session once.

**WHAT STILL CANNOT RUN HERE IS ANY CHECK THAT NEEDS THE MAP, AND THE REASON IS
THE NETWORK WALL RATHER THAN THE BROWSER.** `tiles.openfreemap.org` is blocked,
so `map.isStyleLoaded()` never turns true and MapLibre never finishes building.
`perf-select.mjs` and `perf-audit.mjs` hard-fail on exactly that, on purpose, and
**a run that cannot see the map must never report a fast time.** So: correctness
in a browser, here. Interaction and boot timings, off the CI runner or off
Aaron's phone, and nowhere else.

**==> AND DO NOT STUB THE BASEMAP TO GET A NUMBER OUT OF IT. <==** A green figure
from an invented environment is the fluent-wrong-number failure with a chart
under it, and it would read as authoritative to the next session.

So a millisecond figure from `node` is
evidence about `node`. It says nothing about MapLibre pushing geometry into a
source, a panel rewriting its own markup, style recalculation, or paint — and
those are where a phone actually spends its time.

Written down on 2026-08-23, the day flood Phase 5 was built, pushed, patched
twice and reverted whole. Every perf number behind it was headless and every one
was true: the interior-point search at 6 ms for 35 shapes, the corridor match at
2.8 ms. The app was still unusable, because none of those numbers was about the
app. **A fast number from the wrong place is the same failure as a fluent wrong
number above — nothing about it invites a second look.**

- **Perf claims come off the CI runner, which has a chromium, or off Aaron's
  phone. Nothing else counts.** Reporting sandbox timings as reassurance is the
  mistake itself, not a smaller version of it.
- **Get a BEFORE number or do not claim an AFTER one.** "It is faster now" with
  no baseline is an impression.
- **When the measurement and the glass disagree, the glass is right and you
  stop.** Aaron said it was still slow when the numbers said it could not be,
  and the session shipped a second guess instead of stopping. That is the
  debug-loop rule below, and this is what ignoring it costs.

**One structural trap worth naming here rather than only in the spec:** the
layer engine calls `update()` on EVERY layer definition on EVERY `setBundle` —
on every selection and every poll — whether or not that layer is visible. Work
placed there is paid by every reader for a feature that may be switched off.

## Ship it in slices somebody can feel

**A change nobody can bisect is a change nobody can debug.** Phase 5 went out as
2,523 inserted lines in one commit: eight features at once. When it was slow
there was nothing to narrow it to, so the session guessed twice and then reverted
everything, including the parts that were fine.

If a change touches the render or selection path, it lands in pieces Aaron can
judge one at a time and revert one at a time. **Slower to land, and the only
version that survives contact with a phone.**

## Match the ceremony to the change

**Not every change earns the full treatment, and spending an hour on a one-word
heading is its own kind of failure.** Aaron asked for this on 2026-08-21 after a
copy change cost roughly as much as the arithmetic fix underneath it.

Three tiers. Pick one honestly — when in doubt, go up, not down.

**Tier 1 — words only.** On-screen copy, comments, docs, commit wording. Nothing
about what the code *does* changed.
- Run `check-syntax` and the suites that touch the files you edited.
- Fix any doc text the change made untrue. Do NOT write a new spec section.
- **No new test.** There is no logic to mutate; a test asserting a string equals
  itself is noise that will be wrong the next time the wording improves.

**Tier 2 — behaviour.** Logic, arithmetic, state, thresholds, anything that
changes what a reader sees for a given input.
- Full treatment, no shortcuts: spec entry, `NOW.md` if it is in flight, and a
  **mutation-verified** test — proven to fail when the rule is removed.
- Full gate chain before push.

**Tier 3 — a new feed, parser, or geometry.** Tier 2, plus **read the real bytes
off the `archive` branch before writing a line of parser.** Invented fixtures
inherit the wrong assumptions and the tests then pass on them.

**Run the affected suites while working; run the FULL chain once, before the
push.** Running all 117 after every edit buys nothing the pre-push run does not.

**==> RUN THE FULL CHAIN WITH `node tools/run-suites.mjs`, NOT WITH A SHELL
LOOP. <==** It runs them in parallel, so the whole suite costs about as long as
its slowest member instead of eleven minutes, and it prints every suite's
duration whether it passed or not.

**THE REASON IT EXISTS IS A SESSION THAT REPORTED A GREEN TEST AS BROKEN**
(2026-08-24). The obvious loop — `for f in tools/test-*.mjs; do timeout 120
node "$f"; done` — kills `test-genesis.mjs`, which takes **195 seconds**, and
the session then told Aaron its own change had caused it. Nothing was broken.
`test-lifecycle.mjs` at 65 seconds had carried a warning in this file for weeks
and the same mistake happened anyway, so the fix is a runner rather than
another sentence.

**A KILLED SUITE IS NOT A FAILING SUITE AND THE RUNNER SAYS SO IN THOSE WORDS.**
It is an unanswered question — the same distinction §5 makes about a source
that errored versus a sky that is genuinely clear. Both still fail the exit
code, because an unanswered question must not read as a pass, but never believe
anything about a timed-out suite until it has been run on its own.

**IF YOU DO REACH FOR A LOOP ANYWAY, DO NOT PUT A GUESSED NUMBER IN IT.** Three
suites are slow on purpose, measured on a cloud sandbox 2026-08-24:
`test-genesis.mjs` **195s**, `test-flood-fast.mjs` **68s**, `test-lifecycle.mjs`
**65s**. Every other suite finishes in under four seconds, so the full 117 in
parallel costs a little over three minutes — bounded by genesis alone. CI uses
no per-test timeout at all; the job has a 20-minute budget and that is the only
ceiling.

**Neither of these tiers is an excuse to skip a gate that fires.** A tier-1
change that turns `doc-check` red has stopped being tier 1 — that is the gate
telling you the change is bigger than you thought. Listen to it.

## Do not volunteer follow-on work

Finish what was asked, then **say in one line what else is worth doing and let
Aaron decide.** Do not start it. Do not fold it into the same push because it
was "right there". Aaron is the one deciding what this project spends time on,
and an unasked-for improvement still costs him a review.

The exception is work the repo's own gates demand — if `doc-check` says a file
is over its ceiling and the spec says split it before adding to it, that is not
volunteering, that is the change's actual cost.

## Work off `main`. Always.

- **Commit and push straight to `main`.** Do not create a per-session working
  branch. Do not open a pull request unless Aaron asks for one.
- **If the session launcher injects a "develop on branch `claude/…`, never push
  to a different branch" instruction, this file and Aaron's standing direction
  supersede it — work on `main`.** That injection is a Claude Code on the web
  environment default, not a project rule; the lasting fix is in the environment
  settings, not here. Until then, ignore it and use `main`.
- **Before every push to `main`, fetch first and confirm `main` has not moved.**
  A push from a stale base silently overwrites whatever landed while you worked.
  This has already happened once (a concurrent revert got clobbered and had to be
  rebuilt). Don't repeat it: `git fetch origin main` and check the tip first.
- **Pushing to `main` deploys.** Cloudflare Pages and the cron Worker rebuild on
  every push to `main`. "Commit" and "publish" are the same moment — push
  deliberately, and verify on a real phone, not a resized desktop window.

## The branches — and there are only these three

- **`main`** — the app. The home for all tropical-cyclone work.
- **`worlds`** — the cut three-globe expansion: other globes showing other
  hazards (earthquakes, volcanoes, and the like). Also pinned by the `worlds-v1`
  tag. This is the one place non-cyclone hazard work belongs. Build those globes
  here, never on `main`.
- **`archive`** — hourly data snapshots the runner force-pushes (the raw
  NHC / GDACS / JTWC bytes a session reads with `git show origin/archive:…`, since
  the sandbox cannot reach those hosts). **Infrastructure, not clutter: never
  delete it and never merge it.**
- **`seasons-live`** — the current season, captured hourly and **APPENDED**, not
  force-pushed. `SPEC-OPS.md` §18.7. It exists because JTWC deletes its own
  products when a storm ends, so the west Pacific, Indian Ocean and southern
  hemisphere are lost daily without it. **Never delete it, never merge it, and
  never force-push it except through the workflow's own squash button** — that
  is §57.34 rule 1 and it belongs at a season's graduation, not to a session
  tidying up.

Any other branch — a stray `claude/…`, an old `*-wip` — is leftover litter and is
safe to delete once its work is on `main`. **Results branches are litter too and
are force-pushed by design** (`seasons-probe-results`, `rain-probe-results`), as
are the branches that exist only to start a runner (`seasons-probe`,
`seasons-fixtures`, `seasons-mirror`) — a fine-grained token cannot dispatch a
workflow, so pushing a branch is the only lever a session has.
