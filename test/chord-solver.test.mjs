// Standalone Node verification for the chord-aware remapping solver
// (src/chord-solver.js) plus its createRetuner() integration. Imports
// the real modules from ../src/chart-retune.js — no hand-synced
// duplicate. Run with `node test/chord-solver.test.mjs`.
import test from 'node:test';
import assert from 'node:assert';
import { CR } from '../src/chart-retune.js';

const {
    MAX_CHORD_SPAN,
    parseChordRootFromName,
    fingersNeeded,
    barreIsValid,
    voicingPlayable,
    chordSpecFromNotes,
    degradationLadder,
    scoreVoicing,
    solveVoicingSearch,
    matchVoicingToSource,
    solveChord,
    computeChordFingers,
    pitchClassOf,
} = CR;

// Common tunings (open MIDI, low string first).
const E_STD = [40, 45, 50, 55, 59, 64];        // E2 A2 D3 G3 B3 E4
const DROP_D = [38, 45, 50, 55, 59, 64];
const EB_STD = [39, 44, 49, 54, 58, 63];
const EADG_BASS = [28, 33, 38, 43];

// Voicing/notes helper: pairs [s, f] -> [{ s, f }].
const v = pairs => pairs.map(([s, f]) => ({ s, f }));
// Voicing with midi/pc (as solveVoicingSearch emits) for scoreVoicing.
const vm = (open, pairs) => pairs.map(([s, f]) => {
    const midi = open[s] + f;
    return { s, f, midi, pc: pitchClassOf(midi) };
});
// Ladder levels -> sorted arrays for order-insensitive comparison.
const levelsAsArrays = ladder => ladder.map(set => [...set].sort((a, b) => a - b));
// Solver voicing -> [{s,f}] sorted by string for stable comparison.
const shape = voicing => voicing.map(({ s, f }) => ({ s, f })).sort((a, b) => a.s - b.s);

test('parseChordRootFromName', () => {
    assert.deepStrictEqual(parseChordRootFromName('Am7'), { rootPc: 9, bassPc: null });
    assert.deepStrictEqual(parseChordRootFromName('C/G'), { rootPc: 0, bassPc: 7 });
    assert.deepStrictEqual(parseChordRootFromName('D/F#'), { rootPc: 2, bassPc: 6 });
    assert.deepStrictEqual(parseChordRootFromName('F#5'), { rootPc: 6, bassPc: null });
    assert.deepStrictEqual(parseChordRootFromName('Bb'), { rootPc: 10, bassPc: null });
    assert.deepStrictEqual(parseChordRootFromName('e'), { rootPc: 4, bassPc: null });
    assert.deepStrictEqual(parseChordRootFromName('5'), null);
    assert.deepStrictEqual(parseChordRootFromName(''), null);
    assert.deepStrictEqual(parseChordRootFromName(undefined), null);
});

test('fingersNeeded / barreIsValid', () => {
    assert.deepStrictEqual(fingersNeeded(v([[0, 0], [1, 0], [2, 0]])), 0);
    // Open E 022100: the 2-2 contiguous run is one finger, the 1 another.
    assert.deepStrictEqual(fingersNeeded(v([[0, 0], [1, 2], [2, 2], [3, 1], [4, 0], [5, 0]])), 2);
    // F barre 133211: barre the three 1s, run the 3-3, plus the 2.
    assert.deepStrictEqual(fingersNeeded(v([[0, 1], [1, 3], [2, 3], [3, 2], [4, 1], [5, 1]])), 3);
    // Drop-D F shape 333211: min-fret barre on the two 1s + 3-3-3 run + the 2.
    assert.deepStrictEqual(fingersNeeded(v([[0, 3], [1, 3], [2, 3], [3, 2], [4, 1], [5, 1]])), 3);
    // A major x02220: open high E invalidates a barre, but 2-2-2 is one run.
    assert.deepStrictEqual(fingersNeeded(v([[1, 0], [2, 2], [3, 2], [4, 2], [5, 0]])), 1);
    assert.deepStrictEqual(fingersNeeded(v([[0, 3], [1, 2], [2, 0], [3, 0], [4, 0], [5, 3]])), 3);
    // Five isolated frets, no shared barre or run — each needs its own finger.
    assert.deepStrictEqual(fingersNeeded(v([[0, 1], [1, 3], [2, 2], [3, 4], [4, 3]])), 5);

    assert.deepStrictEqual(barreIsValid(v([[1, 1], [2, 1], [3, 0]])), false);
    assert.deepStrictEqual(barreIsValid(v([[0, 1], [4, 1], [5, 1], [3, 2]])), true);
    assert.deepStrictEqual(barreIsValid(v([[0, 1], [1, 2]])), false);
    assert.deepStrictEqual(barreIsValid(v([[0, 0], [1, 2], [2, 2]])), true);
});

test('voicingPlayable: hard span/finger constraints, source-relative', () => {
    const tight = { span: 0, fingers: 0 };
    assert.deepStrictEqual(voicingPlayable(v([[0, 1], [1, 6]]), tight), false);
    assert.deepStrictEqual(voicingPlayable(v([[0, 1], [1, 4]]), tight), true);
    assert.deepStrictEqual(voicingPlayable(v([[0, 1], [1, 6]]), { span: 5, fingers: 0 }), true);
    const fiveFingers = v([[0, 1], [1, 3], [2, 2], [3, 4], [4, 3]]);
    assert.deepStrictEqual(voicingPlayable(fiveFingers, tight), false);
    assert.deepStrictEqual(voicingPlayable(fiveFingers, { span: 3, fingers: 5 }), true);
});

