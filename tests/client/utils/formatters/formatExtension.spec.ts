//----------------------------------------------------------------------------------------------------------------------
// File Names
//----------------------------------------------------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';

import { ensureExtension } from '@client/utils/formatters/formatExtension.ts';

//----------------------------------------------------------------------------------------------------------------------

describe('ensureExtension', () =>
{
    it('appends the extension when the name lacks it', () =>
    {
        expect(ensureExtension('notes', '.md')).toBe('notes.md');
    });

    it('leaves a name that already carries the extension untouched', () =>
    {
        expect(ensureExtension('notes.md', '.md')).toBe('notes.md');
    });

    it('recognises the extension case-insensitively but preserves the entered casing', () =>
    {
        expect(ensureExtension('README.MD', '.md')).toBe('README.MD');
    });

    it('trims surrounding whitespace before deciding', () =>
    {
        expect(ensureExtension('  draft  ', '.txt')).toBe('draft.txt');
    });

    it('appends when the name ends in a different extension', () =>
    {
        expect(ensureExtension('report.txt', '.md')).toBe('report.txt.md');
    });
});

//----------------------------------------------------------------------------------------------------------------------
