//----------------------------------------------------------------------------------------------------------------------
// Frontmatter Keys
//
// The keys the editor gives meaning to beyond the properties panel, each read through its own schema. A value that
// fails its key's schema is ignored. Blank text counts as unset rather than as a failure, so a property just added
// isn't flagged before it's filled in.
//----------------------------------------------------------------------------------------------------------------------

import { z } from 'zod';

// Engines
import type { FrontmatterState, Property, PropertyKind } from './properties.ts';

//----------------------------------------------------------------------------------------------------------------------

export interface DocumentMeta
{
    title : string | null;
    tags : string[];
    lang : string | null;
    strictLineBreaks : boolean;
}

export interface FrontmatterKeyDef
{
    key : string;

    // The kind a property added under this key starts as.
    kind : PropertyKind;

    // What the key takes, in words, for the note on a value the editor ignores.
    expects : string;

    schema : z.ZodType;
}

//----------------------------------------------------------------------------------------------------------------------

const LANGUAGE_TAG = /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/iu;

const titleSchema = z.union([ z.string(), z.number() ]).transform((value) => String(value).trim());

const tagsSchema = z.union([ z.array(z.string()), z.string().transform((text) => text.split(',')) ])
    .transform((tags) => tags.map((tag) => tag.trim()).filter((tag) => tag !== ''));

const langSchema = z.string().trim()
    .regex(LANGUAGE_TAG);

const strictLineBreaksSchema = z.boolean();

export const frontmatterKeys : FrontmatterKeyDef[] = [
    { key: 'title', kind: 'text', expects: 'text', schema: titleSchema },
    { key: 'tags', kind: 'list', expects: 'a list, or text with commas between the tags', schema: tagsSchema },
    { key: 'lang', kind: 'text', expects: 'a language tag such as en or pt-BR', schema: langSchema },
    { key: 'strict-line-breaks', kind: 'checkbox', expects: 'true or false', schema: strictLineBreaksSchema },
];

//----------------------------------------------------------------------------------------------------------------------

function isUnset(property : Property) : boolean
{
    return property.kind === 'text' && property.value.trim() === '';
}

// Nested YAML is an object to the schemas, which none of them take.
function valueOf(property : Property) : unknown
{
    return property.kind === 'nested' ? { yaml: property.yaml } : property.value;
}

function readKey<T>(properties : Property[], key : string, schema : z.ZodType<T>) : T | null
{
    const property = properties.find((candidate) => candidate.key === key);
    if(!property || isUnset(property)) { return null; }

    const parsed = schema.safeParse(valueOf(property));
    return parsed.success ? parsed.data : null;
}

export function buildDocumentMeta(state : FrontmatterState) : DocumentMeta
{
    const properties = state.kind === 'properties' ? state.properties : [];

    return {
        title: readKey(properties, 'title', titleSchema),
        tags: readKey(properties, 'tags', tagsSchema) ?? [],
        lang: readKey(properties, 'lang', langSchema),
        strictLineBreaks: readKey(properties, 'strict-line-breaks', strictLineBreaksSchema) ?? false,
    };
}

// The note for a value the editor ignores, or null when the editor reads the value or doesn't read the key.
export function checkProperty(property : Property) : string | null
{
    const def = frontmatterKeys.find((candidate) => candidate.key === property.key);
    if(!def || isUnset(property) || def.schema.safeParse(valueOf(property)).success) { return null; }

    return `The editor ignores this value: ${ def.key } takes ${ def.expects }.`;
}

//----------------------------------------------------------------------------------------------------------------------
