//----------------------------------------------------------------------------------------------------------------------
// OpenAPI Contract
//
// The documentation surface is a contract. GET /api/openapi.json must emit a well-formed OpenAPI 3.x document in which
// every registered feature route -- everything but better-auth's delegated wildcard -- appears as an operation with a
// summary; an undecorated route is absent from the emitted paths, so that presence check is the drift backstop. The
// document declares one security scheme (the better-auth session cookie), applies it globally, and the anonymous
// surfaces override to require none. The shared error shape is hoisted once into components and referenced by $ref, and
// the POST /api/nodes body round-trips the createNodeRequest discriminated union -- the point of feeding the spec from
// the same codecs the handlers validate against. GET /api/docs serves the Scalar reference UI off this origin's own
// bundle, under a policy that admits its start-up script by nonce and no other script at all. The spec is pure
// composition; no request hits the database, so nothing is migrated.
//----------------------------------------------------------------------------------------------------------------------

import { afterAll, describe, expect, it } from 'vitest';

// Resource Access
import { createAuth } from '@server/resource-access/auth.ts';
import { createDatabase } from '@server/resource-access/database/database.ts';

// Support
import { TEST_AUTH_SECRET, composeFullApp, testConfig } from '../auth/support.ts';

//----------------------------------------------------------------------------------------------------------------------

const config = testConfig();
const handle = createDatabase(config);
const auth = createAuth(handle, config, TEST_AUTH_SECRET);

// The reference is asked for here because a deployment never mounts it -- these specs are what stands in for the
// developer who passes --api-reference at the command line.
const app = composeFullApp(auth, handle, config, { apiReference: true });

afterAll(async () =>
{
    await handle.db.destroy();
});

//----------------------------------------------------------------------------------------------------------------------

interface SchemaBranch
{
    properties : Record<string, { const ?: string }>;
    required : string[];
    additionalProperties : boolean;
}

interface SchemaObject
{
    oneOf ?: SchemaBranch[];
}

interface MediaType
{
    schema ?: SchemaObject & { $ref ?: string };
}

interface Operation
{
    summary ?: string;
    security ?: unknown[];
    responses : Record<string, { content ?: Record<string, MediaType> } | undefined>;
    requestBody ?: { content : Record<string, { schema : SchemaObject }> };
}

type HttpMethod = 'get' | 'post' | 'put' | 'patch' | 'delete';

type PathItem = Partial<Record<HttpMethod, Operation>>;

interface SecurityScheme
{
    type : string;
    in ?: string;
    name ?: string;
}

interface OpenApiSpec
{
    openapi : string;
    info : { title : string; version : string };
    paths : Record<string, PathItem>;
    components ?: {
        schemas ?: Record<string, unknown>;
        securitySchemes ?: Record<string, SecurityScheme>;
    };
    security ?: Record<string, unknown>[];
}

async function fetchSpec() : Promise<OpenApiSpec>
{
    const res = await app.request('/api/openapi.json');
    expect(res.status).toBe(200);

    return await res.json() as OpenApiSpec;
}

// The nonce off the one script tag that carries no src -- the inline call that starts the reference up.
function nonceOf(html : string) : string
{
    const inline = /<script(?![^>]*\ssrc=)[^>]*\snonce="(?<nonce>[^"]*)"/u.exec(html);

    return inline?.groups?.['nonce'] ?? '';
}

//----------------------------------------------------------------------------------------------------------------------

describe('GET /api/openapi.json', () =>
{
    it('emits a well-formed OpenAPI 3.x document', async () =>
    {
        const spec = await fetchSpec();

        expect(spec.openapi).toMatch(/^3\./);
        expect(spec.info).toMatchObject({ title: expect.any(String), version: expect.any(String) });
        expect(spec.paths).toBeTypeOf('object');
    });

    it('documents GET /api/nodes/{id} as a read operation', async () =>
    {
        const spec = await fetchSpec();
        const operation = spec.paths['/api/nodes/{id}']?.get;

        expect(operation).toBeDefined();
        expect(operation?.responses['200']).toBeDefined();
        expect(operation?.responses['404']).toBeDefined();
    });

    it('documents POST /api/nodes as a create operation', async () =>
    {
        const spec = await fetchSpec();
        const operation = spec.paths['/api/nodes']?.post;

        expect(operation).toBeDefined();
        expect(operation?.responses['201']).toBeDefined();
    });

    it('round-trips the createNodeRequest discriminated union into the POST request body', async () =>
    {
        const spec = await fetchSpec();
        const schema = spec.paths['/api/nodes']?.post?.requestBody?.content['application/json']?.schema;
        const branches = schema?.oneOf ?? [];

        // A discriminated union serializes to oneOf, one branch per node type.
        expect(branches).toHaveLength(2);

        // Every branch carries the discriminator and rejects unknown keys (strictObject).
        for(const branch of branches)
        {
            expect(branch.properties.type?.const).toMatch(/^(folder|link)$/);
            expect(branch.required).toContain('type');
            expect(branch.additionalProperties).toBe(false);
        }

        const folderBranch = branches.find((branch) => branch.properties.type?.const === 'folder');
        const linkBranch = branches.find((branch) => branch.properties.type?.const === 'link');

        // The folder branch requires a name, the link branch a target.
        expect(folderBranch?.required).toContain('name');
        expect(linkBranch?.required).toContain('targetNodeID');

        // parentID defaults server-side, so the wire-loose input body must not require it.
        expect(folderBranch?.required).not.toContain('parentID');
    });
});

//----------------------------------------------------------------------------------------------------------------------

