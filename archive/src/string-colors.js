// Chart Retuner — per-string color role resolution + hex
// handling. One of four modules chart-retune.js aggregates into `CR`.
// screen.js owns the actual palette values (PALETTES.default,
// CR.lowBColor()); this module only produces symbolic roles.

import { parseTargetNote } from './pitch.js';
import { EXTENDED_DEFAULT_TARGET_TUNING } from './target-tuning.js';

// Role per note in EXTENDED_DEFAULT_TARGET_TUNING, same order. Derived
// from that single array rather than a second hardcoded MIDI table,
// keeping the two permanently in sync.
const EXTENDED_COLOR_ROLES = ['lowExt2', 'lowExt1', 'lowB', 'e', 'a', 'd', 'g', 'highB', 'highE'];
const _colorRoleByMidi = new Map(
    EXTENDED_DEFAULT_TARGET_TUNING.map((spec, i) => [parseTargetNote(spec).midi, EXTENDED_COLOR_ROLES[i]])
);

// Color role for a note produced by CR.defaultExtensionNote, for a
// newly added string's default color ('gray' outside the known chain).
// Note-based rather than position-based, since an added string's only
// stable identity is its own note (contrast BEADG_COLOR_ROLES below,
// which IS position-based).
export function colorRoleForNote(midi) {
    return _colorRoleByMidi.get(midi) || 'gray';
}

// Roles for the 5 BEADG core positions, by index — colors there are
// pinned to string position, not note identity, so an AEADG tuning's
// position 0 still gets the "low string" role.
export const BEADG_COLOR_ROLES = ['lowB', 'e', 'a', 'd', 'g'];

function hexToInt(hex) {
    if (typeof hex !== 'string') return null;
    const t = hex.trim().replace(/^#/, '');
    const full = t.length === 3 ? t[0] + t[0] + t[1] + t[1] + t[2] + t[2] : t;
    if (!/^[0-9a-fA-F]{6}$/.test(full)) return null;
    return parseInt(full, 16);
}

// The lowest string's color, read from core's "Highway String Colors"
// panel (localStorage key "low7") so a real user override applies. Falls
// back to #cc00aa.
export function lowBColor() {
    try {
        const raw = localStorage.getItem('highwayStringColors');
        if (raw) {
            const parsed = JSON.parse(raw);
            const n = hexToInt(parsed && parsed.low7);
            if (n != null) return n;
        }
    } catch (_) { /* corrupt / blocked storage — fall through to default */ }
    return 0xcc00aa;
}

export function intToHex(n) {
    return '#' + (n >>> 0).toString(16).padStart(6, '0');
}

export const LIGHT_GRAY_COLOR = 0xd3d3d3;

// Fills `colorsIn` out to `length` hex strings, using `defaults[i]`
// wherever the input entry is missing or an invalid hex.
export function resolveColorsArray(colorsIn, length, defaults) {
    const out = new Array(length);
    for (let i = 0; i < length; i++) {
        const c = Array.isArray(colorsIn) ? colorsIn[i] : undefined;
        out[i] = (typeof c === 'string' && hexToInt(c) != null) ? c : defaults[i];
    }
    return out;
}
