// Standalone Node verification for stage 1 (target tuning resolution) and
// the settings/profile layer built on top of it (presets, custom-tuning
// validation, capo/octave field validators). Imports definitions directly
// so the stage boundary is covered. Run with `node
// test/target-tuning.test.mjs`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_MAX_FRET } from '../src/common.js';
import { parseTargetNote, midiToNoteLabel } from '../src/pitch.js';
import { remapNote } from '../src/retune-engine.js';
import {
    MAX_FRET_OPTIONS,
    isValidMaxFret,
    isValidCapo,
    resolveCapo,
    resolveCapoEnabled,
    MIN_OCTAVE_OFFSET,
    MAX_OCTAVE_OFFSET,
    isValidOctaveOffset,
    resolveOctaveOffset,
    MAX_TARGET_STRING_COUNT,
    MIN_TARGET_STRING_COUNT,
    MIN_TARGET_MIDI,
    MAX_TARGET_MIDI,
    DEFAULT_TARGET_MIDI_TUNING,
    DEFAULT_TARGET_TUNING,
    BEADG_TARGET_MIDI_TUNING,
    BEADG_TARGET_TUNING,
    EXTENDED_TARGET_TUNING,
    defaultExtensionNote,
    isValidTuningStringsArray,
    BUILTIN_PRESET_TUNINGS,
    DEFAULT_TUNING_ID,
    DEFAULT_GUITAR_TUNING_ID,
    defaultTuningIdForClass,
    arrangementClassFor,
    resolveSelectedTuningProfile,
    resolveRetunerCapoOctaveFields,
    applyRetunerCapoOctaveOverride,
    resolveTargetTuning,
    parseSessionPreviewTuning,
    SESSION_PREVIEW_TUNING_ID,
    SESSION_PREVIEW_TUNING_NAME,
} from '../src/target-tuning.js';

// Custom target tuning: parseTargetNote / resolveTargetTuning.
test('custom target tuning: parseTargetNote / resolveTargetTuning', () => {
    assert.deepStrictEqual(parseTargetNote('B0'), { midi: 23, label: 'B' });
    assert.deepStrictEqual(parseTargetNote('f#2'), { midi: 42, label: 'F#' });
    assert.deepStrictEqual(parseTargetNote('Bb1'), { midi: 34, label: 'Bb' });
    assert.deepStrictEqual(parseTargetNote('A-1'), { midi: 9, label: 'A' });
    assert.deepStrictEqual(parseTargetNote('H0'), null);
    assert.deepStrictEqual(parseTargetNote('B'), null);
    assert.deepStrictEqual(parseTargetNote(undefined), null);

    const beadg = resolveTargetTuning(BEADG_TARGET_TUNING);
    assert.deepStrictEqual(beadg.midiTuning, [23, 28, 33, 38, 43]);
    assert.deepStrictEqual(BEADG_TARGET_MIDI_TUNING, beadg.midiTuning);
    assert.deepStrictEqual(beadg.labels, ['B', 'E', 'A', 'D', 'G']);
    assert.deepStrictEqual(resolveTargetTuning(DEFAULT_TARGET_TUNING).midiTuning, DEFAULT_TARGET_MIDI_TUNING);
    assert.deepStrictEqual(DEFAULT_TARGET_TUNING, ['E1', 'A1', 'D2', 'G2']);

    const partial = resolveTargetTuning(['B0', 'garbage', 'A1', 'D2', 'G2']);
    assert.deepStrictEqual(partial.midiTuning, [23, 28, 33, 38, 43]);

    assert.deepStrictEqual(resolveTargetTuning(null).midiTuning, DEFAULT_TARGET_MIDI_TUNING);

    // The tolerant public boundary accepts exactly 4-8 strings. Arrays
    // outside that range fall back wholesale to the safe EADG default.
    assert.deepStrictEqual(resolveTargetTuning(['A0', 'F1']).midiTuning, DEFAULT_TARGET_MIDI_TUNING);
    assert.deepStrictEqual(resolveTargetTuning(['A0', 'E1', 'A1']).midiTuning, DEFAULT_TARGET_MIDI_TUNING);
    assert.deepStrictEqual(resolveTargetTuning(new Array(9).fill('E1')).midiTuning, DEFAULT_TARGET_MIDI_TUNING);
    const minimum = resolveTargetTuning(['E1', 'A1', 'D2', 'G2']);
    assert.deepStrictEqual(minimum.midiTuning, [28, 33, 38, 43]);

    // A malformed entry past index 4 falls back to EXTENDED_TARGET_TUNING.
    const long = resolveTargetTuning(['B0', 'E1', 'A1', 'D2', 'G2', 'garbage']);
    assert.deepStrictEqual(long.midiTuning, [23, 28, 33, 38, 43, 47]);
    assert.deepStrictEqual(long.labels[5], 'B');

    // The longest supported target has three positions beyond BEADG. All
    // three must have an indexed fallback; the eighth used to run past the
    // extended table and wrap all the way down to B0.
    const longest = resolveTargetTuning(['B0', 'E1', 'A1', 'D2', 'G2', 'garbage', 'garbage', 'garbage']);
    assert.deepStrictEqual(longest.midiTuning, [23, 28, 33, 38, 43, 47, 52, 57]);
    assert.deepStrictEqual(longest.labels, ['B', 'E', 'A', 'D', 'G', 'B', 'E', 'A']);
});

