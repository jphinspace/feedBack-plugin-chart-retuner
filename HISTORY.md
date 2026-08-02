# Chart Retuner — development history

A condensed record of completed work. Future/unimplemented work lives in
[`PLANNING.md`](PLANNING.md). Phases 1-18 (through v0.4.4) built and
maintained a forked-`highway_3d` renderer, including a repeatable
upstream-sync procedure and log (bottom of this file); Phase 19 retired
that architecture in favor of the `chart-transform` capability.

*Note: this plugin and repo were originally named "Five-String Everything"
(internal abbreviation `FSE` / `fse-retune.js`); renamed to Chart Retuner in
v0.2.0 (globals `fse3d*` → `cr3d*`, barrel export `FSE` → `CR`). Entries below
use whichever name was current at the time.*

## Settled design (why the plugin is shaped this way)

> **Superseded by Phase 19.** The "own renderer, not a hook" bullet below,
> the Patch points list, and the Isolation renames note all describe the
> forked-`highway_3d`-renderer architecture this plugin shipped under
> through Phase 18. Phase 19 replaced that renderer fork with a
> `chart-transform` capability provider; the current `screen.js` no longer
> forks or syncs against `highway_3d` at all. Kept below as the historical
> record of why that architecture existed and what it took to maintain.

- **Own renderer, not a hook.** feedBack had no hook to transform a chart's
  notes/chords/tuning before a renderer or scorer reads them, and core's
  `stringCount` was a private closure primitive with no setter. So this plugin
  was an independent `setRenderer`-contract visualization built by **forking
  `highway_3d/screen.js` verbatim** and patching it minimally — we owned the
  copy outright. Rendering matched `highway_3d` in every respect except note
  gem position (and everything derived from it).
