// Chart Retuner — stage 1 (target tuning resolution) + the settings/profile
// layer built on top of it: presets, custom-tuning validation, and the
// capo/octave FIELD validators (is-this-a-legal-value, not what-effect-it-
// has — that's target-capo.js/source-tuning.js). One of several pure-logic
// modules chart-retune.js aggregates into `CR`.

import { parseTargetNote, midiToNoteLabel } from './pitch.js';
import { DEFAULT_MAX_FRET } from './common.js';

// Selectable ceiling for a tuning profile's remap range (settings.html's
// "Max fret" dropdown + each BUILTIN_PRESET_TUNINGS entry below). 24 is
// the render/UI-safe top of the list and the shared fallback default.
export const MAX_FRET_OPTIONS = [12, 14, 20, 21, 22, 24];
export function isValidMaxFret(v) {
    return MAX_FRET_OPTIONS.indexOf(v) !== -1;
}

// Retuner capo — a per-tuning-profile fret clamped on the target
// instrument, distinct from the chart's own source capo. 0 = no capo;
// negative or >= maxFret is invalid.
export function isValidCapo(v, maxFret) {
    return Number.isInteger(v) && v >= 0 && v < (Number.isInteger(maxFret) ? maxFret : DEFAULT_MAX_FRET);
}
export function resolveCapo(v, maxFret) {
    return isValidCapo(v, maxFret) ? v : 0;
}
// On/off gate for the retuner capo above — off by default; only literal
// `true` counts.
export function resolveCapoEnabled(v) {
    return v === true;
}

// Octave offset — shifts the whole chart ±N octaves before remapping,
// no key change involved. Bounded to ±2 octaves; 0 = no shift.
export const MIN_OCTAVE_OFFSET = -2;
export const MAX_OCTAVE_OFFSET = 2;
export function isValidOctaveOffset(v) {
    return Number.isInteger(v) && v >= MIN_OCTAVE_OFFSET && v <= MAX_OCTAVE_OFFSET;
}
export function resolveOctaveOffset(v) {
    return isValidOctaveOffset(v) ? v : 0;
}

// Resolves capo/capoEnabled/octaveOffset off a raw profile-shaped object,
// against `maxFret` — shared by every builder of a resolved tuning profile.
export function resolveRetunerCapoOctaveFields(raw, maxFret) {
    return {
        capo: resolveCapo(raw.capo, maxFret),
        capoEnabled: resolveCapoEnabled(raw.capoEnabled),
        octaveOffset: resolveOctaveOffset(raw.octaveOffset),
    };
}

// Merges a per-tuning override ({ capo, capoEnabled, octave }) onto an
// already-resolved profile, in place; invalid/missing fields are untouched.
export function applyRetunerCapoOctaveOverride(profile, override) {
    if (!override || typeof override !== 'object') return profile;
    if (isValidCapo(override.capo, profile.maxFret)) profile.capo = override.capo;
    if (typeof override.capoEnabled === 'boolean') profile.capoEnabled = override.capoEnabled;
    if (isValidOctaveOffset(override.octave)) profile.octaveOffset = override.octave;
    return profile;
}

// 8 covers the widest built-in preset (mandolin's 4 doubled courses); 4 is
// the practical floor for a fretted stringed instrument.
export const MAX_TARGET_STRING_COUNT = 8;
export const MIN_TARGET_STRING_COUNT = 4;
// The editor's supported scientific-pitch range is inclusive: C-1 (MIDI 0)
// through E5 (MIDI 76). parseTargetNote intentionally remains general for
// other chart/pitch uses; this boundary belongs to custom tuning validation.
export const MIN_TARGET_MIDI = 0;
export const MAX_TARGET_MIDI = 76;
// The actual bass default and the explicitly selectable BEADG extension.
// Keep these names honest: BEADG is a preset/reference tuning, never an
// implicit product or engine default.
export const DEFAULT_TARGET_TUNING = ['E1', 'A1', 'D2', 'G2'];
export const BEADG_TARGET_TUNING = ['B0', ...DEFAULT_TARGET_TUNING];
// Generic low-to-high extension chain used only for per-position recovery of
// malformed entries in otherwise valid 5-8 string arrays.
export const EXTENDED_TARGET_TUNING = ['C#0', 'F#0', 'B0', 'E1', 'A1', 'D2', 'G2', 'B2', 'E3', 'A3'];
export const BEADG_EXTENDED_INDEX = 2;