// The parser owns only the session-preview payload shape. screen.js owns its
// deliberately global precedence and clears it at every lifecycle boundary.
test('parseSessionPreviewTuning', () => {
    const good = { strings: ['G3', 'D4', 'A4', 'E5'], maxFret: 14, capo: 4, capoEnabled: true, octaveOffset: 1 };
    const r = parseSessionPreviewTuning(JSON.stringify(good));
    assert.deepStrictEqual(
        r,
        {
            id: SESSION_PREVIEW_TUNING_ID,
            name: SESSION_PREVIEW_TUNING_NAME,
            strings: good.strings,
            maxFret: 14,
            capo: 4,
            capoEnabled: true,
            octaveOffset: 1,
        },
    );
    assert.equal(parseSessionPreviewTuning(good).capo, 4);
    assert.equal(parseSessionPreviewTuning({ strings: ['E1', 'A1', 'D2', 'G2'] }).capoEnabled, false);
    assert.equal(parseSessionPreviewTuning({ strings: ['E1', 'A1', 'D2', 'G2'], capoEnabled: 'true' }).capoEnabled, false);

    assert.deepStrictEqual([parseSessionPreviewTuning(''), parseSessionPreviewTuning('   '), parseSessionPreviewTuning(null), parseSessionPreviewTuning(undefined)],
        [null, null, null, null]);
    assert.equal(parseSessionPreviewTuning('{nope'), null);
    assert.deepStrictEqual([parseSessionPreviewTuning('42'), parseSessionPreviewTuning('[1,2,3]')], [null, null]);
    assert.equal(parseSessionPreviewTuning({ strings: ['E1', 'A1'] }), null);

    const sloppy = parseSessionPreviewTuning({ strings: ['E1', 'A1', 'D2', 'G2'], colors: ['legacy'], maxFret: 99, capo: 25, octaveOffset: 9 });
    assert.deepStrictEqual(
        { maxFret: sloppy.maxFret, capo: sloppy.capo, octaveOffset: sloppy.octaveOffset },
        { maxFret: DEFAULT_MAX_FRET, capo: 0, octaveOffset: 0 },
    );
    assert.equal(Object.hasOwn(sloppy, 'colors'), false, 'legacy color data is ignored');
    // Capo is validated against the preview's own maxFret, like saved customs.
    assert.equal(parseSessionPreviewTuning({ strings: ['E1', 'A1', 'D2', 'G2'], maxFret: 14, capo: 13 }).capo, 13);
    assert.equal(parseSessionPreviewTuning({ strings: ['E1', 'A1', 'D2', 'G2'], maxFret: 14, capo: 14 }).capo, 0);
    const aliasIn = { strings: ['E1', 'A1', 'D2', 'G2'] };
    const aliased = parseSessionPreviewTuning(aliasIn);
    assert.notStrictEqual(aliased.strings, aliasIn.strings, 'parsed strings must be a fresh copy');
});