- **Pure string/fret offset arithmetic** — one fret = one half-step; no
  frequency/Hz ever computed. One general algorithm, **no tuning-specific
  special cases**: identity tunings (EADG→BEADG's top 4, BEAD→BEADG, etc.)
  fall out of the math, not detection.
- **Fret-numbering convention (load-bearing):** fret 0 = open string,
  confirmed against both `highway_3d` and `lib/song.py`. Any off-by-one
  anywhere silently desyncs everything.
- **Scoring is unaffected by a purely-visual remap.** The plugin never
  mutates `bundle.notes`/`.chords`/`.songInfo`; note_detect judges detected
  audio pitch against the original chart data. Remapped note copies carry an
  `_origNote` back-reference so `getNoteState` lighting keys correctly.
  **No longer true as of Phase 19** — see its entry in the Phase log below.
- **Chord collisions:** two notes landing on one target string keep only the
  lower-pitched one (per string, not per chord) — later superseded by the
  chord solver revoicing instead (Phase 13).
- **No enable/disable toggle** — `matchesArrangement` + the viz picker are
  the on/off mechanism. **Superseded by Phase 19's Retuning active toggle**
  once the viz picker stopped being the on/off mechanism.
- **Known limitation:** RS2014 `cent_offset` is ignored (same as
  `lib/song.py`'s note-pitch formula); charts with a nonzero value remap
  incorrectly. Backlogged in PLANNING.md.

## Patch points — the auditable diff against upstream `highway_3d/screen.js`

Every behavioral difference from the upstream copy must trace to one of
these (plus the mechanical isolation renames below). This list is the
contract the sync procedure audits against.

1. **Note/chord substitution shim** — `CR.createRetuner().apply(bundle,
   targetMidiTuning, maxFret)` builds cached, shallow-copied note/chord
   arrays with `s`/`f`/`sl`/`slu` remapped; everything downstream consumes
   the copies.
2. **`resolveStringCount()`** — returns the active target tuning's string
   count instead of the chart's.
3. **Open-string nut labels** — from the active tuning's labels (capo
   re-spells them to sounding pitch), never the chart tuning.
4. **Per-string color palette** — target-indexed; the low-B extension slot
   reads core's shared "Low B, 7-string" (`low7`) Highway String Color.
5. **Anchors** — `bundle.anchors` reassigned via `CR.remapAnchors` (each
   anchor borrows the fret adjustment of the nearest remapped note).
6. **Chord templates** — `bundle.chordTemplates` reassigned; entries
   re-indexed to target strings (fixes hand-shape–synthesized chords).
7. **Chord solver routing** — chords/same-onset buckets route through
   `src/chord-solver.js`'s tier ladder inside the retuner.

**Isolation renames (Phase 7):** all `window.h3d*`/`h3dBg*` globals,
`h3d_bg_`/`viz3d_*`/debug storage keys, and settings.html DOM ids renamed to
plugin-scoped equivalents — required because every installed plugin's
`screen.js` and settings snippet load unconditionally into shared
page/storage scope alongside the real `highway_3d`. **One deliberate
exception:** `window.__h3dCamCtl`/`__h3dCamCtlPanels` stay unrenamed — a
public integration bridge for the third-party Camera Director tool (see
`FREECAM_BRIDGE.md`). The core-owned Highway String Colors section is *not*
duplicated in our settings panel (shared by design; `highway_3d`'s panel
edits it).

## Phase log

**Phase 1 — Fork, scaffold, register.** Copied `plugins/highway_3d/`
wholesale; own plugin identity and renamed backend routes; placeholder
settings panel; `matchesArrangement` narrowed to `/bass/i` (MVP bass-only,
fixed 5-string BEADG target).

**Phase 2 — Remap engine.** Per-arrangement natural string shift
(`computeArrangementShift`: most exact string matches wins, then smallest
total adjustment, then smallest |k|), then a per-note walk anchored on the
natural target string, stepping away only when the fret is genuinely out of
range. (An earlier "globally smallest adjustment" form shipped a real bug:
right on Drop D, wrong on Drop C#.) Slides: both endpoints resolve to one
target string (anchored on the lower fret), overflow clamps to the max fret
instead of dropping. Pinned by full-chart tests: Drop D, real Drop C#
(`[-3,-1,-1,-1]`), EADG/BEAD/already-BEADG identities, out-of-range drops.

**Phase 3 — Chord collisions.** Lower-pitched note wins per colliding target
string. Correction from manual testing: also applies to same-onset **flat
notes** (bass double stops are often not `Chord` objects) — grouped by onset
and run through the same resolution.

**Phase 4 — Patch the fork.** All patch points above landed here, three of
them found via manual-testing feedback: the palette fix (low B must use
core's `low7` color `#cc00aa`, not the guitar-B green — that's a different
"B"), anchors (hand-position highlight band was stale), and chord templates
(a chart with **zero** real `Chord` objects synthesizes its visible chords
from hand-shape spans + `chordTemplates`, a path that had bypassed the remap
entirely). Verified by diffing the whole file against upstream — every hunk
traces to a patch point.

**Phase 5 — Caching + note-state passthrough.** Remap rebuilds only on chart
identity / tuning-signature change, never per frame; `getNoteState` receives
the original note object via `_origNote`.

**Phase 6 — Auto-mode findings.** The Auto-mode first-match tiebreak follows
**on-disk plugin directory name sort order** (not `plugin.json` id); this
repo's name sorts before `highway_3d`. Also: a persisted manual pick in
`localStorage.vizSelection` bypasses Auto entirely — check the picker before
diagnosing a tiebreak problem.

**Phase 7 — Full settings UI + isolation.** Restored `highway_3d`'s ~1800-line
settings panel minus Highway String Colors, after the isolation renames
described above (globals, storage keys, DOM ids — all three collide across
plugins because everything loads into one shared page).

**Phase 8 — Upstream sync.** Established the repeatable sync procedure (now
maintained in PLANNING.md) and performed the first sync — see the sync log
below.

**Phase 9 — Engine extracted to `src/` (v0.1.2).** All genuinely-new logic
moved out of `screen.js` into an ES module (`plugin.json` gained
`"scriptType": "module"`; core serves `/api/plugins/<id>/src/…`). Tests
import the real module — no more hand-maintained duplicate. The Phase 7
mechanical renames deliberately stay inline in `screen.js` (they're renamed
*upstream* code, and extracting them would fight the sync goal).

**Phase 10 — Configurable target tuning (v0.1.3–0.1.4).** Any 5-string
pitch set via `parseTargetNote`/`resolveTargetTuning` (per-string fallback
on malformed specs); settings dropdown + custom-tuning editor; live mid-song
switching through the settings change bus; retuner cache invalidates on a
target-tuning signature.

**Phase 11 — Configurable string count 4–8 (v0.1.5).** Bounds: 4 =
highway_3d's own minimum, 8 = `MAX_RENDER_STRINGS`. The copied rendering
pipeline was already variable-count-capable; `resolveStringCount` just feeds
it the tuning's count. Note→color-role tables (`colorRoleForNote`,
`BEADG_COLOR_ROLES`), per-string color pickers, add/remove-string editor
with pure default-note rules. Two same-day follow-ups extracted remaining
logic from `screen.js` and split the module into `pitch.js` /
`target-tuning.js` / `retune-engine.js` / `string-colors.js` behind a barrel
(one-way dependency graph; zero external API change).

*(v0.2.0 — renamed to Chart Retuner, see the note at the top.)*

**Phase 12 — Guitar arrangements.** Three per-class tuning profiles
(bass/rhythm/lead — `targetTuningIdBass`/`…Rhythm`/`…Lead`) over one shared
pool of presets + customs; `arrangementClassFor` routing ("Lead Bass" is
bass; combos are rhythm; empty → bass); EADGBE default for guitar classes;
one-time legacy-key migration; `matchesArrangement` widened back to
highway_3d's own regex. Preset batch: 7-string BEADGBE, baritone BEADF#B,
violin GDAE, upright bass solo F#BEA, viola CGDA, both banjos (banjo5's
drone-first gDGBD is deliberately non-monotonic), mandolin GGDDAAEE.

