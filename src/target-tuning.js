// Chart Retuner — target tuning spec resolution & defaulting.
// One of four modules chart-retune.js aggregates into `CR`. The chart-remap
// math itself lives in retune-engine.js, which imports the constants below.

import { parseTargetNote, midiToNoteLabel, SEMITONES_PER_OCTAVE } from './pitch.js';

// Standard open-string MIDI pitches, low string first, by string count.
// Same numbers as lib/song.py's _TUNING_BASE_MIDI; screen.js's renderer
// base-MIDI table reuses this one rather than keeping its own copy.
export const STANDARD_OPEN_STRING_MIDI = {
    4: [28, 33, 38, 43],
    5: [23, 28, 33, 38, 43],
    6: [40, 45, 50, 55, 59, 64],
    7: [35, 40, 45, 50, 55, 59, 64],
    8: [30, 35, 40, 45, 50, 55, 59, 64],
};

// Engine fallback when a caller resolves no active tuning at all
// (screen.js always threads a resolved profile's own maxFret through).
// Also the pre-guitar hardcoded ceiling every preset/custom tuning
// defaulted to before per-tuning max fret existed.
export const DEFAULT_MAX_FRET = 20;
// Selectable ceiling for a tuning profile's remap range (settings.html's
// "Max fret" dropdown + each BUILTIN_PRESET_TUNINGS entry below). 24 is
// the render/UI-safe top of the list, used as the fallback default.
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