test('chordSpecFromNotes: open C (x32010) in E standard', () => {
    const notes = v([[1, 3], [2, 2], [3, 0], [4, 1], [5, 0]]);
    const spec = chordSpecFromNotes(E_STD, notes, 'C');
    assert.deepStrictEqual([...spec.pitchSet].sort((a, b) => a - b), [48, 52, 55, 60, 64]);
    assert.deepStrictEqual([...spec.pcs].sort((a, b) => a - b), [0, 4, 7]);
    assert.deepStrictEqual([...spec.pcCounts.entries()].sort((a, b) => a[0] - b[0]), [[0, 2], [4, 2], [7, 1]]);
    assert.deepStrictEqual(spec.rootPc, 0);
    assert.deepStrictEqual(spec.bassPc, null);
    assert.deepStrictEqual(spec.bassMidi, 48);
    assert.deepStrictEqual({ minFretted: spec.minFretted, span: spec.span }, { minFretted: 1, span: 2 });
    assert.deepStrictEqual({ o: spec.openCount, n: spec.noteCount }, { o: 2, n: 5 });
    assert.deepStrictEqual(spec.requiresBarre, false);

    const junkName = chordSpecFromNotes(E_STD, notes, '<junk>');
    assert.deepStrictEqual(junkName.rootPc, 0);
    const wrongName = chordSpecFromNotes(E_STD, notes, 'B');
    assert.deepStrictEqual(wrongName.rootPc, 0);
    const slash = chordSpecFromNotes(E_STD, notes, 'C/G');
    assert.deepStrictEqual(slash.bassPc, 7);

    const withNull = chordSpecFromNotes([null, 45, 50, 55, 59, 64], v([[0, 0], [1, 3]]), null);
    assert.deepStrictEqual(withNull.notes.map(n => n.idx), [1]);
    assert.deepStrictEqual(chordSpecFromNotes([null], v([[0, 2]]), null), null);
});

test('degradationLadder', () => {
    const cMaj = chordSpecFromNotes(E_STD, v([[1, 3], [2, 2], [3, 0], [4, 1], [5, 0]]), 'C');
    assert.deepStrictEqual(levelsAsArrays(degradationLadder(cMaj)), [[0, 4, 7], [0, 7], [0]]);
    // Am7 (x02010): A2 E3 G3 C4 E4 -> pcs {9,4,7,0}, root 9.
    const am7 = chordSpecFromNotes(E_STD, v([[1, 0], [2, 2], [3, 0], [4, 1], [5, 0]]), 'Am7');
    assert.deepStrictEqual(levelsAsArrays(degradationLadder(am7)), [[0, 4, 7, 9], [0, 4, 9], [4, 9], [9]]);
    // D5 in Drop D (000xxx): D2 A2 D3 -> pcs {2,9}, no third.
    const d5 = chordSpecFromNotes(DROP_D, v([[0, 0], [1, 0], [2, 0]]), 'D5');
    assert.deepStrictEqual(levelsAsArrays(degradationLadder(d5)), [[2, 9], [2]]);
});

test('scoreVoicing: the source voicing itself scores 0', () => {
    const notes = v([[1, 3], [2, 2], [3, 0], [4, 1], [5, 0]]);
    const spec = chordSpecFromNotes(E_STD, notes, 'C');
    assert.deepStrictEqual(scoreVoicing(spec, vm(E_STD, [[1, 3], [2, 2], [3, 0], [4, 1], [5, 0]])), 0);
    // Muting an inner string is penalized.
    const gap = scoreVoicing(spec, vm(E_STD, [[1, 3], [2, 2], [4, 1], [5, 0]]));
    assert.ok(gap > 0, 'score: dropping an inner note costs > 0');
});

// A >=2-fret interior peak costs more than a real barre technique; open D's 1-fret peak is exempt.
test('scoreVoicing: interior peaks cost more, but a 1-fret peak like open D does not', () => {
    const spec = chordSpecFromNotes(E_STD, v([[0, 0], [1, 4], [2, 4], [3, 0], [4, 5], [5, 5]]), 'F#m7');
    const zigzag = vm(E_STD, [[0, 2], [1, 0], [2, 4], [3, 2], [4, 2], [5, 0]]); // fret 4 peak on string 2
    const barre = vm(E_STD, [[0, 2], [1, 4], [2, 4], [3, 2], [4, 5], [5, 5]]);
    assert.ok(scoreVoicing(spec, zigzag) > scoreVoicing(spec, barre),
        'a real barre technique must score better than an unplayable interior-peak shape');

    const dSpec = chordSpecFromNotes(E_STD, v([[2, 0], [3, 2], [4, 3], [5, 2]]), 'D');
    const openD = vm(E_STD, [[2, 0], [3, 2], [4, 3], [5, 2]]);
    assert.deepStrictEqual(scoreVoicing(dSpec, openD), 0, 'open D\'s 1-fret peak must not be charged');
});

test('solveVoicingSearch: identity recovery when source and target tunings agree', () => {
    const spec = chordSpecFromNotes(E_STD, v([[1, 3], [2, 2], [3, 0], [4, 1], [5, 0]]), 'C');
    const found = solveVoicingSearch(spec, spec.pcs, E_STD, { maxNotes: spec.noteCount });
    assert.deepStrictEqual(found.cost, 0);
    assert.deepStrictEqual(shape(found.voicing), v([[1, 3], [2, 2], [3, 0], [4, 1], [5, 0]]));
});

