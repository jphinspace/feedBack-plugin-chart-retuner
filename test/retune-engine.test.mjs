// Standalone Node verification for stage 4 (note/chord remap onto the
// target tuning, consuming stage 3's octave-shifted source pitches and
// stage 2's capo'd target via chord-solver). Imports each dependency from
// its defining module so the restructured boundaries are covered. Run with `node
// test/retune-engine.test.mjs`.
//
// Stage 1 (target-tuning.test.mjs), stage 2 (target-capo.test.mjs),
// stage 3 (source-tuning.test.mjs), and stage 5 (note-anchors.test.mjs)
// live in their own files.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
    BEADG_TARGET_MIDI_TUNING,
    DEFAULT_TARGET_MIDI_TUNING,
    resolveTargetTuning,
} from '../src/target-tuning.js';
import { computeOpenStringMidiByString } from '../src/source-tuning.js';
import { remapAnchors } from '../src/note-anchors.js';
import {
    computeArrangementShift,
    resolveTargetForFret,
    remapNote,
    remapSlide,
    remapSlideCandidates,
    resolveChordCollisions,
    remapChordTemplate,
    reduceHandTravel,
    createRetuner,
    MAX_SOLVER_GROUP_SIZE,
    HAND_JUMP_FRET_THRESHOLD,
    HAND_JUMP_TIME_WINDOW_S,
    HAND_JUMP_MIN_IMPROVEMENT,
} from '../src/retune-engine.js';
import { songContext, SPOT_FRETS, EADG, EADGBE, makeBundle, bundleFromRaw, cloneChords, cloneAnchors } from './helpers.mjs';

// Drop-D, full chart. tuning = [-2,0,0,0], capo = 0.
test('Drop-D arrangement shift and dropped-string cascade', (t) => {
    const ctx = songContext(4, [-2, 0, 0, 0], 0, BEADG_TARGET_MIDI_TUNING);
    assert.deepStrictEqual(ctx.k, 1);
    for (const f of SPOT_FRETS) {
        t.test(`A string f=${f}`, () => {
            assert.deepStrictEqual(remapNote(ctx.sourceOpenMidiByString[1], ctx.naturalTargetByString[1], f, BEADG_TARGET_MIDI_TUNING), { s: 2, f });
        });
        t.test(`D string f=${f}`, () => {
            assert.deepStrictEqual(remapNote(ctx.sourceOpenMidiByString[2], ctx.naturalTargetByString[2], f, BEADG_TARGET_MIDI_TUNING), { s: 3, f });
        });
        t.test(`G string f=${f}`, () => {
            assert.deepStrictEqual(remapNote(ctx.sourceOpenMidiByString[3], ctx.naturalTargetByString[3], f, BEADG_TARGET_MIDI_TUNING), { s: 4, f });
        });
    }
    const midi0 = ctx.sourceOpenMidiByString[0], nat0 = ctx.naturalTargetByString[0];
    assert.deepStrictEqual(remapNote(midi0, nat0, 0, BEADG_TARGET_MIDI_TUNING), { s: 0, f: 3 });
    assert.deepStrictEqual(remapNote(midi0, nat0, 1, BEADG_TARGET_MIDI_TUNING), { s: 0, f: 4 });
    assert.deepStrictEqual(remapNote(midi0, nat0, 2, BEADG_TARGET_MIDI_TUNING), { s: 1, f: 0 });
    for (const f of [10, 20]) {
        t.test(`dropped string f=${f}`, () => {
            assert.deepStrictEqual(remapNote(midi0, nat0, f, BEADG_TARGET_MIDI_TUNING), { s: 1, f: f - 2 });
        });
    }
});

