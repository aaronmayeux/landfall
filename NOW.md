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

**==> THE VOLCANO LAYER IS SEEN AND ACCEPTED, AND POLISH IS DEFERRED. <==**
Aaron on glass: shapes, footprints, calderas, the cyan mountains and the pinch
through the tilt band are all good. The severity glow and the wider moving sea
were seen and accepted with **"we'll polish it later"** — that is ACCEPTED, not
validated, and the two open risks below have not been separately confirmed.
Everything as-built is `SPEC-GLOBES.md` §42.1.

**Two risks that did not fire but were never separately checked.** An erupting
pip is now up to 78 device px and a few old GPUs clamp point sprites at 63,
which squares off the halo rather than erroring — if erupting pips ever look
CUT OFF, that is `marks.glowPad`. And a sea wider than its mountain covers some
of MapLibre's own painted ocean, which is the composite fault already open on
the plate lines below.

**Phases: A–G ✅ · H — H1 ✅, H2a lava ✅ (UNSEEN ON GLASS), H2b ash column ← next.**
Route, join key, parser traps and the closed questions are in the Project as
`claude/volcanoes-deep-2026-07-30.md` — **do not re-survey the nine centres.**

**==> LAVA RUNS DOWNHILL NOW, AND §42.1.9 SAID IT NEVER WOULD. <==** Aaron
overruled the vent glow 2026-07-31. Both grounds of the old rejection are spent
and the whole rewrite — including the three things the tests caught before glass
did, and what tracing bought — is `SPEC-GLOBES.md` §42.1.9. **Read it there;
none of it is repeated here.**

**==> SEEN ON GLASS 2026-07-31 AND SENT BACK. <== Aaron on Mayon:** *"this
doesn't look like streams of lava... the bands of color are perpendicular to
the flow... these are also rectangular shaped."* All three correct, plus a
fourth he did not name that was probably the main cause:

- **The bands ran across the flow.** Structural, not a constant — the geometry
  emitted only distance-along-flow, so brightness could only vary on distance,
  which necessarily draws rungs at right angles to travel. A cross-flow
  coordinate now exists and the streaks run lengthwise, with dark chilled
  levees at the margins and a bright channel down the middle.
- **The ribbons were rectangular slabs.** Now tapered at both ends — narrow out
  of the vent, rounded lobate toe.
- **They were far too wide** — 220 m half-width growing to 790. Now 95 m.
- **==> AND THE LAVA WAS THE SAME ORANGE AS THE MOUNTAIN. <==** Edifice
  `#FF7A1A`, old lava mid-tone `#FF9A1F`. No figure, no ground, so the flows
  read as glowing panels. The ramp now separates at BOTH ends — white-hot vent,
  near-black crust at the toe, with the mountain sitting between them.

**THE MOUNTAIN COLOUR IS THE OPEN QUESTION AND IT IS AARON'S CALL.** The
cleaner fix for the contrast is to cool the erupting edifice rather than
stretch the lava around it, but that gold is approved and was not changed
without him. If the flows still fight the mountain on the next look, that is
the number to move.

**==> SECOND GLASS PASS, SAME DAY. "PROGRESS."** <== The streaks read as
streams now. Three more, all fixed, all UNSEEN:

- **==> IT CLIPPED ON ROTATE, AND MY OWN TEST WAVED IT THROUGH. <==** Both
  ribbon edges took the CENTRELINE's height, which makes the cross-section a
  straight chord across a convex flank — and a chord across a convex surface
  passes under it. So every flow's margins were buried and which parts showed
  depended on the camera. `tools/test-volcano-flow.mjs` asserted *fewer than
  25% of vertices buried*, a tolerance invented to make a failing test pass
  rather than to describe anything true. **A quarter of the ribbon underground
  WAS the defect.** Each edge now takes the ground under itself; the assertion
  is zero.
- **Too straight.** The mountain is smooth by design (k=7, §43.2), so steepest
  descent down it is nearly a straight radial line. A seeded meander is laid on
  top — **the one openly decorative term in the lava model**, flagged as such
  in `VOLCANO.map3d.lava`, and the first thing to delete if real elevation data
  ever lands.