**Phase 13 — Chord solver (`src/chord-solver.js`).** Tier ladder: 0 = the
per-note remap when collision-free and playable (keeps clean bass output
byte-identical), 2 = position-windowed branch-and-bound revoicing search,
3 = degradation ladder (full pitch-class set → triad → root+5th → root).
Playability = 4-fret box (`MAX_CHORD_SPAN`) unless the source stretched
further, ≤ 4 fingers with barre/run grouping. Weights in `SOLVER_WEIGHTS`
encode openness/position/no-new-barre > root-in-bass. Templates solve first
and instances/difficulty-subsets/synth chords follow them by construction.
Cold solve ≈ 4 ms for a 60-template chart; per-frame apply is a cache hit.
Deliberate bass behavior change: colliding buckets now revoice instead of
silently dropping a pitch.

**Phase 14 — Post-review fixes (2026-07-13).** 11 findings from an
xhigh-effort code review, all fixed. Headline: `resolveTargetForFret`'s walk
now moves in **pitch order** via per-target rank tables instead of index
order — fixes banjo5 wrongly dropping 29/126 swept notes *and* a
pre-existing infinite-loop hang on targets with a > max-fret gap between
pitch-adjacent strings; a direction lock guarantees termination. Also:
null chord id aliasing template 0, duplicate-source-string dedup, sliding
chords bypass the template shortcut, degenerate span clamp, non-array
fingers passthrough, per-frame classifier guard, shared pitch-class parsing,
single fret clamp, single profile-key source of truth.

**Phase 15 — Per-tuning max fret (2026-07-13).** `maxFret` per tuning
profile (options 12/14/20/21/22/24), threaded as a trailing parameter
through the engine/solver (defaulting to `DEFAULT_MAX_FRET`) and folded into
the retuner's cache signature; editor `<select>`; per-preset values (EADG
keeps 20, guitars 24, violin/mandolin 14).

