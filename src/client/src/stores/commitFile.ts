//----------------------------------------------------------------------------------------------------------------------
// Commit File
//
// Every write of a file's bytes goes through here, so each follows the chunking contract (a ticket is delivered in the
// claim's chunkBytes pieces, never as one request that a proxy sized for a chunk would refuse) and each refreshes the
// quota gauge its bytes moved.
//----------------------------------------------------------------------------------------------------------------------

import type { NodeResponse, UploadCommitMetadata } from '@fileshed/core';

// Engines
import { buildProofAnswer } from '../engines/claim.ts';

// Resource Access
import { answerChallenge, claimBlob } from '../resource-access/blobs.ts';
import { uploadChunked } from '../resource-access/chunkedUpload.ts';
import type { UploadProgress } from '../resource-access/uploadWithProgress.ts';

// Stores
import { useSessionStore } from './session.ts';

// Utils
import { hashFile, readSampleWindows } from '../utils/hashFile.ts';

//----------------------------------------------------------------------------------------------------------------------

export type CommitPhase = 'uploading' | 'proving';

export interface CommitFileOptions
{
    // The file's digest, when the caller has already hashed it.
    sha256 ?: string;

    onPhase ?: (phase : CommitPhase) => void;
    onProgress ?: (progress : UploadProgress) => void;

    // Checked between requests as well as handed to the transfer, so a cancel during the claim or the proof stops the
    // commit before it lands.
    signal ?: AbortSignal;
}

//----------------------------------------------------------------------------------------------------------------------

async function deliver(file : File, commit : UploadCommitMetadata, options : CommitFileOptions) : Promise<NodeResponse>
{
    const { onPhase, onProgress, signal } = options;
    const sha256 = options.sha256 ?? await hashFile(file, undefined, signal);

    const claim = await claimBlob({ sha256, size: file.size });
    if(signal?.aborted) { throw new DOMException('Upload cancelled', 'AbortError'); }

    if(claim.upload)
    {
        onPhase?.('uploading');

        return uploadChunked({ ticket: claim.ticket, file, commit, chunkBytes: claim.chunkBytes, onProgress, signal });
    }

    onPhase?.('proving');
    const windows = await readSampleWindows(file, claim.ranges);
    const answer = await buildProofAnswer(claim.nonce, windows);
    if(signal?.aborted) { throw new DOMException('Upload cancelled', 'AbortError'); }

    return answerChallenge(claim.challengeID, { answer, ...commit });
}

export async function commitFile(file : File, commit : UploadCommitMetadata, options : CommitFileOptions = {})
: Promise<NodeResponse>
{
    const saved = await deliver(file, commit, options);
    void useSessionStore().refreshProfile();

    return saved;
}

//----------------------------------------------------------------------------------------------------------------------