- **The travelling pulse.** Aaron thought it had been lost from the plate
  lines; it had not — it is `SEAM_FRAG` in `proto/world-deep.js`, and lava now
  uses the same construction deliberately. Rides a per-vertex distance in
  METRES so it travels rather than blinks, two untidy frequencies so it is not
  a metronome, sharp crests over long troughs.

**THEN JUDGE THESE, IN ORDER. ALL STILL UNSEEN.**

1. **Does a refined mountain look wrong next to an unrefined one?** An erupting
   volcano is sampled 3x finer, so it has visible gullies while its dormant
   neighbour is smooth. Detail the eruption earned, or a glitch? Cannot be
   called from a desk.
2. **Is the crawl right?** `lava.crawlHz` 0.11, deliberately slow. Bands
   travelling visibly *down* the flow would be a conveyor belt and wrong.
3. **Does lava cost a repaint on a land volcano?** The sea funded the plume
   argument, but most erupting volcanoes have no seamount in their cluster, so
   lava is the only thing asking. `lava.crawlHz: 0` kills the crawl and the
   repaint together.

**NOTHING HAS BEEN SEEN WITH REAL LAVA DATA.** No live payload was read while
building this — no sandbox egress, and the fetch tool refused the relay URL — so
how many volcanoes carry `lava` in a given week is unmeasured. **Zero is a
plausible week.** Zero flows looks identical to a broken shader unless you read
the badge: `!L` is the shader failing, no mark at all is nothing erupting lava.

**DO ERUPTING VOLCANOES READ AS LIVE?** Still formally open. The live set now
carries a full-strength halo in magma orange, which is a standing glow and costs
no frames, and nothing else animates on this world. **If they still read as
inert, that is an argument for pulling Phase H forward, not for adding a pulse.**
*New wrinkle since the colour change:* the live set is now the same hue as the
plate seams, so "hard to find" and "reads as inert" are two different failures
with two different fixes — separate them before touching either.

**THE SHORE CUT IS DONE AND CONFIRMED ON GLASS.** The sea stops at the coastline.
As-built in `SPEC-GLOBES.md` §42.1.4c. **Do not re-derive a coastline from tile
geometry** — three cuts did and all three were reverted; the answer is already
on screen.

**ONE THING WAS NOT SEPARATELY CHECKED: TWO-FINGER ROTATE.** That is where the
third attempt died, and this one should be immune because it reads the screen
rather than the tile cache. Immune by argument is not immune. Ten seconds next
time the app is open near Kuwae, Kavachi or Palinuro — everywhere else looks
identical either way.

**AND THE FRAME COST IS UNMEASURED.** The copy is skipped when the camera has
not moved, so a still map with moving water should pay nothing — but nobody has
measured one of these frames, which is `NEXT UP` item 1 and now has a third
feature riding on it.

**==> THE WATER IS OPTICS NOW, AND IT HAS BEEN WRONG ON GLASS TWICE. <==** The
sheet is a flat plane; the wave exists only as a per-pixel normal, carrying a
refraction of the scene beneath it, a glint, and a crest tint. As-built is
`SPEC-GLOBES.md` §42.1.4c. **Colours are ACCEPTED and untouched** — `#241A5C`
body, `#D6C1E1` crests, *"I like the colors."*

**FIRST RENDER: opaque pale ribbons. SECOND: a fingerprint of scales that
re-patterned every time the globe was rotated.** One arithmetic cause and one
design cause. Both fixed, both UNSEEN.

- **The arithmetic.** `slopeScale` was 4.0, set from a peak slope of 0.19 — which
  was ONE train's peak, not the three summed. The real sum was 0.742 (37°), so
  the surface rendered at **71°**, a wall, and every term downstream behaved
  correctly on nonsense: the sheen saturated, the additive highlight blew out,
  and the coverage term reached 1.0 and mixed the refraction away entirely. That
  last one is why the transparency vanished. There is no exaggeration factor any
  more, and amplitude is derived per train from one `steepness`, so the shortest
  wave can no longer dominate every normal. Peak is 0.30, about 17°.
- **The design.** The glint tracked pitch and bearing. Aaron: *"it does this when
  I rotate around. I don't think it needs to rotate."* Right on both counts — it
  also disagreed with the mountains it sits among, which have no view term at
  all. The half-vector is a constant now. **Fresnel was deleted rather than
  faked**: with no eye in the lighting it has nothing to be a function of.