// Eb-standard open-E-shape onto E-standard: registerFlexible lands Eb3
// (not the unreachable Eb2) in the bass: x-x-1-3-4-3 = Eb3 Bb3 Eb4 G4.
test('solveChord: Eb-standard open-E-shape onto E-standard', () => {
    const notes = v([[0, 0], [1, 2], [2, 2], [3, 1], [4, 0], [5, 0]]);
    const spec = chordSpecFromNotes(EB_STD, notes, 'Eb');
    const r = solveChord(spec, E_STD, null);
    assert.deepStrictEqual({ revoiced: r.revoiced, degradeLevel: r.degradeLevel }, { revoiced: true, degradeLevel: 0 });
    assert.deepStrictEqual(r.placements.map(({ s, f }) => ({ s, f })).sort((a, b) => a.s - b.s),
        v([[2, 1], [3, 3], [4, 4], [5, 3]]));
    assert.deepStrictEqual(r.placements.map(p => p.srcIndex).sort((a, b) => a - b), [2, 3, 4, 5]);
});

// Drop-D D5 onto E standard: below-range D2 drops; registerFlexible keeps the open D string as root/bass.
test('solveChord: Drop-D D5 onto E standard', () => {
    const spec = chordSpecFromNotes(DROP_D, v([[0, 0], [1, 0], [2, 0]]), 'D5');
    const r = solveChord(spec, E_STD, null);
    assert.deepStrictEqual(r.revoiced, true);
    assert.deepStrictEqual(r.placements.map(({ s, f }) => ({ s, f })).sort((a, b) => a.s - b.s),
        v([[2, 0], [3, 2], [4, 3]]));
});

// Exact candidate: F barre (133211) in E standard onto Drop D. The
// per-note engine maps it exactly to 333211 (low string +2, rest
// unchanged) and the mini-barre run grouping recognizes it as playable.
test('solveChord: exact candidate, F barre onto Drop D', () => {
    const spec = chordSpecFromNotes(E_STD, v([[0, 1], [1, 3], [2, 3], [3, 2], [4, 1], [5, 1]]), 'F');
    const exact = [
        { srcIndex: 0, s: 0, f: 3 }, { srcIndex: 1, s: 1, f: 3 }, { srcIndex: 2, s: 2, f: 3 },
        { srcIndex: 3, s: 3, f: 2 }, { srcIndex: 4, s: 4, f: 1 }, { srcIndex: 5, s: 5, f: 1 },
    ];
    const r = solveChord(spec, DROP_D, exact);
    assert.deepStrictEqual({ revoiced: r.revoiced, placements: r.placements }, { revoiced: false, placements: exact });
});

// Exact-candidate identity acceptance: a source voicing that violates
// the solver's own playability heuristics is still accepted verbatim
// (it was in the chart, so it's playable by definition).
test('solveChord: exact-candidate identity acceptance', () => {
    const notes = v([[0, 1], [1, 6]]); // 5-fret stretch
    const spec = chordSpecFromNotes(E_STD, notes, null);
    const exact = [{ srcIndex: 0, s: 0, f: 1 }, { srcIndex: 1, s: 1, f: 6 }];
    const r = solveChord(spec, E_STD, exact);
    assert.deepStrictEqual({ revoiced: r.revoiced, placements: r.placements }, { revoiced: false, placements: exact });
});

// A mandatory two-endpoint slide placement must take precedence over the
// otherwise-valid exact chord shortcut. This is the solver-level guard for
// alternate-string slide relocation.
test('solveChord: exact candidate cannot bypass a fixed slide placement', () => {
    const notes = v([[0, 5], [2, 2]]); // A2 + E3
    const spec = chordSpecFromNotes(E_STD, notes, null);
    const exact = [{ srcIndex: 0, s: 0, f: 5 }, { srcIndex: 1, s: 2, f: 2 }];
    const fixed = { srcIndex: 0, s: 1, f: 0, entry: { s: 1, f: 0, sl: 2 } };
    const r = solveChord(spec, E_STD, exact, 20, { fixedPlacements: [fixed] });
    assert.ok(r, 'fixed-placement chord remains solvable');
    assert.deepStrictEqual(r.revoiced, true, 'mismatched exact candidate is rejected');
    assert.deepStrictEqual(
        r.placements.find(placement => placement.srcIndex === 0),
        fixed,
        'searched voicing retains the complete fixed slide placement',
    );
});

// Degradation: a 5-note guitar chord onto a 4-string bass target can
// keep at most 4 notes; the solver still covers the chord's pitch
// classes with root retained, within playability.
test('solveChord: degradation, 5-note chord onto 4-string bass', () => {
    const notes = v([[1, 3], [2, 2], [3, 0], [4, 1], [5, 0]]); // open C, 5 notes
    const spec = chordSpecFromNotes(E_STD, notes, 'C');
    const r = solveChord(spec, EADG_BASS, null);
    assert.ok(r, 'C->bass: solvable');
    assert.ok(r.placements.length <= 4, 'C->bass: never more notes than strings');
    const sounded = r.placements.map(p => pitchClassOf(EADG_BASS[p.s] + p.f));
    assert.ok(sounded.includes(0), 'C->bass: root pc retained');
    const frets = r.placements.map(p => p.f).filter(f => f > 0);
    if (frets.length > 1) {
        assert.ok(Math.max(...frets) - Math.min(...frets) <= MAX_CHORD_SPAN, 'C->bass: span within box');
    }
});

test('solveChord: degenerate 1-string target bottoms out at a bare root', () => {
    const spec = chordSpecFromNotes(E_STD, v([[1, 3], [2, 2], [3, 0], [4, 1], [5, 0]]), 'C');
    const r = solveChord(spec, [40], null);
    assert.deepStrictEqual(r.placements.length, 1);
    assert.deepStrictEqual(pitchClassOf(40 + r.placements[0].f), 0);
    assert.deepStrictEqual(r.degradeLevel, degradationLadder(spec).length - 1);
});