// Variable target string count: 4-8, matching highway_3d's floor and
// MAX_RENDER_STRINGS.
test('variable target string count', () => {
    assert.deepStrictEqual(DEFAULT_MAX_FRET, 24);
    assert.deepStrictEqual(MIN_TARGET_STRING_COUNT, 4);
    assert.deepStrictEqual(MAX_TARGET_STRING_COUNT, 8);
});

// defaultExtensionNote / midiToNoteLabel: low extensions drop a perfect
// fourth; high extensions rise a major third only from BEADG's G2 (43).
test('defaultExtensionNote / midiToNoteLabel', () => {
    assert.deepStrictEqual(DEFAULT_TARGET_MIDI_TUNING.map(midiToNoteLabel), DEFAULT_TARGET_TUNING);

    assert.deepStrictEqual(defaultExtensionNote('high', 43), { midi: 47, label: 'B2' });
    assert.deepStrictEqual(defaultExtensionNote('low', 28), { midi: 23, label: 'B0' });

    assert.deepStrictEqual(defaultExtensionNote('high', 47), { midi: 52, label: 'E3' });
    assert.deepStrictEqual(defaultExtensionNote('low', 23), { midi: 18, label: 'F#0' });

    assert.deepStrictEqual(defaultExtensionNote('high', 33), { midi: 38, label: 'D2' });

    assert.deepStrictEqual(EXTENDED_TARGET_TUNING[1], 'F#0');
    assert.deepStrictEqual(EXTENDED_TARGET_TUNING[7], 'B2');
    assert.deepStrictEqual(EXTENDED_TARGET_TUNING[9], 'A3');
});

// isValidTuningStringsArray: string-count, MIDI-range, and parse-validity checks.
test('isValidTuningStringsArray', () => {
    assert.deepStrictEqual(isValidTuningStringsArray(DEFAULT_TARGET_TUNING), true);
    assert.deepStrictEqual(isValidTuningStringsArray(['E1', 'A1', 'D2', 'G2']), true);
    assert.deepStrictEqual(isValidTuningStringsArray(['C#0', 'F#0', 'B0', 'E1', 'A1', 'D2', 'G2', 'B2']), true);
    assert.deepStrictEqual(isValidTuningStringsArray(['A1', 'D2', 'G2']), false);
    assert.deepStrictEqual(isValidTuningStringsArray(['C#0', 'F#0', 'B0', 'E1', 'A1', 'D2', 'G2', 'B2', 'E3']), false);
    assert.deepStrictEqual(isValidTuningStringsArray(['C-1', 'E1', 'A1', 'D2', 'E5']), true);
    assert.deepStrictEqual(isValidTuningStringsArray(['C-2', 'E1', 'A1', 'D2']), false);
    assert.deepStrictEqual(isValidTuningStringsArray(['E1', 'A1', 'D2', 'F5']), false);
    assert.deepStrictEqual([MIN_TARGET_MIDI, MAX_TARGET_MIDI], [0, 76]);
    assert.deepStrictEqual(isValidTuningStringsArray(['B0', 'E1', 'garbage', 'D2', 'G2']), false);
    assert.deepStrictEqual(isValidTuningStringsArray(null), false);
    assert.deepStrictEqual(isValidTuningStringsArray('B0,E1,A1,D2,G2'), false);
});