**WHAT TO LOOK AT, IN ORDER.** Is there water at all — a shader failure is a
console line, not a blank sheet. Can you see the seamount THROUGH it. Then
`refractPx` (12) for how much the seabed wobbles, `specular` / `shininess`
(0.55 / 24) for the glint, `crestMix` (0.35) for the tint. **If it still reads as
a repeating pattern rather than as water, that is the structural problem below,
not a dial.**

**THE THREE-FREQUENCIES PROBLEM IS ANSWERED, AND THAT ANSWER IS ALSO UNSEEN.**
Gemini's round-2 reply named it correctly and the fix is in:
`proto/water-noise.js` builds a 256x256 tiling slope map at load and the shader
samples it twice, at 1400 m and 520 m, drifting on two headings. `shininess`
went 24 -> 110 in the same pass, because a tight exponent only reads as sparkle
on a surface that HAS fine structure — the two move together.

**Two of Gemini's four were NOT taken, and both were deliberate.** It proposed a
per-pixel view vector recovered from the inverse projection matrix — which
contradicts Aaron's *"I don't think it needs to rotate"*, and whose stated
extraction (column 4 of the inverse, divided by w) is not the camera position
anyway; that column is the view-volume centre at mid-depth. And it proposed
fresnel back on the alpha, which is the exact term that cost the transparency.
Its noise generator was also a sum of sines at non-integer frequencies, which
does not tile — replaced with periodic value noise, checked for a seam.

**AND THE FRAME COST WENT UP, ON TOP OF A REPAINT NOBODY HAS MEASURED.** A second
full-screen blit and a second `render()` per frame, plus roughly a dozen trig
calls per water pixel. Both copies skip themselves when the picture has not
changed. `NEXT UP` item 1 is now carrying a fourth passenger.

**`proto/volcano-3d.js` IS OVER §12's CEILING AND THE CUT IS IDENTIFIED, NOT
TAKEN.** The water `ShaderMaterial` belongs beside its GLSL in a
`proto/water-material.js`, landing the file near 660. Held while the shader is
still changing every session — a file move in the same commit as a look change
makes a break impossible to attribute. **Take it the moment the water is
confirmed working.** Full entry in `SPEC.md` §12's inventory.

**AND LAVA PUSHED TWO FILES FURTHER OUT, WHICH IS ACKNOWLEDGED DEBT AND NOT AN
EXEMPTION.** `proto/volcano-3d.js` 737 → **795** (the lava wiring, ~20 lines,
which genuinely belongs in the file that owns this render pass) and
`lib/volcano-ridge.js` 627 → **730** (`surfaceHeightAt` and the refine option).
Neither got an inventory first, which §12 asks for. The ridge cut, when it
comes, is the clustering — `ridgeMember`/`clusterMembers`/`lonDelta` are a
self-contained ~140 lines that know nothing about grids or colour.

**ONE THING NOTICED AND NOT TOUCHED: THE LAYER'S +y MAY BE SOUTH.** Local metres
go into mercator through a pure scale-and-translate with no flip, and MapLibre's
mercator y grows southward — which would mirror every cluster north-south.
**Unverified**, and invisible so far because 133 mountains sit in 127 ridges, so
almost every cluster is a single cone, and a lone cone mirrored about its own
axis is identical. It would show on a multi-member arc.

**`tools/coast-probe.html` IS NOW ORPHANED.** It reports the live tile schema,
ring count and point spacing. Nothing uses tile geometry for the shoreline any
more, so it is a diagnostic with no consumer — delete it the next time anything
in `tools/` is touched.

**THE VOLCANOES WEAR THE WORLD'S OWN TWO COLOURS AND AARON HAS SEEN THEM.**
Quiet is the coastline's orchid `#DB8EF0`, live is the plate seam's magma
orange `#FF7A1A` — *"the colors look great."* **Kept through the revert; they
were never part of it.** The measured objection is recorded and does not stand:
an erupting volcano is now the same hue as the seam it physically sits on,
where gold held 17°. **If an orange pip is ever hard to find against an orange
seam, that is this** — and the fix is hue, since this colour already failed
once by going pale.

