//----------------------------------------------------------------------------------------------------------------------
// OpenAPI Documentation Routes
//
// Serves the generated spec at GET /api/openapi.json and the Scalar reference UI at GET /api/docs. openAPIRouteHandler
// walks the app it is handed at request time, so this must be mounted onto the fully-composed app after every feature
// router -- otherwise the spec would omit whatever was registered later.
//
// The document declares the better-auth session cookie as its one security scheme and applies it globally: a
// same-origin browser session authenticates every try-it call. The four anonymous surfaces (the health probe, the
// direct link, and these two documentation routes) override with an empty security list. excludeStaticFile is off so
// the period in `openapi.json` does not drop the spec route from its own output.
//
// Both documentation routes stay anonymous by choice. The spec describes the API of a published, AGPL-licensed
// project -- every route in it is readable in the source of the version an instance runs -- so a session on either
// would buy obscurity. What was worth closing here was never the reading; it was the script.
//----------------------------------------------------------------------------------------------------------------------

import { createHash, randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import type { Hono } from 'hono';
import { describeRoute, openAPIRouteHandler } from 'hono-openapi';
import { Scalar } from '@scalar/hono-api-reference';
import type { OpenAPIV3_1 as OpenApiV31 } from 'openapi-types';

// Routes
import { docsContentSecurityPolicy } from './contentSecurityPolicy.ts';
import { ERROR_SCHEMA_NAME, errorResponseComponent } from './docSchema.ts';

//----------------------------------------------------------------------------------------------------------------------

const SPEC_PATH = '/api/openapi.json';

const SESSION_SECURITY_SCHEME = 'sessionCookie';

// The signed session cookie better-auth sets on sign-in (its default prefix + name). A secure deployment adds the
// `__Secure-` prefix; the base name is what a same-origin browser presents on a try-it call.
const sessionCookieScheme : OpenApiV31.SecuritySchemeObject = {
    type: 'apiKey',
    in: 'cookie',
    name: 'better-auth.session_token',
    description: 'The better-auth session cookie, set on sign-in and sent automatically by a same-origin browser.',
};

const tags : OpenApiV31.TagObject[] = [
    { name: 'Nodes', description: 'Files, folders, and links.' },
    { name: 'Search', description: 'Name search across accessible nodes.' },
    { name: 'Me', description: 'The current user and their quota.' },
    { name: 'Users', description: 'Looking up other users by exact email.' },
    { name: 'Avatars', description: 'User avatar upload, removal, and serving.' },
    { name: 'Admin', description: 'User management and server status.' },
    { name: 'Blobs', description: 'Content-addressed claim and proof-of-possession.' },
    { name: 'Uploads', description: 'Committing uploaded bytes to a file node.' },
    { name: 'Shares', description: 'Granting and revoking access to nodes.' },
    { name: 'Access Requests', description: 'Asking an owner for access, and resolving those requests.' },
    { name: 'Downloads', description: 'Authenticated file downloads.' },
    { name: 'Deletion Offers', description: 'Save-a-copy invitations after a shared file is deleted.' },
    { name: 'Links', description: 'Managing hotlinkable public links.' },
    { name: 'Direct', description: 'Anonymous public-link byte serving.' },
    { name: 'Health', description: 'Liveness.' },
    { name: 'Docs', description: 'The API documentation surface itself.' },
];

//----------------------------------------------------------------------------------------------------------------------
// The reference UI's bundle
//----------------------------------------------------------------------------------------------------------------------

// Served from this origin instead of a CDN. A third-party script tag on the app origin is arbitrary JavaScript running
// with the viewer's session, and this page needs no session to reach -- which also made it a fine thing to send an
// admin a link to.
//
// Two homes, one per deployment shape. A source run resolves the bundle out of node_modules; a packaged deployment has
// no node_modules and the client build emits the same file into the static tree, where serveStatic answers this path.
// That is why a failure to resolve falls through instead of answering 404.
const BUNDLE_PATH = '/scalar/standalone.js';

interface Bundle
{
    bytes : Uint8Array<ArrayBuffer>;
    etag : string;
}

let bundle : Promise<Bundle | null> | null = null;

async function loadBundle() : Promise<Bundle | null>
{
    try
    {
        // import.meta.resolve answers the package's module entry; the browser build sits beside it.
        const entry = import.meta.resolve('@scalar/api-reference');
        const bytes = new Uint8Array(await readFile(fileURLToPath(new URL('./browser/standalone.js', entry))));

        return {
            bytes,
            etag: `"${ createHash('sha256').update(bytes)
                .digest('base64url') }"`,
        };
    }
    catch
    {
        return null;
    }
}

//----------------------------------------------------------------------------------------------------------------------

export function mountOpenApiSpec(app : Hono) : void
{
    const specSpec = describeRoute({
        tags: [ 'Docs' ],
        summary: 'Get the OpenAPI document',
        description: 'The generated OpenAPI 3.1 document for this API.',
        security: [],
        responses: { 200: { description: 'The OpenAPI document.', content: { 'application/json': {} } } },
    });

    app.get(SPEC_PATH, specSpec, openAPIRouteHandler(app, {
        excludeStaticFile: false,
        documentation: {
            info: {
                title: 'FileShed API',
                version: '0.1.0',
                description: 'Self-hosted, multi-user file hosting.',
            },
            tags,
            components: {
                schemas: { [ERROR_SCHEMA_NAME]: errorResponseComponent() },
                securitySchemes: { [SESSION_SECURITY_SCHEME]: sessionCookieScheme },
            },
            security: [ { [SESSION_SECURITY_SCHEME]: [] } ],
        },
    }));
}

//----------------------------------------------------------------------------------------------------------------------

// The interactive reference, which a deployment never serves. It is a developer's tool: it renders whatever the
// running process would answer, which is exactly why it is worth having locally and worth refusing in production --
// an instance has no business shipping an anonymous page that loads a bundle and offers to call the API from it.
export function mountApiReference(app : Hono) : void
{
    app.use(BUNDLE_PATH, async (ctx, next) =>
    {
        const loaded = await (bundle ??= loadBundle());
        if(loaded === null) { return next(); }

        if(ctx.req.header('if-none-match') === loaded.etag) { return ctx.body(null, 304); }

        return ctx.body(loaded.bytes, 200, {
            'content-type': 'text/javascript; charset=utf-8',
            'cache-control': 'no-cache',
            'etag': loaded.etag,
        });
    });

    const docsSpec = describeRoute({
        tags: [ 'Docs' ],
        summary: 'Get the API reference UI',
        description: 'The Scalar reference UI, rendered from the OpenAPI document.',
        security: [],
        responses: { 200: { description: 'The reference UI.', content: { 'text/html': {} } } },
    });

    // The config resolver runs per request, which is where the nonce belongs: it has to reach both the header and the
    // inline call that starts the reference up, and it must not be the same nonce twice.
    app.get('/api/docs', docsSpec, Scalar((ctx) =>
    {
        const nonce = randomBytes(16).toString('base64');
        ctx.header('content-security-policy', docsContentSecurityPolicy(nonce));

        return {
            url: SPEC_PATH,
            pageTitle: 'FileShed API',
            cdn: BUNDLE_PATH,
            nonce,
            // Three ways the stock reference reaches off this machine, turned off at the source rather than left for
            // the policy to refuse: a try-it call it considers cross-origin goes through proxy.scalar.com (this
            // instance's API is the page's own origin, so there is nothing to proxy), the theme pulls its webfonts
            // from fonts.scalar.com, and telemetry is on by default.
            proxyUrl: '',
            withDefaultFonts: false,
            telemetry: false,
        };
    }));
}

//----------------------------------------------------------------------------------------------------------------------
