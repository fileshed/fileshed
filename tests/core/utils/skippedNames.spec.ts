//----------------------------------------------------------------------------------------------------------------------
// Skipped Upload Names — the pattern rule both tiers apply
//
// A pattern is a filename with `*` standing for any run of characters, matched against the name and never the path,
// case ignored. The list is one comma-separated setting, so an admin edits it as a sentence.
//----------------------------------------------------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';

// Models
import { DEFAULT_SKIPPED_UPLOAD_NAMES, isSkippedName, parseSkippedNames } from '@fileshed/core';

//----------------------------------------------------------------------------------------------------------------------

describe('parseSkippedNames', () =>
{
    it('reads a comma-separated list, ignoring the spacing around entries', () =>
    {
        expect(parseSkippedNames('.DS_Store,  Thumbs.db ,desktop.ini'))
            .toEqual([ '.DS_Store', 'Thumbs.db', 'desktop.ini' ]);
    });

    // A blank entry left by a trailing comma would otherwise become a pattern, and an empty pattern matches an empty
    // name -- harmless, but it is not something the admin wrote.
    it('drops the blanks a trailing or doubled comma leaves', () =>
    {
        expect(parseSkippedNames('.DS_Store,,')).toEqual([ '.DS_Store' ]);
        expect(parseSkippedNames('   ')).toEqual([]);
    });
});

//----------------------------------------------------------------------------------------------------------------------

describe('isSkippedName', () =>
{
    const patterns = parseSkippedNames(DEFAULT_SKIPPED_UPLOAD_NAMES);

    it('refuses the junk an operating system writes into every folder', () =>
    {
        expect(isSkippedName('.DS_Store', patterns)).toBe(true);
        expect(isSkippedName('Thumbs.db', patterns)).toBe(true);
        expect(isSkippedName('desktop.ini', patterns)).toBe(true);
    });

    // A Mac writes a ._ sidecar per file on a non-native filesystem, so the pattern has to cover a name it has never
    // seen rather than a list of them.
    it('matches a wildcard against any run of characters', () =>
    {
        expect(isSkippedName('._quarterly-report.pdf', patterns)).toBe(true);
        expect(isSkippedName('._', patterns)).toBe(true);
    });

    // The systems that produce these files do not agree on case, and a Windows share can hand back .ds_store for the
    // file a Mac wrote as .DS_Store.
    it('ignores case', () =>
    {
        expect(isSkippedName('.ds_store', patterns)).toBe(true);
        expect(isSkippedName('THUMBS.DB', patterns)).toBe(true);
    });

    it('leaves a file somebody meant to upload alone', () =>
    {
        expect(isSkippedName('report.pdf', patterns)).toBe(false);
        expect(isSkippedName('DS_Store', patterns)).toBe(false);
        expect(isSkippedName('my._notes.txt', patterns)).toBe(false);
    });

    // Everything but `*` stands for itself, so a pattern cannot become a different pattern through a name.
    it('reads a regex character in a pattern as that character', () =>
    {
        expect(isSkippedName('a.b', [ 'a.b' ])).toBe(true);
        expect(isSkippedName('axb', [ 'a.b' ])).toBe(false);
        expect(isSkippedName('anything', [ '.+' ])).toBe(false);
    });

    it('skips nothing when the list is empty', () =>
    {
        expect(isSkippedName('.DS_Store', [])).toBe(false);
    });
});

//----------------------------------------------------------------------------------------------------------------------