// Built-in tuning presets for the per-arrangement profile dropdowns — not
// user-editable/deletable. DEFAULT_TUNING_ID/DEFAULT_GUITAR_TUNING_ID
// (below) name the per-class defaults.
// `maxFret`: EADG deliberately uses 20; most other presets and the fallback
// default use 24; violin and mandolin (short-necked) use 14.
export const BUILTIN_PRESET_TUNINGS = [
    {
        id: 'eadg',
        label: 'EADG (default)',
        strings: DEFAULT_TARGET_TUNING,
        maxFret: 20,
    },
    {
        id: 'beadg',
        label: 'BEADG',
        strings: BEADG_TARGET_TUNING,
        maxFret: 24,
    },
    {
        id: 'upright_solo_fsbea',
        label: 'Upright bass solo (F#BEA)',
        // Double-bass solo tuning (EADG up a whole step).
        strings: ['F#1', 'B1', 'E2', 'A2'],
        maxFret: 24,
    },
    {
        id: 'eadgbe',
        label: 'EADGBE (guitar)',
        strings: ['E2', 'A2', 'D3', 'G3', 'B3', 'E4'],
        maxFret: 24,
    },
    {
        id: 'beadgbe',
        label: 'BEADGBE (7-string guitar)',
        // EADGBE plus a low B.
        strings: ['B1', 'E2', 'A2', 'D3', 'G3', 'B3', 'E4'],
        maxFret: 24,
    },
    {
        id: 'baritone_beadfsb',
        label: 'Baritone (BEADF#B)',
        // Standard guitar down a perfect fourth.
        strings: ['B1', 'E2', 'A2', 'D3', 'F#3', 'B3'],
        maxFret: 24,
    },
    {
        id: 'cello_cgda',
        label: 'Cello (CGDA)',
        strings: ['C2', 'G2', 'D3', 'A3'],
        maxFret: 24,
    },
    {
        id: 'viola_cgda',
        label: 'Viola (CGDA)',
        // Cello's note names an octave up.
        strings: ['C3', 'G3', 'D4', 'A4'],
        maxFret: 24,
    },
    {
        id: 'violin_gdae',
        label: 'Violin (GDAE)',
        strings: ['G3', 'D4', 'A4', 'E5'],
        maxFret: 14,
    },
    {
        id: 'banjo4_cgbd',
        label: 'Banjo 4-string (CGBD)',
        // Plectrum banjo.
        strings: ['C3', 'G3', 'B3', 'D4'],
        maxFret: 24,
    },
    {
        id: 'banjo5_gdgbd',
        label: 'Banjo 5-string (gDGBD)',
        // Open-G 5-string banjo. String 0 is the HIGH G4 drone (banjo tab
        // is written drone-first), so this tuning is deliberately
        // non-monotonic — handled by resolveTargetForFret's pitch-ordered
        // walk. The drone's short neck (no frets below its 5th) is not
        // modeled.
        strings: ['G4', 'D3', 'G3', 'B3', 'D4'],
        maxFret: 24,
    },
    {
        id: 'ukulele_gcea',
        label: 'Ukulele (gCEA)',
        // Standard reentrant ukulele: string 0 is the HIGH G4, above the
        // C that follows it, so — like banjo5_gdgbd — this is a
        // non-monotonic target too. 12 frets for a soprano/concert neck.
        strings: ['G4', 'C4', 'E4', 'A4'],
        maxFret: 12,
    },
    {
        id: 'baritone_uke_dgbe',
        label: 'Baritone ukulele (DGBE)',
        // Linear (non-reentrant) baritone uke: the top four strings of a
        // standard guitar. 20 is the closest selectable ceiling to its real
        // ~18-19 fret neck.
        strings: ['D3', 'G3', 'B3', 'E4'],
        maxFret: 20,
    },
    {
        id: 'mandolin_ggddaaee',
        label: 'Mandolin (GGDDAAEE)',
        // Four paired courses, violin notes doubled — 8 strings, the
        // render maximum.
        strings: ['G3', 'G3', 'D4', 'D4', 'A4', 'A4', 'E5', 'E5'],
        maxFret: 14,
    },
];
// The default preset ids — the single source of truth screen.js and
// settings.html both point at, rather than each hardcoding their own
// literals. DEFAULT_TUNING_ID is the BASS default (named before guitar
// support existed, kept for compatibility); DEFAULT_GUITAR_TUNING_ID is
// the rhythm/lead default.
export const DEFAULT_TUNING_ID = BUILTIN_PRESET_TUNINGS[0].id;
export const DEFAULT_GUITAR_TUNING_ID = 'eadgbe';

