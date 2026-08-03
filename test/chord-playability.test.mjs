// Chord playability regression suite: a retuned chord must stay roughly
// as easy to play as the source, not just pitch-exact. End-to-end via
// createRetuner(), distinct from chord-solver.test.mjs's algorithm-level
// unit tests. Reference shapes: https://www.guitarcommand.com/open-chords-guitar/
import test from 'node:test';
import assert from 'node:assert';
import { CR } from '../src/chart-retune.js';

const { createRetuner, fingersNeeded, isFretted, MAX_CHORD_SPAN, MAX_FRETTING_FINGERS, pitchClassOf } = CR;

const E_STD = [40, 45, 50, 55, 59, 64]; // E2 A2 D3 G3 B3 E4
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

// Standard first-position open-chord diagrams (low string first, -1 =
// muted, 0 = open). Root/quality pitch classes given for verification —
// every note the engine outputs must be one of these.
const OPEN_CHORDS = {
    E:   { frets: [0, 2, 2, 1, 0, 0], pcs: [4, 8, 11] },        // E G# B
    Em:  { frets: [0, 2, 2, 0, 0, 0], pcs: [4, 7, 11] },        // E G B
    E7:  { frets: [0, 2, 0, 1, 0, 0], pcs: [4, 8, 11, 2] },     // E G# B D
    A:   { frets: [-1, 0, 2, 2, 2, 0], pcs: [9, 1, 4] },        // A C# E
    Am:  { frets: [-1, 0, 2, 2, 1, 0], pcs: [9, 0, 4] },        // A C E
    A7:  { frets: [-1, 0, 2, 0, 2, 0], pcs: [9, 1, 4, 7] },     // A C# E G
    D:   { frets: [-1, -1, 0, 2, 3, 2], pcs: [2, 6, 9] },       // D F# A
    D7:  { frets: [-1, -1, 0, 2, 1, 2], pcs: [2, 6, 9, 0] },    // D F# A C
    C:   { frets: [-1, 3, 2, 0, 1, 0], pcs: [0, 4, 7] },        // C E G
    G:   { frets: [3, 2, 0, 0, 0, 3], pcs: [7, 11, 2] },        // G B D
};

// Diagram fret -> chart's own raw fret under a given chart capo: open (0)
// stays 0 (engine raises it to the capo's fret); fretted is already
// absolute, so raw = diagramFret + capo.
function encodeForCapo(diagramFrets, capo) {
    return diagramFrets.map(f => (f <= 0 ? f : f + capo));
}

function pcsTransposedBy(pcs, semitones) {
    return new Set(pcs.map(pc => (pc + semitones + 12) % 12));
}

function retuneChord(name, diagramFrets, capo) {
    const rawFrets = encodeForCapo(diagramFrets, capo);
    const notes = [];
    for (let s = 0; s < rawFrets.length; s += 1) if (rawFrets[s] >= 0) notes.push({ s, f: rawFrets[s] });
    const tmpl = { name, frets: rawFrets, fingers: rawFrets.map(() => -1) };
    const chord = { t: 0, id: 0, notes };
    const bundle = {
        notes: [], chords: [chord], anchors: [], chordTemplates: [tmpl],
        tuning: [0, 0, 0, 0, 0, 0], capo, stringCount: 6,
    };
    createRetuner().apply(bundle, E_STD, 24);
    return bundle.chords[0].notes.map(n => ({ s: n.s, f: n.f }));
}

function spanOf(voicing) {
    const fretted = voicing.filter(n => isFretted(n.f));
    if (fretted.length === 0) return 0;
    const frets = fretted.map(n => n.f);
    return Math.max(...frets) - Math.min(...frets);
}