**Phase 16 — Capo & octave offset, ukulele presets (v0.4.0, 2026-07-13).**
Both fold into the *effective* target the engine already accepts —
`effectiveTargetMidiTuning(midi, capo, oct)` = `m + capo − 12·oct`,
`effectiveMaxFret = maxFret − capo` — so the remap math is untouched, and
both double as algorithm validation via exact-identity round trips (tune
down k half-steps + capo k = original chart; E-standard bass +1 octave =
standard guitar's low four strings note-for-note). Capo re-spells nut labels
to sounding pitch; octave offset doesn't touch labels. Quick per-song
adjustments live in player-controls sliders (v3 `playerControlSlot()` / v2
`#player-controls`) persisting **per tuning id** via a
`tuningAdjustOverrides` blob; saved tuning defaults live in the editor (an
editor save clears that tuning's override). New presets: Ukulele gCEA
(reentrant — second non-monotonic target after banjo5) and Baritone ukulele
DGBE.

**Phase 17 — Pathological-chart safety valves (v0.4.1, 2026-07-13).** A
remap can no longer stall the render thread regardless of chart contents.
Three independent, per-retuner-overridable bounds (`createRetuner(opts)`),
all default-invisible on normal charts: `MAX_SEARCH_NODES` (20 000) bounds
each chord solve — one `{ nodes, aborted }` budget shared across the
degradation-ladder rungs; on exhaustion the search keeps its best-so-far,
and a gave-up null **falls back to the per-note collision path instead of
dropping the group**. `MAX_SOLVER_GROUP_SIZE` (12) routes corrupt
same-onset stacks straight to that path. `MAX_TOTAL_SOLVE_MS` (40) is a
synchronous deadline checked between work units (template / note bucket /
chord): past it the remaining groups take the per-note path, bounding the
worst-case `apply()` stall to ~deadline + one node-capped group — and that
stall lands where it doesn't hurt (song load precedes the first drawn
frame; a mid-song tuning switch on a corrupt chart drops 2–3 frames).
`getStats()` exposes `{ workMs, searchAborts, oversizeGroups,
solverDisabled }`. Measured: a typical 2 000-note chart is unchanged
(≈3.5 ms, zero aborts); 441 distinct adversarial 8-note shapes complete in
42.6 ms vs 154.6 ms without the deadline. **Correction (2026-07-15):** as
first built, this phase also time-sliced the cold remap across frames as a
generator job (`FRAME_BUDGET_MS`, empty-publish until done, mid-job
restart, `slices`/`inProgress` stats). Deliberately simplified away — the
node cap already bounds any single group, so the plain deadline gives the
same no-stall guarantee without the job-lifecycle machinery, at the cost
of one brief (≤ ~42 ms) hitch on charts that are corrupt anyway.

**Phase 18 — Anchor-donor refinement after revoicing (v0.4.2,
2026-07-13).** A revoiced (tier ≥ 2) donor note can carry an octave-sized
fret adjustment that lurched the hand-position highlight band to a nonsense
fret. `createRetuner` now tags each materialized `bundle.notes` copy with
its solve tier (`_crTier`; chord copies stay untagged — they never donate),
and `remapAnchors` prefers the first tier-0 (exact-remap) fretted donor
within `ANCHOR_DONOR_WINDOW_S` (2 s) past the anchor before settling for
the revoiced adjustment. Untagged notes read as tier 0, so direct API use
and all-tier-0 charts behave byte-identically to before. Cosmetic — gems
were never affected. Suites: 426 + 120 assertions.

**Phase 19 — Migrated to the chart-transform capability (v0.5.0,
2026-07-21).** feedBack core shipped a `chart-transform` capability
([#952](https://github.com/got-feedBack/feedBack/issues/952),
`got-feedBack/feedBack#1000`): a provider-coordinator that substitutes a
chart's notes/chords/anchors/chord-templates/string-count/tuning/capo after
difficulty filtering, reaching every renderer's draw bundle and every
`highway.getNotes()`/`getChords()`-style getter — not just one renderer a
plugin happens to own. This retired the whole forked-`highway_3d`-renderer
architecture from Phases 1-18:

- `screen.js` shrank from a ~16,700-line fork of `highway_3d/screen.js` to a
  capability-registration file: it resolves the active target tuning (same
  `src/` engine, same three per-arrangement-class profiles), calls
  `CR.createRetuner().apply()` over both the difficulty-filtered and
  full-difficulty chart views, and returns the remapped result from a
  `transform(input)` function registered via
  `capabilities.dispatch({ capability: 'chart-transform', command:
  'register-provider', ... })`. It also derives `tuning`/`capo` offset
  metadata (the same `base_open_string_midis`-style table `lib/song.py`,
  `static/js/tuning-display.js`, and `highway_3d` all share) so any
  renderer that builds open-string nut labels from those fields gets correct
  labels for whatever target tuning is active.
  Notes come back **capo-relative** (no physical-fret-display shift — that
  was a `highway_3d`-only rendering convention this plugin no longer owns),
  pairing with the returned `capo` field exactly the way an originally
  capo'd chart already works for every consumer.
- The plugin no longer draws anything itself, so it no longer appears in
  the viz picker, doesn't require `highway_3d` to be installed, and doesn't
  carry its own Three.js/Butterchurn rendering stack, background styles,
  camera system, or Free-Camera Bridge. `routes.py` (the background-video
  upload endpoints), `FREECAM_BRIDGE.md`, and the Butterchurn/viz-worklet
  assets were deleted; `NOTICE` (Butterchurn/Three.js attribution) went with
  them.
- `settings-waiting-for-feedBack-support.html` — prepared back in Phase 7
  for exactly this migration — was promoted to `settings.html` as-is (its
  Target Tunings markup was already the surviving copy); the ~1800-line
  `highway_3d`-rendering settings sections it never carried don't need
  removing. It gained one new control: a **Retuning active** toggle
  (`select-provider`/`clear-provider` on the `chart-transform` capability),
  replacing the old implicit on/off mechanism (picking a different viz in
  the picker) that no longer exists once retuning applies regardless of
  which renderer is active.
- Since the remapped chart now reaches `getNotes()`/`getChords()` directly
  (previously those returned the untouched original — see the superseded
  "scoring is unaffected" bullet above), a scorer reading chart data through
  those getters judges against the remapped/revoiced fingering rather than
  the chart's original positions — see PLANNING.md item 4.
- The upstream-sync process (`HISTORY.md`'s sync log below, `PLANNING.md`'s
  old "Syncing from upstream" procedure) is retired along with the fork it
  existed to maintain.
- Unchanged: everything under `src/` (pitch, target-tuning, retune-engine,
  chord-solver, string-colors) and its test suite, the tuning-profile
  settings keys (`targetTuningId*`, `customTunings`, `tuningAdjustOverrides`
  — same `chart_retuner_bg_` storage namespace, so upgrading installs keep
  their saved tunings), and the player-controls capo/octave widget (already
  framework-agnostic — it only ever depended on `playerControlSlot()`, not
  the renderer).

**Phase 20 — Physical-fret display shift, then a capo-floor exception
(2026-08-02).** Phase 19 left notes capo-relative; a follow-up made the
retuner capo (and the chart's own native capo) relabel every output fret
to the physical position a bare, uncapo'd instrument actually needs — no
capo bar is ever drawn, so a note at the floor is not shown as "open"
(relative fret 0 → physical fret `capo`). Real-chart testing (Wonderwall
rhythm, EADGBE target, retuner capo 2) found this broke chord legibility:
renderers key "does this string need its own finger" off `fret === 0`
(the default 2D highway's open-string bar + `nonZeroFrets`/bracket-span
math; `highway_3d`'s `mergeChordShape`/chord-frame sizing) — once every
capo-floor string reports a nonzero physical fret, a chord with several
such strings reads as spanning the full distance from the floor to its
highest fretted note, not the tighter shape it's actually played as.
Fixed by keeping a note (and its chord template's slot) at fret 0 when
its capo-relative fret is 0, rather than shifting it — deliberately
chosen over scoring purity: the note's true sounding pitch still needs a
real finger at the physical capo position, so a player who takes the
open-string display literally, or a scorer reading `.f`, is off by
`capo` semitones. Chord template frets follow the same rule as the note
they classify, so a renderer merging live-note fret with template fret
(`mergeChordShape`) doesn't have the note's real fret silently overwrite
the template's "open" classification.

## Upstream sync log (historical — closed by Phase 19)

Procedure: see PLANNING.md ("Syncing from upstream") — the pre-Phase-19
version of the file. Each entry notes what this repo's `screen.js` (then a
`highway_3d` fork) was synced to, so the next sync would have diffed from
there. No further entries: Phase 19 removed the fork this log tracked.

- **2026-07-10** — synced to canonical `got-feedBack/feedBack`
  (`highway_3d` `3.31.5`, last commit touching the plugin: `b3215694`; the
  local `jphinspace/feedBack` reference checkout was one commit behind, at
  `14d116d8` / `3.31.4`). One substantive change: Butterchurn canvas-sizing
  fix (`_bcApplySize` helper; drawing buffer stuck at 300×150). Zero patch-
  point overlap — direct merge, verified byte-identical to upstream in that
  region. Plugin version bumped to 0.1.1.
