// Standalone Node verification for stage 5 (hand-position anchor remap).
// Consumes stage 4's already-remapped notes/chords as plain input —
// doesn't touch tuning/capo/octave/solver internals directly. Imports the
// real engine from ../src/chart-retune.js — no hand-synced duplicate. Run
// with `node test/note-anchors.test.mjs`.
import test from 'node:test';
import assert from 'node:assert';
import { CR } from '../src/chart-retune.js';
import { makeBundle, bundleFromRaw, cloneChords, cloneAnchors, EADGBE } from './helpers.mjs';

const { DEFAULT_MAX_FRET, DEFAULT_TARGET_MIDI_TUNING, remapAnchors, ANCHOR_DONOR_WINDOW_S, createRetuner, resolveTargetTuning, BUILTIN_PRESET_TUNINGS } = CR;

// Anchor remapping. Open-string notes are excluded as donors.
test('anchor remapping excludes open-string donors', () => {
    const remappedNotes = [
        { t: 0, f: 4, origNote: { t: 0, f: 1 } },
        { t: 1, f: 5, origNote: { t: 1, f: 7 } },
    ];
    const anchors = [
        { time: 0, fret: 1, width: 4 },
        { time: 1, fret: 7, width: 4 },
        { time: 5, fret: 10, width: 4 },
    ];
    const remapped = remapAnchors(anchors, remappedNotes);
    assert.deepStrictEqual(remapped[0], { time: 0, fret: 4, width: 4 });
    assert.deepStrictEqual(remapped[1], { time: 1, fret: 5, width: 4 });
    assert.deepStrictEqual(remapped[2], { time: 5, fret: 8, width: 4 });

    const clampLow = remapAnchors([{ time: 0, fret: 0, width: 4 }], [{ t: 0, f: 0, origNote: { t: 0, f: 3 } }]);
    assert.deepStrictEqual(clampLow[0], { time: 0, fret: 0, width: 4 });
    const clampHigh = remapAnchors([{ time: 0, fret: DEFAULT_MAX_FRET - 1, width: 4 }], [{ t: 0, f: DEFAULT_MAX_FRET, origNote: { t: 0, f: 0 } }]);
    assert.deepStrictEqual(clampHigh[0], { time: 0, fret: DEFAULT_MAX_FRET, width: 4 });

    const passthrough = remapAnchors([{ time: 0, fret: 5, width: 4 }], []);
    assert.deepStrictEqual(passthrough[0], { time: 0, fret: 5, width: 4 });

    const openDonorNotes = [
        { t: 0, f: 3, origNote: { t: 0, f: 4 } },
        { t: 1, f: 4, origNote: { t: 1, f: 0 } },
        { t: 2, f: 6, origNote: { t: 2, f: 7 } },
    ];
    const openDonorAnchors = [
        { time: 0, fret: 3, width: 4 },
        { time: 1, fret: 8, width: 4 },
    ];
    const remappedOpenDonor = remapAnchors(openDonorAnchors, openDonorNotes);
    assert.deepStrictEqual(remappedOpenDonor[0], { time: 0, fret: 2, width: 4 });
    // The open note (t=1) shares the anchor's own start time, and
    // anchors need distinct timestamps to split — so it triggers the
    // uncapped single-band fallback instead (see the "Anchor widening"
    // block below), widening past the normal cap.
    assert.deepStrictEqual(remappedOpenDonor[1], { time: 1, fret: 4, width: 4 });
});

