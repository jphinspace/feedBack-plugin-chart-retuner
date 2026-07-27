// Chart Retuner — target tuning spec resolution & defaulting.
// One of four modules chart-retune.js aggregates into `CR`. The chart-remap
// math itself lives in retune-engine.js, which imports the constants below.

import { parseTargetNote, midiToNoteLabel } from './pitch.js';

// Standard open-string MIDI pitches, low string first, by string count.
// Same numbers as lib/song.py's _TUNING_BASE_MIDI.
const STANDARD_OPEN_STRING_MIDI = {
    4: [28, 33, 38, 43],
    5: [23, 28, 33, 38, 43],
    6: [40, 45, 50, 55, 59, 64],
    7: [35, 40, 45, 50, 55, 59, 64],
    8: [30, 35, 40, 45, 50, 55, 59, 64],
};

// Engine fallback when a caller resolves no active tuning at all (deep
// safety net — screen.js always threads a resolved profile's own maxFret
// through). Also the pre-guitar hardcoded ceiling every preset/custom
// tuning defaulted to before per-tuning max fret existed.
export const DEFAULT_MAX_FRET = 20;
// Selectable ceiling for a tuning profile's remap range (settings.html's
// "Max fret" dropdown + each BUILTIN_PRESET_TUNINGS entry below). Charts
// rarely carry data above fret 20 — usually transcribed solos — so 24
// (the render/UI-safe top of the list) is a fine default for anything
// not explicitly tuned narrower.
export const MAX_FRET_OPTIONS = [12, 14, 20, 21, 22, 24];
export function isValidMaxFret(v) {
    return MAX_FRET_OPTIONS.indexOf(v) !== -1;
}

// Capo — a per-tuning-profile fret the player clamps on TOP of the
// tuning's own string pitches; 1 capo fret = 1 half-step per string, and
// frets above (maxFret - capo) fall off the neck. 0 = no capo; negative
// or >= maxFret is invalid. Deliberate identity: tuning every string down
// k half-steps + capo at fret k reproduces the un-capo'd chart exactly.
// Separate from the chart's own SOURCE capo (songInfo.capo, consumed by
// computeOpenStringMidiByString below) — this one describes the TARGET
// instrument, gated by capoEnabled below.
export function isValidCapo(v, maxFret) {
    return Number.isInteger(v) && v >= 0 && v < (Number.isInteger(maxFret) ? maxFret : DEFAULT_MAX_FRET);
}
export function resolveCapo(v, maxFret) {
    return isValidCapo(v, maxFret) ? v : 0;
}
// On/off gate for the capo above — off by default; only literal `true` counts.
export function resolveCapoEnabled(v) {
    return v === true;
}

// Octave offset — shifts the WHOLE CHART ±N octaves before
// remapping, no key change involved. +1 makes an E-standard bass chart
// land on a guitar profile's lowest four strings (E2 A2 D3 G3 sounding
// an octave above the bass's E1 A1 D2 G2) note-for-note; -1 is the
// reverse. Bounded to ±2 octaves; 0 = no shift.
export const MIN_OCTAVE_OFFSET = -2;
export const MAX_OCTAVE_OFFSET = 2;
export function isValidOctaveOffset(v) {
    return Number.isInteger(v) && v >= MIN_OCTAVE_OFFSET && v <= MAX_OCTAVE_OFFSET;
}
export function resolveOctaveOffset(v) {
    return isValidOctaveOffset(v) ? v : 0;
}