// Every standard open chord, capo'd, must retune onto a bare E-standard
// target as the correct transposed chord, no harder than an open chord.
for (const capo of [2, 3, 5]) {
    for (const [name, { frets, pcs }] of Object.entries(OPEN_CHORDS)) {
        test(`${name} chord, capo ${capo}, retunes to a playable transposed chord`, () => {
            const voicing = retuneChord(name, frets, capo);
            assert.ok(voicing.length > 0, 'chord must not vanish entirely');

            const wantPcs = pcsTransposedBy(pcs, capo);
            for (const { s, f } of voicing) {
                const pc = pitchClassOf(E_STD[s] + f);
                assert.ok(wantPcs.has(pc),
                    `${name} capo ${capo}: string ${s} fret ${f} is ${NOTE_NAMES[pc]}, not a chord tone`);
            }

            assert.ok(spanOf(voicing) <= MAX_CHORD_SPAN,
                `${name} capo ${capo}: fret span ${spanOf(voicing)} exceeds ${MAX_CHORD_SPAN}`);
            assert.ok(fingersNeeded(voicing) <= MAX_FRETTING_FINGERS,
                `${name} capo ${capo}: needs ${fingersNeeded(voicing)} fingers, more than ${MAX_FRETTING_FINGERS}`);
        });
    }
}

// Baseline: capo 0 must retune every shape onto its own tuning unchanged.
test('open chords with no chart capo are untouched', () => {
    for (const [name, { frets }] of Object.entries(OPEN_CHORDS)) {
        const voicing = retuneChord(name, frets, 0);
        const expected = [];
        for (let s = 0; s < frets.length; s += 1) if (frets[s] >= 0) expected.push({ s, f: frets[s] });
        assert.deepStrictEqual(
            voicing.slice().sort((a, b) => a.s - b.s),
            expected.slice().sort((a, b) => a.s - b.s),
            `${name} at capo 0 should be untouched`);
    }
});

// Exact regressions, verified against the real engine, on top of the property checks above.
test('E7 chord, capo 2, is exactly F#7 span-1', () => {
    const voicing = retuneChord('E7', OPEN_CHORDS.E7.frets, 2).sort((a, b) => a.s - b.s);
    assert.deepStrictEqual(voicing, [{ s: 2, f: 2 }, { s: 3, f: 3 }, { s: 4, f: 2 }, { s: 5, f: 2 }]);
});

test('C chord, capo 2, is exactly D major span-1', () => {
    const voicing = retuneChord('C', OPEN_CHORDS.C.frets, 2).sort((a, b) => a.s - b.s);
    assert.deepStrictEqual(voicing, [{ s: 2, f: 0 }, { s: 3, f: 2 }, { s: 4, f: 3 }, { s: 5, f: 2 }]);
});

// Non-capo guard: an easy chord must not be needlessly revoiced.
test('open A onto Drop D stays exact (no needless revoicing)', () => {
    const DROP_D = [38, 45, 50, 55, 59, 64];
    const frets = OPEN_CHORDS.A.frets;
    const notes = [];
    for (let s = 0; s < frets.length; s += 1) if (frets[s] >= 0) notes.push({ s, f: frets[s] });
    const bundle = {
        notes: [], chords: [{ t: 0, id: 0, notes }], anchors: [], chordTemplates: [],
        tuning: [0, 0, 0, 0, 0, 0], capo: 0, stringCount: 6,
    };
    createRetuner().apply(bundle, DROP_D, 24);
    assert.deepStrictEqual(
        bundle.chords[0].notes.map(n => ({ s: n.s, f: n.f })).sort((a, b) => a.s - b.s),
        notes.slice().sort((a, b) => a.s - b.s));
});

// --- B-standard <-> E-standard retuning (no capo involved) --------------
// B-standard is E-standard tuned down a perfect 4th on every string.
// E-on-B-standard and C-on-E-standard are skipped: their counterparts
// (B, F) aren't in this five-chord set.
const B_STD = E_STD.map(m => m - 5);

const MAJOR_CHORDS = {
    A: { frets: [-1, 0, 2, 2, 2, 0], pcs: [9, 1, 4] },   // A C# E
    C: { frets: [-1, 3, 2, 0, 1, 0], pcs: [0, 4, 7] },   // C E G
    D: { frets: [-1, -1, 0, 2, 3, 2], pcs: [2, 6, 9] },  // D F# A
    E: { frets: [0, 2, 2, 1, 0, 0], pcs: [4, 8, 11] },   // E G# B
    G: { frets: [3, 2, 0, 0, 0, 3], pcs: [7, 11, 2] },   // G B D
};