**WHAT SURVIVED THE REVERT, AND IT IS WORTH KEEPING.** Two files were over the
§12 ceiling and both came under it: the sea sheet left `lib/volcano-ridge.js`
(778 → 632) as `lib/volcano-water.js`, and the two GLSL programs left
`proto/volcano-3d.js` as `proto/water-shader.js`. Structure only — no
behaviour rode along.

**THE MAGMA SEAMS HAVE NOT BEEN JUDGED, ONLY MEASURED.** Three passes at
1 : 4.4 : 10; a cut across a seam measures luminance 242 / 84 / 45 against a 38
background. Only the middle pass overlaps USGS MMI's range, and the rule that
resolves it stands: **quake severity on Deep is size and ripple strength, never
hue** (`SPEC-GLOBES.md` §43.2). **Look at whether the core reads as molten or as
fairy lights.**

**THE PLATE LINES MAY SAG IN THE MIDDLE OF THE DIVE.** Pixel counts across the
crossfade ran 8571 → **4844** → 10285 at z2.25 / 2.5 / 2.75: at the midpoint the
3D seams are at 74% and MapLibre at 58%, and two half-faded copies of one line do
not composite back to a whole one. Structural, and the three-pass stack widens
the gap. **Zoom in slowly from space and watch.** Fix is in `DIVE.fade`, which
the shipped coastline rides too, so it is not a prototype-only change; the deeper
fix is ribbon geometry (§43.2.2).

**THE LAND HANDOFF HAS THE SAME MIDPOINT FAULT.** A "shading" at mid-zoom that is
two land fills overlapping during the dive — MapLibre's `landFaint`/`land` fading
up under the Three sheet's translucent white, on two different bands. Same
structural cause, same `DIVE.fade`, and **fixing one should fix both.** Not a
bulge: both renderers use a perfect sphere at radius 1.0.

**THE PLATE NAMES WANT A GLASS READ ON TWO NUMBERS.** `SIZE.plateLabelPx` is 10.5
and at the planet band on a 429 px globe that is very small — move it first if
they are hard to read. `PLATE_LINE.labelBands[].anchorDeg` is the density dial at
95/34/9. Two things that are DESIGN rather than misses: a plate with four
boundaries in view is named four times, and the band handovers at z4.0 and z5.5
show one name at half strength in two places for 0.3 zoom levels. Both explained
in §43.2.2; the second may read as a ghost rather than a fade.

**THE "STATE NAMES" TOGGLE WILL DO NOTHING ON DEEP.** `setAdminVisible` is a safe
no-op there — safe, not honest. Whoever wires Deep into the real drawer has to
hide that switch on this world. Nothing is broken today because the prototype has
no drawer, so there is no caller to write the code against yet.

**==> THE ASH CHANNEL HAS NO ARCHIVE AND THAT IS THE LAYER'S BIGGEST HOLE. <==**
The bulletin slots are latest-only and overwritten in place, so **ONE MISSED POLL
IS ONE PERMANENTLY LOST ADVISORY.** **SCOPED, NOT BUILT** —
`claude/ash-archive-scope-2026-07-30.md` in the Project. Shape: one KV key per
advisory, written once, 30-day TTL, raw text not parsed, on its own key prefix.

**Two things must be MEASURED before a line of it is written.** How much of the
free plan's **1,000 KV writes a day** the warm loop already spends (that, not the
50-fetch cap, is the binding constraint). And whether `ash.js` honours the
warm-key bypass at all: its stampede guard and the cron are both five minutes, so
**the Worker may be spending every cycle reading its own last answer.**

**LEGACY VOLCANO NUMBERS ARE STILL ON THE WIRE.** Read live from Anchorage's
slots: `KATMAI 1101-17` and `PAVLOF 1102-03`, region-style numbers GVP retired in
2013. They cannot join the catalog and are dropped as `unknown_volcano`. Katmai
also arrives as `312170` elsewhere so it survives; **Pavlof may not.** Aaron has
ruled out a crosswalk — recorded so the count is understood, not so it gets
fixed.

**The 16 Decade Volcanoes list is model memory only and must not be built on.**

**==> H1 IS DONE AND IT MOVED FOUR THINGS. <==** Measured against the live wire
2026-07-31; all four are written into `SPEC-GLOBES.md` §42.1.5 / §42.1.9.