// The open-string MIDI array the remap engine should actually match
// against, given the profile's capo + octave offset. A capo RAISES each
// sounding open pitch by `capo` half-steps; a +N octave offset shifts
// the chart up N octaves, which is equivalent to LOWERING the target
// opens by 12·N for matching purposes (the engine transposes the chart
// by moving the target, so no engine change is needed). Callers pair
// this with effectiveMaxFret below.
export function effectiveTargetMidiTuning(midiTuning, capo, octaveOffset) {
    const c = capo | 0, oct = octaveOffset | 0;
    return midiTuning.map(m => m + c - 12 * oct);
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

// Built-in tuning presets for the Active tuning dropdowns — not user-
// editable/deletable. DEFAULT_TUNING_ID/DEFAULT_GUITAR_TUNING_ID (below)
// name the per-class defaults.
//
// `colors: null` means "derive from note identity" (colorRoleForNote,
// falling back to lowBColor for the low string) — EADG/BEADG share this
// since EADG's strings ARE BEADG's own E/A/D/G minus the low B. Guitar
// presets carry an explicit per-position `roles` array instead (their
// guitar-octave notes sit outside the bass note-identity chain, which is
// deliberately not extended with guitar octaves — that same chain also
// drives the settings editor's custom-tuning color suggestions).
// Baritone's roles are position-parallel to standard guitar; the
// 7-string's extra low string gets the dedicated 'lowB' role. Every
// other preset carries concrete hand-picked, note-parallel colors.
//
// `maxFret`: bass (EADG) keeps the historical 20; the 5-string bass and
// every guitar preset get 24 (occasional high transcribed solos); violin
// and mandolin (genuinely short-necked) get 14; the remaining
// orchestral/folk presets default to 24 for lack of a settled number.
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
        // Double-bass solo tuning — standard EADG up a whole step
        // (MIDI 30,35,40,45). Live-tracked, roles position-parallel to
        // EADG: it IS a 4-string bass, each string keeps its position's
        // slot.
        strings: ['F#1', 'B1', 'E2', 'A2'],
        colors: null,
        roles: ['e', 'a', 'd', 'g'],
        maxFret: 24,
    },
    {
        id: 'eadgbe',
        label: 'EADGBE (guitar)',
        // Standard 6-string guitar (MIDI 40,45,50,55,59,64).
        strings: ['E2', 'A2', 'D3', 'G3', 'B3', 'E4'],
        colors: null,
        // Live-track the global palette by POSITION via these roles (the
        // same slots highway_3d gives a 6-string guitar chart's strings) —
        // see the note-identity-chain rationale in the block comment above.
        roles: ['e', 'a', 'd', 'g', 'highB', 'highE'],
        maxFret: 24,
    },
    {
        id: 'beadgbe',
        label: 'BEADGBE (7-string guitar)',
        // Standard 7-string guitar (MIDI 35,40,45,50,55,59,64) — EADGBE
        // plus a low B, which takes the dedicated 'lowB' role (core's
        // "Low B" Highway String Colors swatch).
        strings: ['B1', 'E2', 'A2', 'D3', 'G3', 'B3', 'E4'],
        colors: null,
        roles: ['lowB', 'e', 'a', 'd', 'g', 'highB', 'highE'],
        maxFret: 24,
    },
    {
        id: 'baritone_beadfsb',
        label: 'Baritone (BEADF#B)',
        // Baritone guitar — standard guitar down a perfect fourth
        // (MIDI 35,40,45,50,54,59). Roles are position-parallel to
        // EADGBE: it IS a 6-string guitar, so each string keeps the slot
        // its position has on a standard guitar.
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
        // Cello's note names an octave up (MIDI 48,55,62,69) — same
        // note-parallel colors.
        strings: ['C3', 'G3', 'D4', 'A4'],
        colors: ['#cc00aa', '#f18313', '#3fc413', '#ecd234'],
        maxFret: 24,
    },
    {
        id: 'violin_gdae',
        label: 'Violin (GDAE)',
        // MIDI 55,62,69,76. Fixed colors like Cello: its G/D/A strings
        // reuse Cello's note-parallel hues, the E adds a red.
        strings: ['G3', 'D4', 'A4', 'E5'],
        colors: ['#f18313', '#3fc413', '#ecd234', '#e61f26'],
        maxFret: 14,
    },
    {
        id: 'banjo4_cgbd',
        label: 'Banjo 4-string (CGBD)',
        // Plectrum banjo (MIDI 48,55,59,62). Note-parallel family hues;
        // B adds a blue.
        strings: ['C3', 'G3', 'B3', 'D4'],
        colors: ['#cc00aa', '#f18313', '#1096e6', '#3fc413'],
        maxFret: 24,
    },
    {
        id: 'banjo5_gdgbd',
        label: 'Banjo 5-string (gDGBD)',
        // Open-G 5-string banjo (MIDI 67,50,55,59,62). String 0 is the HIGH
        // G4 drone — deliberately non-monotonic (banjo tab's bottom line
        // is the drone string, written drone-first); handled by
        // resolveTargetForFret's pitch-ordered walk (retune-engine.js,
        // added for this preset). The drone's short neck (no frets below
        // its 5th) is NOT modeled. Duplicate notes share their
        // note-parallel hue.
        strings: ['G4', 'D3', 'G3', 'B3', 'D4'],
        colors: ['#f18313', '#3fc413', '#f18313', '#1096e6', '#3fc413'],
        maxFret: 24,
    },
    {
        id: 'ukulele_gcea',
        label: 'Ukulele (gCEA)',
        // Standard reentrant ukulele (MIDI 67,60,64,69) — string 0 is the
        // HIGH G4, above the C that follows it, so like banjo5_gdgbd this
        // is a non-monotonic target (handled by resolveTargetForFret's
        // pitch-ordered walk). Note-parallel family hues: G/C/E/A reuse
        // the banjo/cello/violin picks for the same note names. 12 frets —
        // a soprano/concert neck.
        strings: ['G4', 'C4', 'E4', 'A4'],
        colors: ['#f18313', '#cc00aa', '#e61f26', '#ecd234'],
        maxFret: 12,
    },
    {
        id: 'baritone_uke_dgbe',
        label: 'Baritone ukulele (DGBE)',
        // Linear (non-reentrant) baritone uke (MIDI 50,55,59,64) — the
        // top four strings of a standard guitar. Note-parallel hues:
        // D/G/B follow the banjo picks, E the violin red. Real necks run
        // ~18-19 frets; 20 is the closest selectable ceiling.
        strings: ['D3', 'G3', 'B3', 'E4'],
        colors: ['#3fc413', '#f18313', '#1096e6', '#e61f26'],
        maxFret: 20,
    },
    {
        id: 'mandolin_ggddaaee',
        label: 'Mandolin (GGDDAAEE)',
        // Four paired courses, violin notes doubled (MIDI 55×2, 62×2,
        // 69×2, 76×2) — 8 strings, the render maximum. Each course pair
        // shares one color: two strings, one logical course.
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
//   - empty/missing (a host that never populates songInfo.arrangement)
//     -> 'bass', preserving this plugin's pre-guitar behavior for such
//     hosts.
// Word boundaries keep substrings from matching ("BasslineKeys" is not
// bass), mirroring matchesArrangement in screen.js.
export function arrangementClassFor(arrangementName) {
    const a = typeof arrangementName === 'string' ? arrangementName.trim() : '';
    if (a === '') return 'bass';
    if (/\bbass\b/i.test(a)) return 'bass';
    if (/\blead\b/i.test(a)) return 'lead';
    return 'rhythm';
}

// Resolves an active-tuning id to { id, strings, colors, roles, maxFret,
// capo, capoEnabled, octaveOffset }: built-in presets first (unset id ->
// the arrangement class's default), then a caller-supplied custom-tuning
// list, falling back to the class-default preset for an id matching
// neither (a stale/deleted id never leaves a caller without a usable
// tuning). `id` is the RESOLVED id — screen.js keys per-tuning capo/
// octave overrides by it. `roles` is non-null only for a preset carrying
// an explicit per-position role array; customs always resolve roles:
// null. `maxFret`/`capo`/`capoEnabled`/`octaveOffset` fall back to sane
// defaults when missing/invalid; capo is validated against the profile's
// OWN maxFret, so shrinking it below a saved capo silently disables the
// capo. Pure: the caller owns reading `id`/`customTunings` from storage.
export function resolveActiveTuning(id, customTunings, arrClass = 'bass') {
    const targetId = id || defaultTuningIdForClass(arrClass);
    // .slice() on preset strings/roles: they're shared module constants —
    // a caller mutating the returned array must never corrupt them for
    // every future resolution. found.strings (the custom-tuning branch) is
    // already a fresh per-read copy from the caller (see screen.js's
    // _crReadCustomTunings), so it's returned as-is.
    const asResult = p => ({
        id: p.id,
        strings: p.strings.slice(),
        colors: p.colors,
        roles: Array.isArray(p.roles) ? p.roles.slice() : null,
        maxFret: p.maxFret,
        capo: resolveCapo(p.capo, p.maxFret),
        capoEnabled: resolveCapoEnabled(p.capoEnabled),
        octaveOffset: resolveOctaveOffset(p.octaveOffset),
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
            capo: resolveCapo(found.capo, maxFret),
            capoEnabled: resolveCapoEnabled(found.capoEnabled),
            octaveOffset: resolveOctaveOffset(found.octaveOffset),
        };
    }
    return asResult(BUILTIN_PRESET_TUNINGS.find(p => p.id === defaultTuningIdForClass(arrClass)));
}

// The silent auto-saved "active" tuning — the unsaved user-defined
// tuning the settings editor edits live. One global slot: whenever the form
// changes, the whole form state is persisted as the active tuning, and
// resolution OVERLAYS it on every arrangement class until the user
// explicitly selects a real tuning (built-in preset or saved custom) —
// which throws the active tuning away. It is never listed in any picker and
// never appears in the saved-tunings pool; this reserved id exists so
// callers (the quick-adjust sliders, name lookups) can recognize it.
export const ACTIVE_TUNING_ID = '__user_defined__';
export const ACTIVE_TUNING_NAME = 'User-defined';

// Parses + validates the persisted active tuning (JSON string or an
// already-parsed object). Returns resolveActiveTuning's shape — { id,
// name, strings, colors, roles, maxFret, capo, capoEnabled, octaveOffset
// } with id/name fixed to the active-tuning constants — or null when
// absent/malformed (callers fall through to normal profile resolution).
// Same capo/octaveOffset/capoEnabled rules as a saved custom tuning;
// colors pass through as stored, for the reader to resolve.
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
        capo: resolveCapo(d.capo, maxFret),
        capoEnabled: resolveCapoEnabled(d.capoEnabled),
        octaveOffset: resolveOctaveOffset(d.octaveOffset),
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
    for (let i = 0; i < n; i++) {
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
// (DEFAULT_TUNING_ID, which is EADG, not BEADG). No caller in this codebase
// actually omits it (screen.js always threads the resolved active tuning
// through), so this is a deep safety net, not what a fresh install renders.
const DEFAULT_TARGET = resolveTargetTuning(DEFAULT_TARGET_TUNING);
export const DEFAULT_TARGET_MIDI_TUNING = DEFAULT_TARGET.midiTuning;
export const TARGET_OPEN_STRING_LABELS = DEFAULT_TARGET.labels;

// Default note for a newly added string (settings.html's "+ Add" button),
// given direction and the current edge string's MIDI pitch. Stateless —
// always computed fresh, never remembers a removed string's value.
// Low: drops a perfect fourth. High: rises a major third only from
// exactly G2 (43, BEADG's own top string — matches the usual high-B
// extension), otherwise also a perfect fourth.
export function defaultExtensionNote(direction, edgeMidi) {
    const midi = direction === 'low' ? edgeMidi - 5 : (edgeMidi === 43 ? edgeMidi + 4 : edgeMidi + 5);
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
    for (let s = 0; s < sourceStringCount; s++) {
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
    let bestK = 0, bestExact = -1, bestTotalAbs = Infinity;
    for (let k = 1 - sourceStringCount; k <= target.length - 1; k++) {
        let exact = 0, totalAbs = 0, counted = 0;
        for (let s = 0; s < sourceStringCount; s++) {
            const j = s + k;
            if (j < 0 || j >= target.length) continue;
            const midi = midiByString[s];
            if (midi === null) continue;
            const adjustment = midi - target[j];
            counted++;
            totalAbs += Math.abs(adjustment);
            if (adjustment === 0) exact++;
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
