//----------------------------------------------------------------------------------------------------------------------
// Archive Manager
//
// A selection served back as one archive, built as it is sent. Nothing is assembled anywhere first: the response
// starts before the second file has been read, and the instance never holds more than one file's bytes at a time.
//
// That last part is why the entries are appended one at a time rather than handed over in a batch. Every file in the
// archive is a stream out of the blob store, and a folder of five thousand files handed over at once would be five
// thousand open descriptors. So each entry waits for the one before it to be consumed, and exactly one blob stream is
// open at any moment.
//
// The length of an archive cannot be known before it is built, so the response is chunked and carries no
// content-length. A failure once the first byte is out can only truncate what the caller receives -- there is no
// status left to change -- so it is logged and the stream is destroyed, which is what a truncated download looks like
// from the other end.
//----------------------------------------------------------------------------------------------------------------------

import { once } from 'node:events';
import { PassThrough, type Readable } from 'node:stream';

import { type Archiver, TarArchive, ZipArchive } from 'archiver';

// Models
import {
    ARCHIVE_SKIPPED_MANIFEST,
    type ArchiveFormat,
    type ArchiveQuery,
    type Node,
    NotFoundError,
    type Role,
} from '@fileshed/core';

// Engines
import { type ArchiveFileEntry, type ArchiveOmission, planArchive } from '../engines/archivePlan.ts';
import { contentDisposition } from '../engines/contentDisposition.ts';

// Resource Access
import { BlobNotFoundError, type BlobRA } from '../resource-access/blob/index.ts';
import type { SessionUser } from '../resource-access/auth.ts';
import type { NodeRA } from '../resource-access/nodes/node.ts';

// Utils
import { getLogger } from '../utils/logger.ts';

//----------------------------------------------------------------------------------------------------------------------

const logger = getLogger('archive');

// What each format is called on the wire and on disk. Both stream; 7z is deliberately absent, having no
// streaming-friendly implementation without native code.
const FORMATS : Record<ArchiveFormat, { contentType : string; extension : string }> = {
    zip: { contentType: 'application/zip', extension: 'zip' },
    tgz: { contentType: 'application/gzip', extension: 'tgz' },
};

// The same shape the byte-serving routes already answer with, so an archive goes out through the one stream adapter
// rather than a second one written for it. Always a 200: an archive has no ranges to satisfy and no etag to match.
export interface ArchiveResult
{
    status : 200;
    headers : Record<string, string>;
    stream : Readable;
}

export type RoleResolver = (userID : string, nodeIDs : readonly string[]) => Promise<Map<string, Role | null>>;

export interface ArchiveManagerDeps
{
    nodes : NodeRA;
    blob : BlobRA;
    resolveRoles : RoleResolver;
}

//----------------------------------------------------------------------------------------------------------------------

// The manifest an archive carries when something in the selection could not go in. Written only when there is
// something to say: a note in every archive would be one nobody reads by the third time.
function manifestText(omissions : readonly ArchiveOmission[]) : string
{
    const lines = [
        'Some of what you selected is not in this archive:',
        '',
        ...omissions.map((omission) => `  ${ omission.path } -- ${ omission.reason }`),
        '',
    ];

    return lines.join('\n');
}

//----------------------------------------------------------------------------------------------------------------------

export class ArchiveManager
{
    readonly #nodes : NodeRA;
    readonly #blob : BlobRA;
    readonly #resolveRoles : RoleResolver;

    constructor(deps : ArchiveManagerDeps)
    {
        this.#nodes = deps.nodes;
        this.#blob = deps.blob;
        this.#resolveRoles = deps.resolveRoles;
    }