describe('GET /api/docs', () =>
{
    it('serves the Scalar reference UI as HTML', async () =>
    {
        const res = await app.request('/api/docs');

        expect(res.status).toBe(200);
        expect(res.headers.get('content-type')).toMatch(/text\/html/);
    });

    it('loads every script it runs from this origin', async () =>
    {
        const html = await (await app.request('/api/docs')).text();

        const sources = [ ...html.matchAll(/<script[^>]*\ssrc="(?<src>[^"]*)"/gu) ]
            .map((match) => match.groups?.['src'] ?? '');

        expect(sources.length).toBeGreaterThan(0);
        for(const source of sources)
        {
            // A path, so it resolves against this origin. A protocol-relative `//host` would not.
            expect(source, source).toMatch(/^\/[^/]/u);
        }
    });

    it('serves the reference bundle itself', async () =>
    {
        const res = await app.request('/scalar/standalone.js');

        expect(res.status).toBe(200);
        expect(res.headers.get('content-type')).toMatch(/javascript/);
        expect((await res.text()).length).toBeGreaterThan(0);
    });

    it('authorizes its inline start-up script with a nonce, and a fresh one each time', async () =>
    {
        const first = await app.request('/api/docs');
        const nonce = nonceOf(await first.text());

        expect(nonce).toBeTruthy();
        expect(first.headers.get('content-security-policy')).toContain(`'nonce-${ nonce }'`);

        const second = await app.request('/api/docs');

        expect(nonceOf(await second.text())).not.toBe(nonce);
    });

    it('keeps its own policy rather than the app-wide default', async () =>
    {
        const res = await app.request('/api/docs');

        // The reference runs an inline script; the app document policy would refuse it.
        expect(res.headers.get('content-security-policy')).toMatch(/script-src[^;]*'nonce-/u);
    });
});

//----------------------------------------------------------------------------------------------------------------------

describe('operation coverage', () =>
{
    const HTTP_METHODS : HttpMethod[] = [ 'get', 'post', 'put', 'patch', 'delete' ];

    // The drift backstop. Every registered route but better-auth's delegated wildcard must be documented, and an
    // undecorated route is simply absent from the emitted paths -- so this fails the moment a route is added without a
    // spec. Terminal handlers only (arity < 2); the doc-spec middleware is filtered exactly as the route table filters
    // it. Path params translate from Hono's `:id` to OpenAPI's `{id}`.
    it('documents every non-auth route as an operation with a summary', async () =>
    {
        const spec = await fetchSpec();

        const registered = app.routes
            .filter((route) => route.method !== 'ALL' && route.handler.length < 2 && route.path !== '/api/auth/*')
            .map((route) => ({
                method: route.method.toLowerCase() as HttpMethod,
                path: route.path.replace(/:(\w+)/g, '{$1}'),
            }));

        expect(registered.length).toBeGreaterThan(0);

        for(const { method, path } of registered)
        {
            const operation = spec.paths[path]?.[method];

            expect(operation, `${ method.toUpperCase() } ${ path } is undocumented`).toBeDefined();
            expect(operation?.summary, `${ method.toUpperCase() } ${ path } has no summary`).toBeTruthy();
        }
    });

    it('emits a summary on every documented operation', async () =>
    {
        const spec = await fetchSpec();

        for(const [ path, item ] of Object.entries(spec.paths))
        {
            for(const method of HTTP_METHODS)
            {
                const operation = item[method];
                if(operation !== undefined)
                {
                    expect(operation.summary, `${ method.toUpperCase() } ${ path } has no summary`).toBeTruthy();
                }
            }
        }
    });
});

//----------------------------------------------------------------------------------------------------------------------

describe('security', () =>
{
    it('declares the better-auth session cookie as the one security scheme', async () =>
    {
        const spec = await fetchSpec();

        expect(spec.components?.securitySchemes?.sessionCookie).toMatchObject({
            type: 'apiKey',
            in: 'cookie',
            name: 'better-auth.session_token',
        });
    });

    it('applies the session cookie as the global default', async () =>
    {
        const spec = await fetchSpec();

        expect(spec.security).toContainEqual({ sessionCookie: [] });
    });

    it('overrides the anonymous surfaces to require no security', async () =>
    {
        const spec = await fetchSpec();

        const anonymous = [
            '/d/{token}',
            '/api/health',
            '/api/openapi.json',
            '/api/docs',
            '/api/branding.css',
            '/api/branding/logo',
        ];

        for(const path of anonymous)
        {
            expect(spec.paths[path]?.get?.security, `${ path } should be anonymous`).toEqual([]);
        }
    });

    it('leaves an authenticated operation to inherit the global default', async () =>
    {
        const spec = await fetchSpec();

        // No per-operation security means the document default applies -- the absence is the inheritance.
        expect(spec.paths['/api/me']?.get?.security).toBeUndefined();
    });
});

//----------------------------------------------------------------------------------------------------------------------

describe('shared error component', () =>
{
    it('hoists the error shape into components/schemas', async () =>
    {
        const spec = await fetchSpec();
        const error = spec.components?.schemas?.ErrorResponse as { properties ?: Record<string, unknown> } | undefined;

        expect(error).toBeDefined();
        expect(error?.properties).toHaveProperty('error');
    });

    it('references the hoisted error component from an error response rather than inlining it', async () =>
    {
        const spec = await fetchSpec();
        const schema = spec.paths['/api/nodes/{id}']?.get?.responses['404']?.content?.['application/json']?.schema;

        expect(schema).toEqual({ $ref: '#/components/schemas/ErrorResponse' });
    });
});

//----------------------------------------------------------------------------------------------------------------------
