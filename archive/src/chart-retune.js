// Chart Retuner — barrel module. Aggregates five pure-logic
// modules into the `CR` namespace screen.js and the test suite import.
//
//   - pitch.js: note-name <-> MIDI
//   - target-tuning.js: target tuning resolution/defaulting
//   - chord-solver.js: chord-aware revoicing (guitar support)
//   - retune-engine.js: chart remap math (consumes chord-solver)
//   - string-colors.js: per-string color roles + hex handling
//
// Served via feedBack core's /api/plugins/<id>/src/... route
// (plugin.json "scriptType":"module"); imported by both screen.js and
// the test suite (test/retune-engine.test.mjs,
// test/chord-solver.test.mjs).

import * as Pitch from './pitch.js';
import * as TargetTuning from './target-tuning.js';
import * as ChordSolver from './chord-solver.js';
import * as RetuneEngine from './retune-engine.js';
import * as StringColors from './string-colors.js';

export const CR = {
    ...Pitch,
    ...TargetTuning,
    ...ChordSolver,
    ...RetuneEngine,
    ...StringColors,
};
