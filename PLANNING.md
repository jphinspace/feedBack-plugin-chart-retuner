# Chart Retuner — planning

This file holds **only future / not-yet-implemented work**, in enough detail
to pick up and build from. Everything already shipped — the design rationale
and the full phase log — lives in [`HISTORY.md`](HISTORY.md).

---

## Future enhancements

None blocking; each is a candidate for its own phase, ordered roughly by
priority. Item 1 is the newest and highest-value idea but is still
exploratory (no design committed yet); item 2 is the most actively worked
(ongoing bug-fix cadence); the rest are ordered roughly by expected
user-visible value.

### 1. Idiom-native chord shapes across tuning families

**Status.** Exploratory — problem framed below, no implementation started.

**Problem.** The engine today does exclusively **pitch-preserving** remap:
every note/chord sounds its exact source pitch, relocated onto whatever
target string/fret reaches it (`src/retune-engine.js`/`chord-solver.js`).
Harmonically correct and comprehensive, but not how a fluent player thinks
about retuning — a "G chord" played in Standard, Drop D, DADGAD, or a
fourths tuning uses a **different, tuning-idiomatic hand shape** in each,
not the same pitches replotted onto new strings. Goal: when the target
tuning has a known native shape for a recognized chord (root + quality),
play *that* shape; fall back to today's pitch-preserving path only as a
**last resort** — a third tier above chord-solver's existing
revoicing-degradation ladder, not a replacement for it.

Worked examples (open G major), across the families this needs to cover:
- E standard (EADGBE): `320003`
- B standard (BEADF#B) — same family as E standard, different root: `X32010`
- DADGAD: `550020` or `550000` (the second voices G-D-A, an add9 color —
  idiomatic for modal/drone tunings, not a plain triad)
- EADGCF fourths: `3200XX`

**Core finding: this can't be derived from tuning-interval math — every
family needs its own curated reference data.** Checked directly against
real sources for all five families below (not just assumed), and true in
every case, including families where the interval-structure math looked
like it should transfer cleanly. Interval-structure reasoning still finds
which *tunings* belong to the same family (see "Within a family" below,
for the cheap same-family case) — it just can't substitute for real chord
data once the question is what a family's own players actually play.

**Families**, grouped by shared interval structure rather than
per-tuning-pair lookups (a combinatorial table wouldn't scale or
generalize to an uncataloged tuning):
- **Standard family** — any transposition of EADGBE's own interval pattern
  (four perfect 4ths + one major 3rd between G/B), started on a different
  root: E/Eb/D/B standard, etc.
- **Drop family** — a standard-family tuning with only the lowest string
  dropped a whole step (Drop D, Drop C, ...). Needs its own catalog, not
  an inherited patch from standard: (1) chords that don't even touch the
  dropped string can still need a different voicing — standard's open D
  mutes both low strings (`XX0232`) because leaving them open adds a
  clashing tone below the root; the identical `000232` pattern is fully
  idiomatic *unmuted* in Drop D, because the open low string is now the
  chord's own root, not a clash (verified against both tunings' actual
  pitches). (2) Root cause: the two lowest strings go from a perfect 4th
  apart (standard) to a perfect 5th apart (drop D), which ripples into
  fingering/muting choices across the whole neck, not just chords that
  fret the dropped string.
- **Fourths family** — every interval a perfect 4th (EADGCF and its
  transpositions). Has its own native, more economical open-position
  system, not borrowed from standard's CAGED shapes: per Wikipedia's *All
  fourths tuning* article and its Wikimedia chord chart (References),
  all twelve open-position major triads come from just **two** shapes
  (named for the chord each produces at its "home" position — an "F
  major" shape and a "D major" shape), each movable up the neck *and*
  diagonally across three different 4-string groups (strings 6-3, 5-2,
  4-1) — 36 voicings from two patterns. The raw arithmetic behind "borrow
  standard's bottom four strings" is still true (`3200XX` above really is
  playable) — it's just not the idiomatic vocabulary. Exact fret numbers
  for the native F-shape/D-shape system still need pulling from Keith
  Bromley's chord reference (References, not yet retrieved) or the
  Wikimedia diagram directly.