// BUILTIN_PRESET_TUNINGS / DEFAULT_TUNING_ID / resolveSelectedTuningProfile: the
// built-in-preset resolution path screen.js's _resolveTuningForArrangement
// delegates to wholesale.
test('BUILTIN_PRESET_TUNINGS / DEFAULT_TUNING_ID / resolveSelectedTuningProfile', () => {
    assert.deepStrictEqual(DEFAULT_TUNING_ID, 'eadg');
    assert.deepStrictEqual(DEFAULT_GUITAR_TUNING_ID, 'eadgbe');
    assert.deepStrictEqual(BUILTIN_PRESET_TUNINGS[0].strings, DEFAULT_TARGET_TUNING);
    assert.deepStrictEqual(BUILTIN_PRESET_TUNINGS[1].strings, BEADG_TARGET_TUNING);
    const eadgbePreset = BUILTIN_PRESET_TUNINGS.find(p => p.id === 'eadgbe');
    assert.deepStrictEqual(eadgbePreset.strings, ['E2', 'A2', 'D3', 'G3', 'B3', 'E4']);
    assert.deepStrictEqual(resolveTargetTuning(eadgbePreset.strings).midiTuning, [40, 45, 50, 55, 59, 64]);
    const sevenPreset = BUILTIN_PRESET_TUNINGS.find(p => p.id === 'beadgbe');
    assert.deepStrictEqual(resolveTargetTuning(sevenPreset.strings).midiTuning, [35, 40, 45, 50, 55, 59, 64]);
    const baritonePreset = BUILTIN_PRESET_TUNINGS.find(p => p.id === 'baritone_beadfsb');
    assert.deepStrictEqual(resolveTargetTuning(baritonePreset.strings).midiTuning, [35, 40, 45, 50, 54, 59]);
    const violinPreset = BUILTIN_PRESET_TUNINGS.find(p => p.id === 'violin_gdae');
    assert.deepStrictEqual(resolveTargetTuning(violinPreset.strings).midiTuning, [55, 62, 69, 76]);
    const uprightPreset = BUILTIN_PRESET_TUNINGS.find(p => p.id === 'upright_solo_fsbea');
    assert.deepStrictEqual(resolveTargetTuning(uprightPreset.strings).midiTuning, [30, 35, 40, 45]);
    const violaPreset = BUILTIN_PRESET_TUNINGS.find(p => p.id === 'viola_cgda');
    assert.deepStrictEqual(resolveTargetTuning(violaPreset.strings).midiTuning, [48, 55, 62, 69]);
    const banjo4Preset = BUILTIN_PRESET_TUNINGS.find(p => p.id === 'banjo4_cgbd');
    assert.deepStrictEqual(resolveTargetTuning(banjo4Preset.strings).midiTuning, [48, 55, 59, 62]);
    const banjo5Preset = BUILTIN_PRESET_TUNINGS.find(p => p.id === 'banjo5_gdgbd');
    assert.deepStrictEqual(resolveTargetTuning(banjo5Preset.strings).midiTuning, [67, 50, 55, 59, 62]);
    const mandolinPreset = BUILTIN_PRESET_TUNINGS.find(p => p.id === 'mandolin_ggddaaee');
    assert.deepStrictEqual(resolveTargetTuning(mandolinPreset.strings).midiTuning, [55, 55, 62, 62, 69, 69, 76, 76]);
    assert.deepStrictEqual(mandolinPreset.strings.length, MAX_TARGET_STRING_COUNT);
    assert.equal(BUILTIN_PRESET_TUNINGS.every(p => isValidTuningStringsArray(p.strings)), true);
    assert.equal(BUILTIN_PRESET_TUNINGS.some(p => Object.hasOwn(p, 'colors') || Object.hasOwn(p, 'roles')), false);

    // Every resolution also reports the RESOLVED id plus capo/capoEnabled/
    // octaveOffset (default off/0 unless the profile carries valid
    // values) — folded into the expected shapes below via this tiny helper.
    const adj = (id, shape) => Object.assign({ id, capo: 0, capoEnabled: false, octaveOffset: 0 }, shape);
    assert.deepStrictEqual(resolveSelectedTuningProfile(undefined, []), adj('eadg', { strings: DEFAULT_TARGET_TUNING, maxFret: 20 }));
    assert.deepStrictEqual(resolveSelectedTuningProfile('eadg', []), adj('eadg', { strings: DEFAULT_TARGET_TUNING, maxFret: 20 }));
    assert.deepStrictEqual(resolveSelectedTuningProfile('beadg', []), adj('beadg', { strings: BEADG_TARGET_TUNING, maxFret: 24 }));
    assert.deepStrictEqual(resolveSelectedTuningProfile('eadgbe', []),
        adj('eadgbe', { strings: ['E2', 'A2', 'D3', 'G3', 'B3', 'E4'], maxFret: 24 }));
    assert.deepStrictEqual(resolveSelectedTuningProfile('cello_cgda', []),
        adj('cello_cgda', { strings: ['C2', 'G2', 'D3', 'A3'], maxFret: 24 }));
    assert.deepStrictEqual(resolveSelectedTuningProfile('custom_abc', [{ id: 'custom_abc', name: 'AEADG', strings: ['A0', 'E1', 'A1', 'D2', 'G2'] }]),
        adj('custom_abc', { strings: ['A0', 'E1', 'A1', 'D2', 'G2'], maxFret: 24 }));
    assert.deepStrictEqual(resolveSelectedTuningProfile('custom_mf', [{ id: 'custom_mf', name: 'Custom24', strings: ['A0', 'E1', 'A1', 'D2', 'G2'], maxFret: 24 }]),
        adj('custom_mf', { strings: ['A0', 'E1', 'A1', 'D2', 'G2'], maxFret: 24 }));
    assert.deepStrictEqual(resolveSelectedTuningProfile('custom_bad_mf', [{ id: 'custom_bad_mf', name: 'BadMF', strings: ['A0', 'E1', 'A1', 'D2', 'G2'], maxFret: 17 }]),
        adj('custom_bad_mf', { strings: ['A0', 'E1', 'A1', 'D2', 'G2'], maxFret: 24 }));
    const callerOwnedStrings = ['A0', 'E1', 'A1', 'D2', 'G2'];
    const copiedCustom = resolveSelectedTuningProfile('custom_copy', [{ id: 'custom_copy', name: 'Copy', strings: callerOwnedStrings }]);
    assert.notStrictEqual(copiedCustom.strings, callerOwnedStrings);
    copiedCustom.strings[0] = 'B0';
    assert.deepStrictEqual(callerOwnedStrings[0], 'A0');
    // A matching but malformed custom entry is not allowed to cross the
    // resolver boundary; it falls back to the arrangement's safe preset.
    assert.deepStrictEqual(resolveSelectedTuningProfile('custom_bad', [{ id: 'custom_bad', name: 'Bad', strings: ['E1', 'A1', 'D2'] }]),
        adj('eadg', { strings: DEFAULT_TARGET_TUNING, maxFret: 20 }));
    // Unknown/deleted ids fall back to the arrangement class's default
    // preset (EADG shape for bass, EADGBE for guitar classes) — changed
    // from the pre-guitar hardcoded BEADG-shape fallback (see HISTORY.md
    // Phase 12): the class default matches what a fresh install shows.
    assert.deepStrictEqual(resolveSelectedTuningProfile('stale_deleted_id', []), adj('eadg', { strings: DEFAULT_TARGET_TUNING, maxFret: 20 }));
    assert.deepStrictEqual(resolveSelectedTuningProfile('stale_deleted_id', null), adj('eadg', { strings: DEFAULT_TARGET_TUNING, maxFret: 20 }));
    assert.deepStrictEqual(resolveSelectedTuningProfile('stale_deleted_id', undefined), adj('eadg', { strings: DEFAULT_TARGET_TUNING, maxFret: 20 }));
    assert.deepStrictEqual(resolveSelectedTuningProfile('stale_deleted_id', [], 'lead'),
        adj('eadgbe', { strings: ['E2', 'A2', 'D3', 'G3', 'B3', 'E4'], maxFret: 24 }));
    assert.deepStrictEqual(resolveSelectedTuningProfile(undefined, [], 'rhythm'),
        adj('eadgbe', { strings: ['E2', 'A2', 'D3', 'G3', 'B3', 'E4'], maxFret: 24 }));
    assert.deepStrictEqual(resolveSelectedTuningProfile('eadg', [], 'lead'), adj('eadg', { strings: DEFAULT_TARGET_TUNING, maxFret: 20 }));
    assert.deepStrictEqual(resolveSelectedTuningProfile('cello_cgda', [{ id: 'cello_cgda', name: 'user override attempt', strings: ['E1', 'A1', 'D2', 'G2'] }]),
        adj('cello_cgda', { strings: ['C2', 'G2', 'D3', 'A3'], maxFret: 24 }));

    assert.deepStrictEqual(MAX_FRET_OPTIONS, [12, 14, 20, 21, 22, 24]);
    assert.deepStrictEqual(MAX_FRET_OPTIONS.every(isValidMaxFret), true);
    assert.deepStrictEqual(isValidMaxFret(17), false);
    assert.deepStrictEqual(isValidMaxFret('20'), false);
    assert.deepStrictEqual(BUILTIN_PRESET_TUNINGS.every(p => isValidMaxFret(p.maxFret)), true);
    assert.deepStrictEqual(BUILTIN_PRESET_TUNINGS.find(p => p.id === 'eadg').maxFret, 20);
    assert.deepStrictEqual(BUILTIN_PRESET_TUNINGS.find(p => p.id === 'beadg').maxFret, 24);
    assert.deepStrictEqual(['eadgbe', 'beadgbe', 'baritone_beadfsb'].every(id => BUILTIN_PRESET_TUNINGS.find(p => p.id === id).maxFret === 24), true);
    assert.deepStrictEqual(['violin_gdae', 'mandolin_ggddaaee'].every(id => BUILTIN_PRESET_TUNINGS.find(p => p.id === id).maxFret === 14), true);
});