// [source shape, source tuning ('B' or 'E'), expected target root pc].
// Retuning preserves the source's actual sounding pitch, so an
// E-standard source keeps its own name's root; only a B-standard source
// transposes (down a 4th).
const TUNING_SWAP_CASES = [
    ['A', 'B', 4], ['C', 'B', 7], ['D', 'B', 9], ['G', 'B', 2],   // B-standard -> E-standard
    ['A', 'E', 9], ['C', 'E', 0], ['E', 'E', 4], ['G', 'E', 7],   // E-standard -> B-standard
];

function retuneAcrossTuning(name, diagramFrets, sourceTuning) {
    const notes = [];
    for (let s = 0; s < diagramFrets.length; s += 1) if (diagramFrets[s] >= 0) notes.push({ s, f: diagramFrets[s] });
    const tmpl = { name, frets: diagramFrets, fingers: diagramFrets.map(() => -1) };
    const offsets = sourceTuning === 'B' ? [-5, -5, -5, -5, -5, -5] : [0, 0, 0, 0, 0, 0];
    const target = sourceTuning === 'B' ? E_STD : B_STD;
    const bundle = {
        notes: [], chords: [{ t: 0, id: 0, notes }], anchors: [], chordTemplates: [tmpl],
        tuning: offsets, capo: 0, stringCount: 6,
    };
    createRetuner().apply(bundle, target, 24);
    return { voicing: bundle.chords[0].notes.map(n => ({ s: n.s, f: n.f })), target };
}

for (const [name, sourceTuning, targetRootPc] of TUNING_SWAP_CASES) {
    const targetLabel = sourceTuning === 'B' ? 'E-standard' : 'B-standard';
    test(`${name} chord on ${sourceTuning === 'B' ? 'B' : 'E'}-standard retunes onto ${targetLabel} playably`, () => {
        const { frets } = MAJOR_CHORDS[name];
        const { voicing, target } = retuneAcrossTuning(name, frets, sourceTuning);
        assert.ok(voicing.length > 0, 'chord must not vanish entirely');

        // Every note must belong to the target-root major triad.
        const wantPcs = new Set([targetRootPc, (targetRootPc + 4) % 12, (targetRootPc + 7) % 12]);
        for (const { s, f } of voicing) {
            const pc = pitchClassOf(target[s] + f);
            assert.ok(wantPcs.has(pc),
                `${name} on ${sourceTuning}-standard: string ${s} fret ${f} is ${NOTE_NAMES[pc]}, not a chord tone`);
        }

        assert.ok(spanOf(voicing) <= MAX_CHORD_SPAN,
            `${name} on ${sourceTuning}-standard: span ${spanOf(voicing)} exceeds ${MAX_CHORD_SPAN}`);
        assert.ok(fingersNeeded(voicing) <= MAX_FRETTING_FINGERS,
            `${name} on ${sourceTuning}-standard: needs ${fingersNeeded(voicing)} fingers, more than ${MAX_FRETTING_FINGERS}`);
    });
}

// Exact regressions for the two round-trip examples that motivated this section.
test('G on B-standard retunes to an easy D major on E-standard', () => {
    const { voicing } = retuneAcrossTuning('G', MAJOR_CHORDS.G.frets, 'B');
    assert.deepStrictEqual(voicing.slice().sort((a, b) => a.s - b.s),
        [{ s: 0, f: 2 }, { s: 1, f: 0 }, { s: 2, f: 0 }, { s: 4, f: 3 }]);
});

test('D on E-standard retunes to an all-open A-D-F# on B-standard', () => {
    const { voicing } = retuneAcrossTuning('D', MAJOR_CHORDS.D.frets, 'E');
    assert.deepStrictEqual(voicing.slice().sort((a, b) => a.s - b.s),
        [{ s: 2, f: 0 }, { s: 3, f: 0 }, { s: 4, f: 0 }]);
});
