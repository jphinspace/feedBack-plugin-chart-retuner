// Chart Retuner — note-name <-> MIDI pitch conversion.
// One of four modules chart-retune.js aggregates into `CR`.

const NOTE_LETTER_PITCH_CLASS = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };

// Letter + optional accidental -> UN-normalized pitch value (may be -1
// for Cb or 12 for B#: the octave arithmetic in parseTargetNote needs the
// raw value so accidentals crossing an octave boundary land on the right
// MIDI note). Returns null for a non-note letter.
function _letterAccidentalValue(letter, accidental) {
    let pc = NOTE_LETTER_PITCH_CLASS[String(letter).toLowerCase()];
    if (pc === undefined) return null;
    if (accidental === '#') pc += 1;
    else if (accidental === 'b') pc -= 1;
    return pc;
}

// Normalized pitch class (0..11) for a bare letter + optional accidental
// ('C', 'F#', 'Bb') — the octave-less half of parseTargetNote, shared
// with chord-name root parsing (chord-solver.js), keeping the two in sync.
export function notePitchClass(letter, accidental) {
    const v = _letterAccidentalValue(letter, accidental || '');
    return v === null ? null : ((v % 12) + 12) % 12;
}

// Parses a note in scientific pitch notation (C4 = MIDI 60). Returns
// { midi, label } or null; label keeps the input's own spelling (Bb,
// not A#).
export function parseTargetNote(spec) {
    if (typeof spec !== 'string') return null;
    const m = /^([A-Ga-g])([#b]?)(-?\d+)$/.exec(spec.trim());
    if (!m) return null;
    const letter = m[1], accidental = m[2], octave = parseInt(m[3], 10);
    const pc = _letterAccidentalValue(letter, accidental);
    return { midi: pc + 12 * (octave + 1), label: letter.toUpperCase() + accidental };
}

const PITCH_CLASS_SHARP_LABELS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

// Inverse of parseTargetNote — MIDI note number -> label, sharp spelling.
export function midiToNoteLabel(midi) {
    const pc = ((midi % 12) + 12) % 12;
    const octave = Math.floor(midi / 12) - 1;
    return PITCH_CLASS_SHARP_LABELS[pc] + octave;
}