// defaultTuningIdForClass / arrangementClassFor: the per-class profile
// routing screen.js's _crProfileKeyFor/_crArrClass tracking delegates to.
test('defaultTuningIdForClass / arrangementClassFor', () => {
    assert.deepStrictEqual(defaultTuningIdForClass('bass'), 'eadg');
    assert.deepStrictEqual(defaultTuningIdForClass('rhythm'), 'eadgbe');
    assert.deepStrictEqual(defaultTuningIdForClass('lead'), 'eadgbe');

    assert.deepStrictEqual(arrangementClassFor('Bass'), 'bass');
    assert.deepStrictEqual(arrangementClassFor('Bass 2'), 'bass');
    assert.deepStrictEqual(arrangementClassFor('Lead'), 'lead');
    assert.deepStrictEqual(arrangementClassFor('Rhythm'), 'rhythm');
    assert.deepStrictEqual(arrangementClassFor('Combo'), 'rhythm');
    assert.deepStrictEqual(arrangementClassFor('Guitar 22'), 'rhythm');
    assert.deepStrictEqual(arrangementClassFor('Lead Bass'), 'bass');
    assert.deepStrictEqual(arrangementClassFor('BasslineKeys'), 'rhythm');
    assert.deepStrictEqual(arrangementClassFor('LEAD'), 'lead');
    assert.deepStrictEqual(arrangementClassFor(''), 'bass');
    assert.deepStrictEqual(arrangementClassFor('   '), 'bass');
    assert.deepStrictEqual(arrangementClassFor(undefined), 'bass');
    assert.deepStrictEqual(arrangementClassFor(42), 'bass');
});

