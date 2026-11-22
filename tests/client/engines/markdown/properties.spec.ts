//----------------------------------------------------------------------------------------------------------------------
// Frontmatter Properties — typed properties over the YAML, and edits that keep the rest of it
//
// The contract: a frontmatter block that parses to a key/value map reads as properties whose kind comes from the
// value (text, number, checkbox, date, list of scalars, or nested); anything else reads as raw, with the parse error.
// Editing one property changes only that property: other keys keep their comments, order, quoting, and layout, and
// removing the last property leaves blank YAML.
//----------------------------------------------------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';

// Under test
import {
    initialPropertyValue,
    parseFrontmatter,
    removeProperty,
    updateProperty,
} from '@client/engines/markdown/properties.ts';

//----------------------------------------------------------------------------------------------------------------------
// Parsing
//----------------------------------------------------------------------------------------------------------------------

describe('parseFrontmatter', () =>
{
    it('reports no frontmatter for a file without a block', () =>
    {
        expect(parseFrontmatter(null)).toEqual({ kind: 'none' });
    });

    it('reads an empty block as a map with no properties', () =>
    {
        expect(parseFrontmatter('')).toEqual({ kind: 'properties', properties: [] });
    });

    it('types each property from its value, in file order', () =>
    {
        const yaml = [
            'title: Hello',
            'draft: true',
            'weight: 3.5',
            'date: 2024-01-15',
            'tags: [a, b]',
            'aliases:',
            '  - one',
            '  - two',
            'author:',
            '  name: Ada',
            '',
        ].join('\n');

        expect(parseFrontmatter(yaml)).toEqual({
            kind: 'properties',
            properties: [
                { kind: 'text', key: 'title', value: 'Hello' },
                { kind: 'checkbox', key: 'draft', value: true },
                { kind: 'number', key: 'weight', value: 3.5 },
                { kind: 'date', key: 'date', value: '2024-01-15' },
                { kind: 'list', key: 'tags', value: [ 'a', 'b' ] },
                { kind: 'list', key: 'aliases', value: [ 'one', 'two' ] },
                { kind: 'nested', key: 'author', yaml: 'name: Ada\n' },
            ],
        });
    });

    it('reads a key with no value as empty text, and a datetime as text rather than a date', () =>
    {
        expect(parseFrontmatter('summary:\nupdated: 2024-01-15T10:00:00Z\n')).toEqual({
            kind: 'properties',
            properties: [
                { kind: 'text', key: 'summary', value: '' },
                { kind: 'text', key: 'updated', value: '2024-01-15T10:00:00Z' },
            ],
        });
    });

    it('shows a list holding maps as nested YAML', () =>
    {
        const state = parseFrontmatter('links:\n  - href: /a\n');

        expect(state).toEqual({
            kind: 'properties',
            properties: [ { kind: 'nested', key: 'links', yaml: '- href: /a\n' } ],
        });
    });

    it('reads YAML that does not parse as raw, with the parse error', () =>
    {
        const state = parseFrontmatter('title: [unclosed\n');

        expect(state.kind).toBe('raw');
        expect(state.kind === 'raw' && state.error.length > 0).toBe(true);
    });

    it('reads YAML that is not a key/value map as raw', () =>
    {
        expect(parseFrontmatter('just a sentence\n').kind).toBe('raw');
        expect(parseFrontmatter('- a\n- b\n').kind).toBe('raw');
    });

    it('reads a block with a repeated key as raw', () =>
    {
        expect(parseFrontmatter('a: 1\na: 2\n').kind).toBe('raw');
    });
});

//----------------------------------------------------------------------------------------------------------------------
// Editing
//----------------------------------------------------------------------------------------------------------------------

describe('updateProperty', () =>
{
    it('changes only the edited value, keeping comments, order, quoting, and blank lines elsewhere', () =>
    {
        const yaml = [
            '# Page settings',
            'title: \'Old\' # shown in the header',
            'tags: [a, b]',
            '',
            'draft: false',
            'quoted: "keep"',
            '',
        ].join('\n');

        const updated = updateProperty(yaml, 'draft', true);

        expect(updated).toBe([
            '# Page settings',
            'title: \'Old\' # shown in the header',
            'tags: [a, b]',
            '',
            'draft: true',
            'quoted: "keep"',
            '',
        ].join('\n'));
    });

    it('keeps a quoted value quoted the same way when its text changes', () =>
    {
        expect(updateProperty('title: \'Old\'\n', 'title', 'New')).toBe('title: \'New\'\n');
    });

    it('quotes text that would otherwise read back as another type', () =>
    {
        const updated = updateProperty('label: plain\n', 'label', 'true');

        expect(parseFrontmatter(updated)).toEqual({
            kind: 'properties',
            properties: [ { kind: 'text', key: 'label', value: 'true' } ],
        });
    });

    it('writes a changed number plainly, not with the old value\'s trailing zeros', () =>
    {
        expect(updateProperty('price: 1.50\n', 'price', 2)).toBe('price: 2\n');
    });

    it('keeps a flow list in flow style, and a kept item keeps its quotes', () =>
    {
        expect(updateProperty('tags: ["a", b]\n', 'tags', [ 'a', 'c' ])).toBe('tags: ["a", c]\n');
    });

    it('keeps a list written flush under its key flush', () =>
    {
        expect(updateProperty('tags:\n- a\n', 'tags', [ 'a', 'b' ])).toBe('tags:\n- a\n- b\n');
    });

    it('keeps an indented list indented', () =>
    {
        expect(updateProperty('tags:\n  - a\n', 'tags', [ 'a', 'b' ])).toBe('tags:\n  - a\n  - b\n');
    });

    it('never folds a long value onto a second line', () =>
    {
        const long = 'word '.repeat(30).trim();

        expect(updateProperty(`a: 1\nsummary: ${ long }\n`, 'a', 2)).toBe(`a: 2\nsummary: ${ long }\n`);
    });

    it('adds a property that is not there yet at the end', () =>
    {
        expect(updateProperty('title: x\n', 'draft', false)).toBe('title: x\ndraft: false\n');
    });

    it('starts a map in empty YAML', () =>
    {
        expect(updateProperty('', 'title', 'New')).toBe('title: New\n');
    });

    it('refuses YAML that does not read as properties', () =>
    {
        expect(() => updateProperty('title: [unclosed\n', 'title', 'x')).toThrow();
    });
});

describe('removeProperty', () =>
{
    it('removes the property and leaves the others as they were', () =>
    {
        expect(removeProperty('# note\ntitle: \'x\'\ndraft: true\n', 'draft')).toBe('# note\ntitle: \'x\'\n');
    });

    it('leaves blank YAML once the last property is gone', () =>
    {
        expect(removeProperty('title: x\n', 'title')).toBe('');
    });
});

describe('initialPropertyValue', () =>
{
    it('gives each kind an empty starting value, and a date today\'s local calendar date', () =>
    {
        const today = new Date(2026, 2, 7, 23, 30);

        expect(initialPropertyValue('text', today)).toBe('');
        expect(initialPropertyValue('number', today)).toBe(0);
        expect(initialPropertyValue('checkbox', today)).toBe(false);
        expect(initialPropertyValue('list', today)).toEqual([]);
        expect(initialPropertyValue('date', today)).toBe('2026-03-07');
    });
});

//----------------------------------------------------------------------------------------------------------------------
