//----------------------------------------------------------------------------------------------------------------------
// Branding Routes OpenAPI Spec
//----------------------------------------------------------------------------------------------------------------------

import { describeRoute } from 'hono-openapi';
import { z } from 'zod';

// Models
import { instanceThemeCodec, updateBrandingRequestCodec } from '@fileshed/core';

// Routes
import { errorResponse, jsonBody, jsonResponse } from './docSchema.ts';

//----------------------------------------------------------------------------------------------------------------------

const BRANDING_TAG = 'Admin';

const logoUploadResponseCodec = z.object({ logo: z.string().nullable() });

//----------------------------------------------------------------------------------------------------------------------

export const getBrandingSpec = describeRoute({
    tags: [ BRANDING_TAG ],
    summary: 'Read the instance theme',
    description: 'The full theme document. Null anywhere means the stock build-time look.',
    responses: {
        200: jsonResponse('The theme document.', instanceThemeCodec),
        401: errorResponse('No session.'),
        403: errorResponse('Not an admin.'),
    },
});

export const patchBrandingSpec = describeRoute({
    tags: [ BRANDING_TAG ],
    summary: 'Change the instance theme',
    description: 'A sparse patch: absent fields stay, explicit null unsets back to stock. Applies on the next '
        + 'page load everywhere -- nothing here waits on a restart. Answers the merged document.',
    requestBody: jsonBody(updateBrandingRequestCodec),
    responses: {
        200: jsonResponse('The merged theme document.', instanceThemeCodec),
        400: errorResponse('A value does not fit.'),
        401: errorResponse('No session.'),
        403: errorResponse('Not an admin.'),
    },
});

export const uploadLogoSpec = describeRoute({
    tags: [ BRANDING_TAG ],
    summary: 'Upload the instance logo',
    description: 'A raw image body (PNG, JPEG, WebP, GIF, SVG, or ICO) under the avatar size cap. Replaces any '
        + 'previous logo; the replaced bytes are graveyarded unless something else references them.',
    responses: {
        200: jsonResponse('The new logo hash.', logoUploadResponseCodec),
        400: errorResponse('Not an accepted image type.'),
        401: errorResponse('No session.'),
        403: errorResponse('Not an admin.'),
        413: errorResponse('Larger than the size cap.'),
    },
});

export const deleteLogoSpec = describeRoute({
    tags: [ BRANDING_TAG ],
    summary: 'Remove the instance logo',
    description: 'Back to the stock mark. Idempotent.',
    responses: {
        204: { description: 'Removed (or never set).' },
        401: errorResponse('No session.'),
        403: errorResponse('Not an admin.'),
    },
});

export const getLogoSpec = describeRoute({
    tags: [ 'Instance' ],
    summary: 'The instance logo',
    description: 'Anonymous by design -- the sign-in page shows it. Serves only the CURRENT logo, so this can '
        + 'never read arbitrary content-addressed blobs. 404 while no logo is set.',
    security: [],
    responses: {
        200: {
            description: 'The logo bytes.',
            content: { 'image/*': { schema: { type: 'string', format: 'binary' } } },
        },
        404: errorResponse('No logo is set.'),
    },
});

export const brandingCssSpec = describeRoute({
    tags: [ 'Instance' ],
    summary: 'The instance theme stylesheet',
    description: 'Anonymous by design -- pre-auth pages brand through it. Empty when the theme is stock. Serves '
        + 'an ETag; clients revalidate rather than cache blindly.',
    security: [],
    responses: {
        200: { description: 'The stylesheet.', content: { 'text/css': { schema: { type: 'string' } } } },
        304: { description: 'Unchanged since the ETag the client holds.' },
    },
});

//----------------------------------------------------------------------------------------------------------------------
