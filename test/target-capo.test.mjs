// Standalone Node verification for stage 2 (retuner/target capo
// application) — turning a base target tuning + capo into a capo'd
// tuning + valid fret ceiling, and the end-to-end capo behaviors that
// flow from it (capo cancellation identity, physical-fret display
// shift). Imports the real engine from ../src/chart-retune.js — no
// hand-synced duplicate. Run with `node test/target-capo.test.mjs`.
import test from 'node:test';
import assert from 'node:assert';
import { CR } from '../src/chart-retune.js';
import { makeBundle, EADG } from './helpers.mjs';

const { effectiveMaxFret, applyCapo, createRetuner, CAPO_OUTPUT_MODES } = CR;

// effectiveMaxFret / applyCapo: pure unit coverage.
test('effectiveMaxFret / applyCapo', () => {
    assert.deepStrictEqual(effectiveMaxFret(20, 3), 17);
    assert.deepStrictEqual(effectiveMaxFret(20, 25), 1);

    const tuning = [28, 33, 38, 43];
    // capo === 0 is a no-op — returns the input unchanged (same
    // reference), not a fresh copy.
    const noCapo = applyCapo(tuning, 20, 0);
    assert.strictEqual(noCapo.midiTuning, tuning);
    assert.deepStrictEqual(noCapo, { midiTuning: tuning, maxFret: 20 });

    assert.deepStrictEqual(applyCapo([28, 33, 38, 43], 20, 2), { midiTuning: [30, 35, 40, 45], maxFret: 18 });
    // Every string shifts up by capo, and maxFret shrinks via effectiveMaxFret.
    assert.deepStrictEqual(applyCapo([28, 33, 38, 43], 20, 25), { midiTuning: [53, 58, 63, 68], maxFret: 1 });
});

// Capo cancellation identity: tuning every string down k half-steps and
// clamping a capo at fret k is a cumulative offset of 0 on the internal,
// pre-projection matching math — the CAPO-RELATIVE remap must equal the
// un-capo'd original exactly (for charts that fit the capo-shortened neck),
// for k = 1..4. Deliberately passes no retunerCapo to apply() — this test
// verifies the
// underlying pitch matching is exact, not the final on-screen fret, which
// now shifts by +k per the "always show the true physical fret" fix (see
// the physical-projection tests below for that layer).
test('capo cancellation identity for k = 1..4', (t) => {
    const rawNotes = [
        { t: 0, s: 0, f: 0 }, { t: 1, s: 1, f: 3 },
        { t: 2, s: 2, f: 12 }, { t: 3, s: 3, f: 16 },
    ];
    const rawChords = [{ id: null, t: 4, notes: [{ t: 4, s: 1, f: 2 }, { t: 4, s: 2, f: 2 }] }];
    const mkBundle = () => makeBundle({ notes: rawNotes, chords: rawChords, tuning: [0, 0, 0, 0] });

    const baseline = mkBundle();
    createRetuner().apply(baseline, EADG.midiTuning, 20);
    const expectedNotes = baseline.notes.map(n => ({ s: n.s, f: n.f }));
    const expectedChord = baseline.chords[0].notes.map(n => ({ s: n.s, f: n.f }));
    assert.deepStrictEqual(expectedNotes, rawNotes.map(n => ({ s: n.s, f: n.f })));

    for (const k of [1, 2, 3, 4]) {
        t.test(`k=${k}`, () => {
            const downTuned = EADG.midiTuning.map(m => m - k);
            const { midiTuning, maxFret } = applyCapo(downTuned, 20, k);
            assert.deepStrictEqual(midiTuning, EADG.midiTuning);
            assert.deepStrictEqual(maxFret, effectiveMaxFret(20, k));
            const bundle = mkBundle();
            createRetuner().apply(bundle, midiTuning, maxFret);
            assert.deepStrictEqual(bundle.notes.map(n => ({ s: n.s, f: n.f })), expectedNotes);
            assert.deepStrictEqual(bundle.chords[0].notes.map(n => ({ s: n.s, f: n.f })), expectedChord);
        });
    }
});

