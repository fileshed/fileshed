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
//----------------------------------------------------------------------------------------------------------------------

import type { Hono } from 'hono';
import { describeRoute, openAPIRouteHandler } from 'hono-openapi';
import { Scalar } from '@scalar/hono-api-reference';
import type { OpenAPIV3_1 as OpenApiV31 } from 'openapi-types';

// Routes
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

export function mountOpenApiDocs(app : Hono) : void
{
    const specSpec = describeRoute({
        tags: [ 'Docs' ],
        summary: 'Get the OpenAPI document',
        description: 'The generated OpenAPI 3.1 document for this API.',
        security: [],
        responses: { 200: { description: 'The OpenAPI document.', content: { 'application/json': {} } } },
    });

    const docsSpec = describeRoute({
        tags: [ 'Docs' ],
        summary: 'Get the API reference UI',
        description: 'The Scalar reference UI, rendered from the OpenAPI document.',
        security: [],
        responses: { 200: { description: 'The reference UI.', content: { 'text/html': {} } } },
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

    app.get('/api/docs', docsSpec, Scalar({ url: SPEC_PATH, pageTitle: 'FileShed API' }));
}

//----------------------------------------------------------------------------------------------------------------------