- **Open family** — tunings that sound a major/minor triad open (Open G,
  Open D, Open C, Open A, ...). More than a uniform movable barre: general
  slide-tuning references also describe thumb-driven idioms (the thumb
  walking a quarter-note bass line across strings 6-4, independent of the
  fretting hand) and voicings built on the tuning's duplicate scale-degree
  strings (open D's multiple D's and A's at different octaves).
- **DADGAD-style / modal family** — tunings voicing a sus/add-tone chord
  open rather than a plain triad (DADGAD itself, CGDGCD, ...). Confirmed
  directly: "transposing chords from standard tuning to DADGAD isn't a
  simple one-to-one conversion... the fingerings for the same chord
  quality will change significantly" (References). Idiom leans on drone
  strings left ringing while only one finger moves, and fingerstyle
  technique (Travis-picking the thumb between the two bass strings) that
  a static frets snapshot may not fully capture — needs more than one
  voicing per quality, and possibly a way to flag "this idiom assumes
  fingerstyle, not strumming" the schema doesn't have yet.

**Within a family built from a uniform whole-tuning shift** — every
string retuned by the same amount, true for standard and fourths family
members (B standard is E standard with all six strings down a perfect
4th) but *not* drop (only one string changes) — the whole shape library
transfers unchanged, no per-tuning curated data or fret transposition.
Templates are named by shape, not by chord letter (CAGED's own C/A/G/E/D
names), since the letter a shape produces is scoped to `(family,
reference tuning)` only: `X32010` is the standard family's **C-shape**
because it produces C major on the reference tuning (E standard); the
identical pattern on B standard produces **G** major instead (B standard
is standard's pattern down a perfect 4th; C down a perfect 4th is G).
Realizing a target root on a specific family member = find that tuning's
own shift from the reference, undo it against the target root to get the
reference-tuning root to look up, and play that entry's `frets` verbatim
— no fret transposition (same kind of alignment `computeArrangementShift`
already computes for pitch-preserving remap). Cross-family mapping always
needs real curated data, no exceptions found yet — even fourths, despite
sharing standard's bottom-four-string arithmetic, turns out to have its
own native system (above).

**Proposed schema (tentative).** One entry per idiomatic shape:
- `family` / `shapeName` — CAGED-style names for standard/drop/fourths,
  family-specific names for open/DADGAD-style. Scoped to `(family,
  reference tuning)` only, never a universal chord-identity claim.
- `referenceRoot` / `referenceTuning` / `quality` — what this shape
  produces on the family's own reference tuning specifically.
- `inversion` (`'root'`/`'first'`/`'second'`/`'third'`) — abstract,
  root-independent: which chord tone is lowest. Reusable across a
  same-family lookup with zero note-name math (query `inversion:
  'second'` directly, the way `referenceRoot` already works).
- `slashBass` (note name, nullable) — the concrete bass note once a
  specific tuning is in play; the only one of the two fields that can
  represent a genuine non-chord-tone slash bass (a hypothetical C/D).
  Not redundant with `inversion` — one's the abstract ordinal a
  same-family lookup needs before a note name exists, the other's the
  concrete note a chart's own slash chord names.
- `frets` — the `-1`/`0`/`N` (muted/open/fretted) convention chord
  templates already use elsewhere in this codebase. No separate `fingers`
  field: same fret across adjacent strings already reads as one barred
  finger by ordinary chord-diagram convention, so it's fully inferable
  from `frets` with no separate stored data needed (checked against the
  existing `computeChordFingers` in chord-solver.js — it solves a
  different problem, guessing fingers for an algorithmically-revoiced
  chord, and doesn't apply this convention, so it isn't a substitute).

Cross-family lookup is a second, smaller mechanism: shapes keyed by
`(family, quality)` directly, no shift math at all.

Three verified entries — the standard family's C-shape and its slash-bass
siblings (fretting or opening the otherwise-muted low E string changes
nothing else about the shape, just which chord tone ends up in the bass):

```js
{ family: 'standard', shapeName: 'C-shape', quality: 'major',
  referenceRoot: 'C', referenceTuning: 'E standard',
  inversion: 'root', slashBass: null,
  frets: [-1, 3, 2, 0, 1, 0] }, // X32010

{ family: 'standard', shapeName: 'C-shape (bass G)', quality: 'major',
  referenceRoot: 'C', referenceTuning: 'E standard',
  inversion: 'second', slashBass: 'G', // C/G — G is the 5th
  frets: [3, 3, 2, 0, 1, 0] }, // 332010

{ family: 'standard', shapeName: 'C-shape (bass E)', quality: 'major',
  referenceRoot: 'C', referenceTuning: 'E standard',
  inversion: 'first', slashBass: 'E', // C/E — E is the 3rd
  frets: [0, 3, 2, 0, 1, 0] }, // 032010
```

A movable/barre shape (one hand shape usable at several neck positions
for different roots, needed per Decisions below) isn't modeled by a flat
`frets` array like these — it likely needs its own `barreFret`/root-offset
field, part of what "Still open" hasn't settled.

**References — check before authoring real shape data, don't derive
shapes from tuning math alone:**
- Fourths family — Wikipedia's *All fourths tuning*
  (https://en.wikipedia.org/wiki/All_fourths_tuning) + its Wikimedia
  chord-chart image (File:Perfect_fourths_P4_tuning_chords_C_major.png) —
  source of the two-shape/36-voicing finding above. Keith Bromley's
  "Sixty Guitar Chords for All-Fourths Tuning"
  (http://www.keith.bromley.name/sitebuildercontent/sitebuilderfiles/P4_Guitar.pdf)
  and synthetictruth.com/music/p4/ are the primary chord-chart sources for
  the exact fret numbers, both still blocked by TLS cert errors. Weaker
  secondary sources: fachords.com, unlocktheguitar.net, chord.rocks,
  gtdb.org/eadgcf.
- Drop family — guitarworld.com, guitar-chord.org, timberlineguitars.com,
  theacousticguitarist.com (top-5-strings-unchanged principle). The
  barre-fingering and open-D muting-pattern facts above came from direct
  domain knowledge, not these pages — still worth cross-checking against a
  dedicated drop-tuning chord chart.
- Open family — opengguitar.com, brentrobitaille.com (barre-major /
  two-finger-minor idiom); stringsdirect.co.uk, playslideguitar.com
  (thumb-bass, duplicate-string idiom).
- DADGAD-style family — guitarworld.com, benfarmer.co.uk,
  guitargearfinder.com, guitarplayer.com, playfingerstyleguitar.com
  (drone/Travis-picking idiom, the "not a simple conversion" quote).
- Standard family — any CAGED-system reference.

**Decisions.**
- **Chord recognition is a build step, not an open question.** Source
  charts don't always carry a chord name — native-shape lookup needs a
  root+quality classifier over the source fret pattern first. Build one:
  extend chord-solver.js's pitch-class infrastructure
  (`chordSpecFromNotes`/`pitchClassOf`) with interval-from-root pattern
  matching (major/minor 3rd, sus4, added tones, etc.). Also needs to
  report the bass note for the `slashBass` key — a much smaller addition,
  since "which note is lowest" needs no pattern matching, just reading off
  the already-sorted note list. Prerequisite the rest of the feature
  depends on.
- **Coverage is organic per family, not a target to hit before shipping.**
  Catalog whatever's actually idiomatic — naturally uneven (DADGAD/open
  skews sus/add-tone; standard/drop/fourths skews full major/minor/7).
  Anything without a cataloged native shape falls straight through to
  today's pitch-preserving path — that fallback *is* the safety net, so
  the catalog can grow incrementally without ever leaving a chart
  unplayable.
- **Both open-position and movable/barre shapes are in scope** from the
  start, not open-position-only with movable deferred.

**Still open:**
- **Data vs. code.** `BUILTIN_PRESET_TUNINGS` is data-driven; the
  "same-family = transpose, cross-family = curated template" split argues
  for two distinct mechanisms rather than one big lookup table, but the
  exact shape (JSON-like table vs. per-family functions) isn't decided.

**Verify (once a design exists).** Every worked example above (and its
family-mates) reproduces the expected canonical shape; unmapped
root/quality/family combinations fall through to today's pitch-preserving
result unchanged; existing suites pass unchanged until this is wired into
`createRetuner`'s actual call path.

### 2. Playability & legibility of remapped output

**Status.** Pitch-preserving remap across tunings (per-note, chord-aware
revoicing, hand-position anchors) is confirmed working end-to-end — verified
against real charts through several rounds of bug fixes. Whether a remapped
note sounds the right pitch, whether the chord solver finds a legitimate
voicing, whether an anchor's math agrees with what the notes actually do —
that's no longer the open question.

**What's next.** With correctness established, the priority shifts to
*playability* (how hard a remapped note is to play relative to the original,
given its surrounding notes) and *legibility* (does the highway/anchor
display read clearly, especially for the repeated patterns most songs are
built from). Known gaps to pick up from — not solved yet, just called out:

Playability:
- `reduceHandTravel` only ever compares a note against its immediate
  prev/next neighbor and only ever considers the two naturally-adjacent
  strings (`n.s ± 1`) as alternates. It has no view of a note's role in a
  longer phrase, and can't relocate a note two strings over even when
  that's the only comfortable option.
- The scoring metric is raw fret-distance only, blind to string distance —
  a same-fret-number alternate on a string away from where the hand
  actually is can score as "comfortable" when it requires a bigger
  movement than staying put. The prevGap/nextGap asymmetry works around
  one shape of this; likely not the only shape it affects.
- Chord-grouped notes are entirely exempt from hand-travel reduction
  ("already have a deliberate voicing"), so a chord's voicing and the
  standalone notes immediately around it are never reconciled against
  each other.
- `HAND_JUMP_FRET_THRESHOLD`/`HAND_JUMP_MIN_IMPROVEMENT` are flat
  constants, not scaled per instrument — a 5-fret stretch means something
  very different on a short-scale ukulele than a full-scale bass.

Legibility:
- Anchor width currently floors at the source chart's original authored width, but nothing checks whether that width
  is still a sane assumption once a differential per-string retune has
  actually changed which frets are in play.
- `ANCHOR_MAX_SPLITS`/`ANCHOR_DONOR_WINDOW_S` are flat constants too, not
  scaled per instrument or informed by phrase/section structure — the
  "rapid alternation" fallback has no concept of a musical phrase
  boundary, so it can unify a hand position across what a player would
  read as two distinct passages.
- Repeated-note consistency (same source string+fret -> same target
  fret) is only guaranteed for a literally consecutive run with nothing
  else in between. The same riff reused later in the song — a chorus
  repeating a verse's line, for instance — is remapped independently
  each time and isn't guaranteed to land on the same frets, since each
  occurrence's surrounding context can differ.

### 3. Per-preset chord stretch allowance

**Problem.** `MAX_CHORD_SPAN = 3` (`src/chord-solver.js:48`, max−min fretted
frets, i.e. a 4-fret box) encodes a guitar-scale hand. Short-scale /
high-register targets (violin, viola, mandolin, ukulele) make wider reaches
normal — and fifths tunings *need* them — so the solver revoices or degrades
chords a real player would just stretch for.

**Design.** Follow the Phase 15 `maxFret` pattern exactly — it threaded a
per-profile value through the same layers this needs:
- `src/target-tuning.js`: optional `chordSpan` field on
  `BUILTIN_PRESET_TUNINGS` entries and custom-tuning profiles; a fixed
  option list (e.g. 3/4/5/6, matching how maxFret avoids free-text) +
  `isValidChordSpan`/fallback-to-3 in `resolveActiveTuning`, which returns
  it alongside `maxFret`/`capo`/`octaveOffset`. Candidate presets: violin /
  viola / mandolin / ukulele get 5 (a fifth-tuned instrument's "one finger
  per diatonic step" hand covers more frets); everything guitar/bass-shaped
  keeps 3.
- `src/chord-solver.js`: `isPlayable` (`:161`) and `solveVoicingSearch`'s
  `allowedSpan` (`:304`) take a `span` parameter defaulting to
  `MAX_CHORD_SPAN`; the existing `Math.max(span, spec.span)` source-stretch
  escape hatch stays.
- `src/retune-engine.js`: `createRetuner().apply(bundle, targetMidiTuning,
  maxFret, chordSpan)` threads it into every solver call **and folds it
  into the internal `targetSig` cache key** (two profiles sharing strings
  but different spans must not cache-hit each other — same rule as maxFret).
- `screen.js`: thread the resolved profile's `chordSpan` into the
  `_transform()` call alongside `maxFret` — it never affects strings/colors,
  so it doesn't touch the tuning/capo output fields.
- `settings.html`: a `<select>` in the tuning editor — it reads
  `BUILTIN_PRESET_TUNINGS` and validators from the imported module, so a
  new field there is picked up with no mirror.

**Verify.** Solver-level: a chord solvable only at span 5 degrades at span 3
and solves at 5; `createRetuner` end-to-end with a mandolin-style target +
cache-invalidation on a span-only change. Existing suites must pass
unchanged (defaulting keeps every current call site byte-identical).

**Alternative considered:** deriving span from the target's register
(higher median open-string MIDI → shorter scale → wider span). Rejected as a
default because it guesses wrong for e.g. a high-tuned guitar; an explicit
per-preset value with a sane fallback is more predictable. Could be revisited
as the *default* the editor pre-fills.

### 4. Degraded-chord label marker

**Problem.** When the degradation ladder simplifies a chord
(`degradeLevel > 0`), the diagram still shows the chart's original name —
"Am7" over a power chord.

**Design.** `solveChord` already returns `{ placements, revoiced,
degradeLevel }`. Where `createRetuner` rebuilds a `chordTemplates` entry
from a solved voicing, append a marker to the rebuilt template's display
name when `degradeLevel > 0` (e.g. `"Am7 ▾"` or `"Am7 (simplified)"` — pick
after seeing it rendered; the name field flows straight into a consuming
renderer's chord diagram). Decisions to make at build time:
- Marker only for degradation (`degradeLevel > 0`), or also for revoicing
  (`revoiced: true`, same pitches re-fingered)? Recommendation: degradation
  only — revoiced chords still sound the full chord, so flagging them reads
  as noise.
- Optional settings toggle if the marker annoys anyone; default on.

**Verify.** Solver test: a degraded chord yields a rebuilt template whose
name carries the marker and whose non-degraded twin doesn't. Manual: play a
chart known to degrade (Eb-standard chart on a narrow-ceiling target) and
confirm the marker shows in a chord-diagram-capable renderer.

### 5. Per-string fret floor (banjo drone, short strings)

**Problem.** A 5-string banjo's drone string physically starts at the 5th
fret and is never barred; the solver and per-note walk have no per-string
floor, so they can place low fretted notes on the drone lane that don't
exist on the instrument.

**Design.**
- Preset/profile field `fretFloors: number[]` (per target string, default
  all 0). Model playable frets on a floored string as `f === 0` (the open
  drone) **or** `f >= floor` — the region in between doesn't exist.
  banjo5_gdgbd: `[5, 0, 0, 0, 0]` (string 0 is the drone).
- `resolveTargetForFret` (the pitch-ordered walk): treat a placement that
  violates the floor as out-of-range on that string and keep walking —
  needs care with the direction lock so a floored middle string doesn't
  falsely prove "fits nowhere" (skip, don't reverse).
- `chord-solver.js`: `isPlayable` rejects floored placements; the search's
  per-string candidate enumeration skips the dead fret range. "Never
  barred" is a separate, softer constraint — probably fold into
  `computeChordFingers`' barre grouping (drone never joins a barre run)
  rather than the cost function, and only if real banjo usage materializes.
- Thread through `resolveActiveTuning` → `apply()` → `targetSig`, same as
  maxFret/chordSpan.

**Verify.** Re-run the Phase-14 banjo5 full-chart sweep with floors on:
zero placements in the dead range, drone still used for reachable notes,
notes that only fit the dead range drop (or land elsewhere) rather than
rendering impossible positions.

**Priority note:** wait for evidence banjo targets see real use — the field
touches every remap layer.