- **Heights are settled**: every ash advisory reporting ash states a top, 10 of
  10 active. The old "6 of 22" was counting weekly prose, which is the wrong
  channel. No prose height parser is needed.
- **The height is above SEA LEVEL.** Real plumes are **0.4–1.1 km above the
  summit**, a third of what §42.1.5 assumed. Sabancaya's 21,000 ft advisory is a
  441 m plume. The subtraction term is in the bulletin (`SOURCE ELEV` /
  `SUMMIT ELEV`) and **its unit varies by centre.**
- **Resuspended ash was NOT being dropped** — live, named, 21,000 ft. Now
  flagged rather than dropped, both channels.
- **Drift is stated outright** as `MOV <bearing> <speed>KT`; the observed-to-
  forecast vector plan is unnecessary. Parse is H3.

**SHIPPED WITH IT:** the weekly narrative is now classified at the edge into
`ash`/`steam`/`lava`/`pdc`/`lahar`/`resuspended` (`_emissions.js`) — the classes
ship, the prose does not. **The U+FFFD encoding fault is diagnosed and fixed**:
the feed declares ISO-8859-1 and we read it as UTF-8.

**THE LAST FIELD OF A BULLETIN ABSORBS THE NEXT ONE'S WMO HEADER.** Seen live
2026-07-31 on Tokyo's Aira advisory: `nextAdvisory` came back as
`NO FURTHER ADVISORIES= FVFE01 RJTD 221237 VAAAK1`. Records split on the
`VA ADVISORY` header, so the routing lines that sit ABOVE it in a concatenated
file fall to the previous record's final field. **Cosmetic today** — that field
is display text — but it is worth knowing before anyone renders it, and worth a
check that nothing is being swallowed rather than merely appended.

**ONE THING TO WATCH THAT IS NOT OURS.** The Smithsonian's machine-readable
feeds run about a week behind their own web page — on 2026-07-31 the page showed
23–29 July while RSS and CAP both still served 16–22 July. **Our relay is honest
and the lag is upstream.** The three-way union covers it: Fuego, Santa Maria and
Telica were missing from our weekly channel and present through ash anyway.

## NEXT UP

**==> AHEAD OF THE NUMBERED QUEUE: A FIFTH OF REAL iPHONE TRAFFIC MAY BE SEEING
NOTHING. <==** 5 of 26 iOS sessions recorded no `t_globe_ms` at all; every other
platform is effectively zero. In four of the five the DATA arrived in under
1.2 s, so those visitors did not just leave — the app got what it needed and the
globe milestone never fired. Two were iPads. **Aaron owns no iPhone or iPad, so
all 26 are strangers.** Either the globe never came up, which is a silent
failure and banned, or the mark does not fire on WebKit and the column is a lie.
Pairs with: no outside visitor has ever opened an advisory. Cannot be reproduced
on hardware Aaron owns. Detail in the Project as `claude/backlog.md`.

**1. WHAT A MAPLIBRE FRAME COSTS — AND TWO THINGS NOW PAY IT.** Undone, and more
urgent than when it was written. `attachIdleRotation` calls `setCenter` per frame
below `DIVE.zHandoff`, so a resting globe already drives a full map repaint —
including at the space floor where the map is at CSS opacity 0 and invisible.
**Moving water now pays it too**, at map zoom, via `triggerRepaint()`. Measured:
drift pinned, zero MapLibre renders per second; unpinned, one per frame. **Nobody
has measured what one of those frames costs.** `proto/shell.js`'s self-driven
loop is the shape of the fix. Do it before smoke, dust or any further continuous
effect.

**2. THE ENFORCED CSP NEEDS A GLASS READ, AND IT IS THE ONE THING THAT CAN BLANK
THE APP.** The policy is out of Report-Only and blocking for real.
`tools/csp-check.mjs` passes but runs offline, so **a selected storm, satellite
imagery and radar were never exercised** — the paths most likely to reach a host
the policy has not been told about. Open a storm on a phone with imagery on. If
something breaks, put the header back to `Content-Security-Policy-Report-Only`
and redeploy; that is a one-word fix.

