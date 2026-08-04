// Standalone Node verification for stage 1 (target tuning resolution) and
// the settings/profile layer built on top of it (presets, custom-tuning
// validation, capo/octave field validators). Imports the real engine from
// ../src/chart-retune.js — no hand-synced duplicate. Run with `node
// test/target-tuning.test.mjs`.
import test from 'node:test';
import assert from 'node:assert';
import { CR } from '../src/chart-retune.js';

const {
    DEFAULT_MAX_FRET,
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
    EXTENDED_DEFAULT_TARGET_TUNING,
    parseTargetNote,
    midiToNoteLabel,
    defaultExtensionNote,
    isValidTuningStringsArray,
    BUILTIN_PRESET_TUNINGS,
    DEFAULT_TUNING_ID,
    DEFAULT_GUITAR_TUNING_ID,
    defaultTuningIdForClass,
    arrangementClassFor,
    resolveActiveTuning,
    resolveRetunerCapoOctaveFields,
    applyRetunerCapoOctaveOverride,
    resolveTargetTuning,
    remapNote,
} = CR;

// Custom target tuning: parseTargetNote / resolveTargetTuning.
test('custom target tuning: parseTargetNote / resolveTargetTuning', () => {
    assert.deepStrictEqual(parseTargetNote('B0'), { midi: 23, label: 'B' });
    assert.deepStrictEqual(parseTargetNote('f#2'), { midi: 42, label: 'F#' });
    assert.deepStrictEqual(parseTargetNote('Bb1'), { midi: 34, label: 'Bb' });
    assert.deepStrictEqual(parseTargetNote('A-1'), { midi: 9, label: 'A' });
    assert.deepStrictEqual(parseTargetNote('H0'), null);
    assert.deepStrictEqual(parseTargetNote('B'), null);
    assert.deepStrictEqual(parseTargetNote(undefined), null);

    const beadg = resolveTargetTuning(DEFAULT_TARGET_TUNING);
    assert.deepStrictEqual(beadg.midiTuning, DEFAULT_TARGET_MIDI_TUNING);
    assert.deepStrictEqual(beadg.labels, ['B', 'E', 'A', 'D', 'G']);

    const partial = resolveTargetTuning(['B0', 'garbage', 'A1', 'D2', 'G2']);
    assert.deepStrictEqual(partial.midiTuning, [23, 28, 33, 38, 43]);

    assert.deepStrictEqual(resolveTargetTuning(null).midiTuning, DEFAULT_TARGET_MIDI_TUNING);

    // resolveTargetTuning honors the spec's own length, no padding.
    const short = resolveTargetTuning(['A0', 'F1']);
    assert.deepStrictEqual(short.midiTuning, [21, 29]);
    assert.deepStrictEqual(short.labels, ['A', 'F']);

    // A malformed entry past index 4 falls back to EXTENDED_DEFAULT_TARGET_TUNING.
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

// parseActiveTuning: the silent auto-saved "active" tuning (the unsaved
// user-defined tuning the settings editor edits live). Accepts the stored
// JSON string or a parsed object; resolves to the resolveActiveTuning
// shape with the reserved id/name; malformed input resolves to null so
// callers fall through to normal profile resolution.
test('parseActiveTuning', () => {
    const { parseActiveTuning, ACTIVE_TUNING_ID, ACTIVE_TUNING_NAME } = CR;
    const good = { strings: ['G3', 'D4', 'A4', 'E5'], colors: ['#f18313', '#3fc413', '#ecd234', '#e61f26'], maxFret: 14, capo: 4, capoEnabled: true, octaveOffset: 1 };
    const r = parseActiveTuning(JSON.stringify(good));
    assert.deepStrictEqual({ id: r.id, name: r.name }, { id: ACTIVE_TUNING_ID, name: ACTIVE_TUNING_NAME });
    assert.deepStrictEqual({ strings: r.strings, colors: r.colors, maxFret: r.maxFret, capo: r.capo, capoEnabled: r.capoEnabled, octaveOffset: r.octaveOffset, roles: r.roles },
        { strings: good.strings, colors: good.colors, maxFret: 14, capo: 4, capoEnabled: true, octaveOffset: 1, roles: null });
    assert.deepStrictEqual(parseActiveTuning(good).capo, 4);
    assert.deepStrictEqual(parseActiveTuning({ strings: ['E1', 'A1', 'D2', 'G2'] }).capoEnabled, false);
    assert.deepStrictEqual(parseActiveTuning({ strings: ['E1', 'A1', 'D2', 'G2'], capoEnabled: 'true' }).capoEnabled, false);

    assert.deepStrictEqual([parseActiveTuning(''), parseActiveTuning('   '), parseActiveTuning(null), parseActiveTuning(undefined)],
        [null, null, null, null]);
    assert.deepStrictEqual(parseActiveTuning('{nope'), null);
    assert.deepStrictEqual([parseActiveTuning('42'), parseActiveTuning('[1,2,3]')], [null, null]);
    assert.deepStrictEqual(parseActiveTuning({ strings: ['E1', 'A1'] }), null);

    const sloppy = parseActiveTuning({ strings: ['E1', 'A1', 'D2', 'G2'], colors: 'nope', maxFret: 99, capo: 25, octaveOffset: 9 });
    assert.deepStrictEqual({ colors: sloppy.colors, maxFret: sloppy.maxFret, capo: sloppy.capo, octaveOffset: sloppy.octaveOffset },
        { colors: null, maxFret: DEFAULT_MAX_FRET, capo: 0, octaveOffset: 0 });
    // capo validated against the active tuning's OWN maxFret, like saved customs.
    assert.deepStrictEqual(parseActiveTuning({ strings: ['E1', 'A1', 'D2', 'G2'], maxFret: 14, capo: 13 }).capo, 13);
    assert.deepStrictEqual(parseActiveTuning({ strings: ['E1', 'A1', 'D2', 'G2'], maxFret: 14, capo: 14 }).capo, 0);
    // Input arrays are copied, so the caller is free to mutate them.
    const aliasIn = { strings: ['E1', 'A1', 'D2', 'G2'], colors: ['#111111', '#222222', '#333333', '#444444'] };
    const aliased = parseActiveTuning(aliasIn);
    assert.notStrictEqual(aliased.strings, aliasIn.strings, 'parsed strings must be a fresh copy');
    assert.notStrictEqual(aliased.colors, aliasIn.colors, 'parsed colors must be a fresh copy');
});

// Variable target string count: 4-8, matching highway_3d's floor and
// MAX_RENDER_STRINGS.
test('variable target string count', () => {
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

    assert.deepStrictEqual(EXTENDED_DEFAULT_TARGET_TUNING[1], 'F#0');
    assert.deepStrictEqual(EXTENDED_DEFAULT_TARGET_TUNING[7], 'B2');
    assert.deepStrictEqual(EXTENDED_DEFAULT_TARGET_TUNING[9], 'A3');
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

// BUILTIN_PRESET_TUNINGS / DEFAULT_TUNING_ID / resolveActiveTuning: the
// built-in-preset resolution path screen.js's _crResolveActiveTuning
// delegates to wholesale.
test('BUILTIN_PRESET_TUNINGS / DEFAULT_TUNING_ID / resolveActiveTuning', () => {
    assert.deepStrictEqual(DEFAULT_TUNING_ID, 'eadg');
    assert.deepStrictEqual(DEFAULT_GUITAR_TUNING_ID, 'eadgbe');
    assert.deepStrictEqual({ strings: BUILTIN_PRESET_TUNINGS[0].strings, colors: BUILTIN_PRESET_TUNINGS[0].colors },
        { strings: DEFAULT_TARGET_TUNING.slice(1), colors: null });
    assert.deepStrictEqual({ strings: BUILTIN_PRESET_TUNINGS[1].strings, colors: BUILTIN_PRESET_TUNINGS[1].colors },
        { strings: DEFAULT_TARGET_TUNING, colors: null });
    const eadgbePreset = BUILTIN_PRESET_TUNINGS.find(p => p.id === 'eadgbe');
    assert.deepStrictEqual({ strings: eadgbePreset.strings, colors: eadgbePreset.colors, roles: eadgbePreset.roles },
        { strings: ['E2', 'A2', 'D3', 'G3', 'B3', 'E4'], colors: null, roles: ['e', 'a', 'd', 'g', 'highB', 'highE'] });
    assert.deepStrictEqual(resolveTargetTuning(eadgbePreset.strings).midiTuning, [40, 45, 50, 55, 59, 64]);
    const sevenPreset = BUILTIN_PRESET_TUNINGS.find(p => p.id === 'beadgbe');
    assert.deepStrictEqual({ midi: resolveTargetTuning(sevenPreset.strings).midiTuning, colors: sevenPreset.colors, roles: sevenPreset.roles },
        { midi: [35, 40, 45, 50, 55, 59, 64], colors: null, roles: ['lowB', 'e', 'a', 'd', 'g', 'highB', 'highE'] });
    const baritonePreset = BUILTIN_PRESET_TUNINGS.find(p => p.id === 'baritone_beadfsb');
    assert.deepStrictEqual({ midi: resolveTargetTuning(baritonePreset.strings).midiTuning, colors: baritonePreset.colors, roles: baritonePreset.roles },
        { midi: [35, 40, 45, 50, 54, 59], colors: null, roles: ['e', 'a', 'd', 'g', 'highB', 'highE'] });
    const violinPreset = BUILTIN_PRESET_TUNINGS.find(p => p.id === 'violin_gdae');
    assert.deepStrictEqual({ midi: resolveTargetTuning(violinPreset.strings).midiTuning, colors: violinPreset.colors, roles: violinPreset.roles },
        { midi: [55, 62, 69, 76], colors: ['#f18313', '#3fc413', '#ecd234', '#e61f26'], roles: undefined });
    const uprightPreset = BUILTIN_PRESET_TUNINGS.find(p => p.id === 'upright_solo_fsbea');
    assert.deepStrictEqual({ midi: resolveTargetTuning(uprightPreset.strings).midiTuning, colors: uprightPreset.colors, roles: uprightPreset.roles },
        { midi: [30, 35, 40, 45], colors: null, roles: ['e', 'a', 'd', 'g'] });
    const violaPreset = BUILTIN_PRESET_TUNINGS.find(p => p.id === 'viola_cgda');
    assert.deepStrictEqual({ midi: resolveTargetTuning(violaPreset.strings).midiTuning, colors: violaPreset.colors },
        { midi: [48, 55, 62, 69], colors: ['#cc00aa', '#f18313', '#3fc413', '#ecd234'] });
    const banjo4Preset = BUILTIN_PRESET_TUNINGS.find(p => p.id === 'banjo4_cgbd');
    assert.deepStrictEqual({ midi: resolveTargetTuning(banjo4Preset.strings).midiTuning, colors: banjo4Preset.colors },
        { midi: [48, 55, 59, 62], colors: ['#cc00aa', '#f18313', '#1096e6', '#3fc413'] });
    const banjo5Preset = BUILTIN_PRESET_TUNINGS.find(p => p.id === 'banjo5_gdgbd');
    assert.deepStrictEqual({ midi: resolveTargetTuning(banjo5Preset.strings).midiTuning, colors: banjo5Preset.colors },
        { midi: [67, 50, 55, 59, 62], colors: ['#f18313', '#3fc413', '#f18313', '#1096e6', '#3fc413'] });
    const mandolinPreset = BUILTIN_PRESET_TUNINGS.find(p => p.id === 'mandolin_ggddaaee');
    assert.deepStrictEqual({ midi: resolveTargetTuning(mandolinPreset.strings).midiTuning, colors: mandolinPreset.colors },
        {
            midi: [55, 55, 62, 62, 69, 69, 76, 76],
            colors: ['#f18313', '#f18313', '#3fc413', '#3fc413', '#ecd234', '#ecd234', '#e61f26', '#e61f26'],
        });
    assert.deepStrictEqual(mandolinPreset.strings.length, MAX_TARGET_STRING_COUNT);
    assert.deepStrictEqual(BUILTIN_PRESET_TUNINGS.filter(p => p.colors !== null).every(p => Array.isArray(p.colors) && p.colors.length === p.strings.length && isValidTuningStringsArray(p.strings)),
        true);
    assert.deepStrictEqual(BUILTIN_PRESET_TUNINGS.filter(p => p.colors === null).every(p => isValidTuningStringsArray(p.strings) && (p.roles === undefined || p.roles.length === p.strings.length)),
        true);

    // Every resolution also reports the RESOLVED id plus capo/capoEnabled/
    // octaveOffset (default off/0 unless the profile carries valid
    // values) — folded into the expected shapes below via this tiny helper.
    const adj = (id, shape) => Object.assign({ id, capo: 0, capoEnabled: false, octaveOffset: 0 }, shape);
    assert.deepStrictEqual(resolveActiveTuning(undefined, []), adj('eadg', { strings: DEFAULT_TARGET_TUNING.slice(1), colors: null, roles: null, maxFret: 20 }));
    assert.deepStrictEqual(resolveActiveTuning('eadg', []), adj('eadg', { strings: DEFAULT_TARGET_TUNING.slice(1), colors: null, roles: null, maxFret: 20 }));
    assert.deepStrictEqual(resolveActiveTuning('beadg', []), adj('beadg', { strings: DEFAULT_TARGET_TUNING, colors: null, roles: null, maxFret: 24 }));
    assert.deepStrictEqual(resolveActiveTuning('eadgbe', []),
        adj('eadgbe', { strings: ['E2', 'A2', 'D3', 'G3', 'B3', 'E4'], colors: null, roles: ['e', 'a', 'd', 'g', 'highB', 'highE'], maxFret: 24 }));
    assert.deepStrictEqual(resolveActiveTuning('cello_cgda', []),
        adj('cello_cgda', { strings: ['C2', 'G2', 'D3', 'A3'], colors: ['#cc00aa', '#f18313', '#3fc413', '#ecd234'], roles: null, maxFret: 24 }));
    assert.deepStrictEqual(resolveActiveTuning('custom_abc', [{ id: 'custom_abc', name: 'AEADG', strings: ['A0', 'E1', 'A1', 'D2', 'G2'], colors: ['#111111', '#222222', '#333333', '#444444', '#555555'] }]),
        adj('custom_abc', { strings: ['A0', 'E1', 'A1', 'D2', 'G2'], colors: ['#111111', '#222222', '#333333', '#444444', '#555555'], roles: null, maxFret: 20 }));
    assert.deepStrictEqual(resolveActiveTuning('custom_mf', [{ id: 'custom_mf', name: 'Custom24', strings: ['A0', 'E1', 'A1', 'D2', 'G2'], colors: ['#111111', '#222222', '#333333', '#444444', '#555555'], maxFret: 24 }]),
        adj('custom_mf', { strings: ['A0', 'E1', 'A1', 'D2', 'G2'], colors: ['#111111', '#222222', '#333333', '#444444', '#555555'], roles: null, maxFret: 24 }));
    assert.deepStrictEqual(resolveActiveTuning('custom_bad_mf', [{ id: 'custom_bad_mf', name: 'BadMF', strings: ['A0', 'E1', 'A1', 'D2', 'G2'], colors: ['#111111', '#222222', '#333333', '#444444', '#555555'], maxFret: 17 }]),
        adj('custom_bad_mf', { strings: ['A0', 'E1', 'A1', 'D2', 'G2'], colors: ['#111111', '#222222', '#333333', '#444444', '#555555'], roles: null, maxFret: 20 }));
    // Unknown/deleted ids fall back to the arrangement class's default
    // preset (EADG shape for bass, EADGBE for guitar classes) — changed
    // from the pre-guitar hardcoded BEADG-shape fallback (see HISTORY.md
    // Phase 12): the class default matches what a fresh install shows.
    assert.deepStrictEqual(resolveActiveTuning('stale_deleted_id', []), adj('eadg', { strings: DEFAULT_TARGET_TUNING.slice(1), colors: null, roles: null, maxFret: 20 }));
    assert.deepStrictEqual(resolveActiveTuning('stale_deleted_id', null), adj('eadg', { strings: DEFAULT_TARGET_TUNING.slice(1), colors: null, roles: null, maxFret: 20 }));
    assert.deepStrictEqual(resolveActiveTuning('stale_deleted_id', undefined), adj('eadg', { strings: DEFAULT_TARGET_TUNING.slice(1), colors: null, roles: null, maxFret: 20 }));
    assert.deepStrictEqual(resolveActiveTuning('stale_deleted_id', [], 'lead'),
        adj('eadgbe', { strings: ['E2', 'A2', 'D3', 'G3', 'B3', 'E4'], colors: null, roles: ['e', 'a', 'd', 'g', 'highB', 'highE'], maxFret: 24 }));
    assert.deepStrictEqual(resolveActiveTuning(undefined, [], 'rhythm'),
        adj('eadgbe', { strings: ['E2', 'A2', 'D3', 'G3', 'B3', 'E4'], colors: null, roles: ['e', 'a', 'd', 'g', 'highB', 'highE'], maxFret: 24 }));
    assert.deepStrictEqual(resolveActiveTuning('eadg', [], 'lead'), adj('eadg', { strings: DEFAULT_TARGET_TUNING.slice(1), colors: null, roles: null, maxFret: 20 }));
    assert.deepStrictEqual(resolveActiveTuning('cello_cgda', [{ id: 'cello_cgda', name: 'user override attempt', strings: ['E1', 'A1', 'D2', 'G2'], colors: ['#000', '#000', '#000', '#000'] }]),
        adj('cello_cgda', { strings: ['C2', 'G2', 'D3', 'A3'], colors: ['#cc00aa', '#f18313', '#3fc413', '#ecd234'], roles: null, maxFret: 24 }));

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

// First-time install: no stored active-tuning overlay and no per-class
// profile id for any arrangement class. Confirms the full chain lands on
// a real, playable builtin default (not null/undefined/a crash) for
// every class, with capo off and no octave shift, exactly what a
// brand-new user sees with zero prior localStorage state.
test('first-time install resolves a real, playable builtin default', (t) => {
    const { parseActiveTuning } = CR;
    assert.deepStrictEqual(parseActiveTuning(undefined), null);
    for (const [cls, expectedId] of [['bass', 'eadg'], ['rhythm', 'eadgbe'], ['lead', 'eadgbe']]) {
        t.test(`class=${cls}`, () => {
            const resolved = resolveActiveTuning(undefined, [], cls);
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
// octaveOffset } resolver every resolved-profile builder (resolveActiveTuning's
// two branches, parseActiveTuning, screen.js's save/seed paths) delegates to.
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

// resolveActiveTuning: resolved id + capo/octaveOffset fields, and the
// ukulele presets.
test('resolveActiveTuning: capo/octaveOffset fields and ukulele presets', () => {
    const t = resolveActiveTuning('eadgbe', []);
    assert.deepStrictEqual(t.id, 'eadgbe');
    assert.deepStrictEqual([t.capo, t.capoEnabled, t.octaveOffset], [0, false, 0]);

    const uke = resolveActiveTuning('ukulele_gcea', []);
    assert.deepStrictEqual(uke.strings, ['G4', 'C4', 'E4', 'A4']);
    assert.deepStrictEqual(uke.maxFret, 12);
    const bari = resolveActiveTuning('baritone_uke_dgbe', []);
    assert.deepStrictEqual(bari.strings, ['D3', 'G3', 'B3', 'E4']);

    const customs = [
        { id: 'c1', name: 'Octave cello', strings: ['C2', 'G2', 'D3', 'A3'], colors: ['#111111', '#222222', '#333333', '#444444'], maxFret: 24, capo: 2, capoEnabled: true, octaveOffset: 1 },
        { id: 'c2', name: 'Bad adjust', strings: ['C2', 'G2', 'D3', 'A3'], colors: ['#111111', '#222222', '#333333', '#444444'], maxFret: 12, capo: 20, capoEnabled: 'yes', octaveOffset: 9 },
    ];
    const c1 = resolveActiveTuning('c1', customs);
    assert.deepStrictEqual([c1.id, c1.capo, c1.capoEnabled, c1.octaveOffset], ['c1', 2, true, 1]);
    const c2 = resolveActiveTuning('c2', customs);
    assert.deepStrictEqual([c2.capo, c2.capoEnabled, c2.octaveOffset], [0, false, 0]);
    const fb = resolveActiveTuning('nonexistent', [], 'bass');
    assert.deepStrictEqual(fb.id, 'eadg');

    // Reentrant uke target sanity: non-monotonic (high-G drone at index
    // 0) flows through the same pitch-ordered walk banjo5 exercised.
    const ukeTarget = resolveTargetTuning(uke.strings);
    assert.deepStrictEqual(ukeTarget.midiTuning, [67, 60, 64, 69]);
    assert.deepStrictEqual(remapNote(59, 1, 0, ukeTarget.midiTuning, 12), null);
    assert.deepStrictEqual(remapNote(60, 1, 0, ukeTarget.midiTuning, 12), { s: 1, f: 0 });
});