// First-time install: no session-preview payload and no per-class
// profile id for any arrangement class. Confirms the full chain lands on
// a real, playable builtin default (not null/undefined/a crash) for
// every class, with capo off and no octave shift, exactly what a
// brand-new user sees with zero prior localStorage state.
test('first-time install resolves a real, playable builtin default', (t) => {
    assert.deepStrictEqual(parseSessionPreviewTuning(undefined), null);
    for (const [cls, expectedId] of [['bass', 'eadg'], ['rhythm', 'eadgbe'], ['lead', 'eadgbe']]) {
        t.test(`class=${cls}`, () => {
            const resolved = resolveSelectedTuningProfile(undefined, [], cls);
            assert.deepStrictEqual({ id: resolved.id, capo: resolved.capo, capoEnabled: resolved.capoEnabled, octaveOffset: resolved.octaveOffset },
                { id: expectedId, capo: 0, capoEnabled: false, octaveOffset: 0 });
            assert.deepStrictEqual(BUILTIN_PRESET_TUNINGS.some(p => p.id === resolved.id), true);
        });
    }
});

// ── Capo & octave offset field validation ──────────────────────────────
// These validate whether a STORED capo/octaveOffset VALUE is legal — not
// what effect it has on a remap (that's target-capo.js/source-tuning.js).