// Drop C#: open strings low-to-high C#, G#, C#, F# (tuning = [-3,-1,-1,-1]).
// Every string carries a nonzero adjustment, so every string cascades near
// the bottom of its range before settling on its own natural target.
test('Drop C# arrangement shift and per-string cascade', (t) => {
    const ctx = songContext(4, [-3, -1, -1, -1], 0, BEADG_TARGET_MIDI_TUNING);
    assert.deepStrictEqual(ctx.k, 1);

    const [midi0, midi1, midi2, midi3] = ctx.sourceOpenMidiByString;
    const [nat0, nat1, nat2, nat3] = ctx.naturalTargetByString;

    assert.deepStrictEqual(remapNote(midi0, nat0, 0, BEADG_TARGET_MIDI_TUNING), { s: 0, f: 2 });
    assert.deepStrictEqual(remapNote(midi0, nat0, 1, BEADG_TARGET_MIDI_TUNING), { s: 0, f: 3 });
    assert.deepStrictEqual(remapNote(midi0, nat0, 2, BEADG_TARGET_MIDI_TUNING), { s: 0, f: 4 });
    assert.deepStrictEqual(remapNote(midi0, nat0, 3, BEADG_TARGET_MIDI_TUNING), { s: 1, f: 0 });
    for (const f of [10, 20]) {
        t.test(`string0 f=${f} stays on its natural (E) target`, () => {
            assert.deepStrictEqual(remapNote(midi0, nat0, f, BEADG_TARGET_MIDI_TUNING), { s: 1, f: f - 3 });
        });
    }

    assert.deepStrictEqual(remapNote(midi1, nat1, 0, BEADG_TARGET_MIDI_TUNING), { s: 1, f: 4 });
    assert.deepStrictEqual(remapNote(midi1, nat1, 1, BEADG_TARGET_MIDI_TUNING), { s: 2, f: 0 });
    for (const f of [10, 20]) {
        t.test(`string1 f=${f} stays on its natural (A) target`, () => {
            assert.deepStrictEqual(remapNote(midi1, nat1, f, BEADG_TARGET_MIDI_TUNING), { s: 2, f: f - 1 });
        });
    }

    assert.deepStrictEqual(remapNote(midi2, nat2, 0, BEADG_TARGET_MIDI_TUNING), { s: 2, f: 4 });
    assert.deepStrictEqual(remapNote(midi2, nat2, 1, BEADG_TARGET_MIDI_TUNING), { s: 3, f: 0 });
    for (const f of [10, 20]) {
        t.test(`string2 f=${f} stays on its natural (D) target`, () => {
            assert.deepStrictEqual(remapNote(midi2, nat2, f, BEADG_TARGET_MIDI_TUNING), { s: 3, f: f - 1 });
        });
    }

    assert.deepStrictEqual(remapNote(midi3, nat3, 0, BEADG_TARGET_MIDI_TUNING), { s: 3, f: 4 });
    assert.deepStrictEqual(remapNote(midi3, nat3, 1, BEADG_TARGET_MIDI_TUNING), { s: 4, f: 0 });
    for (const f of [10, 20]) {
        t.test(`string3 f=${f} stays on its natural (G) target`, () => {
            assert.deepStrictEqual(remapNote(midi3, nat3, f, BEADG_TARGET_MIDI_TUNING), { s: 4, f: f - 1 });
        });
    }
});

// EADG chart onto BEADG: every note shifts string index +1, fret unchanged.
test('EADG onto explicit BEADG', (t) => {
    const ctx = songContext(4, [0, 0, 0, 0], 0, BEADG_TARGET_MIDI_TUNING);
    assert.deepStrictEqual(ctx.k, 1);
    for (let s = 0; s < 4; s++) {
        for (const f of SPOT_FRETS) {
            t.test(`s=${s} f=${f}`, () => {
                assert.deepStrictEqual(remapNote(ctx.sourceOpenMidiByString[s], ctx.naturalTargetByString[s], f, BEADG_TARGET_MIDI_TUNING), { s: s + 1, f });
            });
        }
    }
});

// BEAD identity: completely unchanged.
test('BEAD identity', (t) => {
    const ctx = songContext(4, [-5, -5, -5, -5], 0, BEADG_TARGET_MIDI_TUNING);
    assert.deepStrictEqual(ctx.k, 0);
    for (let s = 0; s < 4; s++) {
        for (const f of SPOT_FRETS) {
            t.test(`s=${s} f=${f}`, () => {
                assert.deepStrictEqual(remapNote(ctx.sourceOpenMidiByString[s], ctx.naturalTargetByString[s], f, BEADG_TARGET_MIDI_TUNING), { s, f });
            });
        }
    }
});

// Already-BEADG identity.
test('Already-BEADG identity', (t) => {
    const ctx = songContext(5, [0, 0, 0, 0, 0], 0, BEADG_TARGET_MIDI_TUNING);
    assert.deepStrictEqual(ctx.k, 0);
    for (let s = 0; s < 5; s++) {
        for (const f of SPOT_FRETS) {
            t.test(`s=${s} f=${f}`, () => {
                assert.deepStrictEqual(remapNote(ctx.sourceOpenMidiByString[s], ctx.naturalTargetByString[s], f, BEADG_TARGET_MIDI_TUNING), { s, f });
            });
        }
    }
});

// Out-of-range drop.
test('out-of-range notes drop', () => {
    assert.deepStrictEqual(remapNote(22, 0, 0), null);
    assert.deepStrictEqual(remapNote(43, 4, 25), null);
});

