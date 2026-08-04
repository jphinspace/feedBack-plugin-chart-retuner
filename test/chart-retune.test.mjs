// Public barrel contract. Unit suites import their defining modules directly;
// this one test verifies that screen.js's CR namespace exposes exactly the
// combined public API and that duplicate names agree rather than overwrite one
// another silently.
import test from 'node:test';
import assert from 'node:assert/strict';
import { CR } from '../src/chart-retune.js';
import * as Pitch from '../src/pitch.js';
import * as Common from '../src/common.js';
import * as TargetTuning from '../src/target-tuning.js';
import * as TargetCapo from '../src/target-capo.js';
import * as SourceTuning from '../src/source-tuning.js';
import * as ChordSolver from '../src/chord-solver.js';
import * as RetuneEngine from '../src/retune-engine.js';
import * as NoteAnchors from '../src/note-anchors.js';
import * as CapoOutput from '../src/capo-output.js';

const modules = [
    Pitch,
    Common,
    TargetTuning,
    TargetCapo,
    SourceTuning,
    ChordSolver,
    RetuneEngine,
    NoteAnchors,
    CapoOutput,
];

test('CR exposes the exact public module surface without conflicting exports', () => {
    const expected = {};
    for (const module of modules) {
        for (const [name, value] of Object.entries(module)) {
            if (Object.hasOwn(expected, name)) {
                assert.strictEqual(value, expected[name], `conflicting duplicate export: ${name}`);
            } else {
                expected[name] = value;
            }
        }
    }

    assert.deepStrictEqual(Object.keys(CR).sort(), Object.keys(expected).sort());
    for (const [name, value] of Object.entries(expected)) {
        assert.strictEqual(CR[name], value, `CR.${name} does not reference its module export`);
    }
});