test('solveChord: determinism, identical inputs give identical outputs', () => {
    const spec = chordSpecFromNotes(EB_STD, v([[0, 0], [1, 2], [2, 2], [3, 1], [4, 0], [5, 0]]), 'Eb');
    assert.deepStrictEqual(solveChord(spec, E_STD, null), solveChord(spec, E_STD, null));
});

// maxFret: solveVoicingSearch/solveChord treat the ceiling as a runtime
// parameter, defaulting to DEFAULT_MAX_FRET (the historical hardcoded
// 20 — every test above that omits it exercises that default) but
// honoring whatever value the caller passes.
test('maxFret is a runtime parameter, not a hardcoded ceiling', () => {
    // Single-string target tuned to pc 1 (MIDI 1): the root pc (C, pc 0)
    // only reappears at fret 11 (mod-12 periodicity, 1+11=12) or fret 23 —
    // nowhere reachable within a narrow ceiling.
    const oneStringTarget = [1];
    const spec = chordSpecFromNotes([12], v([[0, 0]]), 'C');
    assert.deepStrictEqual(solveVoicingSearch(spec, new Set([0]), oneStringTarget, undefined, 10), null);
    const found = solveVoicingSearch(spec, new Set([0]), oneStringTarget, undefined, 14);
    assert.ok(found, 'solveVoicingSearch: root pc found once the ceiling widens to 14');
    assert.deepStrictEqual(found.voicing[0].f, 11);

    const r = solveChord(spec, oneStringTarget, null, 14);
    assert.ok(r, 'solveChord: solvable once maxFret widens enough to reach the root');
    assert.deepStrictEqual(r.placements[0].f, 11);
    assert.deepStrictEqual(solveChord(spec, oneStringTarget, null, 10), null);
});

test('matchVoicingToSource: exact matches first, then same-pc nearest', () => {
    const spec = chordSpecFromNotes(E_STD, v([[1, 3], [2, 2], [3, 0]]), 'C'); // C3 E3 G3
    const m = matchVoicingToSource(vm(E_STD, [[2, 10], [3, 9], [4, 8]]), spec); // C4 E4 G4 (octave up)
    assert.deepStrictEqual(m.map(p => p.srcIndex).sort((a, b) => a - b), [0, 1, 2]);
});

/* ── createRetuner() integration — the same path screen.js's draw() uses ── */

const EADGBE_TARGET = CR.resolveTargetTuning(['E2', 'A2', 'D3', 'G3', 'B3', 'E4']).midiTuning;
const DROP_D_TARGET = CR.resolveTargetTuning(['D2', 'A2', 'D3', 'G3', 'B3', 'E4']).midiTuning;

// Bundle factory: a 6-string guitar chart. `tuning` is per-string offsets
// from standard, notes/chords/templates as feedBack supplies them.
function guitarBundle({ tuning = [0, 0, 0, 0, 0, 0], capo = 0, notes = [], chords = [], templates = [], anchors = [] }) {
    return {
        notes, chords, anchors, chordTemplates: templates,
        tuning, capo, stringCount: tuning.length,
    };
}
const sf = ns => ns.map(({ s, f }) => ({ s, f })).sort((a, b) => a.s - b.s);

// Identity: an E-standard chart on an EADGBE target remaps every open
// chord byte-identically (the exact candidate), template included,
// fingers carried.
test('createRetuner: E-standard chart on EADGBE target is the identity', () => {
    const retuner = CR.createRetuner();
    const tmpl = { name: 'C', frets: [-1, 3, 2, 0, 1, 0], fingers: [-1, 3, 2, 0, 1, 0] };
    const chord = { t: 1, id: 0, notes: v([[1, 3], [2, 2], [3, 0], [4, 1], [5, 0]]) };
    const bundle = guitarBundle({ chords: [chord], templates: [tmpl] });
    retuner.apply(bundle, EADGBE_TARGET);
    assert.deepStrictEqual(sf(bundle.chords[0].notes), v([[1, 3], [2, 2], [3, 0], [4, 1], [5, 0]]));
    assert.deepStrictEqual(bundle.chordTemplates[0].frets, [-1, 3, 2, 0, 1, 0]);
    assert.deepStrictEqual(bundle.chordTemplates[0].fingers, [-1, 3, 2, 0, 1, 0]);
    assert.deepStrictEqual(bundle.chords[0].t, 1);
    assert.ok(bundle.chords[0].notes.every(n => chord.notes.includes(n.origNote)),
        'identity apply: every note keeps an origNote reference into the raw chord');
});

// E-standard open E (022100) onto a Drop-D target: the exact candidate
// maps the low string +2 and the rest unchanged (222100); the carried
// finger 0 on a now-fretted string is invalid, so fingers are re-derived.
test('createRetuner: E-standard open E onto Drop-D target', () => {
    const retuner = CR.createRetuner();
    const tmpl = { name: 'E', frets: [0, 2, 2, 1, 0, 0], fingers: [0, 2, 3, 1, 0, 0] };
    const chord = { t: 0, id: 0, notes: v([[0, 0], [1, 2], [2, 2], [3, 1], [4, 0], [5, 0]]) };
    const bundle = guitarBundle({ chords: [chord], templates: [tmpl] });
    retuner.apply(bundle, DROP_D_TARGET);
    assert.deepStrictEqual(sf(bundle.chords[0].notes), v([[0, 2], [1, 2], [2, 2], [3, 1], [4, 0], [5, 0]]));
    assert.deepStrictEqual(bundle.chordTemplates[0].frets, [2, 2, 2, 1, 0, 0]);
    assert.deepStrictEqual(bundle.chordTemplates[0].fingers, [2, 3, 4, 1, 0, 0]);
});