// The default tuning-profile preset id for an arrangement class
// ('bass' | 'rhythm' | 'lead'): bass defaults to EADG, both guitar
// classes to EADGBE.
export function defaultTuningIdForClass(arrClass) {
    return arrClass === 'bass' ? DEFAULT_TUNING_ID : DEFAULT_GUITAR_TUNING_ID;
}

// Which tuning-profile class an arrangement name routes to:
//   - contains the word "bass"  -> 'bass'  (checked first: "Lead Bass"
//     is a bass arrangement)
//   - contains the word "lead"  -> 'lead'
//   - anything else guitar-ish (rhythm, combo, plain "guitar", unknown
//     non-empty names) -> 'rhythm'
//   - empty/missing (a host that leaves songInfo.arrangement unset)
//     -> 'bass', preserving this plugin's pre-guitar behavior for such
//     hosts.
// Word boundaries keep a substring like "BasslineKeys" from matching
// "bass", mirroring matchesArrangement in screen.js.
export function arrangementClassFor(arrangementName) {
    const a = typeof arrangementName === 'string' ? arrangementName.trim() : '';
    if (a === '') return 'bass';
    if (/\bbass\b/i.test(a)) return 'bass';
    if (/\blead\b/i.test(a)) return 'lead';
    return 'rhythm';
}

// Resolves a selected tuning-profile id to { id, strings, maxFret,
// capo, capoEnabled, octaveOffset }: built-in presets first (unset id
// falls back to the arrangement class's default), then a caller-supplied
// custom-tuning list, then the class-default preset for an id matching
// neither. `id` is the RESOLVED id, which screen.js keys per-tuning
// capo/octave overrides by. `capo` is validated against the profile's
// OWN maxFret, so shrinking it below a saved capo silently
// disables the capo. Pure: the caller owns reading `id`/`customTunings`
// from storage.
export function resolveSelectedTuningProfile(id, customTunings, arrClass = 'bass') {
    const targetId = id || defaultTuningIdForClass(arrClass);
    // Every branch returns a fresh string array. Presets are shared module
    // constants and custom profiles remain caller-owned, so neither may be
    // exposed for mutation through the resolved result.
    const asResult = p => ({
        id: p.id,
        strings: p.strings.slice(),
        maxFret: p.maxFret,
        ...resolveRetunerCapoOctaveFields(p, p.maxFret),
    });
    const preset = BUILTIN_PRESET_TUNINGS.find(p => p.id === targetId);
    if (preset) return asResult(preset);
    // Validate again at the resolver boundary instead of relying on every
    // caller to have filtered persisted/custom data first. A malformed entry
    // with the requested id is skipped in favor of another valid match or the
    // arrangement default.
    const found = Array.isArray(customTunings)
        ? customTunings.find(p => p && p.id === targetId && isValidTuningStringsArray(p.strings))
        : null;
    if (found) {
        const maxFret = isValidMaxFret(found.maxFret) ? found.maxFret : DEFAULT_MAX_FRET;
        return {
            id: found.id,
            strings: found.strings.slice(),
            maxFret,
            ...resolveRetunerCapoOctaveFields(found, maxFret),
        };
    }
    return asResult(BUILTIN_PRESET_TUNINGS.find(p => p.id === defaultTuningIdForClass(arrClass)));
}

// Session-only live preview for ad-hoc tuning edits. This is intentionally
// ONE global overlay, not a fourth saved profile: while the user edits the
// instrument in Settings, every arrangement class previews that instrument.
// It never enters a picker or the saved-custom pool, and screen.js clears it
// on startup, preset selection, Cancel, or Save. The localStorage slot is only
// a bridge between settings.html and screen.js; it is not durable user data.
export const SESSION_PREVIEW_TUNING_ID = '__session_preview__';
export const SESSION_PREVIEW_TUNING_NAME = 'User-defined live preview';