// Anchor widening: a note open in the source (no hand position needed)
// that lands on a nonzero target fret after retuning DOES need one, and
// the source chart's own anchors predate it entirely. Three tiers, in
// order of preference:
//  1. Modest widening (within HAND_JUMP_FRET_THRESHOLD, ANCHOR_DONOR_
//     WINDOW_S) — the band stretches a little, still one hand position.
//  2. A clean split: a note past either bound seeds a brand-new anchor
//     of its own so it stays covered (a comfortable run at one fret,
//     then — seconds later, no jump involved at all — a comfortable run
//     at a different fret; a retune with non-uniform per-string offsets
//     can stretch a passage that was compact on the source instrument
//     apart on the target one).
//  3. Falling back to ONE band spanning the whole chart anchor, widened
//     without a cap: used when a clean split is impossible — either
//     because it would take more than ANCHOR_MAX_SPLITS (a fast,
//     repeating alternation would otherwise flicker through dozens of
//     tiny anchors), or because the very first candidate ties the
//     anchor's own start time (openDonorAnchors above), which only a
//     distinct-timestamp split could represent. A wide-but-honest single
//     anchor reads better than either a flicker or a band that's wrong
//     from the start.
test('anchor widening: modest widen, clean split, or single wide band', () => {
    // Tier 1: modest widening (within the cap) still works in both
    // directions.
    assert.deepStrictEqual(remapAnchors([{ time: 1, fret: 4, width: 4 }], [
            { t: 1, f: 3, origNote: { t: 1, f: 0 } },  // newly fretted, 1 fret below
            { t: 2, f: 6, origNote: { t: 2, f: 6 } },  // fretted donor, adjustment 0
        ]),
        [{ time: 1, fret: 3, width: 4 }]);
    assert.deepStrictEqual(remapAnchors([{ time: 1, fret: 2, width: 4 }], [
            { t: 1, f: 2, origNote: { t: 1, f: 2 } },  // fretted donor: base band [2,6]
            { t: 2, f: 7, origNote: { t: 2, f: 0 } },  // newly fretted, 1 fret above
        ]),
        [{ time: 1, fret: 2, width: 6 }]);

    // Tier 2: a note past the cap or the time window seeds a clean split
    // instead of being left uncovered (both directions), as long as it's
    // strictly later than the current band's own start.
    assert.deepStrictEqual(remapAnchors([{ time: 1, fret: 8, width: 4 }], [
            { t: 1, f: 8, origNote: { t: 1, f: 8 } },  // fretted donor, adjustment 0
            { t: 2, f: 2, origNote: { t: 2, f: 0 } },  // newly fretted, past the cap
        ]),
        [{ time: 1, fret: 8, width: 4 }, { time: 2, fret: 2, width: 4 }]);
    assert.deepStrictEqual(remapAnchors([{ time: 1, fret: 2, width: 4 }], [
            { t: 1, f: 2, origNote: { t: 1, f: 2 } },
            { t: 2, f: 9, origNote: { t: 2, f: 0 } },  // newly fretted, past the cap
        ]),
        [{ time: 1, fret: 2, width: 4 }, { time: 2, fret: 9, width: 4 }]);
    const donorWindow = ANCHOR_DONOR_WINDOW_S;
    assert.deepStrictEqual(remapAnchors([{ time: 0, fret: 5, width: 4 }], [
            { t: 0, f: 5, origNote: { t: 0, f: 5 } },
            { t: donorWindow + 1, f: 4, origNote: { t: donorWindow + 1, f: 0 } },
        ]),
        [{ time: 0, fret: 5, width: 4 }, { time: donorWindow + 1, fret: 4, width: 4 }]);

    // Widening (and splitting) only ever draws candidates from the
    // anchor's own span; a note past it belongs to the next anchor.
    const risingNotes = [
        { t: 1, f: 2, origNote: { t: 1, f: 2 } },  // fretted donor: base band [2,6]
        { t: 6, f: 7, origNote: { t: 6, f: 0 } },  // newly fretted, but belongs to the NEXT anchor's span
    ];
    const risingAnchors = [
        { time: 1, fret: 2, width: 4 },
        { time: 5, fret: 2, width: 4 },
    ];
    const [risingWidened, risingNext] = remapAnchors(risingAnchors, risingNotes);
    assert.deepStrictEqual(risingWidened, { time: 1, fret: 2, width: 4 });
    assert.deepStrictEqual(risingNext, { time: 5, fret: 2, width: 6 });

    // Tier 3a: a long passage — one open-in-source run (now fretted) tied
    // to the anchor's own start, plus a normally fretted run later. The
    // tie forces the uncapped fallback: one band spanning both runs'
    // true fret range together, rather than only the later
    // (donor-derived) run.
    const notes = [
        { t: 1, f: 1, origNote: { t: 1, f: 0 } },  // newly fretted (was open), TIES the anchor's own start
        { t: 2, f: 1, origNote: { t: 2, f: 0 } },  // newly fretted (was open)
        { t: 3, f: 4, origNote: { t: 3, f: 3 } },  // normally fretted, donor for the base band
    ];
    const anchors = [
        { time: 1, fret: 3, width: 4 }, // donor adjustment +1 -> base band [4,8]
        { time: 10, fret: 2, width: 4 }, // same donor, same +1, no notes in its own span
    ];
    const [widened, untouched] = remapAnchors(anchors, notes);
    assert.deepStrictEqual(widened, { time: 1, fret: 1, width: 4 });
    assert.deepStrictEqual(untouched, { time: 10, fret: 3, width: 4 });

    // Tier 3b: a fast, repeating alternation (source open/fretted flipping
    // every 0.2s, far enough apart in fret each time to force a split on
    // every transition) would otherwise produce far more than
    // ANCHOR_MAX_SPLITS splits — falls back to one wide band instead of
    // flickering through a dozen tiny anchors.
    const rapidNotes = [];
    for (let i = 0; i < 10; i++) {
        rapidNotes.push({ t: i * 0.4, f: 8, origNote: { t: i * 0.4, f: 8 } });
        rapidNotes.push({ t: i * 0.4 + 0.2, f: 1, origNote: { t: i * 0.4 + 0.2, f: 0 } });
    }
    assert.deepStrictEqual(remapAnchors([{ time: 0, fret: 8, width: 4 }], rapidNotes),
        [{ time: 0, fret: 1, width: 8 }]);
});

