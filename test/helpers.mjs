// Chart Retuner — shared test fixtures for the split retune-engine test
// suite (target-tuning/target-capo/source-tuning/retune-engine/note-anchors).
// Not a *.test.mjs itself, so `node --test test/*.test.mjs`
// never tries to run it standalone.
import { computeOpenStringMidiByString } from '../src/source-tuning.js';
import { computeArrangementShift } from '../src/retune-engine.js';
import { resolveTargetTuning } from '../src/target-tuning.js';

// Mirrors what createRetuner().apply() does once per song: compute k, then
// per-string open-note MIDI pitches and natural targets. `octaveOffset`
// (stage 3) defaults to 0 for the many callers that don't exercise it.
export function songContext(sourceStringCount, tuning, capo, targetMidiTuning, octaveOffset = 0) {
    const sourceOpenMidiByString = computeOpenStringMidiByString(sourceStringCount, tuning, capo, octaveOffset);
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
export const SPOT_FRETS = [0, 10, 20];

// Standard 4-string bass / 6-string guitar targets, resolved once and
// reused wherever a test needs the plain identity case.
export const EADG = resolveTargetTuning(['E1', 'A1', 'D2', 'G2']);
export const EADGBE = resolveTargetTuning(['E2', 'A2', 'D3', 'G3', 'B3', 'E4']);

// Bundle factory: fills in the chart-transform bundle's usual-empty
// fields so a test only spells out what actually varies. `stringCount`
// defaults from `tuning.length`, overridable like everything else.
// Mirrors chord-solver.test.mjs's guitarBundle.
export function makeBundle(overrides) {
    return {
        notes: [], chords: [], anchors: [], chordTemplates: [],
        capo: 0, stringCount: (overrides.tuning || []).length,
        ...overrides,
    };
}

// Deep-copies chords/anchors before handing them to apply(), which
// mutates in place — for a test that also needs the raw, untouched
// values afterward for comparison.
export const cloneChords = chords => chords.map(c => ({ ...c, notes: c.notes.map(n => ({ ...n })) }));
export const cloneAnchors = anchors => anchors.map(a => ({ ...a }));

// A second bundle factory, positional/raw-shaped ({ notes, chords,
// anchors, templates, tuning, capo, sc }) rather than makeBundle's
// overrides-object shape — used by the pathological-safety-valve tests
// and the revoiced-bucket anchor-fallback test, which both already build
// their fixtures in this shape. Keep values literal: a test factory must
// not sanitize malformed input before the production boundary sees it.
export function bundleFromRaw(raw) {
    return {
        notes: raw.notes, chords: raw.chords, anchors: raw.anchors,
        chordTemplates: raw.templates,
        tuning: raw.tuning, capo: raw.capo, stringCount: raw.sc,
    };
}
