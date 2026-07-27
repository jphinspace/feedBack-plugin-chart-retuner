# Chart Retuner — planning

This file holds **only future / not-yet-implemented work**, in enough detail
to pick up and build from. Everything already shipped — the design rationale
and the full phase log — lives in [`HISTORY.md`](HISTORY.md).

---

## Future enhancements

None blocking; each is a candidate for its own phase. Item 1 is the current
top priority; the rest are ordered roughly by expected user-visible value.

### 1. Playability & legibility of remapped output — current priority

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
  movement than staying put. Worked around for one shape this session
  (prevGap/nextGap asymmetry); likely not the only shape it affects.
- Chord-grouped notes are entirely exempt from hand-travel reduction
  ("already have a deliberate voicing"), so a chord's voicing and the
  standalone notes immediately around it are never reconciled against
  each other.
- `HAND_JUMP_FRET_THRESHOLD`/`HAND_JUMP_MIN_IMPROVEMENT` are flat
  constants, not scaled per instrument — a 5-fret stretch means something
  very different on a short-scale ukulele than a full-scale bass.
- Notes carrying `.sl`/`.slu` (slides) aren't excluded from hand-travel
  relocation eligibility. Relocating a slide's start note to a different
  string independent of its endpoint would be wrong; nothing currently
  guards against it.

Legibility:
- Anchor width floors at the source chart's own authored width (the
  right default, per this session's "hand-position indicator, not a
  note tracker" finding) — but nothing checks whether that authored
  width is still a sane assumption once a differential per-string retune
  has actually changed which frets are in play.
- `ANCHOR_MAX_SPLITS`/`ANCHOR_DONOR_WINDOW_S` are flat constants too, not
  scaled per instrument or informed by phrase/section structure — the
  "rapid alternation" fallback has no concept of a musical phrase
  boundary, so it can unify a hand position across what a player would
  read as two distinct passages.
- Repeated-note consistency (same source string+fret -> same target
  fret) is only guaranteed for a literally consecutive run with nothing
  else in between (fixed this session). The same riff reused later in
  the song — a chorus repeating a verse's line, for instance — is
  remapped independently each time and isn't guaranteed to land on the
  same frets, since each occurrence's surrounding context can differ.

### 2. Per-preset chord stretch allowance

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

### 3. Degraded-chord label marker

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

### 4. Per-string fret floor (banjo drone, short strings)

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

### 5. Judgment translation for revoiced chords — mostly resolved by the chart-transform migration

**Original problem.** Scoring (note_detect) used to key judgments off the
chart's ORIGINAL positions — correct for a Tier-0 exact remap, but a
revoiced (tier ≥ 2) or degraded chord had the player fretting *different
sounding pitches* than a note-for-note reading of the chart implied.

**Status since the chart-transform migration (see HISTORY.md).** The notes
this plugin now hands back through `getNotes()`/`getChords()` already carry
the FINAL (possibly revoiced) string/fret assignment, paired with
`getTuning()`/`getCapo()` describing the same target. A scorer computing
expected pitch from those — the standard `base + tuning + capo + fret`
formula every chart-transform-aware consumer uses — gets the correct
pitch for whatever is actually being played, revoiced or not. The
remaining dependency is entirely on the scorer's own implementation
(note_detect, out of this repo) reading chart data through the
transform-aware getters rather than a private snapshot — not something
this plugin can verify or fix from here. No further plugin-side work is
planned unless a scorer is found not to follow the standard getters.
