// Standalone Node verification for stage 3 (chart tuning/native-capo/
// octave-offset -> source open-string pitches). Independent of stages 1-2
// — none of this reads the target tuning at all. Imports the real engine
// from ../src/chart-retune.js — no hand-synced duplicate. Run with
// `node test/source-tuning.test.mjs`.
import test from 'node:test';
import assert from 'node:assert';
import { CR } from '../src/chart-retune.js';
import { makeBundle, EADG, EADGBE } from './helpers.mjs';

const { STANDARD_OPEN_STRING_MIDI, standardOpenStringMidi, sourceOpenStringMidi, computeOpenStringMidiByString, createRetuner } = CR;

// standardOpenStringMidi / sourceOpenStringMidi / computeOpenStringMidiByString:
// pure unit coverage, focused on the octaveOffset parameter (the new
// stage-3 behavior) — tuning/capo-only behavior is exercised throughout
// retune-engine.test.mjs via songContext.
test('standardOpenStringMidi / sourceOpenStringMidi / computeOpenStringMidiByString', () => {
    assert.deepStrictEqual(standardOpenStringMidi(4), STANDARD_OPEN_STRING_MIDI[4]);
    assert.deepStrictEqual(standardOpenStringMidi(6), STANDARD_OPEN_STRING_MIDI[6]);
    // Unknown string counts fall back to the 6-string table.
    assert.deepStrictEqual(standardOpenStringMidi(3), STANDARD_OPEN_STRING_MIDI[6]);

    // octaveOffset defaults to 0 — unchanged from pre-stage-3 behavior.
    assert.deepStrictEqual(sourceOpenStringMidi(4, [0, 0, 0, 0], 0, 0), 28);
    // A +1 octave offset raises every string by 12 semitones...
    assert.deepStrictEqual(sourceOpenStringMidi(4, [0, 0, 0, 0], 0, 0, 1), 40);
    // ...and -1 lowers it, independent of tuningOffsets/capo, which both
    // still apply on top.
    assert.deepStrictEqual(sourceOpenStringMidi(4, [2, 0, 0, 0], 3, 0, -1), 28 + 2 + 3 - 12);
    // Out-of-range string index still returns null, same as before.
    assert.deepStrictEqual(sourceOpenStringMidi(4, [0, 0, 0, 0], 0, 4, 1), null);

    assert.deepStrictEqual(computeOpenStringMidiByString(4, [0, 0, 0, 0], 0), [28, 33, 38, 43]);
    assert.deepStrictEqual(computeOpenStringMidiByString(4, [0, 0, 0, 0], 0, 1), [40, 45, 50, 55]);
    assert.deepStrictEqual(computeOpenStringMidiByString(4, [0, 0, 0, 0], 0, -2), [4, 9, 14, 19]);
});

// Octave-offset identity: an E-standard bass chart with a +1 octave
// offset lands on a standard guitar's lowest four strings (E2 A2 D3 G3)
// note-for-note; the reverse (-1 octave) puts a guitar chart's low-four-
// string notes back on the bass unchanged. octaveOffset now applies on
// the SOURCE side (createRetuner().apply()'s 5th argument) rather than
// being pre-folded into the target tuning array — verified equivalent to
// the old target-side fold by hand (both only ever affect
// `sourceOpenMidi - target[j]`, so a constant shift on either side
// cancels identically).
test('octave-offset identity', () => {
    const bassNotes = [
        { t: 0, s: 0, f: 0 }, { t: 1, s: 1, f: 5 },
        { t: 2, s: 2, f: 7 }, { t: 3, s: 3, f: 12 },
    ];
    const mkBass = () => makeBundle({ notes: bassNotes, tuning: [0, 0, 0, 0] });
    const onBass = mkBass();
    createRetuner().apply(onBass, EADG.midiTuning, 20);
    const bassExpected = onBass.notes.map(n => ({ s: n.s, f: n.f }));
    assert.deepStrictEqual(bassExpected, bassNotes.map(n => ({ s: n.s, f: n.f })));

    const onGuitar = mkBass();
    createRetuner().apply(onGuitar, EADGBE.midiTuning, 24, 0, 1); // octaveOffset = +1
    assert.deepStrictEqual(onGuitar.notes.map(n => ({ s: n.s, f: n.f })), bassExpected);

    const guitarNotes = [
        { t: 0, s: 0, f: 3 }, { t: 1, s: 1, f: 0 },
        { t: 2, s: 2, f: 9 }, { t: 3, s: 3, f: 14 },
    ];
    const onBassDown = makeBundle({ notes: guitarNotes, tuning: [0, 0, 0, 0, 0, 0] });
    createRetuner().apply(onBassDown, EADG.midiTuning, 20, 0, -1); // octaveOffset = -1
    assert.deepStrictEqual(onBassDown.notes.map(n => ({ s: n.s, f: n.f })), guitarNotes.map(n => ({ s: n.s, f: n.f })));
});