**AND THE POLICY HAS ALREADY EATEN ONE TOOL.** `tools/imagery-probe.html`
carries an inline `<script>`, and `script-src` has no `'unsafe-inline'` — so on
the deployed site it is almost certainly dead, loading as a page whose controls
do nothing. Not verified on glass, and nothing in `tools/csp-check.mjs` covers
`tools/`. **The fix is the one `tools/coast-probe.js` already uses: move the
script to its own file.** Worth knowing before anybody reaches for that probe
and concludes the imagery is broken.

**3. RESPONSIVENESS — SHIPPED, AWAITING A GLASS READ.** The five fixes are in and
the counts are asserted by `tools/test-recompute-budget.mjs`; what is NOT known is
whether INP crossed under the 200 ms bar. **Read `worst_event_ms` in D1, not Web
Analytics** — same question, no dashboard, and it splits by platform. Current
picture: 115 ms typical, but 1,797 ms in the worst-blocked band, so this is the
same disease as the Windows entry below. Boot long tasks are NOT the remaining
suspect: 2–3 tasks and ~900 ms before DOMContentLoaded against ~7000 ms after it,
which is the idle rotation loop and belongs to item 1.

**4. THE BOOT SCREEN IS UP FOR FOUR SECONDS AND NOTHING MEASURES IT.**
`tools/load-probe.mjs` on a 4x-throttled phone: the veil lifts at **3982 ms**,
while Chrome reports LCP at 340 ms. `#boot` is opaque and `inset: 0` and Chrome's
LCP does no occlusion test, so **every LCP number this project has is timing an
element nobody can see.**

Roughly 1.9 s sits between DOMContentLoaded and the globe. `tools/boot-profile.mjs`
names the biggest single piece — a 4096x2048 land texture, **511 ms in
`texImage2D` plus 202 ms rasterising it**, on every cold load, for a sphere first
seen from space. Halving the texture is the obvious first swing and it is
untested. The other half is unattributed; profile before guessing.

