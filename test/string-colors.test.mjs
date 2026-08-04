// Standalone Node verification for string-colors.js (per-string color role
// resolution + hex handling) — not one of the 5 remap stages, but was
// stranded inside retune-engine.test.mjs; moved here to complete the "one
// test file per src module" mirroring the barrel already declares.
// Imports the real module from ../src/chart-retune.js — no hand-synced
// duplicate. Run with `node test/string-colors.test.mjs`.
import test from 'node:test';
import assert from 'node:assert';
import { CR } from '../src/chart-retune.js';

const { colorRoleForNote, intToHex, LIGHT_GRAY_COLOR, resolveColorsArray, lowBColor } = CR;

// colorRoleForNote: symbolic color roles only, no actual colors (that's
// screen.js's job).
test('colorRoleForNote', () => {
    assert.deepStrictEqual(colorRoleForNote(23), 'lowB');
    assert.deepStrictEqual(colorRoleForNote(28), 'e');
    assert.deepStrictEqual(colorRoleForNote(33), 'a');
    assert.deepStrictEqual(colorRoleForNote(38), 'd');
    assert.deepStrictEqual(colorRoleForNote(43), 'g');
    assert.deepStrictEqual(colorRoleForNote(47), 'highB');
    assert.deepStrictEqual(colorRoleForNote(52), 'highE');
    assert.deepStrictEqual(colorRoleForNote(57), 'gray');
    assert.deepStrictEqual(colorRoleForNote(18), 'lowExt1');
    assert.deepStrictEqual(colorRoleForNote(13), 'lowExt2');
    assert.deepStrictEqual(colorRoleForNote(8), 'gray');
    assert.deepStrictEqual(colorRoleForNote(21), 'gray');
});

// intToHex / resolveColorsArray: plain data-shape transforms.
test('intToHex / resolveColorsArray', () => {
    assert.deepStrictEqual(intToHex(0xe61f26), '#e61f26');
    assert.deepStrictEqual(intToHex(0x1), '#000001');
    assert.deepStrictEqual(LIGHT_GRAY_COLOR, 0xd3d3d3);

    const defaults = ['#111111', '#222222', '#333333', '#444444', '#555555'];
    assert.deepStrictEqual(resolveColorsArray(undefined, 5, defaults), defaults);
    assert.deepStrictEqual(resolveColorsArray(null, 5, defaults), defaults);
    assert.deepStrictEqual(resolveColorsArray(['#abcdef', 'not-a-hex', undefined], 5, defaults),
        ['#abcdef', '#222222', '#333333', '#444444', '#555555']);
    assert.deepStrictEqual(resolveColorsArray(['#abcdef'], 5, defaults),
        ['#abcdef', '#222222', '#333333', '#444444', '#555555']);
    assert.deepStrictEqual(resolveColorsArray(['#111111', '#222222', '#333333', '#444444', '#555555', '#666666'], 5, defaults),
        defaults);
});

// lowBColor: no localStorage override available in this (Node) environment,
// so it always falls through to the documented default.
test('lowBColor falls back to the default outside a browser', () => {
    assert.deepStrictEqual(lowBColor(), 0xcc00aa);
});
