//----------------------------------------------------------------------------------------------------------------------
// Word Count Engine
//
// The contract: a word is a word segment of the text's language, numbers and contractions included; punctuation,
// symbols and whitespace are not words. A language written without spaces still counts each word, and a language tag
// the browser can't use falls back to its default rather than failing.
//----------------------------------------------------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';

// Under test
import { countWords } from '@client/engines/wordCount.ts';

//----------------------------------------------------------------------------------------------------------------------

describe('countWords', () =>
{
    it('counts the words between spaces and punctuation', () =>
    {
        expect(countWords('Hello, world! This is   a test.')).toBe(6);
    });

    it('counts nothing in empty text, whitespace, or punctuation alone', () =>
    {
        expect(countWords('')).toBe(0);
        expect(countWords('  \n\t ')).toBe(0);
        expect(countWords('— … !! ?')).toBe(0);
    });

    it('counts a number as a word and a contraction as one word', () =>
    {
        expect(countWords('Released in 2026')).toBe(3);
        expect(countWords('don\'t stop')).toBe(2);
    });

    it('counts each word of a language written without spaces', () =>
    {
        expect(countWords('猫と犬', 'ja')).toBe(3);
    });

    it('falls back to the default language for a tag it cannot use', () =>
    {
        expect(countWords('two words', 'not a tag!')).toBe(2);
    });
});

//----------------------------------------------------------------------------------------------------------------------