// End-to-end through createRetuner: Drop C (non-uniform per-string
// offsets) onto BEADG. A comfortable fret-8 run right at the anchor must
// split cleanly into its own anchor once the notes actually move to
// fret 1, seconds later — not get dragged into a 9-fret span, and not
// get stuck showing fret 6 for a passage that's actually at fret 1.
test('createRetuner anchor split end-to-end (Drop C onto BEADG)', () => {
    const beadg = BUILTIN_PRESET_TUNINGS.find(p => p.id === 'beadg');
    const { midiTuning: beadgTarget } = resolveTargetTuning(beadg.strings);
    const bundle = makeBundle({
        notes: [
            { t: 12.0, s: 1, f: 5 },
            { t: 12.5, s: 1, f: 5 },
            { t: 15.75, s: 0, f: 0 },
        ],
        anchors: [{ time: 12.0, fret: 3, width: 4 }, { time: 16.0, fret: 3, width: 4 }],
        tuning: [-4, -2, -2, -2],
    });
    createRetuner().apply(bundle, beadgTarget, beadg.maxFret, 0);
    assert.deepStrictEqual(bundle.anchors, [
            { time: 12, fret: 6, width: 4 },
            { time: 15.75, fret: 1, width: 4 },
            { time: 16, fret: 6, width: 4 },
        ]);
});

// Anchor donors include chord notes, not just standalone ones — a
// chord-only passage must still retune its anchor. End-to-end via
// createRetuner, the same path screen.js's _transform() uses.
test('anchor donors include chord notes', () => {
    // Chord-only passage; tuning detunes +2 so a real shift is exercised (chart capo wouldn't move these).
    const rawChords = [{ id: null, t: 0, notes: [
        { t: 0, s: 1, f: 4 }, { t: 0, s: 2, f: 4 }, { t: 0, s: 3, f: 4 }, { t: 0, s: 4, f: 0 },
    ] }];
    // Deliberately NOT one of the chord's own retuned frets (6/6/6/0
    // below), so a stray "left at the raw fret" bug can't coincidentally pass.
    const rawAnchors = [{ time: 0, fret: 0, width: 3 }];
    const bundle = makeBundle({
        chords: cloneChords(rawChords),
        anchors: cloneAnchors(rawAnchors),
        tuning: [0, 2, 2, 2, 0, 0],
    });
    createRetuner().apply(bundle, EADGBE.midiTuning, 24);
    const chordFrets = bundle.chords[0].notes.map(n => n.f);
    assert.deepStrictEqual(chordFrets, [6, 6, 6, 0]);
    assert.deepStrictEqual(bundle.anchors[0].fret, 2);
    assert.notStrictEqual(bundle.anchors[0].fret, rawAnchors[0].fret,
        'the anchor must not be left at its un-retuned original fret when the only nearby donor is a chord');
});

// Chord notes with no `.t` of their own (the real chart shape) must still
// let remapAnchors walk them in time order — two far-apart, revoiced
// chords must produce two anchors, not one stuck at the first.
test('chord notes with no own .t still walk in time order for anchors', () => {
    const chordNoTime = (s, f) => ({ s, f }); // no `.t` -- matches the real chart schema
    const rawChords = [
        { id: null, t: 0, notes: [1, 2, 3].map(s => chordNoTime(s, 2)).concat([chordNoTime(4, 0)]) },
        { id: null, t: 2, notes: [0, 1, 2, 4].map(s => chordNoTime(s, 5)) },
    ];
    const bundle = makeBundle({
        chords: cloneChords(rawChords),
        anchors: [{ time: 0, fret: 0, width: 3 }],
        tuning: [0, 0, 0, 0, 0, 0], capo: 2,
    });
    createRetuner().apply(bundle, EADGBE.midiTuning, 24);
    assert.deepStrictEqual(bundle.chords.map(c => c.notes.every(n => n.t === c.t)), [true, true]);
    assert.deepStrictEqual(bundle.anchors.length > 1, true);
    assert.deepStrictEqual(bundle.anchors[bundle.anchors.length - 1].time > 0, true);
});

