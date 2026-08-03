// Standalone Node verification for the string/fret offset transformation
// engine. Imports the real engine from ../src/chart-retune.js — no
// hand-synced duplicate. Run with `node test/retune-engine.test.mjs`.
import test from 'node:test';
import assert from 'node:assert';
import { CR } from '../src/chart-retune.js';

const {
    DEFAULT_MAX_FRET,
    MAX_FRET_OPTIONS,
    isValidMaxFret,
    isValidCapo,
    resolveCapo,
    resolveCapoEnabled,
    MIN_OCTAVE_OFFSET,
    MAX_OCTAVE_OFFSET,
    isValidOctaveOffset,
    resolveOctaveOffset,
    effectiveTargetMidiTuning,
    effectiveMaxFret,
    MAX_TARGET_STRING_COUNT,
    MIN_TARGET_STRING_COUNT,
    MIN_TARGET_MIDI,
    MAX_TARGET_MIDI,
    DEFAULT_TARGET_MIDI_TUNING,
    DEFAULT_TARGET_TUNING,
    EXTENDED_DEFAULT_TARGET_TUNING,
    parseTargetNote,
    midiToNoteLabel,
    defaultExtensionNote,
    colorRoleForNote,
    isValidTuningStringsArray,
    BUILTIN_PRESET_TUNINGS,
    DEFAULT_TUNING_ID,
    DEFAULT_GUITAR_TUNING_ID,
    defaultTuningIdForClass,
    arrangementClassFor,
    resolveActiveTuning,
    resolveRetunerCapoOctaveFields,
    applyRetunerCapoOctaveOverride,
    resolveTargetTuning,
    computeOpenStringMidiByString,
    computeArrangementShift,
    resolveTargetForFret,
    remapNote,
    remapSlide,
    resolveChordCollisions,
    remapAnchors,
    remapChordTemplate,
    intToHex,
    LIGHT_GRAY_COLOR,
    resolveColorsArray,
    lowBColor,
} = CR;

// Mirrors what createRetuner().apply() does once per song: compute k, then
// per-string open-note MIDI pitches and natural targets.
function songContext(sourceStringCount, tuning, capo, targetMidiTuning) {
    const sourceOpenMidiByString = computeOpenStringMidiByString(sourceStringCount, tuning, capo);
    const k = computeArrangementShift(sourceStringCount, tuning, capo, sourceOpenMidiByString, targetMidiTuning);
    const naturalTargetByString = [];
    for (let s = 0; s < sourceStringCount; s++) {
        naturalTargetByString.push(s + k);
    }
    return { k, sourceOpenMidiByString, naturalTargetByString };
}

// Spot-check frets rather than looping 0-20: resolveTargetForFret only
// branches at the 0/20 boundaries, so once a string's adjustment is
// constant these three points give the same confidence as all 21 would.
const SPOT_FRETS = [0, 10, 20];

// Standard 4-string bass / 6-string guitar targets, resolved once and
// reused wherever a test needs the plain identity case.
const EADG = resolveTargetTuning(['E1', 'A1', 'D2', 'G2']);
const EADGBE = resolveTargetTuning(['E2', 'A2', 'D3', 'G3', 'B3', 'E4']);

// Bundle factory: fills in the chart-transform bundle's usual-empty
// fields so a test only spells out what actually varies. `stringCount`
// defaults from `tuning.length`, overridable like everything else.
// Mirrors chord-solver.test.mjs's guitarBundle.
function makeBundle(overrides) {
    return {
        notes: [], chords: [], anchors: [], chordTemplates: [],
        capo: 0, stringCount: (overrides.tuning || []).length,
        ...overrides,
    };
}

// Deep-copies chords/anchors before handing them to apply(), which
// mutates in place — for a test that also needs the raw, untouched
// values afterward for comparison.
const cloneChords = chords => chords.map(c => ({ ...c, notes: c.notes.map(n => ({ ...n })) }));
const cloneAnchors = anchors => anchors.map(a => ({ ...a }));

// Drop-D, full chart. tuning = [-2,0,0,0], capo = 0.
test('Drop-D arrangement shift and dropped-string cascade', (t) => {
    const ctx = songContext(4, [-2, 0, 0, 0], 0);
    assert.deepStrictEqual(ctx.k, 1);
    for (const f of SPOT_FRETS) {
        t.test(`A string f=${f}`, () => {
            assert.deepStrictEqual(remapNote(ctx.sourceOpenMidiByString[1], ctx.naturalTargetByString[1], f), { s: 2, f });
        });
        t.test(`D string f=${f}`, () => {
            assert.deepStrictEqual(remapNote(ctx.sourceOpenMidiByString[2], ctx.naturalTargetByString[2], f), { s: 3, f });
        });
        t.test(`G string f=${f}`, () => {
            assert.deepStrictEqual(remapNote(ctx.sourceOpenMidiByString[3], ctx.naturalTargetByString[3], f), { s: 4, f });
        });
    }
    const midi0 = ctx.sourceOpenMidiByString[0], nat0 = ctx.naturalTargetByString[0];
    assert.deepStrictEqual(remapNote(midi0, nat0, 0), { s: 0, f: 3 });
    assert.deepStrictEqual(remapNote(midi0, nat0, 1), { s: 0, f: 4 });
    assert.deepStrictEqual(remapNote(midi0, nat0, 2), { s: 1, f: 0 });
    for (const f of [10, 20]) {
        t.test(`dropped string f=${f}`, () => {
            assert.deepStrictEqual(remapNote(midi0, nat0, f), { s: 1, f: f - 2 });
        });
    }
});

// Drop C#: open strings low-to-high C#, G#, C#, F# (tuning = [-3,-1,-1,-1]).
// Every string carries a nonzero adjustment, so every string cascades near
// the bottom of its range before settling on its own natural target.
test('Drop C# arrangement shift and per-string cascade', (t) => {
    const ctx = songContext(4, [-3, -1, -1, -1], 0);
    assert.deepStrictEqual(ctx.k, 1);

    const [midi0, midi1, midi2, midi3] = ctx.sourceOpenMidiByString;
    const [nat0, nat1, nat2, nat3] = ctx.naturalTargetByString;

    assert.deepStrictEqual(remapNote(midi0, nat0, 0), { s: 0, f: 2 });
    assert.deepStrictEqual(remapNote(midi0, nat0, 1), { s: 0, f: 3 });
    assert.deepStrictEqual(remapNote(midi0, nat0, 2), { s: 0, f: 4 });
    assert.deepStrictEqual(remapNote(midi0, nat0, 3), { s: 1, f: 0 });
    for (const f of [10, 20]) {
        t.test(`string0 f=${f} stays on its natural (E) target`, () => {
            assert.deepStrictEqual(remapNote(midi0, nat0, f), { s: 1, f: f - 3 });
        });
    }

    assert.deepStrictEqual(remapNote(midi1, nat1, 0), { s: 1, f: 4 });
    assert.deepStrictEqual(remapNote(midi1, nat1, 1), { s: 2, f: 0 });
    for (const f of [10, 20]) {
        t.test(`string1 f=${f} stays on its natural (A) target`, () => {
            assert.deepStrictEqual(remapNote(midi1, nat1, f), { s: 2, f: f - 1 });
        });
    }

    assert.deepStrictEqual(remapNote(midi2, nat2, 0), { s: 2, f: 4 });
    assert.deepStrictEqual(remapNote(midi2, nat2, 1), { s: 3, f: 0 });
    for (const f of [10, 20]) {
        t.test(`string2 f=${f} stays on its natural (D) target`, () => {
            assert.deepStrictEqual(remapNote(midi2, nat2, f), { s: 3, f: f - 1 });
        });
    }

    assert.deepStrictEqual(remapNote(midi3, nat3, 0), { s: 3, f: 4 });
    assert.deepStrictEqual(remapNote(midi3, nat3, 1), { s: 4, f: 0 });
    for (const f of [10, 20]) {
        t.test(`string3 f=${f} stays on its natural (G) target`, () => {
            assert.deepStrictEqual(remapNote(midi3, nat3, f), { s: 4, f: f - 1 });
        });
    }
});

// EADG identity: every note shifts string index +1, fret unchanged.
test('EADG identity', (t) => {
    const ctx = songContext(4, [0, 0, 0, 0], 0);
    assert.deepStrictEqual(ctx.k, 1);
    for (let s = 0; s < 4; s++) {
        for (const f of SPOT_FRETS) {
            t.test(`s=${s} f=${f}`, () => {
                assert.deepStrictEqual(remapNote(ctx.sourceOpenMidiByString[s], ctx.naturalTargetByString[s], f), { s: s + 1, f });
            });
        }
    }
});

// BEAD identity: completely unchanged.
test('BEAD identity', (t) => {
    const ctx = songContext(4, [-5, -5, -5, -5], 0);
    assert.deepStrictEqual(ctx.k, 0);
    for (let s = 0; s < 4; s++) {
        for (const f of SPOT_FRETS) {
            t.test(`s=${s} f=${f}`, () => {
                assert.deepStrictEqual(remapNote(ctx.sourceOpenMidiByString[s], ctx.naturalTargetByString[s], f), { s, f });
            });
        }
    }
});

// Already-BEADG identity.
test('Already-BEADG identity', (t) => {
    const ctx = songContext(5, [0, 0, 0, 0, 0], 0);
    assert.deepStrictEqual(ctx.k, 0);
    for (let s = 0; s < 5; s++) {
        for (const f of SPOT_FRETS) {
            t.test(`s=${s} f=${f}`, () => {
                assert.deepStrictEqual(remapNote(ctx.sourceOpenMidiByString[s], ctx.naturalTargetByString[s], f), { s, f });
            });
        }
    }
});

// Out-of-range drop.
test('out-of-range notes drop', () => {
    assert.deepStrictEqual(remapNote(22, 0, 0), null);
    assert.deepStrictEqual(remapNote(43, 4, 21), null);
});

// Non-monotonic targets (banjo5_gdgbd puts the HIGH G4 drone at index 0):
// the walk moves in PITCH order, not index order, so overflow reaches the
// drone string, and the direction lock guarantees termination (review
// findings: wrongly-dropped notes on the banjo preset; a pre-existing
// infinite loop when two pitch-adjacent strings sit >20 semitones apart).
test('non-monotonic banjo5 target walks in pitch order', () => {
    const banjo5 = resolveTargetTuning(['G4', 'D3', 'G3', 'B3', 'D4']).midiTuning;
    assert.deepStrictEqual(banjo5, [67, 50, 55, 59, 62]);
    assert.deepStrictEqual(resolveTargetForFret(75, 1, 8, banjo5), { s: 0, f: 16, adjustment: 8 });

    // Completeness sweep: a standard-guitar chart remapped onto banjo5
    // must always place a note that SOME banjo string could play, and
    // every kept note must sound its exact source pitch.
    const src = computeOpenStringMidiByString(6, [0, 0, 0, 0, 0, 0], 0);
    const k = computeArrangementShift(6, [0, 0, 0, 0, 0, 0], 0, src, banjo5);
    let wronglyDropped = 0, pitchErrors = 0;
    for (let s = 0; s < 6; s++) {
        for (let f = 0; f <= 20; f++) {
            const r = remapNote(src[s], s + k, f, banjo5);
            const fits = banjo5.some(open => { const tf = f + (src[s] - open); return tf >= 0 && tf <= 20; });
            if (fits && !r) wronglyDropped++;
            if (r && banjo5[r.s] + r.f !== src[s] + f) pitchErrors++;
        }
    }
    assert.deepStrictEqual(wronglyDropped, 0);
    assert.deepStrictEqual(pitchErrors, 0);

    // The former infinite-loop input (strings 35 and 62 are pitch-adjacent
    // in this non-monotonic target, 27 semitones apart): the pitch walk
    // now FINDS the legitimate placement the index walk oscillated past.
    assert.deepStrictEqual(resolveTargetForFret(45, 1, 15, [40, 35, 62, 55, 59, 64]), { s: 0, f: 20, adjustment: 5 });
    // And when no placement fits anywhere, the direction lock returns
    // null (this monotonic huge-gap case also looped forever before).
    assert.deepStrictEqual(resolveTargetForFret(50, 0, 5, [28, 60, 65, 70]), null);
});

