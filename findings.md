# NHC Tropical Cyclone Reports — what is actually there

Probed 2026-08-25T01:38:24.260Z on a GitHub Actions runner.

**This answers one question and it gates §57.22 / step 7:** can the
archive's detail panel offer a link to NHC's written report, and can it
tell which storms have one? A guessed URL ships dead links into a panel
about historical accuracy, and it fails silently.

Denominator: **3266 real storms** across both HURDAT2 basins
in `seasons/data/`.

## Q1 — Is there an index, and is any of it machine-readable?

- `https://www.nhc.noaa.gov/data/tcr/index.php` → **HTTP 200**, 31794 bytes read, `text/html; charset=UTF-8`
- `https://www.nhc.noaa.gov/TCR_StormReportsIndex.xml` → **HTTP 200**, 335285 bytes, `text/xml` — TRUNCATED in raw/

> If the XML resolves it is a far better source than scraping a page NHC
> may restyle at any time. **The first run of this probe reported it
> missing and was wrong** — it guessed the path. The index page links it
> at the site root, and that is where it is asked for now.

The top-level page carries **no report links at all** — it is navigation
plus a grid of **37** per-season, per-basin pages. Those
are where the reports live, so the probe follows them.

Followed **37** of them.

## Q2 — What is linked, and does one filename pattern cover it?

- **578** report-shaped links found across those pages.
- **542** carry an ATCF-shaped storm id in the filename.
- **36** do not — these are the ones that would break a
  pattern built from the majority, so they are listed in full below.

### Can a URL be BUILT from a storm id, or must it be LOOKED UP?

This is the question that decides whether step 7 has to ship an index
file. If the tail after the id is always the storm name we already
hold, the panel can construct the link. If not, it cannot — and a
constructed link that 404s is the silent failure this probe exists for.

- tail equals the name we hold: **510**
- tail differs: **24**

Where it differs:
  - `AL022022_EP042022_Bonnie.pdf` — we hold that id as **BONNIE**
  - `AL132022_EP182022_Julia.pdf` — we hold that id as **JULIA**
  - `AL102004_Ten.pdf` — we hold that id as **UNNAMED**
  - `AL022003_Two.pdf` — we hold that id as **UNNAMED**
  - `AL062003_Six.pdf` — we hold that id as **UNNAMED**
  - `AL072003_Seven.pdf` — we hold that id as **UNNAMED**
  - `AL092003_Nine.pdf` — we hold that id as **UNNAMED**
  - `AL142003_Fourteen.pdf` — we hold that id as **UNNAMED**
  - `AL072002_Seven.pdf` — we hold that id as **UNNAMED**
  - `AL142002_Fourteen.pdf` — we hold that id as **UNNAMED**
  - `AL022001_Two.pdf` — we hold that id as **UNNAMED**
  - `AL092001_Nine.pdf` — we hold that id as **UNNAMED**

File types: `.pdf` ×542

### The exceptions, in full

- `index.shtml`
- `aboutrss.shtml`
- `map.html`
- `aboutalternate.shtml`
- `aboutnhcprod.shtml`
- `abouttafbprod.shtml`
- `gccalc.shtml`
- `tracking_charts.shtml`
- `TCvideos.shtml`
- `aboutnames.shtml`
- `dcmi.shtml`
- `modelsummary.shtml`
- `aboutpubs.shtml`
- `aboutgloss.shtml`
- `acronyms.shtml`
- `faq.shtml`
- `newsarchive.shtml`
- `aboutintro.shtml`
- `contact.shtml`
- `aboutresearch.shtml`
- `aboutrsmc.shtml`
- `jtwc.html`
- `2024_Atlantic_Hurricane_Season_Summary_Table.pdf`
- `2023_Atlantic_Hurricane_Season_Summary_Table.pdf`
- `2022_Atlantic_Hurricane_Season_Summary_Table.pdf`
- `2021_Atlantic_Hurricane_Season_Summary_Table.pdf`
- `2020_Atlantic_Hurricane_Season_Summary_Table.pdf`
- `2019_Atlantic_Hurricane_Season_Summary_Table.pdf`
- `2018_Atlantic_Hurricane_Season_Summary_Table.pdf`
- `2017_Atlantic_Hurricane_Season_Summary_Table.pdf`
- `summary_atlc_2016.pdf`
- `summary_atlc_2015.pdf`
- `summary_atlc_2014.pdf`
- `summary_atlc_2013.pdf`
- `summary_atlc_2012.pdf`
- `summary_atlc_2011.pdf`