// Capo-2 D major (source span-1); exact reproduction needs span-3, so it revoices to span-1.
test('createRetuner: capo-2 chart with open strings onto E-standard', () => {
    const retuner = CR.createRetuner();
    const tmpl = { name: 'D', frets: [-1, 5, 4, 0, 3, 0], fingers: [-1, 3, 2, 0, 1, 0] };
    const chord = { t: 0, id: 0, notes: v([[1, 5], [2, 4], [3, 0], [4, 3], [5, 0]]) };
    const bundle = guitarBundle({ capo: 2, chords: [chord], templates: [tmpl] });
    retuner.apply(bundle, E_STD);
    assert.deepStrictEqual(sf(bundle.chords[0].notes), v([[2, 0], [3, 2], [4, 3], [5, 2]]));
    assert.deepStrictEqual(bundle.chordTemplates[0].frets, [-1, -1, 0, 2, 3, 2]);
    assert.deepStrictEqual(bundle.chordTemplates[0].fingers, [-1, -1, 0, 1, 3, 2]);

    // Still genuine D major (D=2, F#=6, A=9) — revoicing must not change
    // what the chord actually is, only how comfortably it's played.
    const D_MAJOR_PCS = new Set([2, 6, 9]);
    for (const { s, f } of bundle.chords[0].notes) {
        const pc = (E_STD[s] + f) % 12;
        assert.ok(D_MAJOR_PCS.has(pc), `string ${s} fret ${f} (pc ${pc}) is not a D major tone`);
    }
});

// Regression (Oasis "Wonderwall"): capo-2 F#m7 mixing open/fretted notes must stay valid F#m7.
test('createRetuner: Wonderwall-style capo-2 F#m7 with mixed open/fretted notes', () => {
    const retuner = CR.createRetuner();
    const tmpl = { name: 'F#m7', frets: [0, 4, 4, 0, 5, 5], fingers: [-1, 1, 2, -1, 3, 4] };
    const chord = { t: 12.776, id: 0, notes: v([[0, 0], [1, 4], [2, 4], [3, 0], [4, 5], [5, 5]]) };
    const bundle = guitarBundle({ capo: 2, chords: [chord], templates: [tmpl] });
    retuner.apply(bundle, E_STD);
    assert.deepStrictEqual(sf(bundle.chords[0].notes), v([[0, 2], [1, 0], [2, 2], [3, 2], [4, 2], [5, 0]]));
    assert.deepStrictEqual(bundle.chordTemplates[0].frets, [2, 0, 2, 2, 2, 0]);
    assert.deepStrictEqual(bundle.chordTemplates[0].fingers, [1, 0, 2, 3, 4, 0]);

    // Every note is a real F#m7 tone (F#=6, A=9, C#=1, E=4) — the bug this
    // guards against produced 3 of 6 notes outside the chord entirely.
    const F_SHARP_M7_PCS = new Set([6, 9, 1, 4]);
    for (const { s, f } of bundle.chords[0].notes) {
        const pc = (E_STD[s] + f) % 12;
        assert.ok(F_SHARP_M7_PCS.has(pc), `string ${s} fret ${f} (pc ${pc}) is not an F#m7 tone`);
    }
});

// Eb-standard chart on E-standard: root stays in bass (x-x-1-3-4-3). The
// 2-note subset (both fretted, no open note) doesn't get registerFlexible.
test('createRetuner: Eb-standard chart on E-standard target', () => {
    const retuner = CR.createRetuner();
    const tmpl = { name: 'Eb', frets: [0, 2, 2, 1, 0, 0], fingers: [0, 2, 3, 1, 0, 0] };
    const full = { t: 0, id: 0, notes: v([[0, 0], [1, 2], [2, 2], [3, 1], [4, 0], [5, 0]]) };
    // A difficulty-filtered subset instance (source strings 1+2 only) —
    // must take the template solution's placements for those strings.
    const subset = { t: 2, id: 0, notes: v([[1, 2], [2, 2]]) };
    const bundle = guitarBundle({ tuning: [-1, -1, -1, -1, -1, -1], chords: [full, subset], templates: [tmpl] });
    retuner.apply(bundle, E_STD);
    assert.deepStrictEqual(sf(bundle.chords[0].notes), v([[2, 1], [3, 3], [4, 4], [5, 3]]));
    assert.deepStrictEqual(bundle.chordTemplates[0].frets, [-1, -1, 1, 3, 4, 3]);
    assert.deepStrictEqual(sf(bundle.chords[1].notes), v([[1, 1], [2, 1]]));
    assert.ok(bundle.chords[1].notes.every(n => subset.notes.includes(n.origNote)),
        'Eb->E apply: subset notes reference their own raw notes');
});

// Drop-D chart's flat-note D5 bucket (three same-onset notes) on an
// E-standard target: the below-range D2 drops, but the open D string
// keeps the root in the bass instead of fretting the A string up to it.
test('createRetuner: Drop-D flat-note D5 bucket onto E-standard', () => {
    const retuner = CR.createRetuner();
    const rawNotes = [{ t: 0, s: 0, f: 0 }, { t: 0, s: 1, f: 0 }, { t: 0, s: 2, f: 0 }, { t: 1, s: 2, f: 5 }];
    const bundle = guitarBundle({ tuning: [-2, 0, 0, 0, 0, 0], notes: rawNotes });
    retuner.apply(bundle, E_STD);
    const atZero = bundle.notes.filter(n => n.t === 0);
    assert.deepStrictEqual(sf(atZero), v([[2, 0], [3, 2], [4, 3]]));
    assert.deepStrictEqual(sf(bundle.notes.filter(n => n.t === 1)), v([[2, 5]]));
    assert.ok(bundle.notes.every(n => rawNotes.includes(n.origNote)),
        'DropD D5 bucket: origNote references the raw source notes');
});

