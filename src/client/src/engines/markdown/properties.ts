//----------------------------------------------------------------------------------------------------------------------
// Frontmatter Properties
//
// Edits go through the yaml Document API, so changing one property keeps every other key's comments, order, and
// quoting. A property's kind is read off its value each time, never stored alongside it.
//----------------------------------------------------------------------------------------------------------------------

import {
    Document,
    type Node,
    type Pair,
    type ToStringOptions,
    type YAMLMap,
    isMap,
    isNode,
    isScalar,
    isSeq,
    parseDocument,
} from 'yaml';

//----------------------------------------------------------------------------------------------------------------------
// Types
//----------------------------------------------------------------------------------------------------------------------

// The kinds a property can be created as; nested values come only from YAML written by hand.
export const propertyKinds = [ 'text', 'number', 'checkbox', 'date', 'list' ] as const;
export type PropertyKind = typeof propertyKinds[number];

export interface TextProperty
{
    kind : 'text';
    key : string;
    value : string;
}

export interface NumberProperty
{
    kind : 'number';
    key : string;
    value : number;
}

export interface CheckboxProperty
{
    kind : 'checkbox';
    key : string;
    value : boolean;
}

export interface DateProperty
{
    kind : 'date';
    key : string;
    value : string;
}

export interface ListProperty
{
    kind : 'list';
    key : string;
    value : string[];
}

export interface NestedProperty
{
    kind : 'nested';
    key : string;
    yaml : string;
}

export type Property = TextProperty | NumberProperty | CheckboxProperty | DateProperty | ListProperty | NestedProperty;
export type PropertyValue = string | number | boolean | string[];

export interface NoFrontmatter
{
    kind : 'none';
}

export interface PropertyMap
{
    kind : 'properties';
    properties : Property[];
}

// YAML that doesn't parse, or parses to something other than a key/value map.
export interface RawFrontmatter
{
    kind : 'raw';
    error : string;
}

export type FrontmatterState = NoFrontmatter | PropertyMap | RawFrontmatter;

//----------------------------------------------------------------------------------------------------------------------
// Parsing
//----------------------------------------------------------------------------------------------------------------------

const DATE = /^\d{4}-\d{2}-\d{2}$/u;

const STRINGIFY : ToStringOptions = { lineWidth: 0, flowCollectionPadding: false };

const NOT_A_MAP = 'The frontmatter isn\'t a list of key: value properties.';

function loadMap(yaml : string) : { doc : Document; map : YAMLMap | null } | { error : string }
{
    const doc = parseDocument(yaml);

    const [ first ] = doc.errors;
    if(first) { return { error: first.message }; }

    const { contents } = doc;
    if(contents === null) { return { doc, map: null }; }
    if(!isMap(contents) || !contents.items.every((pair) => isScalar(pair.key))) { return { error: NOT_A_MAP }; }

    return { doc, map: contents };
}

function keyOf(pair : Pair) : string
{
    return isScalar(pair.key) ? String(pair.key.value) : '';
}

function yamlOf(node : Node) : string
{
    const doc = new Document();
    doc.contents = node;

    return doc.toString(STRINGIFY);
}

function propertyOf(key : string, node : unknown) : Property
{
    const value = isScalar(node) ? node.value : node;

    if(value === null || value === undefined) { return { kind: 'text', key, value: '' }; }
    if(typeof value === 'string') { return { kind: DATE.test(value) ? 'date' : 'text', key, value }; }
    if(typeof value === 'number') { return { kind: 'number', key, value }; }
    if(typeof value === 'boolean') { return { kind: 'checkbox', key, value }; }

    if(isSeq(node) && node.items.every(isScalar))
    {
        return { kind: 'list', key, value: node.items.map((item) => String(item.value ?? '')) };
    }

    return { kind: 'nested', key, yaml: isNode(node) ? yamlOf(node) : String(value) };
}

export function parseFrontmatter(yaml : string | null) : FrontmatterState
{
    if(yaml === null) { return { kind: 'none' }; }

    const loaded = loadMap(yaml);
    if('error' in loaded) { return { kind: 'raw', error: loaded.error }; }

    const properties = (loaded.map?.items ?? []).map((pair) => propertyOf(keyOf(pair), pair.value));

    return { kind: 'properties', properties };
}

//----------------------------------------------------------------------------------------------------------------------
// Editing
//----------------------------------------------------------------------------------------------------------------------

// A sequence written flush under its key (`tags:` then `- a`) keeps that style when the block is rewritten.
const FLUSH_SEQUENCE = /^([ \t]*)[^\s#-][^\n]*:[ \t]*\r?\n\1- /mu;

function editableMap(yaml : string) : { doc : Document; map : YAMLMap | null }
{
    const loaded = loadMap(yaml);
    if('error' in loaded) { throw new Error(`Frontmatter can't be edited as properties: ${ loaded.error }`); }

    return loaded;
}

// No properties left means no frontmatter left: an emptied map writes as blank YAML, not `{}`.
function stringify(doc : Document, source : string) : string
{
    if(!isMap(doc.contents) || doc.contents.items.length === 0) { return ''; }

    return doc.toString({ ...STRINGIFY, indentSeq: !FLUSH_SEQUENCE.test(source) });
}

function findPair(map : YAMLMap | null, key : string) : Pair | undefined
{
    return map?.items.find((pair) => keyOf(pair) === key);
}

// A list keeps the nodes of the items it still holds, so their quoting survives a chip being added or removed.
function updatedNode(doc : Document, current : unknown, value : PropertyValue) : unknown
{
    if(Array.isArray(value))
    {
        if(!isSeq(current)) { return doc.createNode(value); }

        const pool = [ ...current.items ];
        current.items = value.map((text) =>
        {
            const index = pool.findIndex((item) => isScalar(item) && String(item.value ?? '') === text);
            return index >= 0 ? pool.splice(index, 1)[0] : doc.createNode(text);
        });

        return current;
    }

    if(!isScalar(current)) { return doc.createNode(value); }

    current.value = value;

    // A number's source formatting (the trailing zeros of 1.50) describes the old value, not the new one.
    if(typeof value === 'number')
    {
        delete current.format;
        delete current.minFractionDigits;
    }

    return current;
}

// Sets the property, adding it at the end when the key isn't there yet.
export function updateProperty(yaml : string, key : string, value : PropertyValue) : string
{
    const { doc, map } = editableMap(yaml);

    const pair = findPair(map, key);
    if(pair) { pair.value = updatedNode(doc, pair.value, value); }
    else { doc.set(key, value); }

    return stringify(doc, yaml);
}

export function removeProperty(yaml : string, key : string) : string
{
    const { doc, map } = editableMap(yaml);

    const pair = findPair(map, key);
    if(map && pair) { map.items.splice(map.items.indexOf(pair), 1); }

    return stringify(doc, yaml);
}

export function initialPropertyValue(kind : PropertyKind, today : Date) : PropertyValue
{
    switch (kind)
    {
        case 'text': return '';
        case 'number': return 0;
        case 'checkbox': return false;
        case 'list': return [];
        case 'date':
        {
            const month = String(today.getMonth() + 1).padStart(2, '0');
            const day = String(today.getDate()).padStart(2, '0');

            return `${ today.getFullYear() }-${ month }-${ day }`;
        }
    }
}

//----------------------------------------------------------------------------------------------------------------------