test('validation helpers', () => {
    assert.deepStrictEqual(isValidCapo(0, 20), true);
    assert.deepStrictEqual(isValidCapo(19, 20), true);
    assert.deepStrictEqual(isValidCapo(20, 20), false);
    assert.deepStrictEqual(isValidCapo(-1, 20), false);
    assert.deepStrictEqual(isValidCapo(1.5, 20), false);
    assert.deepStrictEqual(resolveCapo(25, 20), 0);
    assert.deepStrictEqual(resolveCapo(4, 20), 4);
    assert.deepStrictEqual([resolveCapoEnabled(true), resolveCapoEnabled(false), resolveCapoEnabled(undefined), resolveCapoEnabled('true'), resolveCapoEnabled(1)],
        [true, false, false, false, false]);
    assert.deepStrictEqual([MIN_OCTAVE_OFFSET, MAX_OCTAVE_OFFSET], [-2, 2]);
    assert.deepStrictEqual([isValidOctaveOffset(-2), isValidOctaveOffset(2), isValidOctaveOffset(0), isValidOctaveOffset(3), isValidOctaveOffset(-3), isValidOctaveOffset(0.5)],
        [true, true, true, false, false, false]);
    assert.deepStrictEqual(resolveOctaveOffset(9), 0);
});

// resolveRetunerCapoOctaveFields: the shared { capo, capoEnabled,
// octaveOffset } resolver every resolved-profile builder (resolveSelectedTuningProfile's
// two branches, parseSessionPreviewTuning, screen.js's save/seed paths) delegates to.
test('resolveRetunerCapoOctaveFields', () => {
    assert.deepStrictEqual(resolveRetunerCapoOctaveFields({ capo: 4, capoEnabled: true, octaveOffset: 1 }, 20),
        { capo: 4, capoEnabled: true, octaveOffset: 1 });
    assert.deepStrictEqual(resolveRetunerCapoOctaveFields({ capo: 25, capoEnabled: 'yes', octaveOffset: 9 }, 20),
        { capo: 0, capoEnabled: false, octaveOffset: 0 });
    assert.deepStrictEqual(resolveRetunerCapoOctaveFields({}, 20),
        { capo: 0, capoEnabled: false, octaveOffset: 0 });
    assert.deepStrictEqual(resolveRetunerCapoOctaveFields({ capo: 13 }, 14),
        { capo: 13, capoEnabled: false, octaveOffset: 0 });
});