test('createRetuner: chord slide on a revoiced chord', () => {
    // Eb-standard 2-note power chord with a +2 slide on both notes.
    const retuner = CR.createRetuner();
    const chord = { t: 0, id: 0, notes: [{ s: 1, f: 1, sl: 3 }, { s: 2, f: 3, sl: 5 }] };
    const tmpl = { name: 'Bb5', frets: [-1, 1, 3, -1, -1, -1], fingers: [-1, 1, 3, -1, -1, -1] };
    const bundle = guitarBundle({ tuning: [-1, -1, -1, -1, -1, -1], chords: [chord], templates: [tmpl] });
    retuner.apply(bundle, E_STD);
    const ns = bundle.chords[0].notes.slice().sort((a, b) => a.s - b.s);
    assert.deepStrictEqual(ns.every(n => Number.isInteger(n.sl) && n.sl >= 0 && n.sl <= 20), true);
    assert.deepStrictEqual(ns.map(n => n.sl - n.f), [2, 2]);
});

test('createRetuner: chart-capo slide pins both sounding pitches during chord revoicing', () => {
    // Seven-string B/E notes both sound F#2 at the onset, forcing the
    // ordinary chord path to revoice their collision. The slide's raw
    // 0 -> 4 becomes sounding fret 2 -> 4 under the chart's capo 2.
    const slide = { t: 0, s: 1, f: 0, sl: 4 };
    const collision = { t: 0, s: 0, f: 7 };
    const bundle = guitarBundle({
        tuning: [0, 0, 0, 0, 0, 0, 0],
        capo: 2,
        notes: [slide, collision],
    });
    CR.createRetuner({
        capoOutputMode: CR.CAPO_OUTPUT_MODES.CHART_TRANSFORM_CONTRACT,
    }).apply(bundle, E_STD);

    const remappedSlide = bundle.notes.find(note => note.origNote === slide);
    assert.ok(remappedSlide);
    assert.equal(remappedSlide.crRevoiced, true);
    assert.deepStrictEqual(
        { s: remappedSlide.s, f: remappedSlide.f, sl: remappedSlide.sl },
        { s: 0, f: 2, sl: 4 },
    );
    assert.equal(E_STD[remappedSlide.s] + remappedSlide.f, 42);
    assert.equal(E_STD[remappedSlide.s] + remappedSlide.sl, 44);
});

test('createRetuner: a pinned exact slide wins a one-string collision', () => {
    const slide = { t: 0, s: 0, f: 0, sl: 2 };
    const otherTone = { t: 0, s: 1, f: 0 };
    const bundle = guitarBundle({ notes: [slide, otherTone] });

    CR.createRetuner().apply(bundle, [40]);

    assert.deepStrictEqual(bundle.notes.map(note => note.origNote), [slide]);
    assert.deepStrictEqual(
        { s: bundle.notes[0].s, f: bundle.notes[0].f, sl: bundle.notes[0].sl },
        { s: 0, f: 0, sl: 2 },
    );
});

test('createRetuner: an impossible exact slide is dropped, not shortened', () => {
    const impossibleSlide = { t: 0, s: 0, f: 0, sl: 25 };
    const playableTone = { t: 0, s: 1, f: 0 };
    const bundle = guitarBundle({ notes: [impossibleSlide, playableTone] });

    CR.createRetuner().apply(bundle, E_STD, 20);

    assert.equal(bundle.notes.some(note => note.origNote === impossibleSlide), false);
    assert.equal(bundle.notes.some(note => note.origNote === playableTone), true);
    assert.equal(bundle.notes.some(note => Number.isInteger(note.sl) && note.sl >= 0), false);
});

// Bass regression through apply(): a clean simultaneous pair on the
// default BEADG target behaves exactly as the pre-solver engine (the
// exact candidate == the per-note remap), keeping techniques and
// origNote wiring.
test('createRetuner: bass regression, clean pair on default BEADG', () => {
    const retuner = CR.createRetuner();
    const rawNotes = [{ t: 0, s: 1, f: 2, sus: 0.5 }, { t: 0, s: 2, f: 0 }];
    const bundle = {
        notes: rawNotes, chords: [], anchors: [], chordTemplates: [],
        tuning: [0, 0, 0, 0], capo: 0, stringCount: 4,
    };
    retuner.apply(bundle); // default BEADG-shaped target, k = +1
    assert.deepStrictEqual(sf(bundle.notes), v([[2, 2], [3, 0]]));
    assert.deepStrictEqual(bundle.notes.find(n => n.s === 2).sus, 0.5);
    assert.ok(bundle.notes.every(n => rawNotes.includes(n.origNote)), 'bass double-stop: origNote wired');
});

// Bass improvement pin (behavior change vs the pre-solver engine,
// deliberate): a bucket whose notes COLLIDE on one target string no
// longer loses a pitch class — the solver revoices instead. Source
// strings share open MIDI 33 (tuning [+5,0,0,0]); f5 on string 0 and
// f2 on string 1 both used to fight for one slot, dropping one.
test('createRetuner: bass improvement pin, colliding notes revoice', () => {
    const retuner = CR.createRetuner();
    const rawNotes = [{ t: 0, s: 0, f: 5 }, { t: 0, s: 1, f: 2 }];
    const bundle = {
        notes: rawNotes, chords: [], anchors: [], chordTemplates: [],
        tuning: [5, 0, 0, 0], capo: 0, stringCount: 4,
    };
    retuner.apply(bundle); // default BEADG-shaped target
    const target = CR.DEFAULT_TARGET_MIDI_TUNING;
    const pitches = bundle.notes.map(n => target[n.s] + n.f).sort((a, b) => a - b);
    assert.deepStrictEqual(pitches, [35, 38]);
    assert.deepStrictEqual(new Set(bundle.notes.map(n => n.s)).size, bundle.notes.length);
});

