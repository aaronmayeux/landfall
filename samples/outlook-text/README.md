# Real Tropical Weather Outlook bulletins

Verbatim NHC text products, kept so `tools/test-outlook.mjs` parses real bytes
rather than bytes somebody imagined. Nothing here is edited or fabricated.

| file | what it is | why it is here |
|---|---|---|
| `atlantic-current.txt` | ABNT20 KNHC 111142, 2026-08-11 | three areas, and one of them says **`near 0 percent`** rather than a bare number — the shape that breaks a naive percentage regex |
| `epacific-current.txt` | ABPZ20 KNHC 111139, 2026-08-11 | two areas, one titled `Central Pacific (CP93):` — an NHC invest designator inside the title |
| `atlantic-all-clear.txt` | ABNT20 KNHC 241134, 2026-06-24 | a genuine quiet-season bulletin: no areas at all, one sentence saying so. The state the app must be able to reach, and the one a busy-season fixture cannot exercise |

**The first two came out of the `archive` branch** (`latest/nhc-two-*.txt`,
`<pre>` block extracted). **The third came from
`https://www.nhc.noaa.gov/ftp/pub/forecasts/discussion/MIATWOAT`, and that
mirror is FROZEN** — measured 2026-08-11, it was still serving the 24 June
bulletin two months later, plain text, HTTP 200, looking perfectly healthy.

That is the single most useful thing in this folder. It is exactly the failure
this whole feature exists to catch, wearing the opposite hat: a source that is
up, answering, well-formed, and months out of date. **It is why the bulletin's
own issuance time is checked on every read** rather than trusted because the
fetch succeeded — see `OUTLOOK.maxAgeMs`. A second opinion that can silently
freeze is worse than no second opinion, because it would tell us NHC's GIS
layer is broken on a day when it is fine.

## What is NOT here, stated plainly

No fixture carries an `Active Systems:` block (NHC lists named storms above the
areas when any are active) and none uses the numbered `1. Central Pacific:`
form that `gtwo.php` renders. The parser handles both by construction — it
anchors on the formation-chance lines and walks back to the nearest title — but
**neither path has been run against real bytes.** When a bulletin with either
shape lands in the archive, add it here and the suite covers it for free.
