# samples/vaac — real WMO VA ADVISORY bulletins, captured for the parser suite

Seven live bulletins pulled from `tgftp.nws.noaa.gov/data/raw/fv/` on
2026-07-30, one per behaviour `functions/api/volcano/_vaa.js` has to survive.
`tools/test-vaa.mjs` reads these files; it does not carry inline strings, so
what the suite asserts against is what a centre actually published.

**WHITESPACE IS NOT GUARANTEED BYTE-EXACT.** These were captured through a tool
that converts a response before handing it over, so trailing spaces and wrap
columns may differ from the originals by a character here and there. That is
survivable precisely because **the parser is forbidden to depend on whitespace**
— it scans for field labels, not lines. If a future change makes a whitespace
detail load-bearing, these fixtures stop being sufficient evidence and a fresh
byte-exact capture is owed.

| File | What it is here to prove |
|---|---|
| `toulouse-etna-active.txt` | **A real eruption in progress.** `AVIATION COLOUR CODE: RED`, ash to FL230, `MOV NW 10KT`, `NXT ADVISORY: NO LATER THAN`. The only fixture that must come out as active ash. Its continuation line (`CLOUD UP TO 7KM`) is **not indented** — see below. |
| `washington-santa-maria-close.txt` | A close via `ERUPTION DETAILS: VA EMS ENDED`. Also: blank lines between every field, `+6HR` with no space, `SOURCE ELEV` in **feet**, and **no terminating `=` at all**. |
| `tokyo-sheveluch-close.txt` | A close via `VA IS NOT IDENTIFIABLE IN SATELLITE IMAGERY`. Its `OBS VA CLD` contains `FL180` — that is the **WIND**, not an ash cloud. Any flight-level scan that does not cut at `WIND` reads this dead volcano as erupting. |
| `wellington-ambae-close.txt` | The centre BoM omits. Continuation lines indented eight spaces, and the same `WIND FL010/020` trap. |
| `london-krysuvik-exer.txt` | `STATUS: EXER` — an exercise, and it sits **above** `DTG`. Terminating `=` is on its own line. |
| `buenosaires-sabancaya-quiet.txt` | `SUMMIT ELEV` instead of `SOURCE ELEV`, and `AVIATION COLOUR CODE: NOT GIVEN`. Quiet: no ash, no further advisories. |
| `toulouse-test-unknown.txt` | **The worst bulletin on the wire, and it has no `STATUS:` line.** See below. |

## The four things this set corrects

Recorded here because `claude/phase-c-relay-plan.md` states each one differently
and the fixtures are the evidence.

**1. `STATUS: TEST` IS NOT HOW YOU CATCH A TEST BULLETIN.** `fvxx02.lfpw` is a
drill and carries no `STATUS:` line whatsoever — it is a test only by
`INFO SOURCE: TEST TEST TEST` and `RMK: TEST TEST TEST`. It also carries
`AVIATION COLOUR CODE: RED` and an `ERUPTION AT` time. "Absence of a `STATUS:`
line means operational" would let a RED eruption through. What saves it is
`VOLCANO: UNKNOWN 600000` and its **2024 date-time group**, which is why both
of those are independent guards rather than nice-to-haves.

**2. `VOLCANO: UNKNOWN` STILL CARRIES A NUMBER.** `600000` is number-shaped and
would pass any "has a GVP number" test. The unknown check reads the NAME.

**3. NOT EVERY ADVISORY TERMINATES WITH `=`.** Washington's has none. London's
is on its own line. Splitting records on `=` alone loses bulletins.

**4. CONTINUATION LINES ARE NOT RELIABLY INDENTED.** Wellington indents eight
spaces; Toulouse wraps `ERUPTION DETAILS` and `OBS VA CLD` at **column zero**.
Indentation is unreliable in both directions, which is the whole reason the
parser is label-driven.

## Not captured, and stated rather than faked

**A live `VOLCANO: UNKNOWN` from Buenos Aires on resuspended Andean ash.** The
behaviour is documented in SMN's own product PDF and the drop rule is tested
against the Toulouse bulletin above, which is the same shape. No synthetic
Buenos Aires file was written: a fixture that nobody published is not evidence.

**A cross-centre duplicate** (London issuing on behalf of Toulouse). One was
read on 2026-07-30 but is no longer in a latest-only slot. Dedupe is tested by
feeding the same bulletin twice, which is the same assertion without inventing
a bulletin.
