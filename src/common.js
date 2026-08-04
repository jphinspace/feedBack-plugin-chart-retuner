// Chart Retuner — constants shared across more than one pipeline stage
// (target-tuning, target-capo, source-tuning, retune-engine, note-anchors,
// chord-solver). Kept deliberately tiny: anything used by only one stage
// belongs in that stage's own file, not here.

// Engine fallback when a caller resolves no active tuning/maxFret at all.
// Also the pre-guitar hardcoded ceiling every preset/custom tuning
// defaulted to before per-tuning max fret existed.
export const DEFAULT_MAX_FRET = 20;

// A comfortable single-position hand span, in frets. Stage 4 uses this
// as reduceHandTravel's trigger; stage 5 uses the same value as its anchor
// widening cap. Keeping the shared policy here avoids a stage-4 <-> stage-5
// module cycle.
export const HAND_JUMP_FRET_THRESHOLD = 5;