// ---- Anchor-donor refinement after revoicing (PLANNING #2) ------------
// A revoiced donor can carry an octave-sized fret adjustment; remapAnchors
// prefers the first exact donor within ANCHOR_DONOR_WINDOW_S past the
// anchor, falling back to the revoiced adjustment only when no exact
// donor is nearby.
test('remapAnchors prefers a nearby exact donor over a revoiced one', () => {
    assert.ok(ANCHOR_DONOR_WINDOW_S > 0, 'donor window sane');
    const mk = (t, origF, newF, revoiced) => {
        const n = { t, s: 0, f: newF, origNote: { t, s: 0, f: origF } };
        if (revoiced !== undefined) n.crRevoiced = revoiced;
        return n;
    };
    // Revoiced (+12) donor right at the anchor, exact (-2) donor 1s later.
    assert.deepStrictEqual(remapAnchors([{ time: 0.9, fret: 5, width: 4 }], [mk(1.0, 5, 17, true), mk(2.0, 5, 3, false)]),
        [{ time: 0.9, fret: 3, width: 4 }]);
    // Exact donor beyond the window: the revoiced adjustment wins for the
    // base band (it is the only signal for that passage) — but the exact,
    // non-revoiced note far later is still real, uncovered data, so it
    // seeds its own anchor rather than being silently dropped.
    assert.deepStrictEqual(remapAnchors([{ time: 0.9, fret: 5, width: 4 }],
            [mk(1.0, 5, 17, true), mk(0.9 + ANCHOR_DONOR_WINDOW_S + 1, 5, 3, false)]),
        [{ time: 0.9, fret: 17, width: 4 }, { time: 0.9 + ANCHOR_DONOR_WINDOW_S + 1, fret: 3, width: 4 }]);
    // Untagged donors (direct API use) are trusted as exact for the base
    // band, same as before — but an untagged note is also eligible as a
    // split/widen candidate, so a far one still gets its own anchor.
    assert.deepStrictEqual(remapAnchors([{ time: 0.9, fret: 5, width: 4 }], [mk(1.0, 5, 17), mk(2.0, 5, 3)]),
        [{ time: 0.9, fret: 17, width: 4 }, { time: 2.0, fret: 3, width: 4 }]);
});

// End-to-end through createRetuner: a same-onset bucket whose low D1
// drops under the exact remap (below EADG's range) gets revoiced — its
// notes are tagged, and the anchor skips past them to the exact single
// note that follows.
test('createRetuner end-to-end: revoiced bucket notes and anchor donor fallback', () => {
    const eadg = DEFAULT_TARGET_MIDI_TUNING.slice(1); // E1 A1 D2 G2
    const mkRaw = (singleT) => ({
        // tuning [-3,-3,0,0]: s0 open C#1(25), s1 open F#1(30).
        // Bucket t=0: (s0,f1)=D1(26) — below EADG, exact remap drops it ->
        // solver revoices the pair; (s1,f1... ) see below.
        notes: [
            { t: 0, s: 0, f: 1 }, { t: 0, s: 1, f: 1 },
            { t: singleT, s: 2, f: 4 }, // (s2,f4)=D2+4 — exact, adjustment 0
        ],
        chords: [], anchors: [{ time: 0, fret: 1, width: 4 }], templates: [],
        tuning: [-3, -3, 0, 0], capo: 0, sc: 4,
    });

    // Revoiced tags + the preferred-donor path (single note inside the window).
    const near = createRetuner();
    const nearRaw = mkRaw(0.6);
    const nearBundle = bundleFromRaw(nearRaw);
    near.apply(nearBundle, eadg);
    const bucketNotes = nearBundle.notes.filter(n => n.t === 0);
    assert.ok(bucketNotes.length >= 1, 'revoiced bucket has at least one note');
    assert.ok(bucketNotes.every(n => n.crRevoiced === true), 'revoiced bucket notes are tagged');
    assert.deepStrictEqual(nearBundle.notes.find(n => n.t === 0.6).crRevoiced, false);
    assert.deepStrictEqual(nearBundle.anchors, [{ time: 0, fret: 1, width: 4 }]);

    // Same chart with the exact note pushed past the window: the anchor
    // falls back to the first revoiced donor's own adjustment, and the
    // far note (30s later, outside the widen window) splits into its
    // own anchor rather than being silently absorbed.
    const far = createRetuner();
    const farRaw = mkRaw(30);
    const farBundle = bundleFromRaw(farRaw);
    far.apply(farBundle, eadg);
    const donor = farBundle.notes[0]; // first (time-sorted) fretted note at t=0
    const expected = Math.max(0, Math.min(20, 1 + donor.f - donor.origNote.f));
    const farNote = farBundle.notes.find(n => n.t === 30);
    assert.deepStrictEqual(farBundle.anchors, [
        { time: 0, fret: expected, width: 4 },
        { time: 30, fret: farNote.f, width: 4 },
    ]);
    assert.notStrictEqual(expected, 1, 'fallback case actually differs from the exact adjustment');
});