    // GET /api/archives. Resolves the selection to a layout, then answers with a stream already being written into.
    // A selection that resolves to nothing at all is a 404 -- ids naming no node the caller can even see is a request
    // about somebody else's drive, not an archive of nothing.
    async build(actor : SessionUser, query : ArchiveQuery) : Promise<ArchiveResult>
    {
        const nodes = await this.#nodes.subtreeNodes(query.ids);
        if(nodes.length === 0) { throw new NotFoundError('Nothing in that selection could be found.'); }

        // A link's target can live anywhere -- that is what a link is for -- so the targets are fetched rather than
        // walked, and their own access is resolved alongside the walk's. The caller's reach through a link is the
        // reach they have to what it points at, never to the link.
        const targets = await this.#targetsOf(nodes);
        const roles = await this.#resolveRoles(actor.id, [
            ...nodes.map((node) => node.id),
            ...targets.keys(),
        ]);

        const plan = planArchive({ selectedIDs: query.ids, nodes, targets, roles });

        if(plan.files.length === 0 && plan.directories.length === 0 && plan.omissions.length === 0)
        {
            throw new NotFoundError('Nothing in that selection could be found.');
        }

        const format = FORMATS[query.format];
        const filename = `${ this.#archiveName(query, nodes) }.${ format.extension }`;

        return {
            status: 200,
            headers: {
                // No content-length: the size is not known until the archive has been built, which is the point of
                // building it as it is sent.
                'content-type': format.contentType,
                'content-disposition': contentDisposition('attachment', filename),
            },
            stream: this.#stream(query.format, plan.directories, plan.files, plan.omissions, actor),
        };
    }

    // What the links among these nodes point at. A target that is itself in the walk is reused rather than fetched
    // again, and one already gone comes back absent, which reads as a dead link.
    async #targetsOf(nodes : readonly Node[]) : Promise<Map<string, Node>>
    {
        const walked = new Map(nodes.map((node) => [ node.id, node ]));
        const wanted = new Set<string>();

        for(const node of nodes)
        {
            if(node.type === 'link' && !walked.has(node.targetNodeID)) { wanted.add(node.targetNodeID); }
        }

        const fetched = await this.#nodes.getMany([ ...wanted ]);
        const targets = new Map(fetched.map((node) => [ node.id, node ]));

        for(const node of nodes)
        {
            const inWalk = node.type === 'link' ? walked.get(node.targetNodeID) : undefined;
            if(inWalk !== undefined) { targets.set(inWalk.id, inWalk); }
        }

        return targets;
    }

    // One selected node names the archive after itself; anything else is a selection, which has no name of its own.
    #archiveName(query : ArchiveQuery, nodes : readonly { id : string; name : string }[]) : string
    {
        if(query.ids.length !== 1) { return 'fileshed-selection'; }

        const only = nodes.find((node) => node.id === query.ids[0]);

        return only === undefined ? 'fileshed-selection' : only.name;
    }

    #stream(
        format : ArchiveFormat,
        directories : readonly string[],
        files : readonly ArchiveFileEntry[],
        omissions : readonly ArchiveOmission[],
        actor : SessionUser
    ) : Readable
    {
        // Stored rather than deflated for zip: this store holds whatever people uploaded, which is mostly already
        // compressed, and deflating it would spend a core per download to save nothing. A tgz is gzipped because
        // that is what the extension promises.
        const archive : Archiver = format === 'zip'
            ? new ZipArchive({ store: true })
            : new TarArchive({ gzip: true });

        const out = new PassThrough();
        archive.pipe(out);

        let building = true;

        void this.#fill(archive, directories, files, omissions)
            .then(() => { building = false; })
            .catch((error : unknown) =>
            {
                building = false;

                logger.error({ err: error, userID: actor.id }, 'Archive failed mid-stream');

                archive.abort();
                out.destroy(error instanceof Error ? error : new Error('The archive could not be built.'));
            });

        // Somebody cancelling a download of ten thousand files should stop it reading the eleventh. Without this the
        // fill runs to the end of the selection against a response nobody is listening to.
        out.once('close', () =>
        {
            if(building) { archive.abort(); }
        });

        return out;
    }

    async #fill(
        archive : Archiver,
        directories : readonly string[],
        files : readonly ArchiveFileEntry[],
        omissions : readonly ArchiveOmission[]
    ) : Promise<void>
    {
        const missing : ArchiveOmission[] = [];

        // An explicit directory entry rather than one implied by the files inside it, so a folder holding nothing
        // still appears and the archive mirrors the tree rather than the subset of it that had content.
        for(const path of directories)
        {
            archive.append(Buffer.alloc(0), { name: path, type: 'directory' });
        }

        for(const entry of files)
        {
            // eslint-disable-next-line no-await-in-loop -- serial by intent: one blob stream open at a time
            const opened = await this.#open(entry);

            if(opened === null)
            {
                missing.push({ path: entry.path, reason: 'its stored content is missing' });
            }
            else
            {
                archive.append(opened, { name: entry.path });

                // eslint-disable-next-line no-await-in-loop -- the backpressure this loop exists for
                await once(archive, 'entry');
            }
        }

        const reported = [ ...omissions, ...missing ];
        if(reported.length > 0)
        {
            archive.append(manifestText(reported), { name: ARCHIVE_SKIPPED_MANIFEST });
        }

        await archive.finalize();
    }

    // The bytes behind one entry, or null when the store no longer has them -- a blob collected between the walk and
    // the read. That is a line in the manifest, not a failed download of everything else.
    async #open(entry : ArchiveFileEntry) : Promise<Readable | null>
    {
        const blob = await this.#blob.get(entry.blobID);
        if(blob === undefined) { return null; }

        try
        {
            return await this.#blob.getStream({ backendID: blob.backendID, storageKey: blob.storageKey });
        }
        catch(error)
        {
            if(error instanceof BlobNotFoundError) { return null; }
            throw error;
        }
    }
}

//----------------------------------------------------------------------------------------------------------------------
