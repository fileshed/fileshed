//----------------------------------------------------------------------------------------------------------------------
// Frontmatter Keys — the keys the editor reads
//
// The contract: the editor reads `title` (text, or a number as its text), `tags` (a list, or comma-separated text),
// `lang` (a language tag), and `strict-line-breaks` (true or false), each checked against its own schema. A value that
// fails its key's schema is ignored, and the properties editor notes it, saying what the key takes; blank text is
// unset, not a failure, so a key just added from the suggestions with its kind's starting value carries no note.
//----------------------------------------------------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';

// Engines
import {
    type Property,
    initialPropertyValue,
    parseFrontmatter,
    updateProperty,
} from '@client/engines/markdown/properties.ts';

// Under test
import { buildDocumentMeta, checkProperty, frontmatterKeys } from '@client/engines/markdown/frontmatterKeys.ts';

//----------------------------------------------------------------------------------------------------------------------

const UNSET = { title: null, tags: [], lang: null, strictLineBreaks: false };

function metaOf(yaml : string | null) : ReturnType<typeof buildDocumentMeta>
{
    return buildDocumentMeta(parseFrontmatter(yaml));
}

function propertyOf(yaml : string) : Property
{
    const state = parseFrontmatter(yaml);
    const [ property ] = state.kind === 'properties' ? state.properties : [];
    if(!property) { throw new Error(`No property in ${ yaml }`); }

    return property;
}

//----------------------------------------------------------------------------------------------------------------------

describe('buildDocumentMeta', () =>
{
    it('reads the title, tags, language, and line rule', () =>
    {
        const meta = metaOf('title: Hello\ntags: [a, b]\nlang: en-GB\nstrict-line-breaks: true\n');

        expect(meta).toEqual({ title: 'Hello', tags: [ 'a', 'b' ], lang: 'en-GB', strictLineBreaks: true });
    });

    it('has nothing to read without property frontmatter', () =>
    {
        expect(metaOf(null)).toEqual(UNSET);
        expect(metaOf('title: [unclosed\n')).toEqual(UNSET);
    });

    it('reads a blank title as no title, and a numeric one as its text', () =>
    {
        expect(metaOf('title: "  "\n').title).toBeNull();
        expect(metaOf('title: 1984\n').title).toBe('1984');
    });

    it('reads tags written as one comma-separated string', () =>
    {
        expect(metaOf('tags: rust, web , \n').tags).toEqual([ 'rust', 'web' ]);
    });

    it('ignores a value that fails its key\'s schema', () =>
    {
        const meta = metaOf('title: [a, b]\ntags:\n  - x: 1\nlang: English please\nstrict-line-breaks: "yes"\n');

        expect(meta).toEqual(UNSET);
    });
});

describe('checkProperty', () =>
{
    it('notes a value the editor ignores, saying what its key takes', () =>
    {
        expect(checkProperty(propertyOf('lang: English please\n'))).toMatch(/language tag/u);
        expect(checkProperty(propertyOf('strict-line-breaks: "true"\n'))).toMatch(/true or false/u);
    });

    it('has no note for a value the editor reads, a blank value, or a key it doesn\'t read', () =>
    {
        expect(checkProperty(propertyOf('lang: pt-BR\n'))).toBeNull();
        expect(checkProperty(propertyOf('lang:\n'))).toBeNull();
        expect(checkProperty(propertyOf('author: [1, 2]\n'))).toBeNull();
    });

    it('has no note for a key added from the suggestions with its kind\'s starting value', () =>
    {
        const notes = frontmatterKeys.map(({ key, kind }) =>
        {
            return checkProperty(propertyOf(updateProperty('', key, initialPropertyValue(kind, new Date()))));
        });

        expect(notes).toEqual([ null, null, null, null ]);
    });
});

//----------------------------------------------------------------------------------------------------------------------
