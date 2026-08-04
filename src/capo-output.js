// Chart Retuner — final target-capo output projection. The retune engine
// solves once in canonical, capo-relative coordinates; this module turns
// that result into the representation expected by the active feedBack host.
//
// `physical-workaround` is the current production behavior. It reports
// capo 0 and moves fretted notes to their physical frets, while keeping a
// capo-open note/template at fret 0 so existing chord renderers still draw
// it as open. Slide endpoints remain physical because they are positions,
// not open-string glyph classifications.
//
// `chart-transform-contract` preserves the canonical relative coordinates
// and reports the target capo separately. It is ready for the host renderer
// fix; selecting it must not change chord solving or fingering.

import { isFretted, isRealFret } from './chord-solver.js';

export const CAPO_OUTPUT_MODES = Object.freeze({
    PHYSICAL_WORKAROUND: 'physical-workaround',
    CHART_TRANSFORM_CONTRACT: 'chart-transform-contract',
});

// Deliberately not user-facing and not host-version-sniffed. feedBack does
// not expose a capability marker for the renderer fix, so this is the one
// manual switch to change when the fixed contract is available.
export const CAPO_OUTPUT_MODE = CAPO_OUTPUT_MODES.PHYSICAL_WORKAROUND;

export function resolveCapoOutputMode(mode) {
    return mode === CAPO_OUTPUT_MODES.CHART_TRANSFORM_CONTRACT
        ? CAPO_OUTPUT_MODES.CHART_TRANSFORM_CONTRACT
        : CAPO_OUTPUT_MODES.PHYSICAL_WORKAROUND;
}

function sanitizedCapo(capo) {
    return Number.isInteger(capo) && capo > 0 ? capo : 0;
}

export function capoForOutput(capo, mode = CAPO_OUTPUT_MODE) {
    return resolveCapoOutputMode(mode) === CAPO_OUTPUT_MODES.CHART_TRANSFORM_CONTRACT
        ? sanitizedCapo(capo)
        : 0;
}

// Project one canonical solve result without mutating it. Contract mode and
// capo 0 are identity projections; the workaround allocates fresh objects so
// switching projections can never contaminate the cached canonical result.
export function projectCapoOutput(result, capo, mode = CAPO_OUTPUT_MODE) {
    const c = sanitizedCapo(capo);
    const resolvedMode = resolveCapoOutputMode(mode);
    if (resolvedMode === CAPO_OUTPUT_MODES.CHART_TRANSFORM_CONTRACT || c === 0) {
        return result;
    }

    const projectNote = (note) => {
        const out = { ...note };
        // Relative 0 deliberately stays 0 for the host's open-string glyph.
        if (isFretted(out.f)) out.f += c;
        // A real slide endpoint denotes a neck position, including endpoint
        // 0 at the capo. Never shift the -1 "no slide" sentinel.
        if (isRealFret(out.sl)) out.sl += c;
        if (isRealFret(out.slu)) out.slu += c;
        return out;
    };

    const notes = Array.isArray(result.notes)
        ? result.notes.map(projectNote)
        : result.notes;
    const chords = Array.isArray(result.chords)
        ? result.chords.map(chord => ({
            ...chord,
            notes: Array.isArray(chord.notes) ? chord.notes.map(projectNote) : chord.notes,
        }))
        : result.chords;
    const anchors = Array.isArray(result.anchors)
        ? result.anchors.map(anchor => ({ ...anchor, fret: anchor.fret + c }))
        : result.anchors;
    const chordTemplates = Array.isArray(result.chordTemplates)
        ? result.chordTemplates.map(template => (template && Array.isArray(template.frets))
            ? {
                ...template,
                frets: template.frets.map(fret => (isFretted(fret) ? fret + c : fret)),
            }
            : template)
        : result.chordTemplates;

    return { notes, chords, anchors, chordTemplates };
}
