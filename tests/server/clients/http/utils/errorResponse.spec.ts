//----------------------------------------------------------------------------------------------------------------------
// Error Responses
//----------------------------------------------------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';

// Models
import {
    BlobNotFoundError,
    NotFoundError,
    OffsetConflictError,
    PayloadTooLargeError,
    RegulationError,
} from '@fileshed/core';

// Utils
import { errorToResponse } from '@server/clients/http/utils/errorResponse.ts';

//----------------------------------------------------------------------------------------------------------------------

describe('errorToResponse', () =>
{
    it('answers a missing resource with 404 and its message', () =>
    {
        const response = errorToResponse(new NotFoundError('No such node.'));

        expect(response?.status).toBe(404);
        expect(response?.body).toEqual({ error: 'No such node.' });
    });

    it('tells a resuming upload where it stands', () =>
    {
        const response = errorToResponse(new OffsetConflictError('Those bytes are not next.', 4096));

        expect(response?.status).toBe(409);
        expect(response?.body).toEqual({
            error: 'Those bytes are not next.',
            code: 'upload.offsetConflict',
            receivedBytes: 4096,
        });
    });

    it('states the byte ceiling in the body and in the Upload-Limit header', () =>
    {
        const response = errorToResponse(new PayloadTooLargeError('Too large.', 1000));

        expect(response?.status).toBe(413);
        expect(response?.body).toEqual({ error: 'Too large.', maxBytes: 1000 });
        expect(response?.headers).toEqual({ 'Upload-Limit': 'max-size=1000' });
    });

    it('answers a refusal of authority with 403 and an illegal state with 422', () =>
    {
        const forbidden = errorToResponse(new RegulationError([ { code: 'share.notOwner', message: 'not yours' } ]));
        const illegal = errorToResponse(new RegulationError([ { code: 'quota.exceeded', message: 'over quota' } ]));

        expect(forbidden?.status).toBe(403);
        expect(illegal?.status).toBe(422);
    });

    it('leaves a server failure for the error handler to answer', () =>
    {
        expect(errorToResponse(new BlobNotFoundError('abc'))).toBeUndefined();
        expect(errorToResponse(new Error('boom'))).toBeUndefined();
    });
});

//----------------------------------------------------------------------------------------------------------------------
