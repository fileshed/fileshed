//----------------------------------------------------------------------------------------------------------------------
// OpenAPI Doc Schema Helpers
//
// The per-operation boilerplate every *.openapi.ts sibling shares, in one place. describeRoute resolves RESPONSE
// schemas through resolver() at spec-generation time but does NOT resolve requestBody or parameters, so bodies and
// query params are emitted as JSON Schema from the codec with io:'input' -- the wire-loose shape the client sends
// (defaults not yet applied), never the parsed-invariant output.
//
// The shared error shape is the one schema hoisted into components/schemas: it rides nearly every operation, so a
// single $ref keeps the spec from repeating it dozens of times. The node response union stays inlined -- resolver()
// inlines a top-level union, and the list envelopes embed it inline regardless, so hoisting only it would leave the
// spec half-referenced and half-inline. errorResponseComponent feeds openapi.ts's components block. The raw-byte body
// is the only other schema written by hand: file bytes are not a domain type any codec models.
//----------------------------------------------------------------------------------------------------------------------

import { type ResponsesWithResolver, resolver } from 'hono-openapi';
import type { OpenAPIV3_1 as OpenApiV31 } from 'openapi-types';
import { type ZodType, z } from 'zod';

//----------------------------------------------------------------------------------------------------------------------

// The wire error shape mapManagerError emits: a message, plus the regulation violations present on 403/422 rejections.
export const errorResponseCodec = z.object({
    error: z.string(),
    violations: z.array(z.object({ code: z.string() }).loose()).optional(),
});

export const ERROR_SCHEMA_NAME = 'ErrorResponse';

const ERROR_SCHEMA_REF = `#/components/schemas/${ ERROR_SCHEMA_NAME }`;

// One response entry, resolver-aware, as describeRoute's responses map holds them.
type DocResponse = ResponsesWithResolver[string];

//----------------------------------------------------------------------------------------------------------------------

// z.toJSONSchema emits a valid JSON Schema, but its return type models `type` as a single string where OpenAPI's
// SchemaObject models the mixed case as an array -- a nominal gap only, so the runtime object is already correct.
function toInputSchema(codec : ZodType) : OpenApiV31.SchemaObject
{
    return z.toJSONSchema(codec, { io: 'input' }) as unknown as OpenApiV31.SchemaObject;
}

// The generated schema for the hoisted error component, minus the $schema dialect marker that has no place inside an
// OpenAPI components block.
export function errorResponseComponent() : OpenApiV31.SchemaObject
{
    const generated = { ...(toInputSchema(errorResponseCodec) as Record<string, unknown>) };
    delete generated['$schema'];

    return generated as OpenApiV31.SchemaObject;
}

//----------------------------------------------------------------------------------------------------------------------
// Request pieces
//----------------------------------------------------------------------------------------------------------------------

// A required JSON request body from a core codec's wire-loose input shape.
export function jsonBody(codec : ZodType) : OpenApiV31.RequestBodyObject
{
    return {
        required: true,
        content: { 'application/json': { schema: toInputSchema(codec) } },
    };
}

// The raw byte-stream request body of an upload -- no codec models file bytes.
export function binaryBody() : OpenApiV31.RequestBodyObject
{
    return {
        required: true,
        content: { 'application/octet-stream': { schema: { type: 'string', format: 'binary' } } },
    };
}

// Query parameters derived from a request codec: one parameter per property, required exactly when the codec's input
// shape requires it (a defaulted or optional field is not required on the wire).
export function queryParams(codec : ZodType) : OpenApiV31.ParameterObject[]
{
    const schema = toInputSchema(codec) as OpenApiV31.SchemaObject & {
        properties ?: Record<string, unknown>;
        required ?: string[];
    };
    const required = new Set(schema.required ?? []);

    return Object.entries(schema.properties ?? {}).map(([ name, propSchema ]) : OpenApiV31.ParameterObject => ({
        name,
        in: 'query',
        required: required.has(name),
        schema: propSchema as OpenApiV31.ParameterObject['schema'],
    }));
}

export function pathParam(name : string, description : string) : OpenApiV31.ParameterObject
{
    return { name, in: 'path', required: true, description, schema: { type: 'string' } };
}

//----------------------------------------------------------------------------------------------------------------------
// Response pieces
//----------------------------------------------------------------------------------------------------------------------

// A JSON response documented by an existing core codec, resolved (and inlined) at spec-generation time.
export function jsonResponse(description : string, codec : ZodType) : DocResponse
{
    return { description, content: { 'application/json': { schema: resolver(codec) } } };
}

// A JSON error body, referencing the hoisted shared error component so the shape is written once.
export function errorResponse(description : string) : DocResponse
{
    return { description, content: { 'application/json': { schema: { $ref: ERROR_SCHEMA_REF } } } };
}

// A bodiless response: a 204, or the bodiless 304/416 of the byte-serving routes.
export function emptyResponse(description : string) : DocResponse
{
    return { description };
}

// A raw byte-stream response -- the download and direct-link endpoints serve file bytes, which no codec models.
export function binaryResponse(description : string) : DocResponse
{
    return { description, content: { 'application/octet-stream': { schema: { type: 'string', format: 'binary' } } } };
}

//----------------------------------------------------------------------------------------------------------------------