// Physical-workaround projection: notes/slides/chord
// notes/anchors relabel to physical frets, except relative fret 0, which
// stays open — chosen for chord legibility over scoring purity.
test('physical capo-output projection', () => {
    const capo = 3;
    // sc=1 source open is 40 (same base the maxFret block above relies on).
    const effective = [40 + capo];
    const relCeiling = 20 - capo;

    const retuner = createRetuner();
    const rawNotes = [
        { t: 0, s: 0, f: 5 },        // sounds 45 → relative 2 → physical 5
        { t: 1, s: 0, f: capo },     // sounds at the capo → relative 0 → stays open (fret 0)
        { t: 2, s: 0, f: 2 },        // sounds below the capo → unplayable, drops
        { t: 3, s: 0, f: 7, sl: 9 }, // slide: both endpoints back to physical
    ];
    const rawAnchors = [{ time: 0, fret: 5, width: 4 }];
    const bundle = makeBundle({ notes: rawNotes, anchors: rawAnchors, tuning: [0] });
    const rawViews = {
        notes: bundle.notes,
        chords: bundle.chords,
        anchors: bundle.anchors,
        chordTemplates: bundle.chordTemplates,
    };
    retuner.apply(bundle, effective, relCeiling, capo);
    assert.deepStrictEqual(bundle.notes.map(n => n.f), [5, 0, 7]);
    assert.deepStrictEqual(bundle.notes.some(n => n.origNote.f === 2), false);
    assert.deepStrictEqual(bundle.notes[2].sl, 9);
    // The slide at t=3 is past ANCHOR_DONOR_WINDOW_S from the anchor's
    // own start, so it splits into its own anchor rather than being
    // absorbed into one wide band.
    assert.deepStrictEqual(bundle.anchors, [
        { time: 0, fret: 5, width: 4 },
        { time: 3, fret: 7, width: 4 },
    ]);
    assert.notStrictEqual(bundle.anchors[0], rawAnchors[0],
        'shifted anchors must be fresh objects — the raw chart anchor must never be mutated');
    assert.deepStrictEqual(rawAnchors[0], { time: 0, fret: 5, width: 4 });

    // Projection changes reuse the same canonical solve. Dropping the output
    // capo to 0 exposes the relative result; restoring it must not compound
    // the shift or mutate the earlier projected objects.
    const firstPhysicalNotes = bundle.notes;
    Object.assign(bundle, rawViews);
    retuner.apply(bundle, effective, relCeiling, capo);
    assert.strictEqual(bundle.notes, firstPhysicalNotes,
        'an unchanged solve/projection should reuse its projected array');
    Object.assign(bundle, rawViews);
    retuner.apply(bundle, effective, relCeiling, 0);
    assert.deepStrictEqual(bundle.notes.map(n => n.f), [2, 0, 4]);
    assert.deepStrictEqual(firstPhysicalNotes.map(n => n.f), [5, 0, 7]);
    Object.assign(bundle, rawViews);
    retuner.apply(bundle, effective, relCeiling, capo);
    assert.deepStrictEqual(bundle.notes.map(n => n.f), [5, 0, 7]);

    // Bogus offsets sanitize to 0 rather than shifting by garbage.
    Object.assign(bundle, rawViews);
    retuner.apply(bundle, effective, relCeiling, 2.5);
    assert.deepStrictEqual(bundle.notes.map(n => n.f), [2, 0, 4]);
});

// Physical projection: a plain note's sl/slu carry the -1 "no slide"
// sentinel (never omitted), which must stay untouched by the shift.
test('physical capo-output projection leaves the -1 no-slide sentinel untouched', () => {
    const capo = 5;
    const effective = [40 + capo];
    const relCeiling = 20 - capo;
    // f: 8 → relative 3 (not 0), so this stays about the sl/slu sentinel,
    // not the separate relative-fret-0-stays-open behavior above.
    const bundle = makeBundle({ notes: [{ t: 0, s: 0, f: 8, sl: -1, slu: -1 }], tuning: [0] });
    createRetuner().apply(bundle, effective, relCeiling, capo);
    assert.deepStrictEqual({ f: bundle.notes[0].f, sl: bundle.notes[0].sl, slu: bundle.notes[0].slu },
        { f: 8, sl: -1, slu: -1 });
});

