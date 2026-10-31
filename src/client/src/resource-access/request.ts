//----------------------------------------------------------------------------------------------------------------------
// API Request Helper
//
// The 2xx body is validated against the endpoint's core codec in every build, not just dev: the server never re-parses
// its responses on the way out, so this is the only place drift between the two is caught, and a parse costs nothing
// next to a network round trip.
//----------------------------------------------------------------------------------------------------------------------

import type { ZodType } from 'zod';

// Resource Access
import { APIError, apiErrorFromResponse } from './apiError.ts';

//----------------------------------------------------------------------------------------------------------------------

type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

// A query value the URL builder will stringify; null and undefined drop the parameter entirely, so an omitted parentID
// is root placement rather than the literal string "null".
type QueryValue = string | number | boolean | null | undefined;
export type QueryParams = Record<string, QueryValue>;

// Node's global fetch types the request duplex mode, but not every lib config that reaches this file does; the
// intersection keeps `duplex: 'half'` (required to stream a ReadableStream request body) type-safe either way.
type FetchInit = RequestInit & { duplex ?: 'half' };

interface JSONRequestOptions<T>
{
    method ?: HttpMethod;
    query ?: QueryParams;
    body ?: unknown;
    codec : ZodType<T>;

    // Aborting rejects the returned promise with the signal's own DOMException rather than an APIError -- a caller
    // that cancels its own request is expected to recognise and swallow it.
    signal ?: AbortSignal;
}

interface VoidRequestOptions
{
    method : HttpMethod;
    query ?: QueryParams;
    body ?: unknown;
}

interface UploadRequestOptions<T>
{
    method ?: HttpMethod;
    query ?: QueryParams;
    body : BodyInit;
    contentType ?: string;
    codec : ZodType<T>;
}

//----------------------------------------------------------------------------------------------------------------------

// Fired on the window whenever a credentialed request answers 401: the session died out from under us (revoked,
// banned, expired). The router-side listener owns the reaction.
export const SESSION_LOST_EVENT = 'fileshed:session-lost';

//----------------------------------------------------------------------------------------------------------------------

export function buildURL(path : string, query ?: QueryParams) : string
{
    if(query === undefined) { return path; }

    const params = new URLSearchParams();
    for(const [ key, value ] of Object.entries(query))
    {
        if(value !== undefined && value !== null) { params.append(key, String(value)); }
    }

    const encoded = params.toString();
    return encoded === '' ? path : `${ path }?${ encoded }`;
}

// Every credentialed transport calls this with a failed request's status. A 401 means the session the request rode is
// dead -- revoked, banned, or expired. The shell listens for the event and bounces to sign-in; announcing it on the
// window keeps resource access router-ignorant.
export function announceIfSessionLost(status : number) : void
{
    if(status === 401) { window.dispatchEvent(new CustomEvent(SESSION_LOST_EVENT)); }
}

export async function apiFetch(url : string, init : FetchInit = {}) : Promise<Response>
{
    const response = await fetch(url, { ...init, credentials: 'include' });
    if(!response.ok)
    {
        announceIfSessionLost(response.status);

        throw await apiErrorFromResponse(response);
    }

    return response;
}

// A 2xx body validated against its codec. A body that isn't JSON is a broken response (an APIError carrying the
// status); a body that parses but fails the codec throws the codec's own error -- either way the caller never
// receives an unvalidated shape.
async function parseJSON<T>(response : Response, codec : ZodType<T>) : Promise<T>
{
    let payload : unknown;
    try
    {
        payload = await response.json();
    }
    catch
    {
        throw new APIError(response.status, 'The server returned a response that was not valid JSON.');
    }

    return codec.parse(payload);
}

// The shared request path for a JSON (or bodyless) request: build the URL, attach a JSON body when present, fetch.
async function issue(
    path : string,
    method : HttpMethod,
    query : QueryParams | undefined,
    body : unknown,
    signal ?: AbortSignal
) : Promise<Response>
{
    const headers : Record<string, string> = { accept: 'application/json' };
    const init : FetchInit = { method, headers };

    if(body !== undefined)
    {
        headers['content-type'] = 'application/json';
        init.body = JSON.stringify(body);
    }

    if(signal !== undefined) { init.signal = signal; }

    return apiFetch(buildURL(path, query), init);
}

//----------------------------------------------------------------------------------------------------------------------

export async function requestJSON<T>(path : string, options : JSONRequestOptions<T>) : Promise<T>
{
    const response = await issue(path, options.method ?? 'GET', options.query, options.body, options.signal);

    return parseJSON(response, options.codec);
}

// A request whose success carries no body (a 204). The response is drained by fetch but never parsed.
export async function requestVoid(path : string, options : VoidRequestOptions) : Promise<void>
{
    await issue(path, options.method, options.query, options.body);
}

// A raw-body request -- the upload PUT, whose body is the file bytes rather than JSON and whose metadata rides the
// query string. Streaming a ReadableStream body needs duplex: 'half'; a Blob or buffer needs nothing. There is no
// upload progress here: fetch exposes none, so a progress bar is the upload manager's job (XHR) rather than this layer.
export async function requestUpload<T>(path : string, options : UploadRequestOptions<T>) : Promise<T>
{
    const headers : Record<string, string> = { accept: 'application/json' };
    if(options.contentType !== undefined) { headers['content-type'] = options.contentType; }

    const init : FetchInit = { method: options.method ?? 'PUT', headers, body: options.body };
    if(options.body instanceof ReadableStream) { init.duplex = 'half'; }

    const response = await apiFetch(buildURL(path, options.query), init);

    return parseJSON(response, options.codec);
}

//----------------------------------------------------------------------------------------------------------------------
