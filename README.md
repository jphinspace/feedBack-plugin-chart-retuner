# Chart Retuner

A [feedBack](https://github.com/got-feedBack/feedBack) plugin that remaps a
chart from its original tuning onto a target tuning of your choice, so a
bass or guitar player can play **any** chart regardless of source tuning
(Open G, Drop C#, whatever). Notes outside the target instrument's range
are dropped.

> **Disclaimer:** the remap isn't perfect — octaves can shift, chords may
> be revoiced or simplified, out-of-range notes drop, and the result can
> be harder to play than the original. Suggestions welcome: [submit an
> issue](https://github.com/jphinspace/feedBack-plugin-chart-retuner/issues).

## How it works

Chart Retuner registers as a **chart-transform provider**
([feedBack#952](https://github.com/got-feedBack/feedBack/issues/952)): a
core capability that swaps in remapped notes, chords, hand-position
anchors, chord templates, string count, and tuning/capo before both
rendering and scoring. This works with any visualization (2D highway, 3D
Highway, or a third-party viz) and any scorer (note_detect) reading chart
data via `highway.getNotes()`/`getChords()`.

Retuning starts **off**. Turn it on with the **Retuning active** toggle in
the plugin's settings, or the matching quick toggle in the player controls.

## Target tunings

Each arrangement class (Bass / Lead / Rhythm) has its own tuning profile,
set in the plugin's settings and switchable anytime, even mid-song:

- **Bass** defaults to **EADG** (standard 4-string).
- **Lead** and **Rhythm** (including "Combo"/plain "Guitar") default to
  **EADGBE** (standard 6-string).

Any profile can use any tuning (4-8 strings) — nothing stops you from
pointing a guitar profile at a bass tuning, or vice versa:

- **Bass (EADG)** (bass default)
- **Bass (BEADG)**
- **Guitar (EADGBE)** (lead/rhythm default)
- **Guitar (BEADGBE)**
- **Baritone Guitar (BEADF#B)**
- **Upright bass solo (F#BEA)**
- **Cello (CGDA)**
- **Viola (CGDA)**
- **Violin (GDAE)**
- **Banjo 4-string (CGBD)**
- **Banjo 5-string (gDGBD)**
- **Ukulele (gCEA)**
- **Baritone ukulele (DGBE)**
- **Mandolin (GGDDAAEE)**
- **Your own saved custom profiles**

Each tuning also has its own **max fret** (12, 14, 20, 21, 22, or 24), the
highest fret a chart can remap onto.

### Ad-hoc live preview

Editing the tuning form immediately creates one **session-only live
preview**. It temporarily overrides bass, rhythm, and lead together so you
can try a physical instrument setup without changing or saving any profile.
The preview is discarded when you select another tuning, press Cancel or
Save, or restart the plugin. Saving is the only operation that creates or
updates a custom profile; editing a built-in always saves as a new custom
profile.

## Capo & octave offset

Two per-tuning adjustments on top of the tuning itself (both default to 0):

- **Capo** — clamps a virtual floor on any fret from 1 to (max fret − 1);
  nothing below that pitch is ever placed on the neck. No capo bar is
  drawn — it's purely a floor, the same as a real capo.
- **Octave offset** — shifts the whole chart ±1-2 octaves before
  remapping, with no key change. **+1** plays an E-standard bass chart on
  a standard guitar's lowest four strings note-for-note; **-1** reverses
  that.

Every fretted note shown is the true physical position on the target
instrument's bare neck — never relabeled relative to a capo, whether the
shift comes from the retuner capo above or the chart's own recorded capo.
**One exception:** a note sitting exactly at the capo floor displays as
open, like a real open string, instead of at its physical fret. That's a
visual choice, not a physical one — the string still needs a real finger
there, so a player (or scorer) reading it literally lands `capo` semitones
flat. Worth the tradeoff: showing the true fret there made chords look
stretched across a wider span than they're actually played.

Both settings live in two places:

- **Player controls** — Capo/Octave sliders for quick per-song changes.
  These apply live and persist **per tuning** (a capo set on EADGBE
  doesn't follow you to the cello preset).
- **Tuning editor** — saved as a tuning's own defaults. Saving the editor
  clears any player-controls override for that tuning.

## Chords

Single notes keep their exact pitch, or drop if the target can't reach
them. Chords get smarter treatment, since shapes don't map note-for-note
across tunings: an exact mapping is used when playable; otherwise the
chord is **revoiced** (same notes, octaves may shuffle) by priority:

1. **Playable** — no stretch wider than 4 frets (unless the original
   chord was wider) and no more than 4 fretting fingers.
2. **Comparable hand shape** — stays open where the original was open,
   stays near the original position, avoids introducing a barre if a
   better option exists.
3. **Root in the bass** — preferred, but a better-fitting inversion or
   simplified voicing can win instead.

When nothing fits, the chord simplifies progressively (drop doubled notes
→ triad → power chord → single root) instead of disappearing. Diagrams and
hand-shape highlights follow the remapped voicing; the chord name still
shows the chart's original label.

## Install

**Option A — feedback-desktop plugin manager:** add this repo's URL
(`https://github.com/jphinspace/feedBack-plugin-chart-retuner.git`).
Installs under the repo name.

**Option B — manual copy:**

```sh
git clone https://github.com/jphinspace/feedBack-plugin-chart-retuner.git /path/to/feedBack/plugins/feedBack-plugin-chart-retuner
```

Restart feedBack (or reload plugins). Retuning stays off until you turn it
on.

## Build

No build step for `screen.js` — plain JS, no bundler. `assets/plugin.css`
is prebuilt and committed; regenerate it only if you add Tailwind classes
to `screen.js`/`settings.html`:

```sh
bash build-tailwind.sh
```

**Tests** (all pure-logic modules, no browser/DOM):

```sh
node --test test/*.test.mjs
```

## License

AGPL-3.0-only, same as feedBack.
