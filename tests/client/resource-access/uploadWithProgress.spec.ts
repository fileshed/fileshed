//----------------------------------------------------------------------------------------------------------------------
// Upload With Progress
//
// Drives the XHR upload against a fake XMLHttpRequest the test controls: it asserts the request the uploader builds
// (method, url, credentials, headers, the commit-mode query, the chunk offset) and then simulates the outcomes the
// uploader must map -- a committed node, an accepted chunk, a plain error, a regulation rejection, a conflict, upload
// progress, and an abort.
//----------------------------------------------------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Resource Access
import { ApiError, ConflictApiError, RegulationApiError } from '@client/resource-access/apiError.ts';
import { uploadWithProgress } from '@client/resource-access/uploadWithProgress.ts';

//----------------------------------------------------------------------------------------------------------------------

interface ProgressEvent { lengthComputable : boolean; loaded : number; total : number; }

class FakeXHR
{
    static last : FakeXHR | null = null;

    method = '';
    url = '';
    withCredentials = false;
    responseType = '';
    responseText = '';
    status = 0;
    statusText = '';
    aborted = false;
    body : unknown = null;
    headers : Record<string, string> = {};

    #handlers : Record<string, (() => void)[]> = {};
    #progress : ((event : ProgressEvent) => void) | null = null;

