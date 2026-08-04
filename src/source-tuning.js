// Chart Retuner — stage 3: the chart's own (source) tuning, native capo,
// and octave offset, combined into per-string open MIDI pitches. Doesn't
// look at the target tuning at all — independent of stages 1 and 2 — and
// doesn't worry about which notes end up playable; that's stage 4
// (retune-engine.js), which consumes this module's output alongside
// stage 2's capo'd target.
//
// The octave offset shifts the whole chart ±N octaves before any
// note/fret math runs, with no key change involved — applied here, on the
// source side, rather than by shifting the target (the two are pitch-
// equivalent everywhere the engine compares source to target, since only
// the DIFFERENCE between them ever matters).

import { SEMITONES_PER_OCTAVE } from './pitch.js';

// Standard open-string MIDI pitches, low string first, by string count.
// Same numbers as lib/song.py's _TUNING_BASE_MIDI; screen.js's renderer
// base-MIDI table reuses this one rather than keeping its own copy.
export const STANDARD_OPEN_STRING_MIDI = {
    4: [28, 33, 38, 43],
    5: [23, 28, 33, 38, 43],
    6: [40, 45, 50, 55, 59, 64],
    7: [35, 40, 45, 50, 55, 59, 64],
    8: [30, 35, 40, 45, 50, 55, 59, 64],
};

// Highest source-string count the chart format/base-pitch table can
// represent. Counts 1-3 deliberately use the first strings of the
// six-string fallback (useful for reduced fixtures and partial charts),
// but anything above this would repeat the last guitar string forever.
export const MAX_SOURCE_STRING_COUNT = 8;

export function standardOpenStringMidi(stringCount) {
    return STANDARD_OPEN_STRING_MIDI[stringCount] || STANDARD_OPEN_STRING_MIDI[6];
}

// Source string `s`'s open pitch under the chart's own tuning/capo/octave.
export function sourceOpenStringMidi(sourceStringCount, tuningOffsets, capo, s, octaveOffset = 0) {
    if (!tuningOffsets || !(s >= 0 && s < tuningOffsets.length)) return null;
    const base = standardOpenStringMidi(sourceStringCount);
    const root = s < base.length ? base[s] : base[base.length - 1];
    return root + (tuningOffsets[s] | 0) + (capo | 0) + SEMITONES_PER_OCTAVE * (octaveOffset | 0);
}

export function computeOpenStringMidiByString(sourceStringCount, tuningOffsets, capo, octaveOffset = 0) {
    const midiByString = [];
    for (let s = 0; s < sourceStringCount; s += 1) {
        midiByString.push(sourceOpenStringMidi(sourceStringCount, tuningOffsets, capo, s, octaveOffset));
    }
    return midiByString;
}
