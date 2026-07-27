// Standalone Node verification for the chord-aware remapping solver
// (src/chord-solver.js) plus its createRetuner() integration. Imports
// the real modules from ../src/chart-retune.js — no hand-synced
// duplicate. Run with `node test/chord-solver.test.mjs`.
import assert from 'node:assert';
import { CR } from '../src/chart-retune.js';

const {
    MAX_CHORD_SPAN,
    MAX_FRETTING_FINGERS,
    SOLVER_WEIGHTS,
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
} = CR;

let passed = 0;
function check(label, actual, expected) {
    assert.deepStrictEqual(actual, expected, `${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    passed++;
}

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
    return { s, f, midi, pc: ((midi % 12) + 12) % 12 };
});
// Ladder rungs -> sorted arrays for order-insensitive comparison.
const rungsAsArrays = ladder => ladder.map(set => [...set].sort((a, b) => a - b));
// Solver voicing -> [{s,f}] sorted by string for stable comparison.
const shape = voicing => voicing.map(({ s, f }) => ({ s, f })).sort((a, b) => a.s - b.s);

// parseChordRootFromName.
{
    check('root: Am7', parseChordRootFromName('Am7'), { rootPc: 9, bassPc: null });
    check('root: C/G slash bass', parseChordRootFromName('C/G'), { rootPc: 0, bassPc: 7 });
    check('root: D/F# sharp slash bass', parseChordRootFromName('D/F#'), { rootPc: 2, bassPc: 6 });
    check('root: F#5', parseChordRootFromName('F#5'), { rootPc: 6, bassPc: null });
    check('root: Bb flat', parseChordRootFromName('Bb'), { rootPc: 10, bassPc: null });
    check('root: lowercase letter accepted', parseChordRootFromName('e'), { rootPc: 4, bassPc: null });
    check('root: bare number is not a chord name', parseChordRootFromName('5'), null);
    check('root: empty string', parseChordRootFromName(''), null);
    check('root: non-string', parseChordRootFromName(undefined), null);
}

// fingersNeeded / barreIsValid.
{
    check('fingers: all open = 0', fingersNeeded(v([[0, 0], [1, 0], [2, 0]])), 0);
    // Open E 022100: the 2-2 contiguous run is one finger, the 1 another.
    check('fingers: open E (022100) = 2 (run grouping)',
        fingersNeeded(v([[0, 0], [1, 2], [2, 2], [3, 1], [4, 0], [5, 0]])), 2);
    // F barre 133211: barre the three 1s, run the 3-3, plus the 2.
    check('fingers: F barre (133211) = 3',
        fingersNeeded(v([[0, 1], [1, 3], [2, 3], [3, 2], [4, 1], [5, 1]])), 3);
    // Drop-D F shape 333211: min-fret barre on the two 1s + 3-3-3 run + the 2.
    check('fingers: Drop-D F shape (333211) = 3',
        fingersNeeded(v([[0, 3], [1, 3], [2, 3], [3, 2], [4, 1], [5, 1]])), 3);
    // A major x02220: open high E invalidates a barre, but 2-2-2 is one run.
    check('fingers: A major (x02220) = 1',
        fingersNeeded(v([[1, 0], [2, 2], [3, 2], [4, 2], [5, 0]])), 1);
    check('fingers: G major (320003) = 3',
        fingersNeeded(v([[0, 3], [1, 2], [2, 0], [3, 0], [4, 0], [5, 3]])), 3);
    // No barre (single min-fret note), no runs (nothing contiguous same-fret).
    check('fingers: scattered 5 fretted notes = 5',
        fingersNeeded(v([[0, 1], [1, 3], [2, 2], [3, 4], [4, 3]])), 5);

    check('barre: open string above the barred span invalidates it',
        barreIsValid(v([[1, 1], [2, 1], [3, 0]])), false);
    check('barre: no sounded opens at/above the barre is valid',
        barreIsValid(v([[0, 1], [4, 1], [5, 1], [3, 2]])), true);
    check('barre: needs two notes at the same fret',
        barreIsValid(v([[0, 1], [1, 2]])), false);
    check('barre: open BELOW the barred span is fine',
        barreIsValid(v([[0, 0], [1, 2], [2, 2]])), true);
}

// voicingPlayable — hard span/finger constraints, source-relative.
{
    const tight = { span: 0, fingers: 0 };
    check('playable: span 5 exceeds the 4-fret box', voicingPlayable(v([[0, 1], [1, 6]]), tight), false);
    check('playable: span 3 is the box edge', voicingPlayable(v([[0, 1], [1, 4]]), tight), true);
    check('playable: a source that stretched 5 keeps its allowance',
        voicingPlayable(v([[0, 1], [1, 6]]), { span: 5, fingers: 0 }), true);
    const fiveFingers = v([[0, 1], [1, 3], [2, 2], [3, 4], [4, 3]]);
    check('playable: 5 ungroupable fretted notes fail', voicingPlayable(fiveFingers, tight), false);
    check('playable: ...unless the source itself needed 5',
        voicingPlayable(fiveFingers, { span: 3, fingers: 5 }), true);
}

// chordSpecFromNotes — open C (x32010) in E standard.
{
    const notes = v([[1, 3], [2, 2], [3, 0], [4, 1], [5, 0]]);
    const spec = chordSpecFromNotes(E_STD, notes, 'C');
    check('spec: sounded pitches', [...spec.pitchSet].sort((a, b) => a - b), [48, 52, 55, 60, 64]);
    check('spec: pitch classes', [...spec.pcs].sort((a, b) => a - b), [0, 4, 7]);
    check('spec: pc counts', [...spec.pcCounts.entries()].sort((a, b) => a[0] - b[0]), [[0, 2], [4, 2], [7, 1]]);
    check('spec: root from name', spec.rootPc, 0);
    check('spec: no slash bass', spec.bassPc, null);
    check('spec: bass midi', spec.bassMidi, 48);
    check('spec: min fretted / span', { minFretted: spec.minFretted, span: spec.span }, { minFretted: 1, span: 2 });
    check('spec: open count / note count', { o: spec.openCount, n: spec.noteCount }, { o: 2, n: 5 });
    check('spec: no barre required', spec.requiresBarre, false);

    const junkName = chordSpecFromNotes(E_STD, notes, '<junk>');
    check('spec: unparseable name falls back to lowest pitch root', junkName.rootPc, 0);
    const wrongName = chordSpecFromNotes(E_STD, notes, 'B');
    check('spec: name contradicting the sounded pcs falls back to lowest pitch root', wrongName.rootPc, 0);
    const slash = chordSpecFromNotes(E_STD, notes, 'C/G');
    check('spec: slash bass kept when its pc is sounded', slash.bassPc, 7);

    const withNull = chordSpecFromNotes([null, 45, 50, 55, 59, 64], v([[0, 0], [1, 3]]), null);
    check('spec: notes on null-open strings are skipped', withNull.notes.map(n => n.idx), [1]);
    check('spec: nothing sounded -> null', chordSpecFromNotes([null], v([[0, 2]]), null), null);
}

// degradationLadder.
{
    const cMaj = chordSpecFromNotes(E_STD, v([[1, 3], [2, 2], [3, 0], [4, 1], [5, 0]]), 'C');
    check('ladder: major triad chord = full -> root+5th -> root',
        rungsAsArrays(degradationLadder(cMaj)), [[0, 4, 7], [0, 7], [0]]);
    // Am7 (x02010): A2 E3 G3 C4 E4 -> pcs {9,4,7,0}, root 9.
    const am7 = chordSpecFromNotes(E_STD, v([[1, 0], [2, 2], [3, 0], [4, 1], [5, 0]]), 'Am7');
    check('ladder: 7th chord = full -> triad -> dyad -> root',
        rungsAsArrays(degradationLadder(am7)), [[0, 4, 7, 9], [0, 4, 9], [4, 9], [9]]);
    // D5 in Drop D (000xxx): D2 A2 D3 -> pcs {2,9}, no third.
    const d5 = chordSpecFromNotes(DROP_D, v([[0, 0], [1, 0], [2, 0]]), 'D5');
    check('ladder: power chord = dyad -> root',
        rungsAsArrays(degradationLadder(d5)), [[2, 9], [2]]);
}

// scoreVoicing — the source voicing itself scores 0.
{
    const notes = v([[1, 3], [2, 2], [3, 0], [4, 1], [5, 0]]);
    const spec = chordSpecFromNotes(E_STD, notes, 'C');
    check('score: identity voicing costs 0', scoreVoicing(spec, vm(E_STD, [[1, 3], [2, 2], [3, 0], [4, 1], [5, 0]])), 0);
    // Muting an inner string is penalized.
    const gap = scoreVoicing(spec, vm(E_STD, [[1, 3], [2, 2], [4, 1], [5, 0]]));
    assert.ok(gap > 0, 'score: dropping an inner note costs > 0');
    passed++;
}

// solveVoicingSearch — identity recovery: the source shape is the unique
// zero-cost voicing when source and target tunings agree.
{
    const spec = chordSpecFromNotes(E_STD, v([[1, 3], [2, 2], [3, 0], [4, 1], [5, 0]]), 'C');
    const found = solveVoicingSearch(spec, spec.pcs, E_STD, { maxNotes: spec.noteCount });
    check('search: identity cost 0', found.cost, 0);
    check('search: identity shape', shape(found.voicing), v([[1, 3], [2, 2], [3, 0], [4, 1], [5, 0]]));
}

// solveChord — Eb-standard open-E-shape (022100, sounds Eb major) onto an
// E-standard guitar. No exact-open mapping exists (root Eb2 is below the
// instrument); the solver revoices near the open position instead of
// jumping to a distant barre: x-1-1-0-4-x = Bb2 Eb3 G3 Eb4.
{
    const notes = v([[0, 0], [1, 2], [2, 2], [3, 1], [4, 0], [5, 0]]);
    const spec = chordSpecFromNotes(EB_STD, notes, 'Eb');
    const r = solveChord(spec, E_STD, null);
    check('Eb->E: revoiced/rung', { revoiced: r.revoiced, rung: r.rung }, { revoiced: true, rung: 0 });
    check('Eb->E: revoiced near open position',
        r.placements.map(({ s, f }) => ({ s, f })).sort((a, b) => a.s - b.s),
        v([[1, 1], [2, 1], [3, 0], [4, 4]]));
    check('Eb->E: matched back to distinct source notes',
        r.placements.map(p => p.srcIndex).sort((a, b) => a - b), [1, 2, 3, 5]);
}

// solveChord — Drop-D D5 (000xxx) onto E standard: the below-range D2
// drops, the two playable original pitches (A2, D3) survive as opens —
// same notes today's per-note engine keeps, found via the search.
{
    const spec = chordSpecFromNotes(DROP_D, v([[0, 0], [1, 0], [2, 0]]), 'D5');
    const r = solveChord(spec, E_STD, null);
    check('D5->E: revoiced', r.revoiced, true);
    check('D5->E: playable original pitches survive as opens',
        r.placements.map(({ s, f }) => ({ s, f })).sort((a, b) => a.s - b.s),
        v([[1, 0], [2, 0]]));
}

// solveChord — exact candidate: F barre (133211) in E standard onto
// Drop D. The per-note engine maps it exactly to 333211 (low string +2,
// rest unchanged) and the mini-barre run grouping recognizes it as playable.
{
    const spec = chordSpecFromNotes(E_STD, v([[0, 1], [1, 3], [2, 3], [3, 2], [4, 1], [5, 1]]), 'F');
    const exact = [
        { srcIndex: 0, s: 0, f: 3 }, { srcIndex: 1, s: 1, f: 3 }, { srcIndex: 2, s: 2, f: 3 },
        { srcIndex: 3, s: 3, f: 2 }, { srcIndex: 4, s: 4, f: 1 }, { srcIndex: 5, s: 5, f: 1 },
    ];
    const r = solveChord(spec, DROP_D, exact);
    check('F->DropD: exact per-note remap accepted', { revoiced: r.revoiced, placements: r.placements }, { revoiced: false, placements: exact });
}

// solveChord — exact-candidate identity acceptance: a source voicing that
// violates the solver's own playability heuristics is still accepted
// verbatim (it was in the chart, so it's playable by definition).
{
    const notes = v([[0, 1], [1, 6]]); // 5-fret stretch
    const spec = chordSpecFromNotes(E_STD, notes, null);
    const exact = [{ srcIndex: 0, s: 0, f: 1 }, { srcIndex: 1, s: 1, f: 6 }];
    const r = solveChord(spec, E_STD, exact);
    check('identity: chart-given stretch accepted', { revoiced: r.revoiced, placements: r.placements }, { revoiced: false, placements: exact });
}

// solveChord — degradation: a 5-note guitar chord onto a 4-string bass
// target can keep at most 4 notes; the solver still covers the chord's
// pitch classes with root retained, within playability.
{
    const notes = v([[1, 3], [2, 2], [3, 0], [4, 1], [5, 0]]); // open C, 5 notes
    const spec = chordSpecFromNotes(E_STD, notes, 'C');
    const r = solveChord(spec, EADG_BASS, null);
    assert.ok(r, 'C->bass: solvable');
    assert.ok(r.placements.length <= 4, 'C->bass: never more notes than strings');
    const sounded = r.placements.map(p => {
        const midi = EADG_BASS[p.s] + p.f;
        return ((midi % 12) + 12) % 12;
    });
    assert.ok(sounded.includes(0), 'C->bass: root pc retained');
    const frets = r.placements.map(p => p.f).filter(f => f > 0);
    if (frets.length > 1) {
        assert.ok(Math.max(...frets) - Math.min(...frets) <= MAX_CHORD_SPAN, 'C->bass: span within box');
    }
    passed += 3;
}

// solveChord — degenerate 1-string target: the ladder bottoms out at a
// bare root note rather than crashing or dropping.
{
    const spec = chordSpecFromNotes(E_STD, v([[1, 3], [2, 2], [3, 0], [4, 1], [5, 0]]), 'C');
    const r = solveChord(spec, [40], null);
    check('1-string target: bare root note', r.placements.length, 1);
    check('1-string target: sounds the root pc', ((40 + r.placements[0].f) % 12 + 12) % 12, 0);
    check('1-string target: deepest rung', r.rung, degradationLadder(spec).length - 1);
}

// solveChord — determinism: identical inputs, identical outputs.
{
    const spec = chordSpecFromNotes(EB_STD, v([[0, 0], [1, 2], [2, 2], [3, 1], [4, 0], [5, 0]]), 'Eb');
    check('determinism', solveChord(spec, E_STD, null), solveChord(spec, E_STD, null));
}

// maxFret: solveVoicingSearch/solveChord respect the ceiling passed in
// (defaults to DEFAULT_MAX_FRET, the historical hardcoded 20 — every test
// above that omits it exercises that default), not a fixed constant.
{
    // Single-string target tuned to pc 1 (MIDI 1): the root pc (C, pc 0)
    // only reappears at fret 11 (mod-12 periodicity, 1+11=12) or fret 23 —
    // nowhere reachable within a narrow ceiling.
    const oneStringTarget = [1];
    const spec = chordSpecFromNotes([12], v([[0, 0]]), 'C');
    check('solveVoicingSearch: root pc unreachable within a narrow 10-fret ceiling',
        solveVoicingSearch(spec, new Set([0]), oneStringTarget, undefined, 10), null);
    const found = solveVoicingSearch(spec, new Set([0]), oneStringTarget, undefined, 14);
    assert.ok(found, 'solveVoicingSearch: root pc found once the ceiling widens to 14');
    check('solveVoicingSearch: finds it at the periodic fret 11', found.voicing[0].f, 11);
    passed += 1;

    const r = solveChord(spec, oneStringTarget, null, 14);
    assert.ok(r, 'solveChord: solvable once maxFret widens enough to reach the root');
    check('solveChord: lands on fret 11', r.placements[0].f, 11);
    passed += 1;
    check('solveChord: drops when maxFret is too narrow to reach the root anywhere',
        solveChord(spec, oneStringTarget, null, 10), null);
}

// matchVoicingToSource — exact matches first, then same-pc nearest.
{
    const spec = chordSpecFromNotes(E_STD, v([[1, 3], [2, 2], [3, 0]]), 'C'); // C3 E3 G3
    const m = matchVoicingToSource(vm(E_STD, [[2, 10], [3, 9], [4, 8]]), spec); // C4 E4 G4 (octave up)
    check('match: octave-shifted notes match their same-pc source',
        m.map(p => p.srcIndex).sort((a, b) => a - b), [0, 1, 2]);
}

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
{
    const retuner = CR.createRetuner();
    const tmpl = { name: 'C', frets: [-1, 3, 2, 0, 1, 0], fingers: [-1, 3, 2, 0, 1, 0] };
    const chord = { t: 1, id: 0, notes: v([[1, 3], [2, 2], [3, 0], [4, 1], [5, 0]]) };
    const bundle = guitarBundle({ chords: [chord], templates: [tmpl] });
    retuner.apply(bundle, EADGBE_TARGET);
    check('identity apply: chord shape unchanged', sf(bundle.chords[0].notes), v([[1, 3], [2, 2], [3, 0], [4, 1], [5, 0]]));
    check('identity apply: template frets unchanged', bundle.chordTemplates[0].frets, [-1, 3, 2, 0, 1, 0]);
    check('identity apply: chart fingering carried', bundle.chordTemplates[0].fingers, [-1, 3, 2, 0, 1, 0]);
    check('identity apply: chord fields preserved', bundle.chords[0].t, 1);
    assert.ok(bundle.chords[0].notes.every(n => chord.notes.includes(n._origNote)),
        'identity apply: every note keeps an _origNote reference into the raw chord');
    passed++;
}

// E-standard open E (022100) onto a Drop-D target: the exact candidate
// maps the low string +2 and the rest unchanged (222100); the carried
// finger 0 on a now-fretted string is invalid, so fingers are re-derived.
{
    const retuner = CR.createRetuner();
    const tmpl = { name: 'E', frets: [0, 2, 2, 1, 0, 0], fingers: [0, 2, 3, 1, 0, 0] };
    const chord = { t: 0, id: 0, notes: v([[0, 0], [1, 2], [2, 2], [3, 1], [4, 0], [5, 0]]) };
    const bundle = guitarBundle({ chords: [chord], templates: [tmpl] });
    retuner.apply(bundle, DROP_D_TARGET);
    check('E->DropD apply: exact-pitch shape 222100', sf(bundle.chords[0].notes), v([[0, 2], [1, 2], [2, 2], [3, 1], [4, 0], [5, 0]]));
    check('E->DropD apply: template follows', bundle.chordTemplates[0].frets, [2, 2, 2, 1, 0, 0]);
    check('E->DropD apply: fingers re-derived (open moved onto a fret)', bundle.chordTemplates[0].fingers, [2, 3, 4, 1, 0, 0]);
}

// Capo chart: a capo-2 open-C shape sounds D major; on an uncapo'd
// E-standard target the exact candidate lands the same shape two frets
// up (x54232).
{
    const retuner = CR.createRetuner();
    const tmpl = { name: 'D', frets: [-1, 3, 2, 0, 1, 0], fingers: [-1, 3, 2, 0, 1, 0] };
    const chord = { t: 0, id: 0, notes: v([[1, 3], [2, 2], [3, 0], [4, 1], [5, 0]]) };
    const bundle = guitarBundle({ capo: 2, chords: [chord], templates: [tmpl] });
    retuner.apply(bundle, E_STD);
    check('capo apply: shape shifted to position 2', sf(bundle.chords[0].notes), v([[1, 5], [2, 4], [3, 2], [4, 3], [5, 2]]));
    check('capo apply: template frets follow', bundle.chordTemplates[0].frets, [-1, 5, 4, 2, 3, 2]);
    check('capo apply: plausible barre fingering derived', bundle.chordTemplates[0].fingers, [-1, 4, 3, 1, 2, 1]);
}

// Eb-standard chart on an E-standard target: the open-E-shape Eb chord
// revoices near the open position (x-1-1-0-4-x), and the rebuilt template
// agrees with the chord instance by construction.
{
    const retuner = CR.createRetuner();
    const tmpl = { name: 'Eb', frets: [0, 2, 2, 1, 0, 0], fingers: [0, 2, 3, 1, 0, 0] };
    const full = { t: 0, id: 0, notes: v([[0, 0], [1, 2], [2, 2], [3, 1], [4, 0], [5, 0]]) };
    // A difficulty-filtered subset instance (source strings 1+2 only) —
    // must take the template solution's placements for those strings.
    const subset = { t: 2, id: 0, notes: v([[1, 2], [2, 2]]) };
    const bundle = guitarBundle({ tuning: [-1, -1, -1, -1, -1, -1], chords: [full, subset], templates: [tmpl] });
    retuner.apply(bundle, E_STD);
    check('Eb->E apply: full chord revoiced near open position', sf(bundle.chords[0].notes), v([[1, 1], [2, 1], [3, 0], [4, 4]]));
    check('Eb->E apply: template matches the instance voicing', bundle.chordTemplates[0].frets, [-1, 1, 1, 0, 4, -1]);
    check('Eb->E apply: subset instance takes the template placements', sf(bundle.chords[1].notes), v([[1, 1], [2, 1]]));
    assert.ok(bundle.chords[1].notes.every(n => subset.notes.includes(n._origNote)),
        'Eb->E apply: subset notes reference their own raw notes');
    passed++;
}

// Drop-D chart's flat-note D5 bucket (three same-onset notes) on an
// E-standard target: the below-range D2 drops, A2/D3 survive as opens —
// and _origNote references point into the raw arrays.
{
    const retuner = CR.createRetuner();
    const rawNotes = [{ t: 0, s: 0, f: 0 }, { t: 0, s: 1, f: 0 }, { t: 0, s: 2, f: 0 }, { t: 1, s: 2, f: 5 }];
    const bundle = guitarBundle({ tuning: [-2, 0, 0, 0, 0, 0], notes: rawNotes });
    retuner.apply(bundle, E_STD);
    const atZero = bundle.notes.filter(n => n.t === 0);
    check('DropD D5 bucket: playable pitches survive as opens', sf(atZero), v([[1, 0], [2, 0]]));
    check('DropD D5 bucket: later single note keeps the per-note path', sf(bundle.notes.filter(n => n.t === 1)), v([[2, 5]]));
    assert.ok(bundle.notes.every(n => rawNotes.includes(n._origNote)),
        'DropD D5 bucket: _origNote references the raw source notes');
    passed++;
}

// Chord slide on a revoiced chord: the source slide delta re-applies to
// the solved frets, clamped to the fret range.
{
    const retuner = CR.createRetuner();
    // Eb-standard 2-note power chord with a +2 slide on both notes.
    const chord = { t: 0, id: 0, notes: [{ s: 1, f: 1, sl: 3 }, { s: 2, f: 3, sl: 5 }] };
    const tmpl = { name: 'Bb5', frets: [-1, 1, 3, -1, -1, -1], fingers: [-1, 1, 3, -1, -1, -1] };
    const bundle = guitarBundle({ tuning: [-1, -1, -1, -1, -1, -1], chords: [chord], templates: [tmpl] });
    retuner.apply(bundle, E_STD);
    const ns = bundle.chords[0].notes.slice().sort((a, b) => a.s - b.s);
    check('chord slide: every remapped note keeps a slide destination',
        ns.every(n => Number.isInteger(n.sl) && n.sl >= 0 && n.sl <= 20), true);
    check('chord slide: slide delta preserved per note', ns.map(n => n.sl - n.f), [2, 2]);
}

// Bass regression through apply(): a clean simultaneous pair on the
// default BEADG target behaves exactly as the pre-solver engine (the
// exact candidate == the per-note remap), keeping techniques and
// _origNote wiring.
{
    const retuner = CR.createRetuner();
    const rawNotes = [{ t: 0, s: 1, f: 2, sus: 0.5 }, { t: 0, s: 2, f: 0 }];
    const bundle = {
        notes: rawNotes, chords: [], anchors: [], chordTemplates: [],
        tuning: [0, 0, 0, 0], capo: 0, stringCount: 4,
    };
    retuner.apply(bundle); // default BEADG-shaped target, k = +1
    check('bass double-stop: exact per-note remap (string +1, fret kept)', sf(bundle.notes), v([[2, 2], [3, 0]]));
    check('bass double-stop: sustain carried', bundle.notes.find(n => n.s === 2).sus, 0.5);
    assert.ok(bundle.notes.every(n => rawNotes.includes(n._origNote)), 'bass double-stop: _origNote wired');
    passed++;
}

// Bass improvement pin (behavior change vs the pre-solver engine,
// deliberate): a bucket whose notes COLLIDE on one target string no
// longer loses a pitch class — the solver revoices instead. Source
// strings share open MIDI 33 (tuning [+5,0,0,0]); f5 on string 0 and
// f2 on string 1 both used to fight for one slot, dropping one.
{
    const retuner = CR.createRetuner();
    const rawNotes = [{ t: 0, s: 0, f: 5 }, { t: 0, s: 1, f: 2 }];
    const bundle = {
        notes: rawNotes, chords: [], anchors: [], chordTemplates: [],
        tuning: [5, 0, 0, 0], capo: 0, stringCount: 4,
    };
    retuner.apply(bundle); // default BEADG-shaped target
    const target = CR.DEFAULT_TARGET_MIDI_TUNING;
    const pitches = bundle.notes.map(n => target[n.s] + n.f).sort((a, b) => a - b);
    check('bass collision: both pitches survive via revoicing', pitches, [35, 38]);
    check('bass collision: no two notes share a target string',
        new Set(bundle.notes.map(n => n.s)).size, bundle.notes.length);
}

// 7-string GP source onto a 6-string EADGBE target: low-string chord
// content degrades per chord, nothing crashes, single notes below range
// still drop.
{
    const retuner = CR.createRetuner();
    const chord = { t: 0, id: 0, notes: v([[0, 0], [1, 0], [2, 0]]) }; // B1 E2 A2
    const tmpl = { name: null, frets: [0, 0, 0, -1, -1, -1, -1], fingers: [-1, -1, -1, -1, -1, -1, -1] };
    const bundle = {
        notes: [{ t: 1, s: 0, f: 0 }], chords: [chord], anchors: [], chordTemplates: [tmpl],
        tuning: [0, 0, 0, 0, 0, 0, 0], capo: 0, stringCount: 7,
    };
    retuner.apply(bundle, EADGBE_TARGET);
    assert.ok(bundle.chords.length === 1 && bundle.chords[0].notes.length >= 2,
        '7-string: chord survives with a revoiced low end');
    const pcs = bundle.chords[0].notes.map(n => ((EADGBE_TARGET[n.s] + n.f) % 12 + 12) % 12);
    assert.ok(pcs.includes(11), '7-string: root pc (B) retained');
    check('7-string: a lone below-range single note still drops', bundle.notes.length, 0);
    passed += 2;
}

// Mid-run target switch re-solves chords from the RAW chart (cache
// invalidation), mirroring the live tuning-switch contract for notes.
{
    const retuner = CR.createRetuner();
    const tmpl = { name: 'E', frets: [0, 2, 2, 1, 0, 0], fingers: [0, 2, 3, 1, 0, 0] };
    const rawChords = [{ t: 0, id: 0, notes: v([[0, 0], [1, 2], [2, 2], [3, 1], [4, 0], [5, 0]]) }];
    const bundle = guitarBundle({ chords: rawChords, templates: [tmpl] });
    retuner.apply(bundle, EADGBE_TARGET);
    check('target switch: identity on EADGBE', sf(bundle.chords[0].notes), v([[0, 0], [1, 2], [2, 2], [3, 1], [4, 0], [5, 0]]));
    bundle.chords = rawChords;
    bundle.chordTemplates = [tmpl];
    retuner.apply(bundle, DROP_D_TARGET);
    check('target switch: re-solved for Drop D', sf(bundle.chords[0].notes), v([[0, 2], [1, 2], [2, 2], [3, 1], [4, 0], [5, 0]]));
}

/* ── Review-fix regressions (post-Phase-13 code review) ─────────────────── */

// A null chord id must NOT alias template index 0 (Number(null) === 0):
// a null-id chord behaves exactly like one referencing a nonexistent
// template, even when its shape coincidentally matches template 0's.
{
    const tmpl0 = { name: 'C/G', frets: [0, 2, 2, 1, 0, 0], fingers: [0, 2, 3, 1, 0, 0] };
    const solveWithId = id => {
        const chord = { t: 0, id, notes: v([[0, 0], [1, 2], [2, 2], [3, 1], [4, 0], [5, 0]]) };
        const b = guitarBundle({ chords: [chord], templates: [tmpl0] });
        CR.createRetuner().apply(b, DROP_D_TARGET);
        return sf(b.chords[0].notes);
    };
    check('null chord id routes like "no template", not template 0', solveWithId(null), solveWithId(999));
    check('undefined chord id routes like "no template" too', solveWithId(undefined), solveWithId(999));
}

// Duplicate source strings within one chord instance (malformed chart)
// dedup to one note per string on the template-first path, first wins —
// the same one-note-per-slot invariant every other remap path keeps.
{
    const tmpl = { name: 'X', frets: [0, 2, 2, 1, 0, 0], fingers: [-1, -1, -1, -1, -1, -1] };
    const dup = { t: 0, id: 0, notes: v([[1, 2], [1, 2], [2, 2], [3, 1], [4, 0], [5, 0], [0, 0]]) };
    const b = guitarBundle({ chords: [dup], templates: [tmpl] });
    CR.createRetuner().apply(b, E_STD);
    const strings = b.chords[0].notes.map(n => n.s);
    check('duplicate-string chord note deduped', b.chords[0].notes.length, 6);
    check('no two chord notes share a target string', new Set(strings).size, strings.length);
}

// Sliding chords skip the template-first shortcut and keep remapSlide's
// lower-endpoint anchoring. On this non-monotonic target the plain-fret
// template solve lands source string 1 on target string 0 at fret 20 —
// but the downward slide's low endpoint anchors on string 1, which is
// what the chord instance must follow (template route would have emitted
// s:0 with a delta-clamped slu of 5).
{
    const tmpl = { name: 'X', frets: [-1, 15, -1, 0, -1, -1], fingers: [-1, -1, -1, -1, -1, -1] };
    const chord = { t: 0, id: 0, notes: [{ s: 1, f: 15, slu: 0 }, { s: 3, f: 0 }] };
    const target = [40, 35, 62, 55, 59, 64];
    const b = guitarBundle({ chords: [chord], templates: [tmpl] });
    CR.createRetuner().apply(b, target);
    check('sliding chord note follows remapSlide anchoring, not the plain-fret template solve',
        b.chords[0].notes.map(({ s, f, slu }) => ({ s, f, slu })).sort((a, b2) => a.s - b2.s),
        [{ s: 1, f: 20, slu: 10 }, { s: 3, f: 0, slu: undefined }]);
    check('...while the template itself still reflects its plain-fret solve',
        b.chordTemplates[0].frets, [20, -1, -1, 0, -1, -1]);
}

// A degenerate source span (>= 20 frets, extreme GP import) widens the
// search window instead of emptying the position loop: the chord solves
// rather than silently dropping.
{
    const spec = chordSpecFromNotes(E_STD, v([[0, 1], [1, 21]]), null);
    const r = solveChord(spec, E_STD, null);
    check('degenerate 20-fret source span still solves', !!r, true);
    check('degenerate span keeps both pitch classes',
        r.placements.map(p => ((E_STD[p.s] + p.f) % 12 + 12) % 12).sort((a, b) => a - b),
        [...spec.pcs].sort((a, b) => a - b));
}

// A template whose chart omitted finger data entirely (fingers not an
// array — distinct from GP's all--1 arrays) keeps that omission after
// remapping, matching the pre-solver engine: no fabricated digits.
{
    const tmpl = { name: 'X', frets: [0, 2, 2, 1, 0, 0] };
    const b = guitarBundle({ templates: [tmpl] });
    CR.createRetuner().apply(b, EADGBE_TARGET);
    check('non-array template.fingers passes through untouched', b.chordTemplates[0].fingers, undefined);
    check('...while frets still remap', b.chordTemplates[0].frets, [0, 2, 2, 1, 0, 0]);
}

// computeChordFingers.
{
    check('fingers diagram: open E canonical 0-2-3-1-0-0',
        computeChordFingers([0, 2, 2, 1, 0, 0]), [0, 2, 3, 1, 0, 0]);
    check('fingers diagram: F barre 1-3-4-2-1-1',
        computeChordFingers([1, 3, 3, 2, 1, 1]), [1, 3, 4, 2, 1, 1]);
    check('fingers diagram: G barre 1-3-4-2-1-1 shape',
        computeChordFingers([3, 5, 5, 4, 3, 3]), [1, 3, 4, 2, 1, 1]);
    check('fingers diagram: unused strings stay -1',
        computeChordFingers([-1, 3, 2, 0, 1, -1]), [-1, 3, 2, 0, 1, -1]);
    check('fingers diagram: all open / unused',
        computeChordFingers([0, 0, -1]), [0, 0, -1]);
    // Drop-D F shape: min-fret barre (1s) + 3-3-3 needs run grouping.
    check('fingers diagram: Drop-D F shape groups the 3-3-3 run',
        computeChordFingers([3, 3, 3, 2, 1, 1]), [3, 3, 3, 2, 1, 1]);
}

// Node budget (MAX_SEARCH_NODES / opts.budget) — the pathological-chart
// safety valve: the search must terminate under a tiny budget, report
// the abort, and behave identically to before when the budget is ample.
{
    const { MAX_SEARCH_NODES } = CR;
    assert.ok(Number.isInteger(MAX_SEARCH_NODES) && MAX_SEARCH_NODES > 0, 'MAX_SEARCH_NODES sane'); passed++;

    // A deliberately heavy search: 8-string wide-open target, an 8-note
    // source chord of 8 distinct pitch classes spanning 20 frets — the
    // huge span widens allowedSpan to the whole neck, and every string
    // offers many qualifying frets per pc, defeating the usual pruning.
    const WIDE8 = [28, 33, 38, 43, 48, 53, 58, 63];
    const heavyNotes = v([[0, 0], [1, 2], [2, 4], [3, 6], [4, 9], [5, 13], [6, 17], [7, 20]]);
    const heavySpec = chordSpecFromNotes(WIDE8, heavyNotes, null);

    const tiny = { nodes: 50, aborted: false };
    const t0 = Date.now();
    solveChord(heavySpec, WIDE8, null, 24, { budget: tiny });
    const elapsed = Date.now() - t0;
    check('node budget: tiny budget reports the abort', tiny.aborted, true);
    assert.ok(tiny.nodes <= 0, 'tiny budget consumed'); passed++;
    assert.ok(elapsed < 1000, `tiny-budget solve returned promptly (${elapsed}ms)`); passed++;

    // One shared budget across the whole solveChord call: after a heavy
    // solve, later ladder rungs draw from whatever is left — never a
    // fresh budget per rung.
    const shared = { nodes: 200, aborted: false };
    solveChord(heavySpec, WIDE8, null, 24, { budget: shared });
    assert.ok(shared.nodes <= 0 && shared.aborted, 'shared budget spans the rung ladder'); passed++;

    // An ample explicit budget must not change the result vs. the
    // default path (same chord solved with and without opts).
    const spec = chordSpecFromNotes(E_STD, v([[0, 0], [1, 2], [2, 2], [3, 1], [4, 0], [5, 0]]), 'E');
    const ample = { nodes: MAX_SEARCH_NODES, aborted: false };
    check('node budget: ample budget is behavior-neutral',
        solveChord(spec, DROP_D, null, 20, { budget: ample }),
        solveChord(spec, DROP_D, null, 20));
    check('node budget: ample budget does not abort', ample.aborted, false);
}

console.log(`OK - ${passed} assertions passed`);