// 7-string GP source onto a 6-string EADGBE target: low-string chord
// content degrades gracefully per chord, the pipeline stays stable
// throughout, and single notes below range still drop.
test('createRetuner: 7-string GP source onto 6-string EADGBE target', () => {
    const retuner = CR.createRetuner();
    const chord = { t: 0, id: 0, notes: v([[0, 0], [1, 0], [2, 0]]) }; // B1 E2 A2
    const tmpl = { name: null, frets: [0, 0, 0, -1, -1, -1, -1], fingers: [-1, -1, -1, -1, -1, -1, -1] };
    const bundle = {
        notes: [{ t: 1, s: 0, f: 0 }], chords: [chord], anchors: [], chordTemplates: [tmpl],
        tuning: [0, 0, 0, 0, 0, 0, 0], capo: 0, stringCount: 7,
    };
    retuner.apply(bundle, EADGBE_TARGET);
    assert.strictEqual(bundle.chords.length, 1, '7-string: chord survives');
    assert.ok(bundle.chords[0].notes.length >= 2, '7-string: chord survives with a revoiced low end');
    const pcs = bundle.chords[0].notes.map(n => pitchClassOf(EADGBE_TARGET[n.s] + n.f));
    assert.ok(pcs.includes(11), '7-string: root pc (B) retained');
    assert.deepStrictEqual(bundle.notes.length, 0);
});

// Mid-run target switch re-solves chords from the RAW chart (cache
// invalidation), mirroring the live tuning-switch contract for notes.
test('createRetuner: mid-run target switch re-solves from the raw chart', () => {
    const retuner = CR.createRetuner();
    const tmpl = { name: 'E', frets: [0, 2, 2, 1, 0, 0], fingers: [0, 2, 3, 1, 0, 0] };
    const rawChords = [{ t: 0, id: 0, notes: v([[0, 0], [1, 2], [2, 2], [3, 1], [4, 0], [5, 0]]) }];
    const bundle = guitarBundle({ chords: rawChords, templates: [tmpl] });
    retuner.apply(bundle, EADGBE_TARGET);
    assert.deepStrictEqual(sf(bundle.chords[0].notes), v([[0, 0], [1, 2], [2, 2], [3, 1], [4, 0], [5, 0]]));
    bundle.chords = rawChords;
    bundle.chordTemplates = [tmpl];
    retuner.apply(bundle, DROP_D_TARGET);
    assert.deepStrictEqual(sf(bundle.chords[0].notes), v([[0, 2], [1, 2], [2, 2], [3, 1], [4, 0], [5, 0]]));
});

/* ── Review-fix regressions (post-Phase-13 code review) ─────────────────── */

// A null chord id must NOT alias template index 0 (Number(null) === 0):
// a null-id chord behaves exactly like one referencing a nonexistent
// template, even when its shape coincidentally matches template 0's.
test('createRetuner: null chord id does not alias template index 0', () => {
    const tmpl0 = { name: 'C/G', frets: [0, 2, 2, 1, 0, 0], fingers: [0, 2, 3, 1, 0, 0] };
    const solveWithId = id => {
        const chord = { t: 0, id, notes: v([[0, 0], [1, 2], [2, 2], [3, 1], [4, 0], [5, 0]]) };
        const b = guitarBundle({ chords: [chord], templates: [tmpl0] });
        CR.createRetuner().apply(b, DROP_D_TARGET);
        return sf(b.chords[0].notes);
    };
    assert.deepStrictEqual(solveWithId(null), solveWithId(999));
    assert.deepStrictEqual(solveWithId(undefined), solveWithId(999));
});

// Duplicate source strings within one chord instance (malformed chart)
// dedup to one note per string on the template-first path, first wins —
// the same one-note-per-slot invariant every other remap path keeps.
test('createRetuner: duplicate source strings dedup to one note per string', () => {
    const tmpl = { name: 'X', frets: [0, 2, 2, 1, 0, 0], fingers: [-1, -1, -1, -1, -1, -1] };
    const dup = { t: 0, id: 0, notes: v([[1, 2], [1, 2], [2, 2], [3, 1], [4, 0], [5, 0], [0, 0]]) };
    const b = guitarBundle({ chords: [dup], templates: [tmpl] });
    CR.createRetuner().apply(b, E_STD);
    const strings = b.chords[0].notes.map(n => n.s);
    assert.deepStrictEqual(b.chords[0].notes.length, 6);
    assert.deepStrictEqual(new Set(strings).size, strings.length);
});

// Sliding chords skip the template-first shortcut and keep remapSlide's
// exact two-endpoint placement. On this non-monotonic target the plain-fret
// template solve lands source string 1 on target string 0 at fret 20 —
// the chord instance also uses target string 0 because it is the only
// string that can sound both MIDI 60 -> 45 without endpoint clamping.
test('createRetuner: sliding chords skip the template-first shortcut', () => {
    const tmpl = { name: 'X', frets: [-1, 15, -1, 0, -1, -1], fingers: [-1, -1, -1, -1, -1, -1] };
    const chord = { t: 0, id: 0, notes: [{ s: 1, f: 15, slu: 0 }, { s: 3, f: 0 }] };
    const target = [40, 35, 62, 55, 59, 64];
    const b = guitarBundle({ chords: [chord], templates: [tmpl] });
    CR.createRetuner().apply(b, target);
    assert.deepStrictEqual(b.chords[0].notes.map(({ s, f, slu }) => ({ s, f, slu })).sort((a, b2) => a.s - b2.s),
        [{ s: 0, f: 20, slu: 5 }, { s: 3, f: 0, slu: undefined }]);
    assert.equal(target[0] + 20, E_STD[1] + 15);
    assert.equal(target[0] + 5, E_STD[1]);
    assert.deepStrictEqual(b.chordTemplates[0].frets, [20, -1, -1, 0, -1, -1]);
});