test('omitted engine target defaults to EADG', () => {
    assert.deepStrictEqual(DEFAULT_TARGET_MIDI_TUNING, [28, 33, 38, 43]);
    const ctx = songContext(4, [0, 0, 0, 0], 0);
    assert.deepStrictEqual(ctx.k, 0);
    assert.deepStrictEqual(remapNote(ctx.sourceOpenMidiByString[0], ctx.naturalTargetByString[0], 0), { s: 0, f: 0 });
    assert.deepStrictEqual(remapNote(ctx.sourceOpenMidiByString[3], ctx.naturalTargetByString[3], 20), { s: 3, f: 20 });
});

// Non-monotonic targets (banjo5_gdgbd puts the HIGH G4 drone at index 0):
// the walk moves in PITCH order, not index order, so overflow reaches the
// next playable pitch-ranked string, and the direction lock guarantees termination (review
// findings: wrongly-dropped notes on the banjo preset; a pre-existing
// infinite loop when two pitch-adjacent strings sit >20 semitones apart).
test('non-monotonic banjo5 target walks in pitch order', () => {
    const banjo5 = resolveTargetTuning(['G4', 'D3', 'G3', 'B3', 'D4']).midiTuning;
    assert.deepStrictEqual(banjo5, [67, 50, 55, 59, 62]);
    assert.deepStrictEqual(resolveTargetForFret(75, 1, 8, banjo5), { s: 3, f: 24, adjustment: 16 });

    // Completeness sweep: a standard-guitar chart remapped onto banjo5
    // must always place a note that SOME banjo string could play, and
    // every kept note must sound its exact source pitch.
    const src = computeOpenStringMidiByString(6, [0, 0, 0, 0, 0, 0], 0);
    const k = computeArrangementShift(6, [0, 0, 0, 0, 0, 0], 0, src, banjo5);
    let wronglyDropped = 0, pitchErrors = 0;
    for (let s = 0; s < 6; s++) {
        for (let f = 0; f <= 24; f++) {
            const r = remapNote(src[s], s + k, f, banjo5);
            const fits = banjo5.some(open => { const tf = f + (src[s] - open); return tf >= 0 && tf <= 24; });
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
    const lowToHigh = remapSlide(midi, natural, 18, 25, BEADG_TARGET_MIDI_TUNING);
    // The natural string cannot fit fret 25. Move to the neighboring
    // higher string where both exact pitches fit instead of clamping 25.
    assert.deepStrictEqual(lowToHigh, { s: 2, f: 13, slideTo: 20 });
    const highToLow = remapSlide(midi, natural, 25, 18, BEADG_TARGET_MIDI_TUNING);
    assert.deepStrictEqual(highToLow, { s: 2, f: 20, slideTo: 13 });
    assert.equal(BEADG_TARGET_MIDI_TUNING[lowToHigh.s] + lowToHigh.f, midi + 18);
    assert.equal(BEADG_TARGET_MIDI_TUNING[lowToHigh.s] + lowToHigh.slideTo, midi + 25);

    const candidates = remapSlideCandidates(midi, natural, 18, 20, BEADG_TARGET_MIDI_TUNING);
    assert.deepStrictEqual(candidates.slice(0, 2), [
        { s: 1, f: 18, slideTo: 20 },
        { s: 2, f: 13, slideTo: 15 },
    ], 'natural string is preferred when every endpoint fits');

    // Native capo affects each endpoint independently: raw 0 -> 4 under
    // capo 2 sounds as 2 -> 4, not a four-semitone slide.
    assert.deepStrictEqual(remapSlide(40, 0, 0, 4, [40, 45, 50], 20, 2),
        { s: 0, f: 2, slideTo: 4 });
});

// The bounded/no-search fallback still retains the maximum possible number
// of exact slides. The first slide can use either string; the second can use
// only string 0, so a greedy first-choice assignment would wrongly drop it.
test('simultaneous slide fallback uses adjacent strings before dropping a slide', () => {
    const target = [40, 45];
    const bundle = makeBundle({
        notes: [
            { t: 0, s: 0, f: 10, sl: 12 }, // MIDI 50 -> 52: either target string
            { t: 0, s: 1, f: 1, sl: 3 },   // MIDI 41 -> 43: target string 0 only
        ],
        // For a 2-string chart, the fallback standard bases are E2/A2;
        // lower the second by five semitones so both source opens are E2.
        tuning: [0, -5],
    });
    createRetuner({ maxSearchNodes: 0 }).apply(bundle, target, 20, 0);
    assert.deepStrictEqual(bundle.notes.map(note => ({ s: note.s, f: note.f, sl: note.sl })), [
        { s: 1, f: 5, sl: 7 },
        { s: 0, f: 1, sl: 3 },
    ]);
});

// Chord collision: two source strings sharing open-string MIDI 33 and
// natural target 2 both resolve to target string 2; lower pitch survives.
test('chord collision: lower pitch survives', () => {
    const sourceOpenMidiByString = [33, 33, 38];
    const naturalTargetByString = [2, 2, 3];
    const noteA = { s: 0, f: 5 };
    const noteB = { s: 1, f: 2 };
    const noteC = { s: 2, f: 0 };
    const survivors = resolveChordCollisions(
        sourceOpenMidiByString, naturalTargetByString, [noteA, noteB, noteC], BEADG_TARGET_MIDI_TUNING,
    );
    const bySourceString = new Map(survivors.map(x => [x.note.s, x]));

    assert.deepStrictEqual(survivors.length, 2);
    assert.deepStrictEqual(bySourceString.has(0), false);
    assert.deepStrictEqual(bySourceString.get(1).entry, { s: 2, f: 2 });
    assert.deepStrictEqual(bySourceString.get(2).entry, { s: 3, f: 0 });
});

// reduceHandTravel: relocates a note reached via a large, fast cross-string
// jump to an exact-pitch alternate on an adjacent string — the motivating
// real-chart case was a source open string landing on target fret 1,
// alternating rapidly with a fretted neighbor on fret 8 one string over —
// an easy open-to-fretted jump in the source, a 7-fret unplayable stretch
// after retuning. BEADG's perfect-fourths spacing means fret 8 on one
// string is the same pitch as fret 3 on the next string up.
test('reduceHandTravel relocates a cross-string jump to an exact-pitch alternate', () => {
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

    assert.deepStrictEqual([HAND_JUMP_FRET_THRESHOLD, HAND_JUMP_TIME_WINDOW_S, HAND_JUMP_MIN_IMPROVEMENT],
        [5, 0.75, 2]);
});

// Complexity regression: collision checks must use the live occupancy
// index, not rescan the entire chart for every alternate-string candidate.
// Count timestamp reads instead of asserting wall-clock time: this fails
// deterministically for the old O(n^2) implementation without depending on
// CI load or machine speed.
test('reduceHandTravel remains bounded on a long standalone passage', () => {
    let timestampReads = 0;
    const notes = [];
    const noteCount = 2000;
    for (let i = 0; i < noteCount; i += 1) {
        const timestamp = i * 0.1;
        const note = {
            s: i % 2,
            f: i % 2 ? 15 : 1,
            origNote: { s: i % 2, f: i % 2 ? 5 : 1 },
        };
        Object.defineProperty(note, 't', {
            enumerable: true,
            get() {
                timestampReads += 1;
                return timestamp;
            },
        });
        notes.push(note);
    }
    reduceHandTravel(notes, [40, 45, 50, 55, 59, 64], 24);
    assert.ok(
        timestampReads < noteCount * 30,
        `expected linear timestamp reads, got ${timestampReads} for ${noteCount} notes`,
    );
    assert.equal(notes.length, noteCount);
});

// reduceHandTravel's retune-attributable gate: notes carrying an
// `origNote` back-reference (as createRetuner tags them) only trigger a
// relocation when retuning actually made the jump worse than the source
// chart already demanded.
test('reduceHandTravel retune-attributable gate', () => {
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
    // The actual reported bug: an EADG bass chart on an explicitly selected BEADG
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
        createRetuner().apply(bundle, BEADG_TARGET_MIDI_TUNING, 20, 0);
        assert.deepStrictEqual(bundle.notes.map(n => ({ s: n.s, f: n.f })), [{ s: 2, f: 6 }, { s: 1, f: 0 }]);
        assert.deepStrictEqual(bundle.anchors, [{ time: 0.0, fret: 6, width: 4 }]);
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
            [{ s: 1, f: 8, hasSlide: true, relocated: false }, { s: 4, f: 13, hasSlide: true, relocated: false }]);
        const sourceOpen = computeOpenStringMidiByString(4, [-23, -23, -13, -23], 0);
        for (const n of doubleStop) {
            const srcSlide = Number.isInteger(n.origNote.sl) ? n.origNote.sl : n.origNote.slu;
            const outSlide = Number.isInteger(n.sl) ? n.sl : n.slu;
            assert.equal(target[n.s] + n.f, sourceOpen[n.origNote.s] + n.origNote.f);
            assert.equal(target[n.s] + outSlide, sourceOpen[n.origNote.s] + srcSlide);
        }
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
        for (const { entry, note } of resolveChordCollisions(
            sourceOpenMidiByString, naturalTargetByString, bucket, BEADG_TARGET_MIDI_TUNING,
        )) {
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
    const ctx = songContext(4, [-3, -1, -1, -1], 0, BEADG_TARGET_MIDI_TUNING);
    const template = { name: '', displayName: '', frets: [6, 7, -1, -1, -1, -1], fingers: [1, 2, -1, -1, -1, -1] };
    const remapped = remapChordTemplate(
        ctx.sourceOpenMidiByString, ctx.naturalTargetByString, template, BEADG_TARGET_MIDI_TUNING,
    );
    assert.deepStrictEqual(remapped.frets, [-1, 3, 6, -1, -1]);
    assert.deepStrictEqual(remapped.fingers, [-1, 1, 2, -1, -1]);
    assert.deepStrictEqual({
        name: remapped.name, displayName: remapped.displayName,
    }, { name: '', displayName: '' });

    const midi0 = ctx.sourceOpenMidiByString[0], nat0 = ctx.naturalTargetByString[0];
    assert.deepStrictEqual(remapNote(midi0, nat0, 6, BEADG_TARGET_MIDI_TUNING), { s: remapped.frets.indexOf(3), f: 3 });
});

// Collision within a single template.
test('collision within a single template', () => {
    const sourceOpenMidiByString = [33, 33, 38];
    const naturalTargetByString = [2, 2, 3];
    const template = { frets: [5, 2, 0, -1], fingers: null };
    const remapped = remapChordTemplate(
        sourceOpenMidiByString, naturalTargetByString, template, BEADG_TARGET_MIDI_TUNING,
    );
    assert.deepStrictEqual(remapped.frets, [-1, -1, 2, 0, -1]);
    assert.deepStrictEqual(remapped.fingers, null);
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
    const retuner = createRetuner();
    const rawNotes = [{ t: 0, s: 0, f: 0 }];
    const bundle = makeBundle({ notes: rawNotes, tuning: [0, 0, 0, 0, 0] });
    retuner.apply(bundle, BEADG_TARGET_MIDI_TUNING);
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
    retuner.apply(bundle, BEADG_TARGET_MIDI_TUNING);
    assert.deepStrictEqual(bundle.notes[0].f, 0);
});

test('createRetuner apply is idempotent on its own output and target switches use raw notes', () => {
    const rawNote = { t: 0, s: 0, f: 5 };
    const bundle = makeBundle({ notes: [rawNote], tuning: [5, 0, 0, 0] });
    const retuner = createRetuner();

    retuner.apply(bundle, BEADG_TARGET_MIDI_TUNING, 20);
    const first = bundle.notes;
    assert.deepStrictEqual(first.map(({ s, f }) => ({ s, f })), [{ s: 1, f: 10 }]);
    assert.strictEqual(first[0].origNote, rawNote);

    // No manual restoration of the raw arrays: apply must recognize the
    // bundle fields it wrote on the previous call.
    retuner.apply(bundle, BEADG_TARGET_MIDI_TUNING, 20);
    assert.strictEqual(bundle.notes, first, 'same solve/projection reuses the cached output');
    assert.strictEqual(bundle.notes[0].origNote, rawNote, 'origNote never becomes a nested transformed note');

    const alternateTarget = [28, 33, 38, 43];
    const expected = makeBundle({ notes: [rawNote], tuning: [5, 0, 0, 0] });
    createRetuner().apply(expected, alternateTarget, 20);
    retuner.apply(bundle, alternateTarget, 20);
    assert.deepStrictEqual(
        bundle.notes.map(({ s, f }) => ({ s, f })),
        expected.notes.map(({ s, f }) => ({ s, f })),
        'target change re-solves from the original chart rather than prior output',
    );
    assert.strictEqual(bundle.notes[0].origNote, rawNote);

    retuner.apply(bundle, BEADG_TARGET_MIDI_TUNING, 20);
    assert.deepStrictEqual(bundle.notes.map(({ s, f }) => ({ s, f })), [{ s: 1, f: 10 }]);
    assert.strictEqual(bundle.notes[0].origNote, rawNote);
});

test('createRetuner invalidates its cache for in-place source mutations', () => {
    const rawNote = { t: 0, s: 0, f: 0, sus: 1 };
    const tuning = [0, 0, 0, 0];
    const bundle = makeBundle({ notes: [rawNote], tuning });
    const target = [28, 33, 38, 43];
    const retuner = createRetuner();

    retuner.apply(bundle, target, 20);
    assert.deepStrictEqual({ f: bundle.notes[0].f, sus: bundle.notes[0].sus }, { f: 0, sus: 1 });

    // Mutate the original object without replacing either the raw array or
    // the transformed bundle field. Content, not reference identity, must
    // invalidate the cached solve and refresh copied note metadata.
    rawNote.f = 5;
    rawNote.sus = 2;
    retuner.apply(bundle, target, 20);
    assert.deepStrictEqual({ f: bundle.notes[0].f, sus: bundle.notes[0].sus }, { f: 5, sus: 2 });
    assert.strictEqual(bundle.notes[0].origNote, rawNote);

    // Source tuning is host-owned and mutable too; changing one offset in
    // place raises this note's exact target fret by one.
    tuning[0] = 1;
    retuner.apply(bundle, target, 20);
    assert.deepStrictEqual(bundle.notes[0].f, 6);
    assert.strictEqual(bundle.notes[0].origNote, rawNote);
});

// createRetuner's fail-safe: a malformed bundle (invalid stringCount, or a
// non-array tuning) passes every array through unremapped rather than
// crashing or silently dropping the chart.
test('createRetuner fail-safe passes a malformed bundle through unremapped', (t) => {
    const rawNotes = [{ t: 0, s: 0, f: 3 }];
    const rawChords = [{ id: null, t: 1, notes: [] }];
    const rawAnchors = [{ time: 0, fret: 1, width: 3 }];

    t.test('non-array tuning', () => {
        const bundle = { notes: rawNotes, chords: rawChords, anchors: rawAnchors, chordTemplates: [], tuning: null, capo: 0, stringCount: 4 };
        // A requested physical capo projection must not touch a chart that
        // failed validation and therefore was never canonically remapped.
        createRetuner().apply(bundle, [43, 48, 53, 58], 17, 3);
        assert.strictEqual(bundle.notes, rawNotes);
        assert.strictEqual(bundle.chords, rawChords);
        assert.strictEqual(bundle.anchors, rawAnchors);
    });

    t.test('invalid stringCount', () => {
        const bundle = { notes: rawNotes, chords: rawChords, anchors: rawAnchors, chordTemplates: [], tuning: [0, 0, 0, 0], capo: 0, stringCount: 0 };
        createRetuner().apply(bundle, [40, 45, 50, 55]);
        assert.strictEqual(bundle.notes, rawNotes);
    });

    for (const stringCount of [1.5, 9, 1000000]) {
        t.test(`bounded stringCount=${stringCount}`, () => {
            const bundle = { notes: rawNotes, chords: rawChords, anchors: rawAnchors, chordTemplates: [], tuning: [0], capo: 0, stringCount };
            createRetuner().apply(bundle, [40], 20);
            assert.strictEqual(bundle.notes, rawNotes);
            assert.strictEqual(bundle.chords, rawChords);
        });
    }

    t.test('stringCount/tuning length mismatch', () => {
        const bundle = { notes: rawNotes, chords: rawChords, anchors: rawAnchors, chordTemplates: [], tuning: [0], capo: 0, stringCount: 4 };
        createRetuner().apply(bundle, [40, 45, 50, 55], 20);
        assert.strictEqual(bundle.notes, rawNotes);
    });

    t.test('non-integer tuning offset', () => {
        const bundle = { notes: rawNotes, chords: rawChords, anchors: rawAnchors, chordTemplates: [], tuning: [0, 0, NaN, 0], capo: 0, stringCount: 4 };
        createRetuner().apply(bundle, [40, 45, 50, 55], 20);
        assert.strictEqual(bundle.notes, rawNotes);
    });

    t.test('sparse tuning array', () => {
        const sparse = new Array(4);
        sparse[0] = 0;
        const bundle = { notes: rawNotes, chords: rawChords, anchors: rawAnchors, chordTemplates: [], tuning: sparse, capo: 0, stringCount: 4 };
        createRetuner().apply(bundle, [40, 45, 50, 55], 20);
        assert.strictEqual(bundle.notes, rawNotes);
    });

    t.test('invalid target pitch', () => {
        const bundle = { notes: rawNotes, chords: rawChords, anchors: rawAnchors, chordTemplates: [], tuning: [0, 0, 0, 0], capo: 0, stringCount: 4 };
        createRetuner().apply(bundle, [40, Infinity], 20);
        assert.strictEqual(bundle.notes, rawNotes);
    });

    t.test('unbounded maxFret', () => {
        const bundle = { notes: rawNotes, chords: rawChords, anchors: rawAnchors, chordTemplates: [], tuning: [0, 0, 0, 0], capo: 0, stringCount: 4 };
        createRetuner().apply(bundle, [40, 45, 50, 55], Infinity);
        assert.strictEqual(bundle.notes, rawNotes);
    });
});

// A bundle with no chord templates at all (chordTemplates omitted/non-array)
// resolves to an empty array rather than crashing.
test('createRetuner handles a bundle with no chord templates', () => {
    const bundle = makeBundle({ notes: [{ t: 0, s: 0, f: 3 }], tuning: [0, 0, 0, 0], chordTemplates: undefined });
    createRetuner().apply(bundle, [40, 45, 50, 55]);
    assert.deepStrictEqual(bundle.chordTemplates, []);
});

// Switching tuning mid-playthrough must re-add a note previously dropped
// as unplayable, if now in range under the new target.
test('switching tuning mid-playthrough re-adds a previously dropped note', () => {
    const retuner = createRetuner();
    const rawNotes = [{ t: 0, s: 0, f: 0 }];
    const bundle = makeBundle({ notes: rawNotes, tuning: [-2, 0, 0, 0, 0] });

    retuner.apply(bundle, BEADG_TARGET_MIDI_TUNING);
    assert.deepStrictEqual(bundle.notes.length, 0);

    const aeadg = resolveTargetTuning(['A0', 'E1', 'A1', 'D2', 'G2']);
    bundle.notes = rawNotes;
    retuner.apply(bundle, aeadg.midiTuning);
    assert.deepStrictEqual(bundle.notes.length, 1);
    assert.deepStrictEqual({ s: bundle.notes[0].s, f: bundle.notes[0].f }, { s: 0, f: 0 });

    bundle.notes = rawNotes;
    retuner.apply(bundle, BEADG_TARGET_MIDI_TUNING);
    assert.deepStrictEqual(bundle.notes.length, 0);
});

// maxFret: per-tuning-profile ceiling (HISTORY.md Phase 15 — replaces the old
// blanket hardcoded 20). Every engine entry point defaults to
// DEFAULT_MAX_FRET (24); these
// cases pin the actual widening/narrowing behavior a non-default value
// produces.
test('maxFret per-tuning-profile ceiling', () => {
    // Single-string target at exactly the source's open pitch (adjustment
    // 0), so the target fret always equals the source fret — isolates the
    // ceiling check from any natural-string/adjustment interaction.
    const oneString = [40];
    assert.deepStrictEqual(resolveTargetForFret(40, 0, 21, oneString, 20), null);
    assert.deepStrictEqual(resolveTargetForFret(40, 0, 21, oneString), { s: 0, f: 21, adjustment: 0 });
    assert.deepStrictEqual(resolveTargetForFret(40, 0, 15, oneString, 14), null);

    assert.deepStrictEqual(remapAnchors([{ time: 0, fret: 23, width: 4 }], [{ t: 0, f: 0, origNote: { t: 0, f: 0 } }], 24),
        [{ time: 0, fret: 23, width: 4 }]);
    assert.deepStrictEqual(remapAnchors([{ time: 0, fret: 23, width: 4 }], [{ t: 0, f: 0, origNote: { t: 0, f: 0 } }]),
        [{ time: 0, fret: 23, width: 4 }]);

    // Single-string source/target (as above) so there's no adjacent string
    // the walk could escape to — isolates the ceiling from string choice.
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
    assert.deepStrictEqual(remapNote(ctx.sourceOpenMidiByString[4], ctx.naturalTargetByString[4], 23, irregular.midiTuning), { s: 4, f: 24 });
    assert.deepStrictEqual(remapNote(ctx.sourceOpenMidiByString[4], ctx.naturalTargetByString[4], 24, irregular.midiTuning), null);

    assert.deepStrictEqual(resolveTargetForFret(38, 3, 25, irregular.midiTuning), { s: 4, f: 21, adjustment: -4 });
});

// Unplayable-low-note-drop regression: EADG target (4-string, B removed)
// must silently drop notes below open E1, not cascade or crash.
test('unplayable-low-note-drop regression on EADG target', () => {
    assert.deepStrictEqual(EADG.midiTuning, [28, 33, 38, 43]);

    assert.deepStrictEqual(remapNote(27, 0, 0, EADG.midiTuning), null);
    assert.deepStrictEqual(resolveTargetForFret(27, 0, 0, EADG.midiTuning), null);
    assert.deepStrictEqual(remapNote(28, 0, 0, EADG.midiTuning), { s: 0, f: 0 });

    // End-to-end via createRetuner, same path screen.js's draw() uses.
    const retuner = createRetuner();
    const rawNotes = [{ t: 0, s: 0, f: 0 }, { t: 1, s: 1, f: 0 }];
    const bundle = makeBundle({ notes: rawNotes, tuning: [0, 0, 0, 0, 0] });
    retuner.apply(bundle);
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

    assert.deepStrictEqual(remapNote(sixString.midiTuning[5], 5, 25, sixString.midiTuning), null);
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

// Chart capo only raises notes at or below its own fret; already-fretted notes are untouched.
test('a chart\'s own native capo only raises notes at or below its fret', () => {
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
    assert.deepStrictEqual(bundle.anchors, [{ time: 0, fret: 2, width: 4 }]);
});

// ---- Pathological-chart safety valves (createRetuner) -----------------
// The cold remap is synchronous and bounded: a per-group solver node
// budget (maxSearchNodes), an oversize-group cutoff
// (MAX_SOLVER_GROUP_SIZE), and a whole-remap deadline (maxTotalSolveMs)
// past which the remaining groups take the per-note path.

// Solver node-budget abort inside createRetuner: the group degrades to
// the per-note path (notes still render) instead of dropping, and the
// abort is counted. Default budget: same chart, no aborts.
test('solver node-budget abort degrades to the per-note path', (t) => {
    // Eb-standard open-heavy chord onto EADG: the exact per-note remap
    // drops the low open Eb (below the target's range), so the solver
    // search must run — then a 10-node budget aborts it immediately.
    const raw = {
        notes: [
            { t: 0, s: 0, f: 0 }, { t: 0, s: 1, f: 0 }, { t: 0, s: 2, f: 1 }, { t: 0, s: 3, f: 3 },
        ],
        chords: [], anchors: [], templates: [], tuning: [-1, -1, -1, -1], capo: 0, sc: 4,
    };
    const eadg = DEFAULT_TARGET_MIDI_TUNING; // E1 A1 D2 G2

    const capped = createRetuner({ maxSearchNodes: 10 });
    const cappedBundle = bundleFromRaw(raw);
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
    const uncappedBundle = bundleFromRaw(raw);
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
    const zeroBundle = bundleFromRaw(raw);
    zeroBudget.apply(zeroBundle, eadg);
    assert.deepStrictEqual(zeroBudget.getStats().searchAborts, 1);
    assert.deepStrictEqual(zeroBundle.notes, cappedBundle.notes);
});

// Oversized simultaneous-note groups (data corruption, e.g. a broken GP
// export stacking a bar on one timestamp) skip the solver entirely.
test('oversized simultaneous-note groups skip the solver', () => {
    assert.deepStrictEqual(MAX_SOLVER_GROUP_SIZE >= 8, true);
    const notes = [];
    for (let i = 0; i < MAX_SOLVER_GROUP_SIZE + 3; i++) {
        notes.push({ t: 0, s: i % 4, f: i });
    }
    const raw = { notes, chords: [], anchors: [], templates: [], tuning: [0, 0, 0, 0], capo: 0, sc: 4 };
    const retuner = createRetuner();
    const bundle = bundleFromRaw(raw);
    retuner.apply(bundle, BEADG_TARGET_MIDI_TUNING);
    assert.deepStrictEqual(retuner.getStats().oversizeGroups, 1);
    assert.ok(bundle.notes.length >= 1 && bundle.notes.length <= 5,
        'oversize group resolves via per-note collision path');
    assert.deepStrictEqual(retuner.getStats().searchAborts, 0);
});

// Whole-remap deadline: past maxTotalSolveMs of work, the solver is
// disabled for the remaining groups — the remap still completes in the
// same apply() call and every group still materializes.
test('whole-remap deadline disables the solver for remaining groups', (t) => {
    const notes = [];
    for (let i = 0; i < 6; i++) {
        notes.push({ t: i, s: 0, f: i + 1 }, { t: i, s: 1, f: i + 2 });
    }
    const raw = { notes, chords: [], anchors: [], templates: [], tuning: [0, 0, 0, 0], capo: 0, sc: 4 };
    // maxTotalSolveMs: -1 -> the deadline is already past at the first
    // between-groups check, so every group takes the per-note path.
    const retuner = createRetuner({ maxTotalSolveMs: -1 });
    const bundle = bundleFromRaw(raw);
    retuner.apply(bundle, BEADG_TARGET_MIDI_TUNING);
    assert.deepStrictEqual(retuner.getStats().solverDisabled, true);
    assert.deepStrictEqual(bundle.notes.length, notes.length);
    assert.deepStrictEqual(Object.keys(retuner.getStats()).sort(),
        ['oversizeGroups', 'searchAborts', 'solverDisabled', 'workMs']);
    // Identity chart on the explicit BEADG target: the per-note fallback
    // maps EADG onto BEADG's top four strings — same frets, string + 1 — so
    // the degraded output is still exactly right here.
    for (let i = 0; i < notes.length; i++) {
        t.test(`note i=${i}`, () => {
            assert.deepStrictEqual({ s: bundle.notes[i].s, f: bundle.notes[i].f },
                { s: notes[i].s + 1, f: notes[i].f });
        });
    }
});