// Physical projection across chords and templates: template frets shift
// except the -1 "unused string" sentinel AND relative fret 0, which stays
// open — same rule as notes, so a renderer merging live note fret with
// template fret (e.g. highway_3d's mergeChordShape) sees the two agree
// instead of the note silently overwriting the template's "open"
// classification with a nonzero physical fret. Fingers untouched.
test('physical capo-output projection across chords and templates', () => {
    const capo = 3;
    // sc=2 source opens are [40, 45]; capo'd effective target below.
    const effective = [43, 48];
    const relCeiling = 20 - capo;

    const retuner = createRetuner();
    const rawTemplates = [
        { name: 'X', frets: [5, 7], fingers: [1, 3] },   // → relative [2, 4]
        { name: 'Open-ish', frets: [3, -1], fingers: [0, -1] }, // string 0 AT the capo → template AND note stay open, unused stays -1
    ];
    const rawChords = [
        { t: 0, id: 0, notes: [{ s: 0, f: 5 }, { s: 1, f: 7 }] },
        { t: 1, id: 1, notes: [{ s: 0, f: 3 }] },
    ];
    const rawNotes = [];
    const bundle = makeBundle({ notes: rawNotes, chords: rawChords, chordTemplates: rawTemplates, tuning: [0, 0] });
    retuner.apply(bundle, effective, relCeiling, capo);
    assert.deepStrictEqual(bundle.chordTemplates[0].frets, [5, 7]);
    // Fingers are whatever the RELATIVE solve produced (for this adjusted
    // remap the engine re-derives them: [1, 2]) — the display shift only
    // touches the frets, leaving fingers exactly as solved.
    assert.deepStrictEqual(bundle.chordTemplates[0].fingers, [1, 2]);
    assert.deepStrictEqual(bundle.chordTemplates[1].frets, [0, -1]);
    assert.deepStrictEqual(bundle.chords[0].notes.map(n => ({ s: n.s, f: n.f })), [{ s: 0, f: 5 }, { s: 1, f: 7 }]);
    assert.deepStrictEqual(bundle.chords[1].notes.map(n => ({ s: n.s, f: n.f })), [{ s: 0, f: 0 }]);
    assert.deepStrictEqual(rawTemplates[0].frets, [5, 7]);
});

test('contract capo-output mode preserves canonical notes, slides, anchors, chords, and templates', () => {
    const capo = 3;
    const effective = [43, 48];
    const relCeiling = 17;
    const rawTemplates = [
        { name: 'X', frets: [5, 7], fingers: [1, 3] },
        { name: 'Open-ish', frets: [3, -1], fingers: [0, -1] },
    ];
    const rawChords = [
        { t: 0, id: 0, notes: [{ s: 0, f: 5 }, { s: 1, f: 7 }] },
        { t: 1, id: 1, notes: [{ s: 0, f: 3 }] },
    ];
    const rawNotes = [
        { t: 2, s: 0, f: 3, sl: 5 }, // relative 0 -> 2
        { t: 3, s: 0, f: 5, sl: 3 }, // relative 2 -> 0
    ];
    const rawAnchors = [{ time: 2, fret: 3, width: 4 }];
    const bundle = makeBundle({
        notes: rawNotes,
        chords: rawChords,
        anchors: rawAnchors,
        chordTemplates: rawTemplates,
        tuning: [0, 0],
    });
    const retuner = createRetuner({
        capoOutputMode: CAPO_OUTPUT_MODES.CHART_TRANSFORM_CONTRACT,
    });

    retuner.apply(bundle, effective, relCeiling, capo);

    assert.equal(retuner.capoOutputMode, CAPO_OUTPUT_MODES.CHART_TRANSFORM_CONTRACT);
    assert.deepStrictEqual(bundle.notes.map(n => ({ f: n.f, sl: n.sl })), [
        { f: 0, sl: 2 },
        { f: 2, sl: 0 },
    ]);
    assert.deepStrictEqual(bundle.chords[0].notes.map(n => n.f), [2, 4]);
    assert.deepStrictEqual(bundle.chords[1].notes.map(n => n.f), [0]);
    assert.deepStrictEqual(bundle.chordTemplates.map(t => t.frets), [[2, 4], [0, -1]]);
    assert.deepStrictEqual(bundle.anchors, [{ time: 2, fret: 0, width: 4 }]);
    assert.deepStrictEqual(rawNotes, [
        { t: 2, s: 0, f: 3, sl: 5 },
        { t: 3, s: 0, f: 5, sl: 3 },
    ]);
});

test('physical projection keeps capo-open starts open while slide endpoints stay physical', () => {
    const capo = 3;
    const bundle = makeBundle({
        notes: [
            { t: 0, s: 0, f: 3, sl: 5 },
            { t: 1, s: 0, f: 5, sl: 3 },
        ],
        tuning: [0],
    });

    createRetuner().apply(bundle, [43], 17, capo);

    assert.deepStrictEqual(bundle.notes.map(n => ({ f: n.f, sl: n.sl })), [
        { f: 0, sl: 5 },
        { f: 5, sl: 3 },
    ]);
});
