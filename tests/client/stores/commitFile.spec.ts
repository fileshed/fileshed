// @vitest-environment node

//----------------------------------------------------------------------------------------------------------------------
// commitFile
//
// The resource-access calls are mocked; hashing, window reads and the proof-answer engine run for real, and each
// answer is checked against an HMAC computed independently here. Runs in the node environment because jsdom's File has
// no .stream(), which hashing reads through.
//----------------------------------------------------------------------------------------------------------------------

import { createHash, createHmac } from 'node:crypto';

import { type Mock, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

// Resource Access
import { answerChallenge, claimBlob } from '@client/resource-access/blobs.ts';
import { uploadChunked } from '@client/resource-access/chunkedUpload.ts';
import { getMe } from '@client/resource-access/me.ts';

// Stores
import { commitFile } from '@client/stores/commitFile.ts';
import { useSessionStore } from '@client/stores/session.ts';

// Support
import { fileNode, meFixture } from '../support.ts';

//----------------------------------------------------------------------------------------------------------------------

vi.mock('@client/resource-access/blobs.ts', () => ({ claimBlob: vi.fn(), answerChallenge: vi.fn() }));
vi.mock('@client/resource-access/chunkedUpload.ts', () => ({ uploadChunked: vi.fn() }));
vi.mock('@client/resource-access/me.ts', () => ({ getMe: vi.fn() }));

const claimBlobMock = claimBlob as unknown as Mock;
const answerChallengeMock = answerChallenge as unknown as Mock;
const uploadMock = uploadChunked as unknown as Mock;
const getMeMock = getMe as unknown as Mock;

const TEXT = 'the quick brown fox';
const PLACEMENT = { name: 'fox.txt', parentID: null, mimeType: 'text/plain' };

// Not the compiled default, so a commit that ignored the claim and cut to its own size would show.
const CHUNK_BYTES = 3 * 1024 * 1024;

function foxFile() : File
{
    return new File([ TEXT ], 'fox.txt', { type: 'text/plain' });
}

beforeEach(() =>
{
    vi.resetAllMocks();
    setActivePinia(createPinia());
    getMeMock.mockResolvedValue(meFixture());
});

//----------------------------------------------------------------------------------------------------------------------

describe('commitFile', () =>
{
    it('delivers a new blob through the chunked transfer at the size its claim names', async () =>
    {
        const file = foxFile();
        claimBlobMock.mockResolvedValue({ upload: true, ticket: 'T1', chunkBytes: CHUNK_BYTES });
        uploadMock.mockResolvedValue(fileNode({ id: 'n1' }));

        const node = await commitFile(file, PLACEMENT, { sha256: 'a'.repeat(64) });

        expect(node.id).toBe('n1');
        expect(uploadMock).toHaveBeenCalledWith(expect.objectContaining({
            ticket: 'T1',
            file,
            commit: PLACEMENT,
            chunkBytes: CHUNK_BYTES,
        }));
        expect(answerChallengeMock).not.toHaveBeenCalled();
    });

    it('proves a known blob with an HMAC over the sampled windows in the order the challenge lists them', async () =>
    {
        const ranges = [ [ 4, 5 ], [ 0, 3 ] ];
        claimBlobMock.mockResolvedValue({ upload: false, challengeID: 'C1', nonce: 'NONCE', ranges });
        answerChallengeMock.mockResolvedValue(fileNode({ id: 'n2' }));

        const node = await commitFile(foxFile(), PLACEMENT, { sha256: 'a'.repeat(64) });

        const expected = createHmac('sha256', 'NONCE')
            .update('quickthe')
            .digest('hex');
        expect(node.id).toBe('n2');
        expect(answerChallengeMock).toHaveBeenCalledWith('C1', { answer: expected, ...PLACEMENT });
        expect(uploadMock).not.toHaveBeenCalled();
    });

    it('claims the digest of the bytes when the caller has not hashed them', async () =>
    {
        claimBlobMock.mockResolvedValue({ upload: true, ticket: 'T1', chunkBytes: CHUNK_BYTES });
        uploadMock.mockResolvedValue(fileNode());

        await commitFile(foxFile(), PLACEMENT);

        const digest = createHash('sha256')
            .update(TEXT)
            .digest('hex');
        expect(claimBlobMock).toHaveBeenCalledWith({ sha256: digest, size: TEXT.length });
    });

    it('refreshes the signed-in profile once the bytes land, since they moved the quota gauge', async () =>
    {
        claimBlobMock.mockResolvedValue({ upload: true, ticket: 'T1', chunkBytes: CHUNK_BYTES });
        uploadMock.mockResolvedValue(fileNode());
        getMeMock.mockResolvedValue(meFixture({ quota: { used: 4096, effective: null, limit: null } }));

        await commitFile(foxFile(), PLACEMENT, { sha256: 'a'.repeat(64) });

        await vi.waitFor(() => { expect(useSessionStore().me?.quota.used).toBe(4096); });
    });

    it('lands nothing when cancelled while the claim is answering', async () =>
    {
        const controller = new AbortController();
        claimBlobMock.mockImplementation(async () =>
        {
            controller.abort();
            return { upload: false, challengeID: 'C1', nonce: 'NONCE', ranges: [ [ 0, 3 ] ] };
        });

        const committing = commitFile(foxFile(), PLACEMENT, { sha256: 'a'.repeat(64), signal: controller.signal });

        await expect(committing).rejects.toMatchObject({ name: 'AbortError' });
        expect(answerChallengeMock).not.toHaveBeenCalled();
    });
});

//----------------------------------------------------------------------------------------------------------------------