// applyRetunerCapoOctaveOverride: the shared per-tuning quick-adjust merge
// screen.js's player-controls widget and settings.html's editor both apply
// on top of an already-resolved profile.
test('applyRetunerCapoOctaveOverride', () => {
    const baseProfile = () => ({ id: 'eadgbe', maxFret: 24, capo: 0, capoEnabled: false, octaveOffset: 0 });
    assert.deepStrictEqual(applyRetunerCapoOctaveOverride(baseProfile(), { capo: 3, capoEnabled: true, octave: -1 }),
        { id: 'eadgbe', maxFret: 24, capo: 3, capoEnabled: true, octaveOffset: -1 });
    assert.deepStrictEqual([applyRetunerCapoOctaveOverride(baseProfile(), null), applyRetunerCapoOctaveOverride(baseProfile(), 'nope')],
        [baseProfile(), baseProfile()]);
    assert.deepStrictEqual(applyRetunerCapoOctaveOverride(baseProfile(), { capo: 24, capoEnabled: true, octave: 1 }),
        { id: 'eadgbe', maxFret: 24, capo: 0, capoEnabled: true, octaveOffset: 1 });
    assert.deepStrictEqual(applyRetunerCapoOctaveOverride(baseProfile(), { capo: 2, capoEnabled: 'yes', octave: 0 }),
        { id: 'eadgbe', maxFret: 24, capo: 2, capoEnabled: false, octaveOffset: 0 });
    assert.deepStrictEqual(applyRetunerCapoOctaveOverride(baseProfile(), { capo: 0, capoEnabled: false, octave: 9 }),
        baseProfile());
    assert.deepStrictEqual((() => {
        const p = baseProfile();
        return applyRetunerCapoOctaveOverride(p, { capo: 5, capoEnabled: true, octave: 2 }) === p;
    })(), true);
});

// resolveSelectedTuningProfile: resolved id + capo/octaveOffset fields, and the
// ukulele presets.
test('resolveSelectedTuningProfile: capo/octaveOffset fields and ukulele presets', () => {
    const t = resolveSelectedTuningProfile('eadgbe', []);
    assert.deepStrictEqual(t.id, 'eadgbe');
    assert.deepStrictEqual([t.capo, t.capoEnabled, t.octaveOffset], [0, false, 0]);

    const uke = resolveSelectedTuningProfile('ukulele_gcea', []);
    assert.deepStrictEqual(uke.strings, ['G4', 'C4', 'E4', 'A4']);
    assert.deepStrictEqual(uke.maxFret, 12);
    const bari = resolveSelectedTuningProfile('baritone_uke_dgbe', []);
    assert.deepStrictEqual(bari.strings, ['D3', 'G3', 'B3', 'E4']);

    const customs = [
        { id: 'c1', name: 'Octave cello', strings: ['C2', 'G2', 'D3', 'A3'], maxFret: 24, capo: 2, capoEnabled: true, octaveOffset: 1 },
        { id: 'c2', name: 'Bad adjust', strings: ['C2', 'G2', 'D3', 'A3'], maxFret: 12, capo: 20, capoEnabled: 'yes', octaveOffset: 9 },
    ];
    const c1 = resolveSelectedTuningProfile('c1', customs);
    assert.deepStrictEqual([c1.id, c1.capo, c1.capoEnabled, c1.octaveOffset], ['c1', 2, true, 1]);
    const c2 = resolveSelectedTuningProfile('c2', customs);
    assert.deepStrictEqual([c2.capo, c2.capoEnabled, c2.octaveOffset], [0, false, 0]);
    const fb = resolveSelectedTuningProfile('nonexistent', [], 'bass');
    assert.deepStrictEqual(fb.id, 'eadg');

    // Reentrant uke target sanity: non-monotonic (high-G drone at index
    // 0) flows through the same pitch-ordered walk banjo5 exercised.
    const ukeTarget = resolveTargetTuning(uke.strings);
    assert.deepStrictEqual(ukeTarget.midiTuning, [67, 60, 64, 69]);
    assert.deepStrictEqual(remapNote(59, 1, 0, ukeTarget.midiTuning, 12), null);
    assert.deepStrictEqual(remapNote(60, 1, 0, ukeTarget.midiTuning, 12), { s: 1, f: 0 });
});
