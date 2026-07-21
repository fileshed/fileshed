//----------------------------------------------------------------------------------------------------------------------
// Download Route OpenAPI Spec
//----------------------------------------------------------------------------------------------------------------------

import { describeRoute } from 'hono-openapi';

// Routes
import { binaryResponse, emptyResponse, errorResponse, pathParam } from './docSchema.ts';

//----------------------------------------------------------------------------------------------------------------------

export const downloadSpec = describeRoute({
    tags: [ 'Downloads' ],
    summary: 'Download a file',
    description: 'Streams a file node\'s bytes with the full HTTP/1.1 range contract: 200 or 206, a strong ETag over '
        + 'the content hash, If-None-Match to 304, and 416 on an unsatisfiable range. Viewer access suffices; no '
        + 'access, a non-file, or a node trashed and not owned by the caller is 404. The owner may still pull their '
        + 'own trashed bytes.',
    parameters: [
        pathParam('id', 'The file node ID.'),
        {
            name: 'disposition',
            in: 'query',
            required: false,
            description: 'inline for a browser preview, or attachment (the default) to force a download.',
            schema: { type: 'string', enum: [ 'inline', 'attachment' ] },
        },
        {
            name: 'Range',
            in: 'header',
            required: false,
            description: 'An optional single byte range (RFC 7233).',
            schema: { type: 'string' },
        },
        {
            name: 'If-None-Match',
            in: 'header',
            required: false,
            description: 'A prior ETag; a match yields 304 Not Modified.',
            schema: { type: 'string' },
        },
    ],
    responses: {
        200: binaryResponse('The full file.'),
        206: binaryResponse('The requested byte range.'),
        304: emptyResponse('The cached representation is still current.'),
        401: errorResponse('No session.'),
        404: errorResponse('No downloadable file is readable at this ID.'),
        416: emptyResponse('The requested range is not satisfiable.'),
    },
});

//----------------------------------------------------------------------------------------------------------------------
