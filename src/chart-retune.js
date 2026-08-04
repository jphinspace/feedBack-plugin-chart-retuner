// Chart Retuner — barrel module. Aggregates ten pure-logic
// modules into the `CR` namespace screen.js and the test suite import.
//
//   - pitch.js: note-name <-> MIDI
//   - common.js: constants shared across multiple pipeline stages
//   - target-tuning.js: stage 1 (target tuning resolution) + the
//     settings/profile layer
//   - target-capo.js: stage 2 (retuner-capo application to the target)
//   - source-tuning.js: stage 3 (chart tuning/native-capo/octave-offset
//     -> source open-string pitches)
//   - chord-solver.js: chord-aware revoicing (guitar support)
//   - retune-engine.js: stage 4 (note/chord remap, consumes chord-solver
//     + stages 2/3's output)
//   - note-anchors.js: stage 5 (hand-position anchor remap, consumes
//     stage 4's remapped notes)
//   - capo-output.js: final target-capo projection (current physical-host
//     workaround vs. the chart-transform contract)
//   - string-colors.js: per-string color roles + hex handling
//
// Served via feedBack core's /api/plugins/<id>/src/... route
// (plugin.json "scriptType":"module"); imported by both screen.js and
// the test suite (test/*.test.mjs).

import * as Pitch from './pitch.js';
import * as Common from './common.js';
import * as TargetTuning from './target-tuning.js';
import * as TargetCapo from './target-capo.js';
import * as SourceTuning from './source-tuning.js';
import * as ChordSolver from './chord-solver.js';
import * as RetuneEngine from './retune-engine.js';
import * as NoteAnchors from './note-anchors.js';
import * as CapoOutput from './capo-output.js';
import * as StringColors from './string-colors.js';

export const CR = {
    ...Pitch,
    ...Common,
    ...TargetTuning,
    ...TargetCapo,
    ...SourceTuning,
    ...ChordSolver,
    ...RetuneEngine,
    ...NoteAnchors,
    ...CapoOutput,
    ...StringColors,
};