    upload = {
        addEventListener: (type : string, cb : (event : ProgressEvent) => void) : void =>
        {
            if(type === 'progress') { this.#progress = cb; }
        },
    };

    open(method : string, url : string) : void { this.method = method; this.url = url; }
    setRequestHeader(key : string, value : string) : void { this.headers[key] = value; }
    addEventListener(type : string, cb : () => void) : void { (this.#handlers[type] ??= []).push(cb); }
    send(body : unknown) : void { this.body = body; FakeXHR.last = this; }
    abort() : void { this.aborted = true; this.#fire('abort'); }

    #fire(type : string) : void { for(const cb of this.#handlers[type] ?? []) { cb(); } }

    // Test drivers.
    emitProgress(loaded : number, total : number) : void
    {
        this.#progress?.({ lengthComputable: true, loaded, total });
    }

    complete(status : number, responseText : string, statusText = '') : void
    {
        this.status = status;
        this.responseText = responseText;
        this.statusText = statusText;
        this.#fire('load');
    }

    fail() : void { this.#fire('error'); }
}

//----------------------------------------------------------------------------------------------------------------------

const NODE_JSON = {
    id: 'n1',
    name: 'f.txt',
    ownerID: 'u1',
    parentID: 'p1',
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
    role: 'owner',
    type: 'file',
    blobID: 'b1',
    size: 10,
    mimeType: 'text/plain',
    trashedAt: null,

    // A node fresh off an upload has nothing granted and nothing published.
    sharing: { granteeCount: 0, linkUrl: null },
};

function lastRequest() : FakeXHR
{
    if(FakeXHR.last === null) { throw new Error('no request was sent'); }

    return FakeXHR.last;
}

function queryOf(xhr : FakeXHR) : Record<string, string>
{
    return Object.fromEntries(new URL(xhr.url, 'http://localhost').searchParams);
}

//----------------------------------------------------------------------------------------------------------------------

describe('uploadWithProgress', () =>
{
    beforeEach(() =>
    {
        FakeXHR.last = null;
        vi.stubGlobal('XMLHttpRequest', FakeXHR);
    });

    afterEach(() => vi.unstubAllGlobals());

    it('PUTs to the ticket path, credentialed, with the octet-stream content type', async () =>
    {
        const promise = uploadWithProgress({
            ticket: 'TKT',
            body: new Blob([ 'bytes' ]),
            commit: { name: 'f.txt', parentID: 'p1', mimeType: 'text/plain' },
        });

        const xhr = lastRequest();
        expect(xhr.method).toBe('PUT');
        expect(new URL(xhr.url, 'http://localhost').pathname).toBe('/api/uploads/TKT');
        expect(xhr.withCredentials).toBe(true);
        expect(xhr.headers['content-type']).toBe('application/octet-stream');

        xhr.complete(200, JSON.stringify(NODE_JSON));
        await promise;
    });

    it('carries create-mode placement on the query string', async () =>
    {
        const promise = uploadWithProgress({
            ticket: 'TKT',
            body: new Blob([ 'x' ]),
            commit: { name: 'f.txt', parentID: 'p1', mimeType: 'text/plain' },
        });

        expect(queryOf(lastRequest())).toEqual({ name: 'f.txt', parentID: 'p1', mimeType: 'text/plain' });

        lastRequest().complete(200, JSON.stringify(NODE_JSON));
        await promise;
    });

    it('carries only the target id (and new type) in replace mode', async () =>
    {
        const promise = uploadWithProgress({
            ticket: 'TKT',
            body: new Blob([ 'x' ]),
            commit: { replaceNodeID: 'n9', mimeType: 'image/png' },
        });

        expect(queryOf(lastRequest())).toEqual({ replaceNodeID: 'n9', mimeType: 'image/png' });

        lastRequest().complete(200, JSON.stringify(NODE_JSON));
        await promise;
    });

    it('carries the chunk offset on the query string, and omits it for a whole-file upload', async () =>
    {
        const chunked = uploadWithProgress({
            ticket: 'TKT',
            body: new Blob([ 'x' ]),
            commit: { name: 'f.txt', parentID: 'p1', mimeType: 'text/plain' },
            offset: 8192,
        });

        expect(queryOf(lastRequest()).offset).toBe('8192');

        lastRequest().complete(200, JSON.stringify(NODE_JSON));
        await chunked;

        const whole = uploadWithProgress({
            ticket: 'TKT',
            body: new Blob([ 'x' ]),
            commit: { name: 'f.txt', parentID: 'p1', mimeType: 'text/plain' },
        });

        expect(queryOf(lastRequest())).not.toHaveProperty('offset');

        lastRequest().complete(200, JSON.stringify(NODE_JSON));
        await whole;
    });

    it('resolves the codec-validated committed node on a 2xx', async () =>
    {
        const promise = uploadWithProgress({
            ticket: 'TKT',
            body: new Blob([ 'x' ]),
            commit: { name: 'f.txt', parentID: 'p1', mimeType: 'text/plain' },
        });

        lastRequest().complete(201, JSON.stringify(NODE_JSON));

        const outcome = await promise;
        expect(outcome.committed).toBe(true);
        if(!outcome.committed) { throw new Error('expected a committed node'); }

        expect(outcome.node.id).toBe('n1');
        expect(outcome.node.type).toBe('file');
    });

    it('reads a 202 as an accepted chunk carrying the upload\'s position, not as a node', async () =>
    {
        const promise = uploadWithProgress({
            ticket: 'TKT',
            body: new Blob([ 'x' ]),
            commit: { name: 'f.txt', parentID: 'p1', mimeType: 'text/plain' },
            offset: 0,
        });

        lastRequest().complete(202, JSON.stringify({ receivedBytes: 8192, totalBytes: 20_000 }));

        expect(await promise).toEqual({ committed: false, receivedBytes: 8192, totalBytes: 20_000 });
    });

    it('rejects a 2xx body that fails the node codec', async () =>
    {
        const promise = uploadWithProgress({
            ticket: 'TKT',
            body: new Blob([ 'x' ]),
            commit: { name: 'f.txt', parentID: 'p1', mimeType: 'text/plain' },
        });

        lastRequest().complete(200, JSON.stringify({ id: 'n1', type: 'file' }));

        await expect(promise).rejects.toBeInstanceOf(Error);
    });

    it('maps a non-2xx { error } body to an ApiError with the status and message', async () =>
    {
        const promise = uploadWithProgress({
            ticket: 'TKT',
            body: new Blob([ 'x' ]),
            commit: { name: 'f.txt', parentID: 'p1', mimeType: 'text/plain' },
        });

        lastRequest().complete(413, JSON.stringify({ error: 'That file is too large.' }));

        await expect(promise).rejects.toMatchObject({ status: 413, message: 'That file is too large.' });
        await expect(promise).rejects.toBeInstanceOf(ApiError);
    });

    // A size refusal names the ceiling it measured against. The transport keeps the parsed body on the error so a
    // caller can show that figure instead of a bare failure -- the message alone cannot be turned back into a number.
    it('keeps the ceiling a size refusal reports on the error it raises', async () =>
    {
        const promise = uploadWithProgress({
            ticket: 'TKT',
            body: new Blob([ 'x' ]),
            commit: { name: 'f.txt', parentID: 'p1', mimeType: 'text/plain' },
        });

        lastRequest().complete(413, JSON.stringify({ error: 'That file is too large.', maxBytes: 5_368_709_120 }));

        const error = await promise.catch((caught : unknown) => caught);
        expect((error as ApiError).body).toMatchObject({ maxBytes: 5_368_709_120 });
    });

    it('maps a regulation rejection to a RegulationApiError carrying the codes', async () =>
    {
        const promise = uploadWithProgress({
            ticket: 'TKT',
            body: new Blob([ 'x' ]),
            commit: { name: 'f.txt', parentID: 'p1', mimeType: 'text/plain' },
        });

        lastRequest().complete(
            403,
            JSON.stringify({ error: 'Over quota', violations: [ { code: 'quota.exceeded', message: 'no room' } ] })
        );

        const error = await promise.catch((caught : unknown) => caught);
        expect(error).toBeInstanceOf(RegulationApiError);
        expect((error as RegulationApiError).codes()).toEqual([ 'quota.exceeded' ]);
    });

    // A 409 says two writes collided; only its code says which collision, and the caller's next move differs by it.
    it('maps a conflict to a ConflictApiError carrying the code', async () =>
    {
        const promise = uploadWithProgress({
            ticket: 'TKT',
            body: new Blob([ 'x' ]),
            commit: { name: 'f.txt', parentID: 'p1', mimeType: 'text/plain' },
        });

        lastRequest().complete(
            409,
            JSON.stringify({ error: 'Another chunk is still being received.', code: 'upload.chunkInFlight' })
        );

        const error = await promise.catch((caught : unknown) => caught);
        expect(error).toBeInstanceOf(ConflictApiError);
        expect((error as ConflictApiError).code).toBe('upload.chunkInFlight');
    });

    // Other surfaces put a `code` in their error bodies too (better-auth names its failures that way), so the upgrade
    // is a conflict's alone -- a caller must not be handed a conflict code by a status that never meant one.
    it('leaves a code on a status that is not a conflict as a plain ApiError', async () =>
    {
        const promise = uploadWithProgress({
            ticket: 'TKT',
            body: new Blob([ 'x' ]),
            commit: { name: 'f.txt', parentID: 'p1', mimeType: 'text/plain' },
        });

        lastRequest().complete(401, JSON.stringify({ error: 'No session.', code: 'SESSION_EXPIRED' }));

        const error = await promise.catch((caught : unknown) => caught);
        expect(error).toBeInstanceOf(ApiError);
        expect(error).not.toBeInstanceOf(ConflictApiError);
    });

    it('reports upload progress as bytes sent of total', async () =>
    {
        const onProgress = vi.fn();
        const promise = uploadWithProgress({
            ticket: 'TKT',
            body: new Blob([ 'x' ]),
            commit: { name: 'f.txt', parentID: 'p1', mimeType: 'text/plain' },
            onProgress,
        });

        lastRequest().emitProgress(40, 100);
        expect(onProgress).toHaveBeenLastCalledWith({ sentBytes: 40, totalBytes: 100 });

        lastRequest().complete(200, JSON.stringify(NODE_JSON));
        await promise;
    });

    it('aborts the in-flight request when its signal fires, rejecting with AbortError', async () =>
    {
        const controller = new AbortController();
        const promise = uploadWithProgress({
            ticket: 'TKT',
            body: new Blob([ 'x' ]),
            commit: { name: 'f.txt', parentID: 'p1', mimeType: 'text/plain' },
            signal: controller.signal,
        });

        controller.abort();

        expect(lastRequest().aborted).toBe(true);
        await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
    });

    it('rejects immediately without sending when the signal is already aborted', async () =>
    {
        await expect(uploadWithProgress({
            ticket: 'TKT',
            body: new Blob([ 'x' ]),
            commit: { name: 'f.txt', parentID: 'p1', mimeType: 'text/plain' },
            signal: AbortSignal.abort(),
        })).rejects.toMatchObject({ name: 'AbortError' });

        expect(FakeXHR.last).toBeNull();
    });

    it('rejects with an ApiError when the transport itself fails', async () =>
    {
        const promise = uploadWithProgress({
            ticket: 'TKT',
            body: new Blob([ 'x' ]),
            commit: { name: 'f.txt', parentID: 'p1', mimeType: 'text/plain' },
        });

        lastRequest().fail();

        await expect(promise).rejects.toBeInstanceOf(ApiError);
    });
});

//----------------------------------------------------------------------------------------------------------------------
