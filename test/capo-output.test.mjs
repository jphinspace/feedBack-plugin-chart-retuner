// Final capo-output projection coverage. The retune engine's canonical
// result is capo-relative; this module verifies both supported host views
// without invoking the solver.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
    CAPO_OUTPUT_MODE,
    CAPO_OUTPUT_MODES,
    capoForOutput,
    projectCapoOutput,
    resolveCapoOutputMode,
} from '../src/capo-output.js';

test('physical capo projection shifts positions but preserves open and sentinel semantics', () => {
    const canonical = {
        notes: [
            { t: 0, s: 0, f: 0, sl: -1, slu: -1 },
            { t: 1, s: 0, f: 2, sl: 0, slu: -1 },
        ],
        chords: [{ t: 2, notes: [{ s: 0, f: 0 }, { s: 1, f: 4, slu: 2 }] }],
        anchors: [{ time: 0, fret: 2, width: 4, extra: true }],
        chordTemplates: [{ name: 'X', frets: [0, 2, -1], fingers: [0, 1, -1] }],
    };

    const projected = projectCapoOutput(canonical, 3, CAPO_OUTPUT_MODES.PHYSICAL_WORKAROUND);

    assert.deepStrictEqual(projected.notes.map(n => ({ f: n.f, sl: n.sl, slu: n.slu })), [
        { f: 0, sl: -1, slu: -1 },
        { f: 5, sl: 3, slu: -1 },
    ]);
    assert.deepStrictEqual(projected.chords[0].notes.map(n => ({ f: n.f, slu: n.slu })), [
        { f: 0, slu: undefined },
        { f: 7, slu: 5 },
    ]);
    assert.deepStrictEqual(projected.anchors, [{ time: 0, fret: 5, width: 4, extra: true }]);
    assert.deepStrictEqual(projected.chordTemplates[0], {
        name: 'X', frets: [0, 5, -1], fingers: [0, 1, -1],
    });

    assert.notStrictEqual(projected, canonical);
    assert.notStrictEqual(projected.notes[0], canonical.notes[0]);
    assert.deepStrictEqual(canonical.notes.map(n => ({ f: n.f, sl: n.sl, slu: n.slu })), [
        { f: 0, sl: -1, slu: -1 },
        { f: 2, sl: 0, slu: -1 },
    ], 'projection must not contaminate the canonical solve');
    assert.deepStrictEqual(canonical.chordTemplates[0].frets, [0, 2, -1]);
});

test('contract projection is the canonical identity and reports capo separately', () => {
    const canonical = { notes: [{ f: 0 }, { f: 2 }], chords: [], anchors: [], chordTemplates: [] };
    const mode = CAPO_OUTPUT_MODES.CHART_TRANSFORM_CONTRACT;

    assert.strictEqual(projectCapoOutput(canonical, 3, mode), canonical);
    assert.equal(capoForOutput(3, mode), 3);
    assert.equal(capoForOutput(3, CAPO_OUTPUT_MODES.PHYSICAL_WORKAROUND), 0);
});

test('production default and malformed modes fail closed to the physical workaround', () => {
    assert.equal(CAPO_OUTPUT_MODE, CAPO_OUTPUT_MODES.PHYSICAL_WORKAROUND);
    assert.equal(resolveCapoOutputMode('future-unrecognized-mode'), CAPO_OUTPUT_MODES.PHYSICAL_WORKAROUND);
    assert.equal(capoForOutput(3, 'future-unrecognized-mode'), 0);
    assert.equal(capoForOutput(2.5, CAPO_OUTPUT_MODES.CHART_TRANSFORM_CONTRACT), 0);
});