*Two dead hypotheses, do not reopen without new data:* the OpenFreeMap CDN is not
the bottleneck (3982 ms healthy vs 3807 ms unreachable), and preloading was
measured and rejected (see `_headers` and the probe's `--preload` switch).

**5. GULLIES ARE THE HALF OF CHARACTER THAT DOES NOT FIT, AND THE MEASUREMENT IS
NOT TO BE REPEATED.** The grid is ~21 samples across a mountain and fine downhill
rills need roughly 3x that. Tripling `ridge.cellsPerRadius` to 30 on the
240-volcano drawn set takes it from **130,350 nodes to 1,108,989** and the build
from **134–288 ms to 994–4,021 ms** on a sandbox CPU faster than a phone, with
`ridge.maxCells` needing to rise 9x alongside or every cluster silently coarsens
back. **That is a blocking multi-second build on a phone.** The answer is
resolution that follows on-screen size, which is its own session.

**6. THE RENDERING DEEP DIVE, AND THE BRIEF IS ALREADY WRITTEN.** Cutting edge of
three.js and anything else that gets §41–§43's effects onto a phone. **The loaded
brief is `claude/globes-research-brief.md` in the Project** — every measured
number, the engine baseline, the rejected techniques with their evidence, and
eight named questions. Read it before searching anything. The gate on all of it:
**the app is on three.js r128 (2021), current is r182+.** Nothing in §41–§43 is
reachable without that jump, and the backlog defers it out of the Sky freeze
window.

**7. GDACS IS THE FEED THAT LEAVES PEOPLE ON A SPINNER.** 177 of 196 loads ok
(90%) against NHC's 194 (98%), and **11 visits ended with GDACS still loading** —
no success, no error, just a spinner the visitor left behind. Retry has been
pressed **zero times in 193 sessions**, so that recovery path has never been
exercised by a real user.

**8. EVERY VISITOR DOWNLOADS 113 KB OF VOLCANO CONSTANTS AND USES NONE OF IT.**
**The hazard work stays — this is extraction, not removal.** Traced from
`main.js` 2026-07-31: the shipped app reaches 103 modules and **not one is
volcano, plate or multi-globe code.** The split is clean. Two things leak
anyway, and both are on the critical path of every cold load:

- **`VOLCANO` in `config/constants.js` is 1,971 lines — 37% of the file,
  113 KB raw, 42 KB gzipped.** Nothing shipped imports it, but `constants.js`
  is imported by nearly everything and there is no build step to tree-shake it,
  by design. **Move the block to `config/worlds/deep.js`**, which is where it
  belongs and which nothing shipped loads. The eight `lib/volcano-*.js` files
  and `data/volcano-live.js` already import `VOLCANO` by name and follow it.
- **`map/style.js` defines plate-boundary line and label layers** (~150 lines,
  and the `PLATE_LINE` import) that **are never fed** — `map/plate-seams.js`
  pushes the data in and is not loaded. Empty layer definitions shipping to
  every user. Take them out with `PLATE_LINE`'s 212 constant lines.

Nothing else costs a visitor anything: `proto/` (6,293 lines), the volcano
tools (5,103), `functions/api/volcano/` (1,942) and the hazard specs (3,987)
are all off the shipped path and stay put.

**This is the cheapest measured win on this list** and it lands on the same
cold-load path as the slow tail. **But it edits two shipped files during
cyclone season** — `constants.js` and `style.js` — so it gets its own pass, its
own push, and a look on glass before anything else moves. Not `globe3d.js`, so
not blocked by the Sky freeze.

**Delete `map/pitch-ramp.js` and its `TILT` constants in the same pass.**
Unreachable, nothing to do with hazards — dead cyclone code, and §12 says dead
code is deleted rather than archived.

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

**The three-globe expansion.** One app, several globes, a switcher between them:
**Sky** (cyclone, and it is Landfall today), **Surface** (flood + drought +
wildfire), **Deep** (earthquake + volcano). Data in `SPEC-HAZARDS.md` §18–§26,
payloads under `samples/`.

**`SPEC-GLOBES.md` §38–§44 IS STALE ON BOTH THE SPLIT AND THE NAMES** and needs
rewriting before the second globe starts. It still describes Sea/Air/Land grouped
by rendering technique; the grouping is now by what the data IS, which is why the
names are altitudes. The live consequence is that **drought lost its free
rendering path** — per-dot dimming cost nothing only on the dot-matrix globe. A
full-screen haze is ~40% of the frame budget, so Surface needs a different answer,
and its land form is deliberately undecided until Deep is on glass.

Build order is §44 and it is engine-first: r128 → r182+, then the world shell,
then **Deep with earthquakes only** — the cheapest world, fully unblocked, and the
plate boundaries make it look finished on day one.

Still genuinely blocked: **the global drought raster** (Copernicus is Europe-only
and name-guessing is exhausted) and **the NIFC perimeter payload size** (429 on
every attempt). Neither gates the first two globes.

**The app is called Landfall and is no longer a hurricane app.** Name, subdomain
and install identity are `[DECIDE]` before a second globe ships.

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

## KNOWN AND ACCEPTED

- **The slow tail is WINDOWS, and 43 of its 62 sessions are Aaron's own work
  PCs.** Strangers on Windows: 8.8 s to storms, 3,561 ms blocked. Aaron's two
  work machines: 2.1 s, 572 ms. Both are 32 GB / 14-core on office internet and
  were hiding the problem. Blocking is the cause and the correlation is clean —
  under 0.5 s blocked averages 1.5 s to storms, over 5 s blocked averages 14.2 s.
  Worst single session: 27,086 ms across 86 long tasks. **Nobody has looked at
  what the blocking is.** Numbers and the per-band table are in the Project as
  `claude/backlog.md`.
- **Re-run that before acting on it.** `hidden_at_start` / `first_hidden_ms`
  shipped 2026-07-31 and have never carried a real value. Some of that tail may
  be backgrounded tabs rather than slow machines — one hidden iOS session
  recorded 97 s to storms and made iOS look like the worst platform in the table
  when its true median is second best.
- **iOS's clean long-task numbers are an instrumentation gap.** All 26 WebKit
  sessions report `longtask_n = 0` because WebKit does not implement the
  observer. `ttfb_ms`, `mem_gb` and `conn_type` are blank on WebKit for the same
  reason. Do not read any of those columns as "iPhones never block".
- **`overallStatus` returns `ok`, not `clear`, when only ended storms are held.**
  Deliberate — `clear` would fire an all-clear while a grey dot sits on the globe.
- **Ended storms keep their track but not their wind swath.** Cosmetic; nobody has
  asked for it.
