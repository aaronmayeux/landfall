# seasons-live — the current season, captured hourly

**Data, not code. Never merge this branch into `main`.**

Written by `tools/seasons-mirror.mjs` on a GitHub Actions runner.
See `SPEC-SEASONS-BUILD.md` §57.30 step 3.

## What is here

| path | what it is |
|---|---|
| `btk/<year>/` | NHC's own ATCF b-decks, verbatim. Atlantic, East and Central Pacific |
| `jtwc/<year>/` | One JSON line per JTWC warning, appended. West Pacific, Indian Ocean, southern hemisphere — **and this half exists because JTWC deletes its own** |
| `state.json` | ETags, so unchanged files are not re-downloaded |
| `manifest.json` | What happened on the last run that changed anything |

## Reading it

    git fetch origin seasons-live
    git show origin/seasons-live:manifest.json
    git show origin/seasons-live:btk/2026/bal022026.dat

## Two things that will look wrong and are not

**Long gaps between commits are correct.** The job runs hourly and commits only
when a byte actually moved. Out of season that is zero commits a day.

**Invests are missing on purpose.** Storm numbers 90-99 are reused several times
inside one season and 80-89 are internal test systems, so mirroring the
directory unfiltered would store several different systems under one name.
`manifest.json` lists every file dropped and why.

## Retention

Once a season has graduated to a settled file, this branch's hour-by-hour
provenance has expired and the branch is squashed to a single commit —
`SPEC-SEASONS-BUILD.md` §57.34 rule 1. Run the workflow with `squash` set.
