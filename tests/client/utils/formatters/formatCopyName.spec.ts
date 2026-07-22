//----------------------------------------------------------------------------------------------------------------------
// Copy Name Derivation
//----------------------------------------------------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';

import { nextCopyName } from '@client/utils/formatters/formatCopyName.ts';

//----------------------------------------------------------------------------------------------------------------------

describe('nextCopyName', () =>
{
    it('adds a " (1)" suffix before the extension on a first collision', () =>
    {
        expect(nextCopyName('report.txt')).toBe('report (1).txt');
    });

    it('bumps an existing numeric suffix rather than nesting a new one', () =>
    {
        expect(nextCopyName('report (1).txt')).toBe('report (2).txt');
        expect(nextCopyName('report (2).txt')).toBe('report (3).txt');
    });

    it('handles multi-digit suffixes', () =>
    {
        expect(nextCopyName('report (10).pdf')).toBe('report (11).pdf');
    });

    it('suffixes an extensionless name at the end', () =>
    {
        expect(nextCopyName('report')).toBe('report (1)');
        expect(nextCopyName('report (1)')).toBe('report (2)');
    });

    it('treats a leading dot as a dotfile name, not an extension', () =>
    {
        expect(nextCopyName('.gitignore')).toBe('.gitignore (1)');
        expect(nextCopyName('.gitignore (1)')).toBe('.gitignore (2)');
    });

    it('keeps only the final segment as the extension for a multi-dot name', () =>
    {
        expect(nextCopyName('archive.tar.gz')).toBe('archive.tar (1).gz');
        expect(nextCopyName('archive.tar (1).gz')).toBe('archive.tar (2).gz');
    });

    it('only bumps a suffix that sits at the very end of the base', () =>
    {
        expect(nextCopyName('report (1) draft.txt')).toBe('report (1) draft (1).txt');
    });

    it('does not treat a non-numeric parenthetical as a suffix', () =>
    {
        expect(nextCopyName('report (final).txt')).toBe('report (final) (1).txt');
    });
});

//----------------------------------------------------------------------------------------------------------------------