// A degenerate source span (>= 20 frets, extreme GP import) widens the
// search window instead of emptying the position loop: the chord solves
// rather than silently dropping.
test('solveChord: degenerate 20-fret source span still solves', () => {
    const spec = chordSpecFromNotes(E_STD, v([[0, 1], [1, 21]]), null);
    const r = solveChord(spec, E_STD, null);
    assert.deepStrictEqual(!!r, true);
    assert.deepStrictEqual(r.placements.map(p => pitchClassOf(E_STD[p.s] + p.f)).sort((a, b) => a - b),
        [...spec.pcs].sort((a, b) => a - b));
});

// A template whose chart omitted finger data entirely (fingers not an
// array — distinct from GP's all--1 arrays) keeps that omission after
// remapping, matching the pre-solver engine: no fabricated digits.
test('createRetuner: template with omitted finger data stays omitted', () => {
    const tmpl = { name: 'X', frets: [0, 2, 2, 1, 0, 0] };
    const b = guitarBundle({ templates: [tmpl] });
    CR.createRetuner().apply(b, EADGBE_TARGET);
    assert.deepStrictEqual(b.chordTemplates[0].fingers, undefined);
    assert.deepStrictEqual(b.chordTemplates[0].frets, [0, 2, 2, 1, 0, 0]);
});

test('computeChordFingers', () => {
    assert.deepStrictEqual(computeChordFingers([0, 2, 2, 1, 0, 0]), [0, 2, 3, 1, 0, 0]);
    assert.deepStrictEqual(computeChordFingers([1, 3, 3, 2, 1, 1]), [1, 3, 4, 2, 1, 1]);
    assert.deepStrictEqual(computeChordFingers([3, 5, 5, 4, 3, 3]), [1, 3, 4, 2, 1, 1]);
    assert.deepStrictEqual(computeChordFingers([-1, 3, 2, 0, 1, -1]), [-1, 3, 2, 0, 1, -1]);
    assert.deepStrictEqual(computeChordFingers([0, 0, -1]), [0, 0, -1]);
    // Drop-D F shape: min-fret barre (1s) + 3-3-3 needs run grouping.
    assert.deepStrictEqual(computeChordFingers([3, 3, 3, 2, 1, 1]), [3, 3, 3, 2, 1, 1]);
    // Five distinct, non-adjacent-or-shared frets: no barre (no fret shared
    // by 2+ strings) and no mini-barre run collapses any pair, so 5 runs
    // still need more fingers than MAX_FRETTING_FINGERS (4) — ambiguous,
    // every fretted string returns -1.
    assert.deepStrictEqual(computeChordFingers([1, 2, 3, 4, 5, -1]), [-1, -1, -1, -1, -1, -1]);
});

// Node budget (MAX_SEARCH_NODES / opts.budget) — the pathological-chart
// safety valve: the search must terminate under a tiny budget, report
// the abort, and behave identically to before when the budget is ample.
test('solveChord: node budget pathological-chart safety valve', () => {
    const { MAX_SEARCH_NODES } = CR;
    assert.ok(Number.isInteger(MAX_SEARCH_NODES) && MAX_SEARCH_NODES > 0, 'MAX_SEARCH_NODES sane');

    // A deliberately heavy search: 8-string wide-open target, an 8-note
    // source chord of 8 distinct pitch classes spanning 20 frets — the
    // huge span widens allowedSpan to the whole neck, and every string
    // offers many qualifying frets per pc, defeating the usual pruning.
    const WIDE8 = [28, 33, 38, 43, 48, 53, 58, 63];
    const heavyNotes = v([[0, 0], [1, 2], [2, 4], [3, 6], [4, 9], [5, 13], [6, 17], [7, 20]]);
    const heavySpec = chordSpecFromNotes(WIDE8, heavyNotes, null);

    const tiny = { nodes: 50, aborted: false };
    solveChord(heavySpec, WIDE8, null, 24, { budget: tiny });
    assert.deepStrictEqual(tiny.aborted, true);
    assert.ok(tiny.nodes <= 0, 'tiny budget consumed');

    // One shared budget spans the whole solveChord call: after a heavy
    // solve, later ladder levels draw from whatever budget remains,
    // carried forward level to level.
    const shared = { nodes: 200, aborted: false };
    solveChord(heavySpec, WIDE8, null, 24, { budget: shared });
    assert.ok(shared.nodes <= 0 && shared.aborted, 'shared budget spans the degradation ladder');

    // An ample explicit budget must not change the result vs. the
    // default path (same chord solved with and without opts).
    const spec = chordSpecFromNotes(E_STD, v([[0, 0], [1, 2], [2, 2], [3, 1], [4, 0], [5, 0]]), 'E');
    const ample = { nodes: MAX_SEARCH_NODES, aborted: false };
    assert.deepStrictEqual(solveChord(spec, DROP_D, null, 20, { budget: ample }),
        solveChord(spec, DROP_D, null, 20));
    assert.deepStrictEqual(ample.aborted, false);
});