// The open-string MIDI array the remap engine should actually match
// against, given the profile's capo + octave offset. A capo raises each
// sounding open pitch by `capo` half-steps; a +N octave offset is
// applied as -12·N to the target, since the engine transposes by moving
// the target rather than the chart. Callers pair this with
// effectiveMaxFret below.
export function effectiveTargetMidiTuning(midiTuning, capo, octaveOffset) {
    const c = capo | 0;
    const oct = octaveOffset | 0;
    return midiTuning.map(m => m + c - SEMITONES_PER_OCTAVE * oct);
}
// Frets remaining above the capo. capo is validated < maxFret, so this
// is always >= 1 for a valid profile.
export function effectiveMaxFret(maxFret, capo) {
    return Math.max(1, (maxFret | 0) - (capo | 0));
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
export const DEFAULT_TARGET_TUNING = ['B0', 'E1', 'A1', 'D2', 'G2'];
// Fallback chain for resolveTargetTuning (entries past index 4) and the
// note->color-role table in string-colors.js. EXTENDED_CORE_INDEX is the
// index of 'B0', so DEFAULT_TARGET_TUNING[i] === EXTENDED_DEFAULT_TARGET_TUNING[EXTENDED_CORE_INDEX + i].
export const EXTENDED_DEFAULT_TARGET_TUNING = ['C#0', 'F#0', 'B0', 'E1', 'A1', 'D2', 'G2', 'B2', 'E3'];
export const EXTENDED_CORE_INDEX = 2;

// Built-in tuning presets for the Active tuning dropdowns — not
// user-editable/deletable. DEFAULT_TUNING_ID/DEFAULT_GUITAR_TUNING_ID
// (below) name the per-class defaults.
//
// `colors: null` derives from note identity (colorRoleForNote, falling
// back to lowBColor for the low string); EADG/BEADG share this since
// EADG's strings ARE BEADG's own E/A/D/G minus the low B. Guitar presets
// instead carry an explicit per-position `roles` array, since their
// guitar-octave notes sit outside the bass note-identity chain. Every
// other preset carries concrete hand-picked, note-parallel colors.
//
// `maxFret`: EADG keeps DEFAULT_MAX_FRET (20); most other presets use 24;
// violin and mandolin (short-necked) use 14.
export const BUILTIN_PRESET_TUNINGS = [
    {
        id: 'eadg',
        label: 'EADG (default)',
        // Standard 4-string bass — DEFAULT_TARGET_TUNING's own E/A/D/G
        // strings, without the low B.
        strings: DEFAULT_TARGET_TUNING.slice(1),
        colors: null,
        maxFret: 20,
    },
    {
        id: 'beadg',
        label: 'BEADG',
        strings: DEFAULT_TARGET_TUNING,
        colors: null,
        maxFret: 24,
    },
    {
        id: 'upright_solo_fsbea',
        label: 'Upright bass solo (F#BEA)',
        // Double-bass solo tuning (EADG up a whole step). Roles are
        // position-parallel to EADG, since it's still a 4-string bass.
        strings: ['F#1', 'B1', 'E2', 'A2'],
        colors: null,
        roles: ['e', 'a', 'd', 'g'],
        maxFret: 24,
    },
    {
        id: 'eadgbe',
        label: 'EADGBE (guitar)',
        strings: ['E2', 'A2', 'D3', 'G3', 'B3', 'E4'],
        colors: null,
        roles: ['e', 'a', 'd', 'g', 'highB', 'highE'],
        maxFret: 24,
    },
    {
        id: 'beadgbe',
        label: 'BEADGBE (7-string guitar)',
        // EADGBE plus a low B, which takes the dedicated 'lowB' role.
        strings: ['B1', 'E2', 'A2', 'D3', 'G3', 'B3', 'E4'],
        colors: null,
        roles: ['lowB', 'e', 'a', 'd', 'g', 'highB', 'highE'],
        maxFret: 24,
    },
    {
        id: 'baritone_beadfsb',
        label: 'Baritone (BEADF#B)',
        // Standard guitar down a perfect fourth. Roles are
        // position-parallel to EADGBE, since it's still a 6-string guitar.
        strings: ['B1', 'E2', 'A2', 'D3', 'F#3', 'B3'],
        colors: null,
        roles: ['e', 'a', 'd', 'g', 'highB', 'highE'],
        maxFret: 24,
    },
    {
        id: 'cello_cgda',
        label: 'Cello (CGDA)',
        strings: ['C2', 'G2', 'D3', 'A3'],
        colors: ['#cc00aa', '#f18313', '#3fc413', '#ecd234'],
        maxFret: 24,
    },
    {
        id: 'viola_cgda',
        label: 'Viola (CGDA)',
        // Cello's note names an octave up; same note-parallel colors.
        strings: ['C3', 'G3', 'D4', 'A4'],
        colors: ['#cc00aa', '#f18313', '#3fc413', '#ecd234'],
        maxFret: 24,
    },
    {
        id: 'violin_gdae',
        label: 'Violin (GDAE)',
        // Fixed colors like Cello: G/D/A reuse Cello's note-parallel
        // hues, E adds a red.
        strings: ['G3', 'D4', 'A4', 'E5'],
        colors: ['#f18313', '#3fc413', '#ecd234', '#e61f26'],
        maxFret: 14,
    },
    {
        id: 'banjo4_cgbd',
        label: 'Banjo 4-string (CGBD)',
        // Plectrum banjo. Note-parallel family hues; B adds a blue.
        strings: ['C3', 'G3', 'B3', 'D4'],
        colors: ['#cc00aa', '#f18313', '#1096e6', '#3fc413'],
        maxFret: 24,
    },
    {
        id: 'banjo5_gdgbd',
        label: 'Banjo 5-string (gDGBD)',
        // Open-G 5-string banjo. String 0 is the HIGH G4 drone (banjo tab
        // is written drone-first), so this tuning is deliberately
        // non-monotonic — handled by resolveTargetForFret's pitch-ordered
        // walk. The drone's short neck (no frets below its 5th) is not
        // modeled. Duplicate notes share their note-parallel hue.
        strings: ['G4', 'D3', 'G3', 'B3', 'D4'],
        colors: ['#f18313', '#3fc413', '#f18313', '#1096e6', '#3fc413'],
        maxFret: 24,
    },
    {
        id: 'ukulele_gcea',
        label: 'Ukulele (gCEA)',
        // Standard reentrant ukulele: string 0 is the HIGH G4, above the
        // C that follows it, so — like banjo5_gdgbd — this is a
        // non-monotonic target too. Note-parallel hues reuse the
        // banjo/cello/violin picks. 12 frets for a soprano/concert neck.
        strings: ['G4', 'C4', 'E4', 'A4'],
        colors: ['#f18313', '#cc00aa', '#e61f26', '#ecd234'],
        maxFret: 12,
    },
    {
        id: 'baritone_uke_dgbe',
        label: 'Baritone ukulele (DGBE)',
        // Linear (non-reentrant) baritone uke: the top four strings of a
        // standard guitar. Note-parallel hues follow the banjo/violin
        // picks. 20 is the closest selectable ceiling to its real
        // ~18-19 fret neck.
        strings: ['D3', 'G3', 'B3', 'E4'],
        colors: ['#3fc413', '#f18313', '#1096e6', '#e61f26'],
        maxFret: 20,
    },
    {
        id: 'mandolin_ggddaaee',
        label: 'Mandolin (GGDDAAEE)',
        // Four paired courses, violin notes doubled — 8 strings, the
        // render maximum. Each course pair shares one color.
        strings: ['G3', 'G3', 'D4', 'D4', 'A4', 'A4', 'E5', 'E5'],
        colors: ['#f18313', '#f18313', '#3fc413', '#3fc413', '#ecd234', '#ecd234', '#e61f26', '#e61f26'],
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

// Resolves an active-tuning id to { id, strings, colors, roles, maxFret,
// capo, capoEnabled, octaveOffset }: built-in presets first (unset id
// falls back to the arrangement class's default), then a caller-supplied
// custom-tuning list, then the class-default preset for an id matching
// neither. `id` is the RESOLVED id, which screen.js keys per-tuning
// capo/octave overrides by. `roles` is non-null only for a preset
// carrying an explicit role array. `capo` is validated against the
// profile's OWN maxFret, so shrinking it below a saved capo silently
// disables the capo. Pure: the caller owns reading `id`/`customTunings`
// from storage.
export function resolveActiveTuning(id, customTunings, arrClass = 'bass') {
    const targetId = id || defaultTuningIdForClass(arrClass);
    // .slice() on preset strings/roles: they're shared module constants,
    // so each call returns a fresh, safely mutable copy. found.strings
    // (the custom-tuning branch) is already a fresh per-read copy from
    // the caller, so it's returned as-is.
    const asResult = p => ({
        id: p.id,
        strings: p.strings.slice(),
        colors: p.colors,
        roles: Array.isArray(p.roles) ? p.roles.slice() : null,
        maxFret: p.maxFret,
        ...resolveRetunerCapoOctaveFields(p, p.maxFret),
    });
    const preset = BUILTIN_PRESET_TUNINGS.find(p => p.id === targetId);
    if (preset) return asResult(preset);
    const found = Array.isArray(customTunings) ? customTunings.find(p => p.id === targetId) : null;
    if (found) {
        const maxFret = isValidMaxFret(found.maxFret) ? found.maxFret : DEFAULT_MAX_FRET;
        return {
            id: found.id,
            strings: found.strings,
            colors: found.colors,
            roles: null,
            maxFret,
            ...resolveRetunerCapoOctaveFields(found, maxFret),
        };
    }
    return asResult(BUILTIN_PRESET_TUNINGS.find(p => p.id === defaultTuningIdForClass(arrClass)));
}

// The silent auto-saved "active" tuning: the unsaved user-defined
// tuning the settings editor edits live. Any form change persists the
// whole form state as the active tuning, and resolution overlays it on
// every arrangement class until the user selects a real tuning (which
// discards it). Stays out of every picker and saved-tunings pool; this
// reserved id lets callers (quick-adjust sliders, name lookups)
// recognize it.
export const ACTIVE_TUNING_ID = '__user_defined__';
export const ACTIVE_TUNING_NAME = 'User-defined';

// Parses + validates the persisted active tuning (JSON string or an
// already-parsed object). Returns resolveActiveTuning's shape, with
// id/name fixed to the active-tuning constants, or null when
// absent/malformed. Same capo/octaveOffset/capoEnabled rules as a saved
// custom tuning; colors pass through as stored.
export function parseActiveTuning(raw) {
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
        id: ACTIVE_TUNING_ID,
        name: ACTIVE_TUNING_NAME,
        strings: d.strings.slice(),
        colors: Array.isArray(d.colors) ? d.colors.slice() : null,
        roles: null,
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
// DEFAULT_TARGET_TUNING/EXTENDED_DEFAULT_TARGET_TUNING rather than
// discarding the whole spec. A non-array/empty spec falls back to BEADG.
export function resolveTargetTuning(spec) {
    const src = (Array.isArray(spec) && spec.length > 0) ? spec : DEFAULT_TARGET_TUNING;
    const n = src.length;
    const midiTuning = new Array(n);
    const labels = new Array(n);
    for (let i = 0; i < n; i += 1) {
        const fallbackSpec = i < DEFAULT_TARGET_TUNING.length
            ? DEFAULT_TARGET_TUNING[i]
            : EXTENDED_DEFAULT_TARGET_TUNING[EXTENDED_CORE_INDEX + i];
        const parsed = parseTargetNote(src[i]) || parseTargetNote(fallbackSpec) || parseTargetNote(DEFAULT_TARGET_TUNING[0]);
        midiTuning[i] = parsed.midi;
        labels[i] = parsed.label;
    }
    return { midiTuning, labels };
}

// BEADG-shaped engine fallback, used when a caller omits targetMidiTuning
// entirely — independent of the user's chosen default preset
// (DEFAULT_TUNING_ID, which is EADG, not BEADG). No caller in this
// codebase actually omits it, so this exists purely as a deep safety net.
const DEFAULT_TARGET = resolveTargetTuning(DEFAULT_TARGET_TUNING);
export const DEFAULT_TARGET_MIDI_TUNING = DEFAULT_TARGET.midiTuning;

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

export function standardOpenStringMidi(stringCount) {
    return STANDARD_OPEN_STRING_MIDI[stringCount] || STANDARD_OPEN_STRING_MIDI[6];
}

// Source string `s`'s open pitch under the chart's own tuning/capo.
export function sourceOpenStringMidi(sourceStringCount, tuningOffsets, capo, s) {
    if (!tuningOffsets || !(s >= 0 && s < tuningOffsets.length)) return null;
    const base = standardOpenStringMidi(sourceStringCount);
    const root = s < base.length ? base[s] : base[base.length - 1];
    return root + (tuningOffsets[s] | 0) + (capo | 0);
}

export function computeOpenStringMidiByString(sourceStringCount, tuningOffsets, capo) {
    const midiByString = [];
    for (let s = 0; s < sourceStringCount; s += 1) {
        midiByString.push(sourceOpenStringMidi(sourceStringCount, tuningOffsets, capo, s));
    }
    return midiByString;
}

// The shift k (target string = source string + k) that best aligns the
// source strings with the target — most exact matches win, ties broken by
// smallest total |adjustment| then smallest |k|. `sourceOpenMidiByString`
// is optional, pass it when already computed.
export function computeArrangementShift(sourceStringCount, tuningOffsets, capo, sourceOpenMidiByString, targetMidiTuning) {
    const midiByString = sourceOpenMidiByString || computeOpenStringMidiByString(sourceStringCount, tuningOffsets, capo);
    const target = targetMidiTuning || DEFAULT_TARGET_MIDI_TUNING;
    let bestK = 0;
    let bestExact = -1;
    let bestTotalAbs = Infinity;
    for (let k = 1 - sourceStringCount; k <= target.length - 1; k += 1) {
        let exact = 0;
        let totalAbs = 0;
        let counted = 0;
        for (let s = 0; s < sourceStringCount; s += 1) {
            const j = s + k;
            if (j < 0 || j >= target.length) continue;
            const midi = midiByString[s];
            if (midi === null) continue;
            const adjustment = midi - target[j];
            counted += 1;
            totalAbs += Math.abs(adjustment);
            if (adjustment === 0) exact += 1;
        }
        if (counted === 0) continue;
        if (exact > bestExact
            || (exact === bestExact && totalAbs < bestTotalAbs)
            || (exact === bestExact && totalAbs === bestTotalAbs && Math.abs(k) < Math.abs(bestK))) {
            bestExact = exact;
            bestTotalAbs = totalAbs;
            bestK = k;
        }
    }
    return bestK;
}