// Slide notes.
test('slide notes', () => {
    const midi = 28, natural = 1;
    const lowToHigh = remapSlide(midi, natural, 18, 25);
    assert.deepStrictEqual(lowToHigh, { s: 1, f: 18, slideTo: 20 });
    const highToLow = remapSlide(midi, natural, 25, 18);
    assert.deepStrictEqual(highToLow, { s: 1, f: 20, slideTo: 18 });
});

// Chord collision: two source strings sharing open-string MIDI 33 and
// natural target 2 both resolve to target string 2; lower pitch survives.
test('chord collision: lower pitch survives', () => {
    const sourceOpenMidiByString = [33, 33, 38];
    const naturalTargetByString = [2, 2, 3];
    const noteA = { s: 0, f: 5 };
    const noteB = { s: 1, f: 2 };
    const noteC = { s: 2, f: 0 };
    const survivors = resolveChordCollisions(sourceOpenMidiByString, naturalTargetByString, [noteA, noteB, noteC]);
    const bySourceString = new Map(survivors.map(x => [x.note.s, x]));

    assert.deepStrictEqual(survivors.length, 2);
    assert.deepStrictEqual(bySourceString.has(0), false);
    assert.deepStrictEqual(bySourceString.get(1).entry, { s: 2, f: 2 });
    assert.deepStrictEqual(bySourceString.get(2).entry, { s: 3, f: 0 });
});

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
        [{ time: 1, fret: 3, width: 5 }]);
    assert.deepStrictEqual(remapAnchors([{ time: 1, fret: 2, width: 4 }], [
            { t: 1, f: 2, origNote: { t: 1, f: 2 } },  // fretted donor: base band [2,6]
            { t: 2, f: 7, origNote: { t: 2, f: 0 } },  // newly fretted, 1 fret above
        ]),
        [{ time: 1, fret: 2, width: 5 }]);

    // Tier 2: a note past the cap or the time window seeds a clean split
    // instead of being left uncovered (both directions), as long as it's
    // strictly later than the current band's own start.
    assert.deepStrictEqual(remapAnchors([{ time: 1, fret: 4, width: 4 }], [
            { t: 1, f: 4, origNote: { t: 1, f: 4 } },  // fretted donor, adjustment 0
            { t: 2, f: 1, origNote: { t: 2, f: 0 } },  // newly fretted, past the cap
        ]),
        [{ time: 1, fret: 4, width: 4 }, { time: 2, fret: 1, width: 4 }]);
    assert.deepStrictEqual(remapAnchors([{ time: 1, fret: 2, width: 4 }], [
            { t: 1, f: 2, origNote: { t: 1, f: 2 } },
            { t: 2, f: 9, origNote: { t: 2, f: 0 } },  // newly fretted, past the cap
        ]),
        [{ time: 1, fret: 2, width: 4 }, { time: 2, fret: 9, width: 4 }]);
    const donorWindow = CR.ANCHOR_DONOR_WINDOW_S;
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
    assert.deepStrictEqual(risingNext, { time: 5, fret: 2, width: 5 });

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
        [{ time: 0, fret: 1, width: 7 }]);
});

