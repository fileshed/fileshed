//----------------------------------------------------------------------------------------------------------------------
// Code Languages — naming a code block's language
//
// The contract: a fence names its language by the first word of its info string, matched exactly and
// case-insensitively against a language's name or aliases. The picker offers every language a fence can name, and
// picking one rewrites only that first word.
//----------------------------------------------------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';

// Under test
import {
    codeLanguageOptions,
    fenceLanguageWord,
    findCodeLanguage,
    withFenceLanguage,
} from '@client/engines/markdown/codeLanguages.ts';

//----------------------------------------------------------------------------------------------------------------------

describe('findCodeLanguage', () =>
{
    it('finds a language by its name or any of its aliases, in any case', () =>
    {
        expect(findCodeLanguage('Python')?.name).toBe('Python');
        expect(findCodeLanguage('js')?.name).toBe('JavaScript');
        expect(findCodeLanguage('TS')?.name).toBe('TypeScript');
    });

    it('reads only the first word of the info string', () =>
    {
        expect(findCodeLanguage('js title="app.js"')?.name).toBe('JavaScript');
    });

    it('matches whole names only, so a word that merely contains an alias names no language', () =>
    {
        expect(findCodeLanguage('text')).toBeNull();
        expect(findCodeLanguage('foobar')).toBeNull();
    });

    it('finds no language for a fence that names none', () =>
    {
        expect(findCodeLanguage(null)).toBeNull();
        expect(findCodeLanguage('')).toBeNull();
    });
});

describe('fenceLanguageWord', () =>
{
    it('gives every alias of a language the same option', () =>
    {
        const javascript = codeLanguageOptions.find((option) => option.label === 'JavaScript');

        expect(fenceLanguageWord('js')).toBe(javascript?.value);
        expect(fenceLanguageWord('javascript title="a"')).toBe(javascript?.value);
    });

    it('keeps the fence\'s own word for a language it doesn\'t know, and gives none for no language', () =>
    {
        expect(fenceLanguageWord('foobar')).toBe('foobar');
        expect(fenceLanguageWord(null)).toBe('');
    });
});

describe('withFenceLanguage', () =>
{
    it('replaces the language and keeps what follows it', () =>
    {
        expect(withFenceLanguage('js title="app.js"', 'python')).toBe('python title="app.js"');
        expect(withFenceLanguage('ts', 'python')).toBe('python');
        expect(withFenceLanguage(null, 'python')).toBe('python');
    });

    it('clears the whole info string for plain text', () =>
    {
        expect(withFenceLanguage('js title="app.js"', '')).toBeNull();
    });
});

describe('codeLanguageOptions', () =>
{
    it('writes each language as one word that names that language again', () =>
    {
        for(const option of codeLanguageOptions)
        {
            expect(option.value).toMatch(/^\S+$/u);
            expect(findCodeLanguage(option.value)?.name).toBe(option.label);
        }
    });

    it('lists the languages in alphabetical order', () =>
    {
        const labels = codeLanguageOptions.map((option) => option.label);

        expect(labels).toEqual([ ...labels ].sort((left, right) => left.localeCompare(right)));
    });
});

//----------------------------------------------------------------------------------------------------------------------
