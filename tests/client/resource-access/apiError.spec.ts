//----------------------------------------------------------------------------------------------------------------------
// API Error
//----------------------------------------------------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';

// Resource Access
import {
    ApiError,
    PayloadTooLargeApiError,
    apiErrorFromAuth,
    apiErrorFromBody,
} from '@client/resource-access/apiError.ts';

//----------------------------------------------------------------------------------------------------------------------

describe('apiErrorFromBody', () =>
{
    it('reads the cap a size refusal names', () =>
    {
        const error = apiErrorFromBody(413, 'Payload Too Large', {
            error: 'Upload exceeds the maximum allowed size.',
            maxBytes: 1_048_576,
        });

        expect(error).toBeInstanceOf(PayloadTooLargeApiError);
        expect(error.message).toBe('Upload exceeds the maximum allowed size.');
        expect((error as PayloadTooLargeApiError).maxBytes).toBe(1_048_576);
    });

    // A proxy in front of the instance answers its own 413, with a body that is nothing like the server's.
    it('reads no cap from a size refusal that carries none', () =>
    {
        const error = apiErrorFromBody(413, 'Request Entity Too Large', '<html>413</html>');

        expect(error).toBeInstanceOf(PayloadTooLargeApiError);
        expect(error.message).toBe('Request Entity Too Large');
        expect((error as PayloadTooLargeApiError).maxBytes).toBeNull();
    });

    it('reads no cap that is not a positive size', () =>
    {
        const error = apiErrorFromBody(413, '', { error: 'Too large.', maxBytes: -1 });

        expect((error as PayloadTooLargeApiError).maxBytes).toBeNull();
    });
});

describe('apiErrorFromAuth', () =>
{
    it('carries better-auth\'s status and sentence', () =>
    {
        const error = apiErrorFromAuth({ status: 401, message: 'Invalid email or password' }, 'Unable to sign in.');

        expect(error).toBeInstanceOf(ApiError);
        expect(error.status).toBe(401);
        expect(error.message).toBe('Invalid email or password');
    });

    it('says the caller\'s sentence when better-auth gives none', () =>
    {
        const error = apiErrorFromAuth({ status: 500 }, 'Unable to sign in.');

        expect(error.message).toBe('Unable to sign in.');
    });
});

//----------------------------------------------------------------------------------------------------------------------