// End-to-end through createRetuner: Drop C (non-uniform per-string
// offsets) onto BEADG. A comfortable fret-8 run right at the anchor must
// split cleanly into its own anchor once the notes actually move to
// fret 1, seconds later — not get dragged into a 9-fret span, and not
// get stuck showing fret 6 for a passage that's actually at fret 1.
test('createRetuner anchor split end-to-end (Drop C onto BEADG)', () => {
    const { createRetuner, resolveTargetTuning, BUILTIN_PRESET_TUNINGS } = CR;
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

// reduceHandTravel: relocates a note reached via a large, fast cross-string
// jump to an exact-pitch alternate on an adjacent string — the motivating
// real-chart case was a source open string landing on target fret 1,
// alternating rapidly with a fretted neighbor on fret 8 one string over —
// an easy open-to-fretted jump in the source, a 7-fret unplayable stretch
// after retuning. BEADG's perfect-fourths spacing means fret 8 on one
// string is the same pitch as fret 3 on the next string up.
test('reduceHandTravel relocates a cross-string jump to an exact-pitch alternate', () => {
    const { reduceHandTravel } = CR;
    const target = [0, 5, 10, 15]; // uniform fourths, easy arithmetic

    const trill = [
        { t: 0, s: 0, f: 1 },
        { t: 0.2, s: 1, f: 8 },
        { t: 0.4, s: 0, f: 1 },
        { t: 0.6, s: 1, f: 8 },
    ];
    reduceHandTravel(trill, target, 20);
    assert.deepStrictEqual(trill.map(n => ({ s: n.s, f: n.f })),
        [{ s: 0, f: 1 }, { s: 2, f: 3 }, { s: 0, f: 1 }, { s: 2, f: 3 }]);

    const smoothRun = [
        { t: 10, s: 1, f: 7 },
        { t: 10.3, s: 1, f: 8 },
        { t: 10.6, s: 1, f: 9 },
    ];
    reduceHandTravel(smoothRun, target, 20);
    assert.deepStrictEqual(smoothRun.map(n => ({ s: n.s, f: n.f })),
        [{ s: 1, f: 7 }, { s: 1, f: 8 }, { s: 1, f: 9 }]);

    const ineligible = [
        { t: 0, s: 0, f: 1 },
        { t: 0.2, s: 1, f: 8 },
    ];
    reduceHandTravel(ineligible, target, 20, (n) => n.s !== 1);
    assert.deepStrictEqual(ineligible.map(n => ({ s: n.s, f: n.f })), [{ s: 0, f: 1 }, { s: 1, f: 8 }]);

    const blocked = [
        { t: 0, s: 0, f: 1 },
        { t: 0.2, s: 1, f: 8 },
        { t: 0.2, s: 2, f: 3 }, // already occupies the would-be alternate at the same instant
    ];
    reduceHandTravel(blocked, target, 20);
    assert.deepStrictEqual(blocked.map(n => ({ s: n.s, f: n.f })), [{ s: 0, f: 1 }, { s: 1, f: 8 }, { s: 2, f: 3 }]);

    const farApart = [
        { t: 0, s: 0, f: 1 },
        { t: 5, s: 1, f: 8 },
    ];
    reduceHandTravel(farApart, target, 20);
    assert.deepStrictEqual(farApart.map(n => ({ s: n.s, f: n.f })), [{ s: 0, f: 1 }, { s: 1, f: 8 }]);

    // Same-string-leap regression guard: a candidate on the SAME string as
    // the neighbor can look tempting under a naive "different-string-only"
    // gap metric (it reads as zero cross-string gap), but it can be an even
    // bigger same-string leap. Scoring must catch this and prefer the
    // genuinely closer cross-string alternate instead.
    const trapTarget = [0, 5, 10];
    const trap = [
        { t: 0, s: 0, f: 1 },
        { t: 0.2, s: 1, f: 13 },
    ];
    reduceHandTravel(trap, trapTarget, 20);
    assert.deepStrictEqual(trap.map(n => ({ s: n.s, f: n.f })), [{ s: 0, f: 1 }, { s: 2, f: 8 }]);

    // Only a 1-fret-better alternate exists — below HAND_JUMP_MIN_IMPROVEMENT (2).
    const marginalTarget = [0, 5, 6];
    const marginal = [
        { t: 0, s: 0, f: 1 },
        { t: 0.2, s: 1, f: 8 },
    ];
    reduceHandTravel(marginal, marginalTarget, 20);
    assert.deepStrictEqual(marginal.map(n => ({ s: n.s, f: n.f })), [{ s: 0, f: 1 }, { s: 1, f: 8 }]);

    assert.deepStrictEqual([CR.HAND_JUMP_FRET_THRESHOLD, CR.HAND_JUMP_TIME_WINDOW_S, CR.HAND_JUMP_MIN_IMPROVEMENT],
        [5, 0.75, 2]);
});

// reduceHandTravel's retune-attributable gate: notes carrying an
// `origNote` back-reference (as createRetuner tags them) only trigger a
// relocation when retuning actually made the jump worse than the source
// chart already demanded.
test('reduceHandTravel retune-attributable gate', () => {
    const { reduceHandTravel } = CR;

    // Same gap before and after (e.g. a full identity remap) -- already a
    // fact about the arrangement, not this pass's problem. This is the
    // exact shape of feedBack-plugin-chart-retuner's own reported bug: an
    // EADG chart's cross-string jump surviving unchanged onto BEADG must
    // stay unchanged, not get "corrected."
    const unchanged = [
        { t: 0, s: 0, f: 1, origNote: { s: 0, f: 1 } },
        { t: 0.2, s: 1, f: 8, origNote: { s: 1, f: 8 } },
    ];
    reduceHandTravel(unchanged, [0, 5, 10, 15], 20);
    assert.deepStrictEqual(unchanged.map(n => ({ s: n.s, f: n.f })), [{ s: 0, f: 1 }, { s: 1, f: 8 }]);

    // Source gap was already borderline (5, right at threshold) but a
    // differential per-string retune widens it to 15 -- a genuine new
    // problem, not one the source already had, so it must still fire even
    // though the source gap alone crossed the threshold.
    const worsened = [
        { t: 0, s: 0, f: 3, origNote: { s: 0, f: 3 } },
        { t: 0.2, s: 1, f: 18, origNote: { s: 1, f: 8 } },
    ];
    reduceHandTravel(worsened, [0, 5, 10, 15, 20], 24);
    assert.deepStrictEqual(worsened.map(n => ({ s: n.s, f: n.f })), [{ s: 0, f: 3 }, { s: 2, f: 13 }]);

    // "Already existed" only applies to a genuine cross-string reach in
    // the source. When both notes came from the same SOURCE string (a
    // slide/run), the origin gap is irrelevant -- only the post-remap
    // cross-string gap matters here.
    const sameSourceString = [
        { t: 0, s: 0, f: 1, origNote: { s: 0, f: 1 } },
        { t: 0.2, s: 1, f: 8, origNote: { s: 0, f: 14 } },
    ];
    reduceHandTravel(sameSourceString, [0, 5, 10, 15], 20);
    assert.deepStrictEqual(sameSourceString.map(n => ({ s: n.s, f: n.f })), [{ s: 0, f: 1 }, { s: 2, f: 3 }]);

    // A side that was open in the source and stays open post-remap
    // counts toward "already existed" like any other unchanged side (a
    // side that became fretted is the exception, exercised by the
    // "trill" test above via its lack of `origNote`).
    const stillOpen = [
        { t: 0, s: 0, f: 1, origNote: { s: 0, f: 1 } },
        { t: 0.2, s: 1, f: 0, origNote: { s: 1, f: 0 } },
    ];
    reduceHandTravel(stillOpen, [0, 5, 10, 15], 20);
    assert.deepStrictEqual(stillOpen.map(n => ({ s: n.s, f: n.f })), [{ s: 0, f: 1 }, { s: 1, f: 0 }]);

    // Cascade guard: A has a genuine retuning-caused jump vs a seed note
    // and legitimately relocates (natural s1/f10 -> s2/f5). B's TRUE
    // relationship to A is comfortable both before (source frets 3 vs 4,
    // gap 1) and after (natural frets 10 vs 11, gap 1) retuning -- B must
    // stay put, evaluated on its own true relationship to A rather than
    // dragged along purely because A was processed (and moved) first,
    // one array slot earlier.
    const seedA_B = [
        { t: 0.0, s: 0, f: 2,  origNote: { s: 0, f: 2 } },
        { t: 0.2, s: 1, f: 10, origNote: { s: 1, f: 3 } },
        { t: 0.4, s: 3, f: 11, origNote: { s: 3, f: 4 } },
    ];
    reduceHandTravel(seedA_B, [0, 5, 10, 15, 20, 25], 24);
    assert.deepStrictEqual(seedA_B.map(n => ({ s: n.s, f: n.f })), [{ s: 0, f: 2 }, { s: 2, f: 5 }, { s: 3, f: 11 }]);

    // Repeated-note run: three notes sharing the identical source
    // string+fret, back-to-back with nothing else in between (including
    // a real time gap before the last one, same as a rest in the chart).
    // Only the first is adjacent to the awkward neighbor at t=0, but the
    // whole run must relocate together, not just that one hit.
    const repeatRun = [
        { t: 0,   s: 0, f: 1, origNote: { s: 0, f: 1 } },
        { t: 0.2, s: 1, f: 8, origNote: { s: 5, f: 5 } },
        { t: 0.7, s: 1, f: 8, origNote: { s: 5, f: 5 } },
        { t: 4.0, s: 1, f: 8, origNote: { s: 5, f: 5 } },
    ];
    reduceHandTravel(repeatRun, [0, 5, 10, 15, 20], 20);
    assert.deepStrictEqual(repeatRun.map(n => ({ s: n.s, f: n.f })),
        [{ s: 0, f: 1 }, { s: 2, f: 3 }, { s: 2, f: 3 }, { s: 2, f: 3 }]);

    // Same-natural-string jump, not just cross-string: B shares its
    // natural string with the C run right after it (a slide-shaped
    // source relationship), so the big fret jump between them is a real
    // trigger even though neither ever lands on a different NATURAL
    // string. C must be the one that relocates (to land beside B on B's
    // own string) -- not B reaching forward and grabbing an unrelated
    // same-fret-number alternate on a string that has nothing to do
    // with A, which would only trade one bad jump for another.
    const sameStringJump = [
        { t: 0,   s: 2, f: 5, origNote: { s: 2, f: 5 } },              // A: comfortable seed
        { t: 0.2, s: 1, f: 3, origNote: { s: 1, f: 0 } },              // B: newly fretted, natural E
        { t: 0.4, s: 1, f: 8, origNote: { s: 1, f: 5 } },              // C: natural E too -- same source string as B
        { t: 0.6, s: 2, f: 5, origNote: { s: 2, f: 5 } },              // D: comfortable exit
    ];
    reduceHandTravel(sameStringJump, [0, 5, 10, 15, 20], 20);
    assert.deepStrictEqual(sameStringJump.map(n => ({ s: n.s, f: n.f })),
        [{ s: 2, f: 5 }, { s: 1, f: 3 }, { s: 2, f: 3 }, { s: 2, f: 5 }]);

    // A slide's start/end frets are both computed for one target string
    // (remapSlide) -- relocating just the start note here would strand
    // the `.sl`/`.slu` endpoint on the string it left. Never eligible,
    // even across a jump that would otherwise clearly trigger.
    const slideNote = [
        { t: 0, s: 0, f: 1 },
        { t: 0.2, s: 1, f: 8, slu: 10 },
    ];
    reduceHandTravel(slideNote, [0, 5, 10, 15, 20], 20);
    assert.deepStrictEqual(slideNote.map(n => ({ s: n.s, f: n.f })), [{ s: 0, f: 1 }, { s: 1, f: 8 }]);

    // A slide can't join (or seed) a repeated-note run either -- it stays
    // untouched while an otherwise-identical, non-slide run member around
    // it still relocates on its own.
    const runWithSlide = [
        { t: 0,   s: 0, f: 1, origNote: { s: 5, f: 1 } },
        { t: 0.2, s: 1, f: 8, origNote: { s: 6, f: 5 } },
        { t: 0.4, s: 1, f: 8, origNote: { s: 6, f: 5 }, slu: 10 },
    ];
    reduceHandTravel(runWithSlide, [0, 5, 10, 15, 20], 20);
    assert.deepStrictEqual(runWithSlide.map(n => ({ s: n.s, f: n.f })),
        [{ s: 0, f: 1 }, { s: 2, f: 3 }, { s: 1, f: 8 }]);

    // A double-stop slide (two simultaneous notes, each with its own
    // sl/slu) is two independent slide notes as far as this function is
    // concerned -- the isSlide guard protects each one regardless of
    // which string it's on or that it shares an onset with the other.
    // isEligible defaults to true here (the worst case): createRetuner
    // never marks a same-onset pair standalone in the first place (see
    // its own test below), but this proves the guard holds even if that
    // routing were ever bypassed.
    const doubleStopSlide = [
        { t: 0,   s: 0, f: 1 },
        { t: 0.2, s: 1, f: 8, slu: 10 },
        { t: 0.2, s: 2, f: 8, sl: 6 },
        { t: 0.4, s: 0, f: 1 },
    ];
    reduceHandTravel(doubleStopSlide, [0, 5, 10, 15, 20], 20);
    assert.deepStrictEqual(doubleStopSlide.map(n => ({ s: n.s, f: n.f })),
        [{ s: 0, f: 1 }, { s: 1, f: 8 }, { s: 2, f: 8 }, { s: 0, f: 1 }]);
});

// createRetuner() end-to-end: the retune-attributable gate must hold
// across the full pipeline, from the pure-function level all the way
// through the public API.
test('createRetuner end-to-end retune-attributable gate', () => {
    const { createRetuner, DEFAULT_TARGET_MIDI_TUNING } = CR;

    // The actual reported bug: an EADG bass chart on the default BEADG
    // target is a full identity remap (every note lands on its own exact
    // natural string/fret). A pre-existing cross-string jump already in
    // the source chart must survive completely untouched end to end --
    // including the anchor, which must not be corrupted by borrowing a
    // hand-travel-relocated donor's delta.
    {
        const bundle = makeBundle({
            notes: [{ t: 0.0, s: 1, f: 6 }, { t: 0.3, s: 0, f: 0 }],
            anchors: [{ time: 0.0, fret: 6, width: 3 }],
            tuning: [0, 0, 0, 0],
        });
        createRetuner().apply(bundle, DEFAULT_TARGET_MIDI_TUNING, 20, 0);
        assert.deepStrictEqual(bundle.notes.map(n => ({ s: n.s, f: n.f })), [{ s: 2, f: 6 }, { s: 1, f: 0 }]);
        assert.deepStrictEqual(bundle.anchors, [{ time: 0.0, fret: 6, width: 3 }]);
    }

    // A genuine differential per-string retune (only one string shifted
    // hard) must still relocate the note it makes newly awkward, all the
    // way through the full pipeline built on top of reduceHandTravel.
    {
        const target = [0, 5, 10, 15, 20];
        const bundle = makeBundle({
            notes: [{ t: 0.0, s: 1, f: 3 }, { t: 0.2, s: 2, f: 8 }],
            tuning: [-23, -23, -13, -23],
        });
        createRetuner().apply(bundle, target, 24, 0);
        assert.deepStrictEqual(bundle.notes.map(n => ({ s: n.s, f: n.f })), [{ s: 1, f: 8 }, { s: 4, f: 13 }]);
    }

    // A double-stop slide (two simultaneous notes, each carrying its own
    // sl/slu) shares an onset, so createRetuner's own bucketing routes it
    // through the group solver rather than the standalone path -- it
    // never reaches reduceHandTravel at all, regardless of how awkward a
    // neighboring standalone note would otherwise make it look.
    {
        const target = [0, 5, 10, 15, 20];
        const bundle = makeBundle({
            notes: [
                { t: 0.0, s: 1, f: 3, sl: 5 },
                { t: 0.0, s: 2, f: 8, slu: 10 },
                { t: 0.2, s: 0, f: 1 },
            ],
            tuning: [-23, -23, -13, -23],
        });
        createRetuner().apply(bundle, target, 24, 0);
        const doubleStop = bundle.notes.filter(n => n.t === 0.0);
        assert.deepStrictEqual(doubleStop.map(n => ({ s: n.s, f: n.f, hasSlide: Number.isInteger(n.sl) || Number.isInteger(n.slu), relocated: n.natS !== undefined })),
            [{ s: 2, f: 3, hasSlide: true, relocated: false }, { s: 3, f: 6, hasSlide: true, relocated: false }]);
    }
});

// Collision resolution for simultaneous notes NOT wrapped in a Chord
// object — grouped by onset time and run through resolveChordCollisions
// the same as a real chord's .notes array.
test('collision resolution for simultaneous non-chord notes', () => {
    const sourceOpenMidiByString = [33, 33, 38];
    const naturalTargetByString = [2, 2, 3];
    const noteA = { t: 5, s: 0, f: 5 };
    const noteB = { t: 5, s: 1, f: 2 };
    const noteC = { t: 5, s: 2, f: 0 };
    const noteD = { t: 6, s: 2, f: 3 };

    const byTime = new Map();
    for (const n of [noteA, noteB, noteC, noteD]) {
        let bucket = byTime.get(n.t);
        if (!bucket) byTime.set(n.t, bucket = []);
        bucket.push(n);
    }
    const remapped = [];
    for (const bucket of byTime.values()) {
        for (const { entry, note } of resolveChordCollisions(sourceOpenMidiByString, naturalTargetByString, bucket)) {
            remapped.push({ t: note.t, s: entry.s, f: entry.f, origS: note.s });
        }
    }
    remapped.sort((a, b) => a.t - b.t);

    assert.deepStrictEqual(remapped.length, 3);
    const atT5 = remapped.filter(n => n.t === 5);
    const atT6 = remapped.filter(n => n.t === 6);
    assert.deepStrictEqual(atT5.length, 2);
    assert.deepStrictEqual(atT5.some(n => n.origS === 0), false);
    assert.deepStrictEqual(atT5.find(n => n.origS === 1), { t: 5, s: 2, f: 2, origS: 1 });
    assert.deepStrictEqual(atT5.find(n => n.origS === 2), { t: 5, s: 3, f: 0, origS: 2 });
    assert.deepStrictEqual(atT6[0], { t: 6, s: 3, f: 3, origS: 2 });
});

// Chord template remapping — real-world case: Black Veil Brides "In the
// End", Drop C# tuning, no real Chord objects, chord synthesized from a
// hand-shape + this template's raw frets.
test('chord template remapping (Drop C# real-world case)', () => {
    const ctx = songContext(4, [-3, -1, -1, -1], 0);
    const template = { name: '', displayName: '', frets: [6, 7, -1, -1, -1, -1], fingers: [1, 2, -1, -1, -1, -1] };
    const remapped = remapChordTemplate(ctx.sourceOpenMidiByString, ctx.naturalTargetByString, template);
    assert.deepStrictEqual(remapped.frets, [-1, 3, 6, -1, -1]);
    assert.deepStrictEqual(remapped.fingers, [-1, 1, 2, -1, -1]);
    assert.deepStrictEqual({
        name: remapped.name, displayName: remapped.displayName,
    }, { name: '', displayName: '' });

    const midi0 = ctx.sourceOpenMidiByString[0], nat0 = ctx.naturalTargetByString[0];
    assert.deepStrictEqual(remapNote(midi0, nat0, 6), { s: remapped.frets.indexOf(3), f: 3 });
});

// Collision within a single template.
test('collision within a single template', () => {
    const sourceOpenMidiByString = [33, 33, 38];
    const naturalTargetByString = [2, 2, 3];
    const template = { frets: [5, 2, 0, -1], fingers: null };
    const remapped = remapChordTemplate(sourceOpenMidiByString, naturalTargetByString, template);
    assert.deepStrictEqual(remapped.frets, [-1, -1, 2, 0, -1]);
    assert.deepStrictEqual(remapped.fingers, null);
});

// Custom target tuning: parseTargetNote / resolveTargetTuning.
test('custom target tuning: parseTargetNote / resolveTargetTuning', () => {
    assert.deepStrictEqual(parseTargetNote('B0'), { midi: 23, label: 'B' });
    assert.deepStrictEqual(parseTargetNote('f#2'), { midi: 42, label: 'F#' });
    assert.deepStrictEqual(parseTargetNote('Bb1'), { midi: 34, label: 'Bb' });
    assert.deepStrictEqual(parseTargetNote('A-1'), { midi: 9, label: 'A' });
    assert.deepStrictEqual(parseTargetNote('H0'), null);
    assert.deepStrictEqual(parseTargetNote('B'), null);
    assert.deepStrictEqual(parseTargetNote(undefined), null);

    const beadg = resolveTargetTuning(DEFAULT_TARGET_TUNING);
    assert.deepStrictEqual(beadg.midiTuning, DEFAULT_TARGET_MIDI_TUNING);
    assert.deepStrictEqual(beadg.labels, ['B', 'E', 'A', 'D', 'G']);

    const partial = resolveTargetTuning(['B0', 'garbage', 'A1', 'D2', 'G2']);
    assert.deepStrictEqual(partial.midiTuning, [23, 28, 33, 38, 43]);

    assert.deepStrictEqual(resolveTargetTuning(null).midiTuning, DEFAULT_TARGET_MIDI_TUNING);

    // resolveTargetTuning honors the spec's own length, no padding.
    const short = resolveTargetTuning(['A0', 'F1']);
    assert.deepStrictEqual(short.midiTuning, [21, 29]);
    assert.deepStrictEqual(short.labels, ['A', 'F']);

    // A malformed entry past index 4 falls back to EXTENDED_DEFAULT_TARGET_TUNING.
    const long = resolveTargetTuning(['B0', 'E1', 'A1', 'D2', 'G2', 'garbage']);
    assert.deepStrictEqual(long.midiTuning, [23, 28, 33, 38, 43, 47]);
    assert.deepStrictEqual(long.labels[5], 'B');
});

// AEADG target, EADG source: proves the explicit targetMidiTuning
// parameter genuinely takes effect, rather than silently defaulting to
// BEADG. AEADG's indices 1-4 are numerically identical to BEADG's, and a
// 4-string EADG source stays confined to indices 1-4, so a full fret
// sweep here would just re-run the EADG-identity block above against
// different-but-equal data — one spot check is enough to prove the
// parameter takes effect.
test('AEADG target with EADG source', (t) => {
    const aeadg = resolveTargetTuning(['A0', 'E1', 'A1', 'D2', 'G2']);
    assert.deepStrictEqual(aeadg.labels, ['A', 'E', 'A', 'D', 'G']);
    const ctx = songContext(4, [0, 0, 0, 0], 0, aeadg.midiTuning);
    assert.deepStrictEqual(ctx.k, 1);
    assert.deepStrictEqual(remapNote(ctx.sourceOpenMidiByString[0], ctx.naturalTargetByString[0], 5, aeadg.midiTuning), { s: 1, f: 5 });

    // A 5-string source already tuned AEADG is a full identity remap —
    // this DOES exercise index 0 (A0), unlike the EADG-source case above.
    const ctx5 = songContext(5, [-2, 0, 0, 0, 0], 0, aeadg.midiTuning);
    assert.deepStrictEqual(ctx5.k, 0);
    for (let s = 0; s < 5; s++) {
        for (const f of SPOT_FRETS) {
            t.test(`s=${s} f=${f}`, () => {
                assert.deepStrictEqual(remapNote(ctx5.sourceOpenMidiByString[s], ctx5.naturalTargetByString[s], f, aeadg.midiTuning), { s, f });
            });
        }
    }
});

// BbEbAbDbGb target — a half-step-flat identity remap.
test('BbEbAbDbGb target identity', (t) => {
    const flat = resolveTargetTuning(['Bb0', 'Eb1', 'Ab1', 'Db2', 'Gb2']);
    assert.deepStrictEqual(flat.midiTuning, [22, 27, 32, 37, 42]);
    assert.deepStrictEqual(flat.labels, ['Bb', 'Eb', 'Ab', 'Db', 'Gb']);
    const ctx = songContext(5, [-1, -1, -1, -1, -1], 0, flat.midiTuning);
    assert.deepStrictEqual(ctx.k, 0);
    for (let s = 0; s < 5; s++) {
        for (const f of SPOT_FRETS) {
            t.test(`s=${s} f=${f}`, () => {
                assert.deepStrictEqual(remapNote(ctx.sourceOpenMidiByString[s], ctx.naturalTargetByString[s], f, flat.midiTuning), { s, f });
            });
        }
    }

    const sourceOpenMidiByString = [32, 32, 37];
    const naturalTargetByString = [2, 2, 3];
    const survivors = resolveChordCollisions(sourceOpenMidiByString, naturalTargetByString,
        [{ s: 0, f: 5 }, { s: 1, f: 2 }, { s: 2, f: 0 }], flat.midiTuning);
    assert.deepStrictEqual(survivors.length, 2);
    assert.deepStrictEqual(survivors.find(x => x.note.s === 1).entry, { s: 2, f: 2 });
});

// createRetuner().apply() end-to-end, including cache invalidation when
// the active target tuning changes.
test('createRetuner cache invalidation on target tuning change', () => {
    const { createRetuner } = CR;
    const retuner = createRetuner();
    const rawNotes = [{ t: 0, s: 0, f: 0 }];
    const bundle = makeBundle({ notes: rawNotes, tuning: [0, 0, 0, 0, 0] });
    retuner.apply(bundle);
    assert.deepStrictEqual({ s: bundle.notes[0].s, f: bundle.notes[0].f }, { s: 0, f: 0 });
    const beforeAeadg = bundle.notes[0];

    const aeadg = resolveTargetTuning(['A0', 'E1', 'A1', 'D2', 'G2']);
    bundle.notes = rawNotes; // simulate core re-supplying the raw array next frame
    retuner.apply(bundle, aeadg.midiTuning);
    assert.deepStrictEqual(bundle.notes[0].f, 2);
    // assert.notStrictEqual asserts reference INEQUALITY (a genuinely new
    // object, distinct from one that's merely equal) -- check()'s
    // deepStrictEqual only compares structure, so this needs the
    // assert.notStrictEqual form directly.
    assert.notStrictEqual(bundle.notes[0], beforeAeadg, 'a target-tuning change must produce a fresh remap object');

    bundle.notes = rawNotes;
    retuner.apply(bundle);
    assert.deepStrictEqual(bundle.notes[0].f, 0);
});

// createRetuner's fail-safe: a malformed bundle (invalid stringCount, or a
// non-array tuning) passes every array through unremapped rather than
// crashing or silently dropping the chart.
test('createRetuner fail-safe passes a malformed bundle through unremapped', (t) => {
    const { createRetuner } = CR;
    const rawNotes = [{ t: 0, s: 0, f: 3 }];
    const rawChords = [{ id: null, t: 1, notes: [] }];
    const rawAnchors = [{ time: 0, fret: 1, width: 3 }];

    t.test('non-array tuning', () => {
        const bundle = { notes: rawNotes, chords: rawChords, anchors: rawAnchors, chordTemplates: [], tuning: null, capo: 0, stringCount: 4 };
        createRetuner().apply(bundle, [40, 45, 50, 55]);
        assert.strictEqual(bundle.notes, rawNotes);
        assert.strictEqual(bundle.chords, rawChords);
        assert.strictEqual(bundle.anchors, rawAnchors);
    });

    t.test('invalid stringCount', () => {
        const bundle = { notes: rawNotes, chords: rawChords, anchors: rawAnchors, chordTemplates: [], tuning: [0, 0, 0, 0], capo: 0, stringCount: 0 };
        createRetuner().apply(bundle, [40, 45, 50, 55]);
        assert.strictEqual(bundle.notes, rawNotes);
    });
});

// A bundle with no chord templates at all (chordTemplates omitted/non-array)
// resolves to an empty array rather than crashing.
test('createRetuner handles a bundle with no chord templates', () => {
    const { createRetuner } = CR;
    const bundle = makeBundle({ notes: [{ t: 0, s: 0, f: 3 }], tuning: [0, 0, 0, 0], chordTemplates: undefined });
    createRetuner().apply(bundle, [40, 45, 50, 55]);
    assert.deepStrictEqual(bundle.chordTemplates, []);
});

// Switching tuning mid-playthrough must re-add a note previously dropped
// as unplayable, if now in range under the new target.
test('switching tuning mid-playthrough re-adds a previously dropped note', () => {
    const { createRetuner } = CR;
    const retuner = createRetuner();
    const rawNotes = [{ t: 0, s: 0, f: 0 }];
    const bundle = makeBundle({ notes: rawNotes, tuning: [-2, 0, 0, 0, 0] });

    retuner.apply(bundle);
    assert.deepStrictEqual(bundle.notes.length, 0);

    const aeadg = resolveTargetTuning(['A0', 'E1', 'A1', 'D2', 'G2']);
    bundle.notes = rawNotes;
    retuner.apply(bundle, aeadg.midiTuning);
    assert.deepStrictEqual(bundle.notes.length, 1);
    assert.deepStrictEqual({ s: bundle.notes[0].s, f: bundle.notes[0].f }, { s: 0, f: 0 });

    bundle.notes = rawNotes;
    retuner.apply(bundle);
    assert.deepStrictEqual(bundle.notes.length, 0);
});

// maxFret: per-tuning-profile ceiling (HISTORY.md Phase 15 — replaces the old
// blanket hardcoded 20). Every engine entry point defaults to
// DEFAULT_MAX_FRET (20, exercised throughout this file already); these
// cases pin the actual widening/narrowing behavior a non-default value
// produces.
test('maxFret per-tuning-profile ceiling', () => {
    // Single-string target at exactly the source's open pitch (adjustment
    // 0), so the target fret always equals the source fret — isolates the
    // ceiling check from any natural-string/adjustment interaction.
    const oneString = [40];
    assert.deepStrictEqual(resolveTargetForFret(40, 0, 21, oneString), null);
    assert.deepStrictEqual(resolveTargetForFret(40, 0, 21, oneString, 24), { s: 0, f: 21, adjustment: 0 });
    assert.deepStrictEqual(resolveTargetForFret(40, 0, 15, oneString, 14), null);

    assert.deepStrictEqual(remapAnchors([{ time: 0, fret: 23, width: 4 }], [{ t: 0, f: 0, origNote: { t: 0, f: 0 } }], 24),
        [{ time: 0, fret: 23, width: 4 }]);
    assert.deepStrictEqual(remapAnchors([{ time: 0, fret: 23, width: 4 }], [{ t: 0, f: 0, origNote: { t: 0, f: 0 } }]),
        [{ time: 0, fret: 20, width: 4 }]);

    // Single-string source/target (as above) so there's no adjacent string
    // the walk could escape to — isolates the ceiling from string choice.
    const { createRetuner } = CR;
    const retuner = createRetuner();
    const rawNotes = [{ t: 0, s: 0, f: 21 }];
    const bundle = makeBundle({ notes: rawNotes, tuning: [0] });
    retuner.apply(bundle, oneString, 20);
    assert.deepStrictEqual(bundle.notes.length, 0);

    bundle.notes = rawNotes;
    retuner.apply(bundle, oneString, 24);
    assert.deepStrictEqual(bundle.notes.length, 1);
    assert.deepStrictEqual(bundle.notes[0].f, 21);

    // Cache invalidation: same tuning, different maxFret must NOT cache-hit
    // (targetSig folds maxFret in) — re-running at 20 drops it again.
    bundle.notes = rawNotes;
    retuner.apply(bundle, oneString, 20);
    assert.deepStrictEqual(bundle.notes.length, 0);
});

// parseActiveTuning: the silent auto-saved "active" tuning (the unsaved
// user-defined tuning the settings editor edits live). Accepts the stored
// JSON string or a parsed object; resolves to the resolveActiveTuning
// shape with the reserved id/name; malformed input resolves to null so
// callers fall through to normal profile resolution.
test('parseActiveTuning', () => {
    const { parseActiveTuning, ACTIVE_TUNING_ID, ACTIVE_TUNING_NAME } = CR;
    const good = { strings: ['G3', 'D4', 'A4', 'E5'], colors: ['#f18313', '#3fc413', '#ecd234', '#e61f26'], maxFret: 14, capo: 4, capoEnabled: true, octaveOffset: 1 };
    const r = parseActiveTuning(JSON.stringify(good));
    assert.deepStrictEqual({ id: r.id, name: r.name }, { id: ACTIVE_TUNING_ID, name: ACTIVE_TUNING_NAME });
    assert.deepStrictEqual({ strings: r.strings, colors: r.colors, maxFret: r.maxFret, capo: r.capo, capoEnabled: r.capoEnabled, octaveOffset: r.octaveOffset, roles: r.roles },
        { strings: good.strings, colors: good.colors, maxFret: 14, capo: 4, capoEnabled: true, octaveOffset: 1, roles: null });
    assert.deepStrictEqual(parseActiveTuning(good).capo, 4);
    assert.deepStrictEqual(parseActiveTuning({ strings: ['E1', 'A1', 'D2', 'G2'] }).capoEnabled, false);
    assert.deepStrictEqual(parseActiveTuning({ strings: ['E1', 'A1', 'D2', 'G2'], capoEnabled: 'true' }).capoEnabled, false);

    assert.deepStrictEqual([parseActiveTuning(''), parseActiveTuning('   '), parseActiveTuning(null), parseActiveTuning(undefined)],
        [null, null, null, null]);
    assert.deepStrictEqual(parseActiveTuning('{nope'), null);
    assert.deepStrictEqual([parseActiveTuning('42'), parseActiveTuning('[1,2,3]')], [null, null]);
    assert.deepStrictEqual(parseActiveTuning({ strings: ['E1', 'A1'] }), null);

    const sloppy = parseActiveTuning({ strings: ['E1', 'A1', 'D2', 'G2'], colors: 'nope', maxFret: 99, capo: 25, octaveOffset: 9 });
    assert.deepStrictEqual({ colors: sloppy.colors, maxFret: sloppy.maxFret, capo: sloppy.capo, octaveOffset: sloppy.octaveOffset },
        { colors: null, maxFret: DEFAULT_MAX_FRET, capo: 0, octaveOffset: 0 });
    // capo validated against the active tuning's OWN maxFret, like saved customs.
    assert.deepStrictEqual(parseActiveTuning({ strings: ['E1', 'A1', 'D2', 'G2'], maxFret: 14, capo: 13 }).capo, 13);
    assert.deepStrictEqual(parseActiveTuning({ strings: ['E1', 'A1', 'D2', 'G2'], maxFret: 14, capo: 14 }).capo, 0);
    // Input arrays are copied, so the caller is free to mutate them.
    const aliasIn = { strings: ['E1', 'A1', 'D2', 'G2'], colors: ['#111111', '#222222', '#333333', '#444444'] };
    const aliased = parseActiveTuning(aliasIn);
    assert.notStrictEqual(aliased.strings, aliasIn.strings, 'parsed strings must be a fresh copy');
    assert.notStrictEqual(aliased.colors, aliasIn.colors, 'parsed colors must be a fresh copy');
});

// displayFretOffset: physical-fret display shift. Notes/slides/chord
// notes/anchors relabel to physical frets, except relative fret 0, which
// stays open — chosen for chord legibility over scoring purity.
test('displayFretOffset: physical-fret display shift', () => {
    const { createRetuner } = CR;
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
    retuner.apply(bundle, effective, relCeiling, capo);
    assert.deepStrictEqual(bundle.notes.map(n => n.f), [5, 0, 7]);
    assert.deepStrictEqual(bundle.notes.some(n => n.origNote.f === 2), false);
    assert.deepStrictEqual(bundle.notes[2].sl, 9);
    assert.deepStrictEqual(bundle.anchors, [{ time: 0, fret: 5, width: 4 }]);
    assert.notStrictEqual(bundle.anchors[0], rawAnchors[0],
        'shifted anchors must be fresh objects — the raw chart anchor must never be mutated');
    assert.deepStrictEqual(rawAnchors[0], { time: 0, fret: 5, width: 4 });

    // Cache invalidation: offset folds into targetSig — dropping it back
    // to 0 with everything else identical must re-derive capo-RELATIVE
    // frets from raw, then restoring it re-derives physical again.
    bundle.notes = rawNotes; bundle.anchors = rawAnchors;
    retuner.apply(bundle, effective, relCeiling, 0);
    assert.deepStrictEqual(bundle.notes.map(n => n.f), [2, 0, 4]);
    bundle.notes = rawNotes; bundle.anchors = rawAnchors;
    retuner.apply(bundle, effective, relCeiling, capo);
    assert.deepStrictEqual(bundle.notes.map(n => n.f), [5, 0, 7]);

    // Bogus offsets sanitize to 0 rather than shifting by garbage.
    bundle.notes = rawNotes; bundle.anchors = rawAnchors;
    retuner.apply(bundle, effective, relCeiling, 2.5);
    assert.deepStrictEqual(bundle.notes.map(n => n.f), [2, 0, 4]);
});

// displayFretOffset: a plain note's sl/slu carry the -1 "no slide"
// sentinel (never omitted), which must stay untouched by the shift.
test('displayFretOffset leaves the -1 no-slide sentinel untouched', () => {
    const { createRetuner } = CR;
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

// displayFretOffset across chords and templates: template frets shift
// except the -1 "unused string" sentinel AND relative fret 0, which stays
// open — same rule as notes, so a renderer merging live note fret with
// template fret (e.g. highway_3d's mergeChordShape) sees the two agree
// instead of the note silently overwriting the template's "open"
// classification with a nonzero physical fret. Fingers untouched.
test('displayFretOffset across chords and templates', () => {
    const { createRetuner } = CR;
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

// Duplicate note+octave across strings is allowed — no uniqueness
// constraint anywhere in the engine.
test('duplicate note+octave across strings is allowed', () => {
    const dup = resolveTargetTuning(['B0', 'B0', 'A1', 'D2', 'G2']);
    assert.deepStrictEqual(dup.midiTuning, [23, 23, 33, 38, 43]);
    assert.deepStrictEqual(dup.labels, ['B', 'B', 'A', 'D', 'G']);

    assert.deepStrictEqual(remapNote(23, 0, 0, dup.midiTuning), { s: 0, f: 0 });
    assert.deepStrictEqual(remapNote(23, 1, 0, dup.midiTuning), { s: 1, f: 0 });

    const survivors = resolveChordCollisions([23, 23], [0, 1], [{ s: 0, f: 0 }, { s: 1, f: 0 }], dup.midiTuning);
    assert.deepStrictEqual(survivors.length, 2);
});

// Irregular-interval target: B0,E1,A1,D2,F#2 — D2->F#2 is a major third
// rather than the usual fourth.
test('irregular-interval target', (t) => {
    const irregular = resolveTargetTuning(['B0', 'E1', 'A1', 'D2', 'F#2']);
    assert.deepStrictEqual(irregular.midiTuning, [23, 28, 33, 38, 42]);

    const ctx = songContext(5, [0, 0, 0, 0, 0], 0, irregular.midiTuning);
    assert.deepStrictEqual(ctx.k, 0);
    for (let s = 0; s < 4; s++) {
        for (const f of SPOT_FRETS) {
            t.test(`s=${s} f=${f}`, () => {
                assert.deepStrictEqual(remapNote(ctx.sourceOpenMidiByString[s], ctx.naturalTargetByString[s], f, irregular.midiTuning), { s, f });
            });
        }
    }
    assert.deepStrictEqual(remapNote(ctx.sourceOpenMidiByString[4], ctx.naturalTargetByString[4], 0, irregular.midiTuning), { s: 4, f: 1 });
    assert.deepStrictEqual(remapNote(ctx.sourceOpenMidiByString[4], ctx.naturalTargetByString[4], 19, irregular.midiTuning), { s: 4, f: 20 });
    assert.deepStrictEqual(remapNote(ctx.sourceOpenMidiByString[4], ctx.naturalTargetByString[4], 20, irregular.midiTuning), null);

    assert.deepStrictEqual(resolveTargetForFret(38, 3, 21, irregular.midiTuning), { s: 4, f: 17, adjustment: -4 });
});

// Variable target string count: 4-8, matching highway_3d's floor and
// MAX_RENDER_STRINGS.
test('variable target string count', () => {
    assert.deepStrictEqual(MIN_TARGET_STRING_COUNT, 4);
    assert.deepStrictEqual(MAX_TARGET_STRING_COUNT, 8);
});

// defaultExtensionNote / midiToNoteLabel: low extensions drop a perfect
// fourth; high extensions rise a major third only from BEADG's G2 (43).
test('defaultExtensionNote / midiToNoteLabel', () => {
    assert.deepStrictEqual(DEFAULT_TARGET_MIDI_TUNING.map(midiToNoteLabel), DEFAULT_TARGET_TUNING);

    assert.deepStrictEqual(defaultExtensionNote('high', 43), { midi: 47, label: 'B2' });
    assert.deepStrictEqual(defaultExtensionNote('low', 28), { midi: 23, label: 'B0' });

    assert.deepStrictEqual(defaultExtensionNote('high', 47), { midi: 52, label: 'E3' });
    assert.deepStrictEqual(defaultExtensionNote('low', 23), { midi: 18, label: 'F#0' });

    assert.deepStrictEqual(defaultExtensionNote('high', 33), { midi: 38, label: 'D2' });

    assert.deepStrictEqual(EXTENDED_DEFAULT_TARGET_TUNING[1], 'F#0');
    assert.deepStrictEqual(EXTENDED_DEFAULT_TARGET_TUNING[7], 'B2');
});

// colorRoleForNote: symbolic color roles only, no actual colors (that's
// screen.js's job).
test('colorRoleForNote', () => {
    assert.deepStrictEqual(colorRoleForNote(23), 'lowB');
    assert.deepStrictEqual(colorRoleForNote(28), 'e');
    assert.deepStrictEqual(colorRoleForNote(33), 'a');
    assert.deepStrictEqual(colorRoleForNote(38), 'd');
    assert.deepStrictEqual(colorRoleForNote(43), 'g');
    assert.deepStrictEqual(colorRoleForNote(47), 'highB');
    assert.deepStrictEqual(colorRoleForNote(52), 'highE');
    assert.deepStrictEqual(colorRoleForNote(18), 'lowExt1');
    assert.deepStrictEqual(colorRoleForNote(13), 'lowExt2');
    assert.deepStrictEqual(colorRoleForNote(8), 'gray');
    assert.deepStrictEqual(colorRoleForNote(21), 'gray');
});

// isValidTuningStringsArray: string-count, MIDI-range, and parse-validity checks.
test('isValidTuningStringsArray', () => {
    assert.deepStrictEqual(isValidTuningStringsArray(DEFAULT_TARGET_TUNING), true);
    assert.deepStrictEqual(isValidTuningStringsArray(['E1', 'A1', 'D2', 'G2']), true);
    assert.deepStrictEqual(isValidTuningStringsArray(['C#0', 'F#0', 'B0', 'E1', 'A1', 'D2', 'G2', 'B2']), true);
    assert.deepStrictEqual(isValidTuningStringsArray(['A1', 'D2', 'G2']), false);
    assert.deepStrictEqual(isValidTuningStringsArray(['C#0', 'F#0', 'B0', 'E1', 'A1', 'D2', 'G2', 'B2', 'E3']), false);
    assert.deepStrictEqual(isValidTuningStringsArray(['C-1', 'E1', 'A1', 'D2', 'E5']), true);
    assert.deepStrictEqual(isValidTuningStringsArray(['C-2', 'E1', 'A1', 'D2']), false);
    assert.deepStrictEqual(isValidTuningStringsArray(['E1', 'A1', 'D2', 'F5']), false);
    assert.deepStrictEqual([MIN_TARGET_MIDI, MAX_TARGET_MIDI], [0, 76]);
    assert.deepStrictEqual(isValidTuningStringsArray(['B0', 'E1', 'garbage', 'D2', 'G2']), false);
    assert.deepStrictEqual(isValidTuningStringsArray(null), false);
    assert.deepStrictEqual(isValidTuningStringsArray('B0,E1,A1,D2,G2'), false);
});

// BUILTIN_PRESET_TUNINGS / DEFAULT_TUNING_ID / resolveActiveTuning: the
// built-in-preset resolution path screen.js's _crResolveActiveTuning
// delegates to wholesale.
test('BUILTIN_PRESET_TUNINGS / DEFAULT_TUNING_ID / resolveActiveTuning', () => {
    assert.deepStrictEqual(DEFAULT_TUNING_ID, 'eadg');
    assert.deepStrictEqual(DEFAULT_GUITAR_TUNING_ID, 'eadgbe');
    assert.deepStrictEqual({ strings: BUILTIN_PRESET_TUNINGS[0].strings, colors: BUILTIN_PRESET_TUNINGS[0].colors },
        { strings: DEFAULT_TARGET_TUNING.slice(1), colors: null });
    assert.deepStrictEqual({ strings: BUILTIN_PRESET_TUNINGS[1].strings, colors: BUILTIN_PRESET_TUNINGS[1].colors },
        { strings: DEFAULT_TARGET_TUNING, colors: null });
    const eadgbePreset = BUILTIN_PRESET_TUNINGS.find(p => p.id === 'eadgbe');
    assert.deepStrictEqual({ strings: eadgbePreset.strings, colors: eadgbePreset.colors, roles: eadgbePreset.roles },
        { strings: ['E2', 'A2', 'D3', 'G3', 'B3', 'E4'], colors: null, roles: ['e', 'a', 'd', 'g', 'highB', 'highE'] });
    assert.deepStrictEqual(resolveTargetTuning(eadgbePreset.strings).midiTuning, [40, 45, 50, 55, 59, 64]);
    const sevenPreset = BUILTIN_PRESET_TUNINGS.find(p => p.id === 'beadgbe');
    assert.deepStrictEqual({ midi: resolveTargetTuning(sevenPreset.strings).midiTuning, colors: sevenPreset.colors, roles: sevenPreset.roles },
        { midi: [35, 40, 45, 50, 55, 59, 64], colors: null, roles: ['lowB', 'e', 'a', 'd', 'g', 'highB', 'highE'] });
    const baritonePreset = BUILTIN_PRESET_TUNINGS.find(p => p.id === 'baritone_beadfsb');
    assert.deepStrictEqual({ midi: resolveTargetTuning(baritonePreset.strings).midiTuning, colors: baritonePreset.colors, roles: baritonePreset.roles },
        { midi: [35, 40, 45, 50, 54, 59], colors: null, roles: ['e', 'a', 'd', 'g', 'highB', 'highE'] });
    const violinPreset = BUILTIN_PRESET_TUNINGS.find(p => p.id === 'violin_gdae');
    assert.deepStrictEqual({ midi: resolveTargetTuning(violinPreset.strings).midiTuning, colors: violinPreset.colors, roles: violinPreset.roles },
        { midi: [55, 62, 69, 76], colors: ['#f18313', '#3fc413', '#ecd234', '#e61f26'], roles: undefined });
    const uprightPreset = BUILTIN_PRESET_TUNINGS.find(p => p.id === 'upright_solo_fsbea');
    assert.deepStrictEqual({ midi: resolveTargetTuning(uprightPreset.strings).midiTuning, colors: uprightPreset.colors, roles: uprightPreset.roles },
        { midi: [30, 35, 40, 45], colors: null, roles: ['e', 'a', 'd', 'g'] });
    const violaPreset = BUILTIN_PRESET_TUNINGS.find(p => p.id === 'viola_cgda');
    assert.deepStrictEqual({ midi: resolveTargetTuning(violaPreset.strings).midiTuning, colors: violaPreset.colors },
        { midi: [48, 55, 62, 69], colors: ['#cc00aa', '#f18313', '#3fc413', '#ecd234'] });
    const banjo4Preset = BUILTIN_PRESET_TUNINGS.find(p => p.id === 'banjo4_cgbd');
    assert.deepStrictEqual({ midi: resolveTargetTuning(banjo4Preset.strings).midiTuning, colors: banjo4Preset.colors },
        { midi: [48, 55, 59, 62], colors: ['#cc00aa', '#f18313', '#1096e6', '#3fc413'] });
    const banjo5Preset = BUILTIN_PRESET_TUNINGS.find(p => p.id === 'banjo5_gdgbd');
    assert.deepStrictEqual({ midi: resolveTargetTuning(banjo5Preset.strings).midiTuning, colors: banjo5Preset.colors },
        { midi: [67, 50, 55, 59, 62], colors: ['#f18313', '#3fc413', '#f18313', '#1096e6', '#3fc413'] });
    const mandolinPreset = BUILTIN_PRESET_TUNINGS.find(p => p.id === 'mandolin_ggddaaee');
    assert.deepStrictEqual({ midi: resolveTargetTuning(mandolinPreset.strings).midiTuning, colors: mandolinPreset.colors },
        {
            midi: [55, 55, 62, 62, 69, 69, 76, 76],
            colors: ['#f18313', '#f18313', '#3fc413', '#3fc413', '#ecd234', '#ecd234', '#e61f26', '#e61f26'],
        });
    assert.deepStrictEqual(mandolinPreset.strings.length, MAX_TARGET_STRING_COUNT);
    assert.deepStrictEqual(BUILTIN_PRESET_TUNINGS.filter(p => p.colors !== null).every(p => Array.isArray(p.colors) && p.colors.length === p.strings.length && isValidTuningStringsArray(p.strings)),
        true);
    assert.deepStrictEqual(BUILTIN_PRESET_TUNINGS.filter(p => p.colors === null).every(p => isValidTuningStringsArray(p.strings) && (p.roles === undefined || p.roles.length === p.strings.length)),
        true);

    // Every resolution also reports the RESOLVED id plus capo/capoEnabled/
    // octaveOffset (default off/0 unless the profile carries valid
    // values) — folded into the expected shapes below via this tiny helper.
    const adj = (id, shape) => Object.assign({ id, capo: 0, capoEnabled: false, octaveOffset: 0 }, shape);
    assert.deepStrictEqual(resolveActiveTuning(undefined, []), adj('eadg', { strings: DEFAULT_TARGET_TUNING.slice(1), colors: null, roles: null, maxFret: 20 }));
    assert.deepStrictEqual(resolveActiveTuning('eadg', []), adj('eadg', { strings: DEFAULT_TARGET_TUNING.slice(1), colors: null, roles: null, maxFret: 20 }));
    assert.deepStrictEqual(resolveActiveTuning('beadg', []), adj('beadg', { strings: DEFAULT_TARGET_TUNING, colors: null, roles: null, maxFret: 24 }));
    assert.deepStrictEqual(resolveActiveTuning('eadgbe', []),
        adj('eadgbe', { strings: ['E2', 'A2', 'D3', 'G3', 'B3', 'E4'], colors: null, roles: ['e', 'a', 'd', 'g', 'highB', 'highE'], maxFret: 24 }));
    assert.deepStrictEqual(resolveActiveTuning('cello_cgda', []),
        adj('cello_cgda', { strings: ['C2', 'G2', 'D3', 'A3'], colors: ['#cc00aa', '#f18313', '#3fc413', '#ecd234'], roles: null, maxFret: 24 }));
    assert.deepStrictEqual(resolveActiveTuning('custom_abc', [{ id: 'custom_abc', name: 'AEADG', strings: ['A0', 'E1', 'A1', 'D2', 'G2'], colors: ['#111111', '#222222', '#333333', '#444444', '#555555'] }]),
        adj('custom_abc', { strings: ['A0', 'E1', 'A1', 'D2', 'G2'], colors: ['#111111', '#222222', '#333333', '#444444', '#555555'], roles: null, maxFret: 20 }));
    assert.deepStrictEqual(resolveActiveTuning('custom_mf', [{ id: 'custom_mf', name: 'Custom24', strings: ['A0', 'E1', 'A1', 'D2', 'G2'], colors: ['#111111', '#222222', '#333333', '#444444', '#555555'], maxFret: 24 }]),
        adj('custom_mf', { strings: ['A0', 'E1', 'A1', 'D2', 'G2'], colors: ['#111111', '#222222', '#333333', '#444444', '#555555'], roles: null, maxFret: 24 }));
    assert.deepStrictEqual(resolveActiveTuning('custom_bad_mf', [{ id: 'custom_bad_mf', name: 'BadMF', strings: ['A0', 'E1', 'A1', 'D2', 'G2'], colors: ['#111111', '#222222', '#333333', '#444444', '#555555'], maxFret: 17 }]),
        adj('custom_bad_mf', { strings: ['A0', 'E1', 'A1', 'D2', 'G2'], colors: ['#111111', '#222222', '#333333', '#444444', '#555555'], roles: null, maxFret: 20 }));
    // Unknown/deleted ids fall back to the arrangement class's default
    // preset (EADG shape for bass, EADGBE for guitar classes) — changed
    // from the pre-guitar hardcoded BEADG-shape fallback (see HISTORY.md
    // Phase 12): the class default matches what a fresh install shows.
    assert.deepStrictEqual(resolveActiveTuning('stale_deleted_id', []), adj('eadg', { strings: DEFAULT_TARGET_TUNING.slice(1), colors: null, roles: null, maxFret: 20 }));
    assert.deepStrictEqual(resolveActiveTuning('stale_deleted_id', null), adj('eadg', { strings: DEFAULT_TARGET_TUNING.slice(1), colors: null, roles: null, maxFret: 20 }));
    assert.deepStrictEqual(resolveActiveTuning('stale_deleted_id', undefined), adj('eadg', { strings: DEFAULT_TARGET_TUNING.slice(1), colors: null, roles: null, maxFret: 20 }));
    assert.deepStrictEqual(resolveActiveTuning('stale_deleted_id', [], 'lead'),
        adj('eadgbe', { strings: ['E2', 'A2', 'D3', 'G3', 'B3', 'E4'], colors: null, roles: ['e', 'a', 'd', 'g', 'highB', 'highE'], maxFret: 24 }));
    assert.deepStrictEqual(resolveActiveTuning(undefined, [], 'rhythm'),
        adj('eadgbe', { strings: ['E2', 'A2', 'D3', 'G3', 'B3', 'E4'], colors: null, roles: ['e', 'a', 'd', 'g', 'highB', 'highE'], maxFret: 24 }));
    assert.deepStrictEqual(resolveActiveTuning('eadg', [], 'lead'), adj('eadg', { strings: DEFAULT_TARGET_TUNING.slice(1), colors: null, roles: null, maxFret: 20 }));
    assert.deepStrictEqual(resolveActiveTuning('cello_cgda', [{ id: 'cello_cgda', name: 'user override attempt', strings: ['E1', 'A1', 'D2', 'G2'], colors: ['#000', '#000', '#000', '#000'] }]),
        adj('cello_cgda', { strings: ['C2', 'G2', 'D3', 'A3'], colors: ['#cc00aa', '#f18313', '#3fc413', '#ecd234'], roles: null, maxFret: 24 }));

    assert.deepStrictEqual(MAX_FRET_OPTIONS, [12, 14, 20, 21, 22, 24]);
    assert.deepStrictEqual(MAX_FRET_OPTIONS.every(isValidMaxFret), true);
    assert.deepStrictEqual(isValidMaxFret(17), false);
    assert.deepStrictEqual(isValidMaxFret('20'), false);
    assert.deepStrictEqual(BUILTIN_PRESET_TUNINGS.every(p => isValidMaxFret(p.maxFret)), true);
    assert.deepStrictEqual(BUILTIN_PRESET_TUNINGS.find(p => p.id === 'eadg').maxFret, 20);
    assert.deepStrictEqual(BUILTIN_PRESET_TUNINGS.find(p => p.id === 'beadg').maxFret, 24);
    assert.deepStrictEqual(['eadgbe', 'beadgbe', 'baritone_beadfsb'].every(id => BUILTIN_PRESET_TUNINGS.find(p => p.id === id).maxFret === 24), true);
    assert.deepStrictEqual(['violin_gdae', 'mandolin_ggddaaee'].every(id => BUILTIN_PRESET_TUNINGS.find(p => p.id === id).maxFret === 14), true);
});

// defaultTuningIdForClass / arrangementClassFor: the per-class profile
// routing screen.js's _crProfileKeyFor/_crArrClass tracking delegates to.
test('defaultTuningIdForClass / arrangementClassFor', () => {
    assert.deepStrictEqual(defaultTuningIdForClass('bass'), 'eadg');
    assert.deepStrictEqual(defaultTuningIdForClass('rhythm'), 'eadgbe');
    assert.deepStrictEqual(defaultTuningIdForClass('lead'), 'eadgbe');

    assert.deepStrictEqual(arrangementClassFor('Bass'), 'bass');
    assert.deepStrictEqual(arrangementClassFor('Bass 2'), 'bass');
    assert.deepStrictEqual(arrangementClassFor('Lead'), 'lead');
    assert.deepStrictEqual(arrangementClassFor('Rhythm'), 'rhythm');
    assert.deepStrictEqual(arrangementClassFor('Combo'), 'rhythm');
    assert.deepStrictEqual(arrangementClassFor('Guitar 22'), 'rhythm');
    assert.deepStrictEqual(arrangementClassFor('Lead Bass'), 'bass');
    assert.deepStrictEqual(arrangementClassFor('BasslineKeys'), 'rhythm');
    assert.deepStrictEqual(arrangementClassFor('LEAD'), 'lead');
    assert.deepStrictEqual(arrangementClassFor(''), 'bass');
    assert.deepStrictEqual(arrangementClassFor('   '), 'bass');
    assert.deepStrictEqual(arrangementClassFor(undefined), 'bass');
    assert.deepStrictEqual(arrangementClassFor(42), 'bass');
});

// First-time install: no stored active-tuning overlay and no per-class
// profile id for any arrangement class. Confirms the full chain lands on
// a real, playable builtin default (not null/undefined/a crash) for
// every class, with capo off and no octave shift, exactly what a
// brand-new user sees with zero prior localStorage state.
test('first-time install resolves a real, playable builtin default', (t) => {
    const { parseActiveTuning } = CR;
    assert.deepStrictEqual(parseActiveTuning(undefined), null);
    for (const [cls, expectedId] of [['bass', 'eadg'], ['rhythm', 'eadgbe'], ['lead', 'eadgbe']]) {
        t.test(`class=${cls}`, () => {
            const resolved = resolveActiveTuning(undefined, [], cls);
            assert.deepStrictEqual({ id: resolved.id, capo: resolved.capo, capoEnabled: resolved.capoEnabled, octaveOffset: resolved.octaveOffset },
                { id: expectedId, capo: 0, capoEnabled: false, octaveOffset: 0 });
            assert.deepStrictEqual(BUILTIN_PRESET_TUNINGS.some(p => p.id === resolved.id), true);
        });
    }
});

// intToHex / resolveColorsArray: plain data-shape transforms.
test('intToHex / resolveColorsArray', () => {
    assert.deepStrictEqual(intToHex(0xe61f26), '#e61f26');
    assert.deepStrictEqual(intToHex(0x1), '#000001');
    assert.deepStrictEqual(LIGHT_GRAY_COLOR, 0xd3d3d3);

    const defaults = ['#111111', '#222222', '#333333', '#444444', '#555555'];
    assert.deepStrictEqual(resolveColorsArray(undefined, 5, defaults), defaults);
    assert.deepStrictEqual(resolveColorsArray(null, 5, defaults), defaults);
    assert.deepStrictEqual(resolveColorsArray(['#abcdef', 'not-a-hex', undefined], 5, defaults),
        ['#abcdef', '#222222', '#333333', '#444444', '#555555']);
    assert.deepStrictEqual(resolveColorsArray(['#abcdef'], 5, defaults),
        ['#abcdef', '#222222', '#333333', '#444444', '#555555']);
    assert.deepStrictEqual(resolveColorsArray(['#111111', '#222222', '#333333', '#444444', '#555555', '#666666'], 5, defaults),
        defaults);
});

// lowBColor: no localStorage override available in this (Node) environment,
// so it always falls through to the documented default.
test('lowBColor falls back to the default outside a browser', () => {
    assert.deepStrictEqual(lowBColor(), 0xcc00aa);
});

// Unplayable-low-note-drop regression: EADG target (4-string, B removed)
// must silently drop notes below open E1, not cascade or crash.
test('unplayable-low-note-drop regression on EADG target', () => {
    assert.deepStrictEqual(EADG.midiTuning, [28, 33, 38, 43]);

    assert.deepStrictEqual(remapNote(27, 0, 0, EADG.midiTuning), null);
    assert.deepStrictEqual(resolveTargetForFret(27, 0, 0, EADG.midiTuning), null);
    assert.deepStrictEqual(remapNote(28, 0, 0, EADG.midiTuning), { s: 0, f: 0 });

    // End-to-end via createRetuner, same path screen.js's draw() uses.
    const { createRetuner } = CR;
    const retuner = createRetuner();
    const rawNotes = [{ t: 0, s: 0, f: 0 }, { t: 1, s: 1, f: 0 }];
    const bundle = makeBundle({ notes: rawNotes, tuning: [0, 0, 0, 0, 0] });
    retuner.apply(bundle);
    assert.deepStrictEqual(bundle.notes.length, 2);

    bundle.notes = rawNotes;
    retuner.apply(bundle, EADG.midiTuning);
    assert.deepStrictEqual(bundle.notes.map(n => ({ s: n.s, f: n.f })), [{ s: 0, f: 0 }]);
});

// 6-string target (BEADG + a high string) — every remap function must
// bound itself against the target's actual length, dynamically rather
// than a stale fixed 5.
test('6-string target (BEADG + a high string)', (t) => {
    const sixString = resolveTargetTuning(['B0', 'E1', 'A1', 'D2', 'G2', 'B2']);
    assert.deepStrictEqual(sixString.midiTuning, [23, 28, 33, 38, 43, 47]);
    assert.deepStrictEqual(sixString.labels, ['B', 'E', 'A', 'D', 'G', 'B']);

    const shiftK = computeArrangementShift(6, null, 0, sixString.midiTuning, sixString.midiTuning);
    assert.deepStrictEqual(shiftK, 0);
    for (let s = 0; s < 6; s++) {
        for (const f of SPOT_FRETS) {
            t.test(`s=${s} f=${f}`, () => {
                assert.deepStrictEqual(remapNote(sixString.midiTuning[s], s, f, sixString.midiTuning), { s, f });
            });
        }
    }

    assert.deepStrictEqual(remapNote(sixString.midiTuning[5], 5, 21, sixString.midiTuning), null);
});

// remapChordTemplate at a non-5 target length.
test('remapChordTemplate at a non-5 target length', () => {
    const sourceOpenMidiByString = [28, 33, 38, 43];
    const naturalTargetByString = [0, 1, 2, 3];
    const template4 = { frets: [3, -1, -1, 2], fingers: [1, -1, -1, 4] };
    const remapped4 = remapChordTemplate(sourceOpenMidiByString, naturalTargetByString, template4, EADG.midiTuning);
    assert.deepStrictEqual(remapped4.frets.length, 4);
    assert.deepStrictEqual(remapped4.fingers.length, 4);
    assert.deepStrictEqual(remapped4.frets, [3, -1, -1, 2]);

    const sixString = resolveTargetTuning(['B0', 'E1', 'A1', 'D2', 'G2', 'B2']);
    const template6 = { frets: [-1, -1, -1, -1, -1, 5], fingers: [-1, -1, -1, -1, -1, 3] };
    const remapped6 = remapChordTemplate([23, 28, 33, 38, 43, 47], [0, 1, 2, 3, 4, 5], template6, sixString.midiTuning);
    assert.deepStrictEqual(remapped6.frets.length, 6);
    assert.deepStrictEqual(remapped6.frets, [-1, -1, -1, -1, -1, 5]);
});

// ── Capo & octave offset ────────────────────────────────────────────

// Validation helpers.
test('validation helpers', () => {
    assert.deepStrictEqual(isValidCapo(0, 20), true);
    assert.deepStrictEqual(isValidCapo(19, 20), true);
    assert.deepStrictEqual(isValidCapo(20, 20), false);
    assert.deepStrictEqual(isValidCapo(-1, 20), false);
    assert.deepStrictEqual(isValidCapo(1.5, 20), false);
    assert.deepStrictEqual(resolveCapo(25, 20), 0);
    assert.deepStrictEqual(resolveCapo(4, 20), 4);
    assert.deepStrictEqual([resolveCapoEnabled(true), resolveCapoEnabled(false), resolveCapoEnabled(undefined), resolveCapoEnabled('true'), resolveCapoEnabled(1)],
        [true, false, false, false, false]);
    assert.deepStrictEqual([MIN_OCTAVE_OFFSET, MAX_OCTAVE_OFFSET], [-2, 2]);
    assert.deepStrictEqual([isValidOctaveOffset(-2), isValidOctaveOffset(2), isValidOctaveOffset(0), isValidOctaveOffset(3), isValidOctaveOffset(-3), isValidOctaveOffset(0.5)],
        [true, true, true, false, false, false]);
    assert.deepStrictEqual(resolveOctaveOffset(9), 0);
    assert.deepStrictEqual(effectiveTargetMidiTuning([28, 33, 38, 43], 2, 1), [18, 23, 28, 33]);
    assert.deepStrictEqual(effectiveMaxFret(20, 3), 17);
    assert.deepStrictEqual(effectiveMaxFret(20, 25), 1);
});

// resolveRetunerCapoOctaveFields: the shared { capo, capoEnabled,
// octaveOffset } resolver every resolved-profile builder (resolveActiveTuning's
// two branches, parseActiveTuning, screen.js's save/seed paths) delegates to.
test('resolveRetunerCapoOctaveFields', () => {
    assert.deepStrictEqual(resolveRetunerCapoOctaveFields({ capo: 4, capoEnabled: true, octaveOffset: 1 }, 20),
        { capo: 4, capoEnabled: true, octaveOffset: 1 });
    assert.deepStrictEqual(resolveRetunerCapoOctaveFields({ capo: 25, capoEnabled: 'yes', octaveOffset: 9 }, 20),
        { capo: 0, capoEnabled: false, octaveOffset: 0 });
    assert.deepStrictEqual(resolveRetunerCapoOctaveFields({}, 20),
        { capo: 0, capoEnabled: false, octaveOffset: 0 });
    assert.deepStrictEqual(resolveRetunerCapoOctaveFields({ capo: 13 }, 14),
        { capo: 13, capoEnabled: false, octaveOffset: 0 });
});

// applyRetunerCapoOctaveOverride: the shared per-tuning quick-adjust merge
// screen.js's player-controls widget and settings.html's editor both apply
// on top of an already-resolved profile.
test('applyRetunerCapoOctaveOverride', () => {
    const baseProfile = () => ({ id: 'eadgbe', maxFret: 24, capo: 0, capoEnabled: false, octaveOffset: 0 });
    assert.deepStrictEqual(applyRetunerCapoOctaveOverride(baseProfile(), { capo: 3, capoEnabled: true, octave: -1 }),
        { id: 'eadgbe', maxFret: 24, capo: 3, capoEnabled: true, octaveOffset: -1 });
    assert.deepStrictEqual([applyRetunerCapoOctaveOverride(baseProfile(), null), applyRetunerCapoOctaveOverride(baseProfile(), 'nope')],
        [baseProfile(), baseProfile()]);
    assert.deepStrictEqual(applyRetunerCapoOctaveOverride(baseProfile(), { capo: 24, capoEnabled: true, octave: 1 }),
        { id: 'eadgbe', maxFret: 24, capo: 0, capoEnabled: true, octaveOffset: 1 });
    assert.deepStrictEqual(applyRetunerCapoOctaveOverride(baseProfile(), { capo: 2, capoEnabled: 'yes', octave: 0 }),
        { id: 'eadgbe', maxFret: 24, capo: 2, capoEnabled: false, octaveOffset: 0 });
    assert.deepStrictEqual(applyRetunerCapoOctaveOverride(baseProfile(), { capo: 0, capoEnabled: false, octave: 9 }),
        baseProfile());
    assert.deepStrictEqual((() => {
        const p = baseProfile();
        return applyRetunerCapoOctaveOverride(p, { capo: 5, capoEnabled: true, octave: 2 }) === p;
    })(), true);
});

// Capo cancellation identity: tuning every string down k half-steps and
// clamping a capo at fret k is a cumulative offset of 0 on the internal,
// pre-display-shift matching math — the CAPO-RELATIVE remap must equal the
// un-capo'd original exactly (for charts that fit the capo-shortened neck),
// for k = 1..4. Deliberately omits displayFretOffset (screen.js always
// passes it as the retuner capo, =k here) — this test verifies the
// underlying pitch matching is exact, not the final on-screen fret, which
// now shifts by +k
// per the "always show the true physical fret" fix (see the
// displayFretOffset tests below for that layer).
test('capo cancellation identity for k = 1..4', (t) => {
    const { createRetuner } = CR;
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
            assert.deepStrictEqual(effectiveTargetMidiTuning(downTuned, k, 0), EADG.midiTuning);
            const bundle = mkBundle();
            createRetuner().apply(bundle, effectiveTargetMidiTuning(downTuned, k, 0), effectiveMaxFret(20, k));
            assert.deepStrictEqual(bundle.notes.map(n => ({ s: n.s, f: n.f })), expectedNotes);
            assert.deepStrictEqual(bundle.chords[0].notes.map(n => ({ s: n.s, f: n.f })), expectedChord);
        });
    }
});

// Chart capo only raises notes at or below its own fret; already-fretted notes are untouched.
test('a chart\'s own native capo only raises notes at or below its fret', () => {
    const { createRetuner } = CR;
    const rawNotes = [
        { t: 0, s: 0, f: 0 },  // open low E — capo clamps it up to fret 2
        { t: 1, s: 1, f: 2 },  // exactly at the capo's own fret — same result
        { t: 2, s: 2, f: 2 },
    ];
    const rawChords = [{ id: null, t: 3, notes: [{ t: 3, s: 3, f: 0 }, { t: 3, s: 4, f: 1 }] }]; // f=1 < capo: physically only reachable via the capo itself
    const rawAnchors = [{ time: 0, fret: 0, width: 3 }];
    const bundle = makeBundle({
        notes: rawNotes.map(n => ({ ...n })),
        chords: cloneChords(rawChords),
        anchors: cloneAnchors(rawAnchors),
        tuning: [0, 0, 0, 0, 0, 0], capo: 2,
    });
    createRetuner().apply(bundle, EADGBE.midiTuning, 24);
    assert.deepStrictEqual(bundle.notes.map(n => ({ s: n.s, f: n.f })), [{ s: 0, f: 2 }, { s: 1, f: 2 }, { s: 2, f: 2 }]);
    assert.deepStrictEqual(bundle.chords[0].notes.map(n => ({ s: n.s, f: n.f })), [{ s: 3, f: 2 }, { s: 4, f: 2 }]);
    // No note needs a finger, so remapAnchors falls back to the nearest note's own change.
    assert.deepStrictEqual(bundle.anchors, [{ time: 0, fret: 2, width: 3 }]);
});

// Anchor donors include chord notes, not just standalone ones — a
// chord-only passage must still retune its anchor. End-to-end via
// createRetuner, the same path screen.js's _transform() uses.
test('anchor donors include chord notes', () => {
    const { createRetuner } = CR;
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
    const { createRetuner } = CR;
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

// Octave-offset identity: an E-standard bass chart with a +1 octave
// offset lands on a standard guitar's lowest four strings (E2 A2 D3 G3)
// note-for-note; the reverse (-1 octave) puts a guitar chart's low-four-
// string notes back on the bass unchanged.
test('octave-offset identity', () => {
    const { createRetuner } = CR;

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
    createRetuner().apply(onGuitar, effectiveTargetMidiTuning(EADGBE.midiTuning, 0, 1), effectiveMaxFret(24, 0));
    assert.deepStrictEqual(onGuitar.notes.map(n => ({ s: n.s, f: n.f })), bassExpected);

    const guitarNotes = [
        { t: 0, s: 0, f: 3 }, { t: 1, s: 1, f: 0 },
        { t: 2, s: 2, f: 9 }, { t: 3, s: 3, f: 14 },
    ];
    const onBassDown = makeBundle({ notes: guitarNotes, tuning: [0, 0, 0, 0, 0, 0] });
    createRetuner().apply(onBassDown, effectiveTargetMidiTuning(EADG.midiTuning, 0, -1), effectiveMaxFret(20, 0));
    assert.deepStrictEqual(onBassDown.notes.map(n => ({ s: n.s, f: n.f })), guitarNotes.map(n => ({ s: n.s, f: n.f })));
});

// resolveActiveTuning: resolved id + capo/octaveOffset fields, and the
// ukulele presets.
test('resolveActiveTuning: capo/octaveOffset fields and ukulele presets', () => {
    const t = resolveActiveTuning('eadgbe', []);
    assert.deepStrictEqual(t.id, 'eadgbe');
    assert.deepStrictEqual([t.capo, t.capoEnabled, t.octaveOffset], [0, false, 0]);

    const uke = resolveActiveTuning('ukulele_gcea', []);
    assert.deepStrictEqual(uke.strings, ['G4', 'C4', 'E4', 'A4']);
    assert.deepStrictEqual(uke.maxFret, 12);
    const bari = resolveActiveTuning('baritone_uke_dgbe', []);
    assert.deepStrictEqual(bari.strings, ['D3', 'G3', 'B3', 'E4']);

    const customs = [
        { id: 'c1', name: 'Octave cello', strings: ['C2', 'G2', 'D3', 'A3'], colors: ['#111111', '#222222', '#333333', '#444444'], maxFret: 24, capo: 2, capoEnabled: true, octaveOffset: 1 },
        { id: 'c2', name: 'Bad adjust', strings: ['C2', 'G2', 'D3', 'A3'], colors: ['#111111', '#222222', '#333333', '#444444'], maxFret: 12, capo: 20, capoEnabled: 'yes', octaveOffset: 9 },
    ];
    const c1 = resolveActiveTuning('c1', customs);
    assert.deepStrictEqual([c1.id, c1.capo, c1.capoEnabled, c1.octaveOffset], ['c1', 2, true, 1]);
    const c2 = resolveActiveTuning('c2', customs);
    assert.deepStrictEqual([c2.capo, c2.capoEnabled, c2.octaveOffset], [0, false, 0]);
    const fb = resolveActiveTuning('nonexistent', [], 'bass');
    assert.deepStrictEqual(fb.id, 'eadg');

    // Reentrant uke target sanity: non-monotonic (high-G drone at index
    // 0) flows through the same pitch-ordered walk banjo5 exercised.
    const ukeTarget = resolveTargetTuning(uke.strings);
    assert.deepStrictEqual(ukeTarget.midiTuning, [67, 60, 64, 69]);
    assert.deepStrictEqual(remapNote(59, 1, 0, ukeTarget.midiTuning, 12), null);
    assert.deepStrictEqual(remapNote(60, 1, 0, ukeTarget.midiTuning, 12), { s: 1, f: 0 });
});

// ---- Pathological-chart safety valves (createRetuner) -----------------
// The cold remap is synchronous and bounded: a per-group solver node
// budget (maxSearchNodes), an oversize-group cutoff
// (MAX_SOLVER_GROUP_SIZE), and a whole-remap deadline (maxTotalSolveMs)
// past which the remaining groups take the per-note path.

// Helper: a fresh bundle over shared raw arrays.
function mkBundle(raw) {
    return {
        notes: raw.notes, chords: raw.chords, anchors: raw.anchors,
        chordTemplates: raw.templates,
        tuning: raw.tuning, capo: raw.capo | 0, stringCount: raw.sc,
    };
}

// Solver node-budget abort inside createRetuner: the group degrades to
// the per-note path (notes still render) instead of dropping, and the
// abort is counted. Default budget: same chart, no aborts.
test('solver node-budget abort degrades to the per-note path', (t) => {
    const { createRetuner } = CR;
    // Eb-standard open-heavy chord onto EADG: the exact per-note remap
    // drops the low open Eb (below the target's range), so the solver
    // search must run — then a 10-node budget aborts it immediately.
    const raw = {
        notes: [
            { t: 0, s: 0, f: 0 }, { t: 0, s: 1, f: 0 }, { t: 0, s: 2, f: 1 }, { t: 0, s: 3, f: 3 },
        ],
        chords: [], anchors: [], templates: [], tuning: [-1, -1, -1, -1], capo: 0, sc: 4,
    };
    const eadg = DEFAULT_TARGET_MIDI_TUNING.slice(1); // E1 A1 D2 G2

    const capped = createRetuner({ maxSearchNodes: 10 });
    const cappedBundle = mkBundle(raw);
    capped.apply(cappedBundle, eadg);
    assert.ok(capped.getStats().searchAborts >= 1, 'node cap aborted the search');
    assert.ok(cappedBundle.notes.length >= 1,
        'aborted group degrades to the per-note path instead of dropping');
    // The per-note fallback keeps exact pitches: every survivor sounds
    // its source pitch (open midi + fret identical across the remap).
    for (const n of cappedBundle.notes) {
        t.test(`survivor origS=${n.origNote.s} origF=${n.origNote.f}`, () => {
            const srcMidi = raw.tuning[n.origNote.s] + [28, 33, 38, 43][n.origNote.s] + n.origNote.f;
            assert.deepStrictEqual(eadg[n.s] + n.f, srcMidi);
        });
    }

    const uncapped = createRetuner();
    const uncappedBundle = mkBundle(raw);
    uncapped.apply(uncappedBundle, eadg);
    assert.deepStrictEqual(uncapped.getStats().searchAborts, 0);
    assert.ok(uncappedBundle.notes.length >= cappedBundle.notes.length,
        'unbounded solve places at least as many notes');

    // maxSearchNodes: 0 is a valid, explicit "immediate-abort" configuration
    // (per-note fallback for every group) — it must be honored as this
    // exact value, distinct from "unset" — a naive `|| MAX_SEARCH_NODES`
    // on the node count would collapse the two (0 is falsy) and silently
    // substitute the default budget instead.
    const zeroBudget = createRetuner({ maxSearchNodes: 0 });
    const zeroBundle = mkBundle(raw);
    zeroBudget.apply(zeroBundle, eadg);
    assert.deepStrictEqual(zeroBudget.getStats().searchAborts, 1);
    assert.deepStrictEqual(zeroBundle.notes, cappedBundle.notes);
});

// Oversized simultaneous-note groups (data corruption, e.g. a broken GP
// export stacking a bar on one timestamp) skip the solver entirely.
test('oversized simultaneous-note groups skip the solver', () => {
    const { createRetuner, MAX_SOLVER_GROUP_SIZE } = CR;
    assert.deepStrictEqual(MAX_SOLVER_GROUP_SIZE >= 8, true);
    const notes = [];
    for (let i = 0; i < MAX_SOLVER_GROUP_SIZE + 3; i++) {
        notes.push({ t: 0, s: i % 4, f: i });
    }
    const raw = { notes, chords: [], anchors: [], templates: [], tuning: [0, 0, 0, 0], capo: 0, sc: 4 };
    const retuner = createRetuner();
    const bundle = mkBundle(raw);
    retuner.apply(bundle);
    assert.deepStrictEqual(retuner.getStats().oversizeGroups, 1);
    assert.ok(bundle.notes.length >= 1 && bundle.notes.length <= 5,
        'oversize group resolves via per-note collision path');
    assert.deepStrictEqual(retuner.getStats().searchAborts, 0);
});

// Whole-remap deadline: past maxTotalSolveMs of work, the solver is
// disabled for the remaining groups — the remap still completes in the
// same apply() call and every group still materializes.
test('whole-remap deadline disables the solver for remaining groups', (t) => {
    const { createRetuner } = CR;
    const notes = [];
    for (let i = 0; i < 6; i++) {
        notes.push({ t: i, s: 0, f: i + 1 }, { t: i, s: 1, f: i + 2 });
    }
    const raw = { notes, chords: [], anchors: [], templates: [], tuning: [0, 0, 0, 0], capo: 0, sc: 4 };
    // maxTotalSolveMs: -1 -> the deadline is already past at the first
    // between-groups check, so every group takes the per-note path.
    const retuner = createRetuner({ maxTotalSolveMs: -1 });
    const bundle = mkBundle(raw);
    retuner.apply(bundle);
    assert.deepStrictEqual(retuner.getStats().solverDisabled, true);
    assert.deepStrictEqual(bundle.notes.length, notes.length);
    assert.deepStrictEqual(Object.keys(retuner.getStats()).sort(),
        ['oversizeGroups', 'searchAborts', 'solverDisabled', 'workMs']);
    // Identity chart on the default target: the per-note fallback maps
    // EADG onto BEADG's top four strings — same frets, string + 1 — so
    // the degraded output is still exactly right here.
    for (let i = 0; i < notes.length; i++) {
        t.test(`note i=${i}`, () => {
            assert.deepStrictEqual({ s: bundle.notes[i].s, f: bundle.notes[i].f },
                { s: notes[i].s + 1, f: notes[i].f });
        });
    }
});

// ---- Anchor-donor refinement after revoicing (PLANNING #2) ------------
// A revoiced donor can carry an octave-sized fret adjustment; remapAnchors
// prefers the first exact donor within ANCHOR_DONOR_WINDOW_S past the
// anchor, falling back to the revoiced adjustment only when no exact
// donor is nearby.
test('remapAnchors prefers a nearby exact donor over a revoiced one', () => {
    const { remapAnchors, ANCHOR_DONOR_WINDOW_S } = CR;
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
    const { createRetuner } = CR;
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
    const nearBundle = mkBundle(nearRaw);
    near.apply(nearBundle, eadg);
    const bucketNotes = nearBundle.notes.filter(n => n.t === 0);
    assert.ok(bucketNotes.length >= 1, 'revoiced bucket has at least one note');
    assert.ok(bucketNotes.every(n => n.crRevoiced === true), 'revoiced bucket notes are tagged');
    assert.deepStrictEqual(nearBundle.notes.find(n => n.t === 0.6).crRevoiced, false);
    assert.deepStrictEqual(nearBundle.anchors, [{ time: 0, fret: 1, width: 4 }]);

    // Same chart with the exact note pushed past the window: the anchor
    // falls back to the first revoiced donor's own adjustment.
    const far = createRetuner();
    const farRaw = mkRaw(30);
    const farBundle = mkBundle(farRaw);
    far.apply(farBundle, eadg);
    const donor = farBundle.notes[0]; // first (time-sorted) fretted note at t=0
    const expected = Math.max(0, Math.min(20, 1 + donor.f - donor.origNote.f));
    assert.deepStrictEqual(farBundle.anchors, [{ time: 0, fret: expected, width: 4 }]);
    assert.notStrictEqual(expected, 1, 'fallback case actually differs from the exact adjustment');
});