## Q3 — Which storms have one?

- **532 of 3266** storms we hold have a report linked
  from the pages above — **16.3%**.
- Earliest year with any report: **1995**.

> ==> A LOW NUMBER HERE IS NOT NECESSARILY THE TRUTH ABOUT NHC. <== It
> may be the truth about the INDEX — a page that only lists recent
> years, or paginates. Compare the earliest year above against Q1: if
> the index is a single page and it stops, that is a real cliff. If it
> links to per-year pages, this probe has only read the top level and
> a second pass should follow them.

| Year | Reports | Storms |
|---:|---:|---:|
| 1995 | 21 | 32 |
| 1996 | 13 | 26 |
| 1997 | 9 | 33 |
| 1998 | 14 | 30 |
| 1999 | 16 | 30 |
| 2000 | 19 | 40 |
| 2001 | 17 | 36 |
| 2002 | 14 | 33 |
| 2003 | 21 | 38 |
| 2004 | 16 | 33 |
| 2005 | 31 | 48 |
| 2006 | 10 | 35 |
| 2007 | 17 | 32 |
| 2008 | 17 | 36 |
| 2009 | 11 | 34 |
| 2010 | 21 | 34 |
| 2011 | 20 | 33 |
| 2012 | 19 | 36 |
| 2013 | 15 | 36 |
| 2014 | 9 | 32 |
| 2015 | 12 | 43 |
| 2016 | 16 | 39 |
| 2017 | 18 | 38 |
| 2018 | 16 | 42 |
| 2019 | 20 | 41 |
| 2020 | 31 | 52 |
| 2021 | 21 | 40 |
| 2022 | 16 | 35 |
| 2023 | 21 | 41 |
| 2024 | 18 | 33 |
| 2025 | 13 | 33 |

## Q4 — Do those links resolve, and what does a MISS look like?

An index entry is a claim. These are HEAD requests against a spread of
them — spread rather than taken from the top, because the interesting
failure is an old entry pointing at a file that has since moved.

- **40 of 40** sampled links returned HTTP 200.
- Report size: **0.04 MB** smallest, **0.76 MB** median, **9.81 MB** largest.
  *(Relevant because §57.22 only wants to LINK to these — but if a later
  pass ever considers mirroring one, this is the number.)*

**A report that cannot exist** (`AL011851_Unnamed.pdf`, an 1851 storm):
HTTP **404**, `text/html; charset=UTF-8`, 22982 bytes.

> This decides whether a link may be CONSTRUCTED at all. A clean 404
> means a miss is detectable. A 200 carrying a friendly error page means
> it is not, and step 7 must only ever link to something it read out of
> an index.

## Q5 — Does JTWC publish live ATCF b-decks? *(secondary)*

`NOW.md` has carried this as "a small addition to the next probe run"
twice. If JTWC publishes b-decks the way NHC does, the rest-of-world
capture gets a better source than our own relay output.

> ==> THESE ARE CANDIDATES, NOT KNOWN URLS, AND THAT MATTERS FOR HOW THE
> RESULT IS READ. <== Unlike everything above, nothing here was
> discovered by listing a directory — nobody knows where JTWC would put
> these. **A 404 below means "this candidate did not answer", never
> "JTWC has no b-decks."** A hit is real evidence; a miss is not.

- `https://www.metoc.navy.mil/jtwc/jtwc.html` → HTTP 403 — no b-deck-shaped filename in the body
- `https://www.metoc.navy.mil/jtwc/products/` → HTTP 403 — no b-deck-shaped filename in the body
- `https://www.nrlmry.navy.mil/atcf_web/docs/` → HTTP 403 — no b-deck-shaped filename in the body

## What this decides

1. **If the tail is always the name we hold and a miss is a clean 404** —
   step 7 can construct the link from the storm id and verify it. Cheapest
   outcome.
2. **If the tails differ or a miss returns 200** — the link must come from
   an index, which means shipping one. That is a real cost and it changes
   the shape of step 7.
3. **If coverage starts at a recent year** — §57.25 rule 2 applies and the
   panel says why there is no report, rather than showing nothing.

Raw bytes are in `raw/`; every response header is in `manifest.json`.
