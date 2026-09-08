//----------------------------------------------------------------------------------------------------------------------
// Archive Route OpenAPI Spec
//----------------------------------------------------------------------------------------------------------------------

import { describeRoute } from 'hono-openapi';

// Models
import { MAX_ARCHIVE_NODES, archiveFormats } from '@fileshed/core';

// Routes
import { errorResponse } from './docSchema.ts';

//----------------------------------------------------------------------------------------------------------------------

export const archiveSpec = describeRoute({
    tags: [ 'Downloads' ],
    summary: 'Download a selection as one archive',
    description: 'Streams the selected nodes back as a single archive, built as it is sent -- there is no '
        + 'content-length, and nothing is assembled on the server first. Folders recurse and the archive\'s internal '
        + 'paths mirror the tree relative to the selection, so nothing above what was selected appears. Each node is '
        + 'judged against the caller\'s own access: one they cannot read is left out rather than failing the '
        + `request, and anything left out is named in a ${ 'SKIPPED.txt' } at the archive root. A link resolves to `
        + 'the file it points at, judged on the caller\'s access to that TARGET rather than to the link; a link to a '
        + 'folder is not followed. A selection naming nothing the caller can see answers 404.',
    parameters: [
        {
            name: 'ids',
            in: 'query',
            required: true,
            description: `The selected node ids, comma-separated. At most ${ MAX_ARCHIVE_NODES }; a folder among `
                + 'them carries however much it contains.',
            schema: { type: 'string' },
        },
        {
            name: 'format',
            in: 'query',
            required: true,
            description: 'The archive format.',
            schema: { type: 'string', enum: [ ...archiveFormats ] },
        },
    ],
    responses: {
        200: {
            description: 'The archive, streamed.',
            content: { 'application/zip': { schema: { type: 'string', format: 'binary' } } },
        },
        400: errorResponse('The selection is empty, too large, or the format is unknown.'),
        401: errorResponse('No session.'),
        404: errorResponse('Nothing in the selection could be found.'),
    },
});

//----------------------------------------------------------------------------------------------------------------------
