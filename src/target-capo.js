// Chart Retuner — stage 2: apply the retuner's own target-instrument capo
// (distinct from the chart's native capo, handled in source-tuning.js/
// retune-engine.js) to an already-resolved target tuning. Doesn't look at
// the chart at all — pure settings-side math, no dependency on any other
// module in this pipeline.

// Frets remaining above the capo. capo is validated < maxFret by the
// settings layer (target-tuning.js's isValidCapo), so this is always
// >= 1 for a valid profile.
export function effectiveMaxFret(maxFret, capo) {
    return Math.max(1, (maxFret | 0) - (capo | 0));
}

// A capo raises every string's sounding open pitch by `capo` half-steps
// and eats into the usable fret range above it. capo === 0 is a no-op —
// returns the input unchanged rather than allocating a fresh array.
export function applyCapo(midiTuning, maxFret, capo) {
    const c = capo | 0;
    if (!c) return { midiTuning, maxFret };
    return {
        midiTuning: midiTuning.map(m => m + c),
        maxFret: effectiveMaxFret(maxFret, c),
    };
}
