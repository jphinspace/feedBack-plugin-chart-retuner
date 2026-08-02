# Chart Retuner

A [feedBack](https://github.com/got-feedBack/feedBack) plugin that lets a
bass or guitar player play **any** chart, in any source tuning (Open G,
Drop C#, whatever), by remapping each note to the correct string/fret for
a target tuning of your choice instead of the chart's original tuning.
Notes outside a target instrument's range are dropped.

> **Disclaimer:** the mapping is not perfect. A remapped chart may not
> sound exactly like the original (notes can land in different octaves,
> chords may be revoiced or simplified, and out-of-range notes are
> dropped), and it may be more difficult to play than the original
> arrangement. If you have suggestions for improving the mapping, please
> [submit an issue](https://github.com/jphinspace/feedBack-plugin-chart-retuner/issues).

## How it works

Chart Retuner registers as a **chart-transform provider**
([feedBack#952](https://github.com/got-feedBack/feedBack/issues/952)) — a
core capability that substitutes the chart's notes, chords, hand-position
anchors, chord templates, string count, and tuning/capo before both
rendering and scoring. That means the remap applies no matter which
visualization you have picked (the built-in 2D highway, 3D Highway, or any
other viz plugin), and any scorer (note_detect) that reads chart data
through `highway.getNotes()`/`getChords()` judges against the remapped
chart rather than the original.

A **Retuning active** toggle in the plugin's settings turns this off (play
every chart in its original tuning) without uninstalling the plugin.

## Target tunings

Each arrangement class has its own tuning profile, configurable in the
plugin's settings (Target Tunings section) and switchable at any time —
even mid-song:

- **Bass arrangements** default to **EADG** (standard 4-string bass).
- **Lead** and **Rhythm/other guitar** arrangements default to **EADGBE**
  (standard 6-string guitar). "Combo" and plain "Guitar" arrangements use
  the Rhythm profile.

All three profiles pick from the same pool of tunings — any pitches, 4 to
8 strings — so a guitarist can keep one tuning for rhythm charts and
another for lead, and nothing stops you from pointing a guitar profile at
a bass tuning or vice versa:

- **Bass (EADG)** (default for bass)
- **Bass (BEADG)**
- **Guitar (EADGBE)** (default for lead/rhythm)
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

Every saved tuning carries its own fixed per-string colors, set via a
per-string color picker when you create or edit it — shown in the tuning
editor for visual reference; whether they drive a renderer's own coloring
depends on that renderer.

Every tuning also carries its own **max fret** (12, 14, 20, 21, 22, or 24)
— the highest fret a chart is allowed to remap onto for that instrument.
Set your own custom tunings' max fret when you create or edit them.

## Capo & octave offset

Two per-tuning adjustments on top of the string pitches themselves
(both default to 0 on every built-in preset):

- **Capo** (the "retuner capo," to distinguish it from the chart's own
  recorded capo below) — clamp a virtual capo on any fret from 1 to (max
  fret − 1). No capo bar is actually drawn anywhere; this is purely a
  floor on what's reachable — nothing below the capo's pitch is ever
  placed on the neck, the same as a real one. One fret = one half-step up
  per string, and frets above (max fret − capo) fall off the end of the
  neck too.
- **Octave offset** — shift the whole chart up or down 1-2 octaves
  before remapping, with no key change. **+1** plays an E-standard bass
  chart on a standard guitar's lowest four strings note-for-note; **-1**
  is the reverse. Save +1 on a cello profile and every bass chart plays
  an octave up by default.

Every fretted note this plugin shows is the TRUE physical position on the
target instrument's own bare neck, never relabeled relative to a capo —
that applies whether the shift comes from the retuner capo above or from
the chart's own native recorded capo. **One deliberate exception:** a
note sitting exactly at the capo floor (the lowest reachable position)
displays as open — same treatment as a real open string — instead of at
its physical fret. No capo bar is actually drawn, so this is a visual
choice, not a physical one: that string still needs a real finger there
to sound correctly, and a player who takes the open-string display
literally (or a scorer reading it) will land `capo` semitones flat. It's
chosen anyway because it reads far more clearly — an untreated physical
fret number there made chords look stretched across a wider span than
they're actually played (nothing distinguished "needs its own finger"
from "covered by the same capo-floor position every other open-at-the-
floor string in the chord already sits on").

Both live in two places:

- **Player controls** — a *Capo* and an *Octave* slider in the player
  chrome (the plugin controls that appear at the left edge of the
  screen), for quick per-song changes. These apply live mid-song and
  persist **per tuning**, so a capo you set while playing on EADGBE
  doesn't follow you to the cello preset.
- **The tuning editor** — saved with a custom tuning as its defaults
  (for a capo you never take off). A later editor save clears any
  player-controls override for that tuning so the saved values take
  effect.

## Chords

Single notes always keep their exact sounding pitch (or drop when the
target instrument can't reach them). Chords get smarter treatment,
because open and barre shapes don't map note-for-note across tunings.
When the exact note-for-note mapping of a chord is playable, it's used
as-is; when it isn't, the chord is **revoiced** on the target tuning —
same chord (same notes-of-the-chord, octaves may shuffle) — following
these priorities, in order:

1. **Playable** — no stretches wider than a 4-fret box (unless the
   original chart chord stretched further) and never more than 4 fretting
   fingers, barres included.
2. **Comparable hand shape** — open-position chords stay open-ish and the
   hand stays near the original fret position; a barre is never
   introduced where the chart had none if a better option exists.
3. **Root in the bass** — preferred, but an inversion or a simplified
   voicing wins when it fits priorities 1-2 better.

When no full voicing fits, the chord simplifies progressively (drop
doubled notes → triad → power chord → single root note) rather than
disappearing. Chord diagrams and hand-shape highlights follow the
remapped voicing; the chord *name* still shows the chart's original
label.

## Install

**Option A — feedback-desktop plugin manager:** add this repo's URL
(`https://github.com/jphinspace/feedBack-plugin-chart-retuner.git`) in the
plugin manager. It installs under the repo name verbatim.

**Option B — manual copy:** clone or copy this repo's contents into your
feedBack install's `plugins/` directory, e.g.:

```sh
git clone https://github.com/jphinspace/feedBack-plugin-chart-retuner.git /path/to/feedBack/plugins/feedBack-plugin-chart-retuner
```

Restart feedBack (or reload plugins) after installing. Retuning activates
automatically on first install (see the **Retuning active** toggle above
to turn it off).

## Build

No build step for `screen.js` itself — it's plain JS, no bundler. The
Tailwind stylesheet (`assets/plugin.css`) is prebuilt and committed; only
regenerate it if you add Tailwind classes to `screen.js`/`settings.html`:

```sh
bash build-tailwind.sh
```

**Tests** (the string/fret remap engine only — pure functions, no browser/DOM):

```sh
node test/retune-engine.test.mjs
node test/chord-solver.test.mjs
```

## License

AGPL-3.0-only, same as feedBack.