// Parses + validates the session-preview transport value (JSON string or an
// already-parsed object). Returns resolveSelectedTuningProfile's shape, with
// id/name fixed to the session-preview constants, or null when
// absent/malformed. Same capo/octaveOffset/capoEnabled rules as a saved
// custom tuning.
export function parseSessionPreviewTuning(raw) {
    let d = raw;
    if (typeof d === 'string') {
        const s = d.trim();
        if (!s) return null;
        try { d = JSON.parse(s); } catch (_) { return null; }
    }
    if (!d || typeof d !== 'object' || Array.isArray(d)) return null;
    if (!isValidTuningStringsArray(d.strings)) return null;
    const maxFret = isValidMaxFret(d.maxFret) ? d.maxFret : DEFAULT_MAX_FRET;
    return {
        id: SESSION_PREVIEW_TUNING_ID,
        name: SESSION_PREVIEW_TUNING_NAME,
        strings: d.strings.slice(),
        maxFret,
        ...resolveRetunerCapoOctaveFields(d, maxFret),
    };
}

// Length in [MIN,MAX], every entry parses, and every pitch is in the
// supported C-1..E5 range. Shared by
// window.cr3dSaveCustomTuning and the storage-read filter in screen.js.
export function isValidTuningStringsArray(strings) {
    if (!Array.isArray(strings) || strings.length < MIN_TARGET_STRING_COUNT || strings.length > MAX_TARGET_STRING_COUNT) return false;
    return strings.every(s => {
        const parsed = parseTargetNote(s);
        return parsed !== null && parsed.midi >= MIN_TARGET_MIDI && parsed.midi <= MAX_TARGET_MIDI;
    });
}

// Resolves a note-spec array (length 4-8) into { midiTuning, labels } of
// the same length. A malformed entry falls back per-index to
// the default/extended reference chain rather than
// discarding the whole spec. A non-array or an array outside the supported
// 4-8 string boundary falls back wholesale to the real EADG default.
export function resolveTargetTuning(spec) {
    const validLength = Array.isArray(spec)
        && spec.length >= MIN_TARGET_STRING_COUNT
        && spec.length <= MAX_TARGET_STRING_COUNT;
    const src = validLength ? spec : DEFAULT_TARGET_TUNING;
    const n = src.length;
    // Four-string arrays recover against EADG. Wider arrays recover against
    // BEADG plus its high extensions, preserving the established positional
    // defaults without making BEADG an implicit whole-tuning fallback.
    const fallback = n === MIN_TARGET_STRING_COUNT
        ? DEFAULT_TARGET_TUNING
        : EXTENDED_TARGET_TUNING.slice(BEADG_EXTENDED_INDEX, BEADG_EXTENDED_INDEX + n);
    const midiTuning = new Array(n);
    const labels = new Array(n);
    for (let i = 0; i < n; i += 1) {
        const parsed = parseTargetNote(src[i]) || parseTargetNote(fallback[i]) || parseTargetNote(DEFAULT_TARGET_TUNING[0]);
        midiTuning[i] = parsed.midi;
        labels[i] = parsed.label;
    }
    return { midiTuning, labels };
}

// EADG-shaped engine fallback, matching the selected bass default when a
// lower-level caller omits targetMidiTuning entirely.
const DEFAULT_TARGET = resolveTargetTuning(DEFAULT_TARGET_TUNING);
export const DEFAULT_TARGET_MIDI_TUNING = DEFAULT_TARGET.midiTuning;
export const BEADG_TARGET_MIDI_TUNING = resolveTargetTuning(BEADG_TARGET_TUNING).midiTuning;

// BEADG's own top string (G2) — the usual high-B extension point.
const BEADG_TOP_STRING_MIDI = 43;

// Default note for a newly added string (settings.html's "+ Add"
// button), given direction and the current edge string's MIDI pitch.
// Low: drops a perfect fourth. High: rises a major third only from
// BEADG's own top string, otherwise also a perfect fourth.
export function defaultExtensionNote(direction, edgeMidi) {
    const midi = direction === 'low' ? edgeMidi - 5 : (edgeMidi === BEADG_TOP_STRING_MIDI ? edgeMidi + 4 : edgeMidi + 5);
    return { midi, label: midiToNoteLabel(midi) };
}
