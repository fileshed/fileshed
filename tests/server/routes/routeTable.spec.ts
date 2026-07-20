//----------------------------------------------------------------------------------------------------------------------
// App Route Table
//
// The composed app's full wire surface, pinned. Route files own their full paths and every feature router mounts at
// /api, so nothing structural stops two files claiming the same method+path -- this spec is that backstop, and its
// expected table is the reviewable URL map: adding, moving, or removing a route must show up in this diff.
//----------------------------------------------------------------------------------------------------------------------

import { afterAll, describe, expect, it } from 'vitest';

// Resource Access
import { BlobRA } from '@server/resource-access/blob/index.ts';
import { NodeRA } from '@server/resource-access/nodes/node.ts';
import { PublicLinkRA } from '@server/resource-access/publicLinks/index.ts';
import { ShareRA } from '@server/resource-access/shares/index.ts';
import { createAuth } from '@server/resource-access/auth.ts';
import { createDatabase } from '@server/resource-access/database/database.ts';

// Managers
import { BlobManager } from '@server/managers/blob.ts';
import { NodeManager } from '@server/managers/node.ts';
import { PublicLinkManager } from '@server/managers/publicLink.ts';
import { ShareManager } from '@server/managers/share.ts';

// App
import { createApp } from '@server/app.ts';

// Support
import { testConfig } from '../auth/support.ts';

//----------------------------------------------------------------------------------------------------------------------

const EXPECTED_ROUTES = [
    // Auth (better-auth's delegated subtree)
    'GET /api/auth/*',
    'POST /api/auth/*',

    // Admin
    'GET /api/admin/users',

    // Health
    'GET /api/health',

    // Blobs (claim / proof-of-possession)
    'POST /api/blobs/claim',
    'POST /api/blobs/claim/:challengeID',

    // Uploads
    'PUT /api/uploads/:ticket',

    // Me
    'GET /api/me',

    // Nodes
    'GET /api/nodes/children',
    'GET /api/nodes/:id/children',
    'GET /api/nodes/:id',
    'POST /api/nodes',
    'PATCH /api/nodes/:id',
    'POST /api/nodes/:id/trash',
    'POST /api/nodes/:id/restore',
    'DELETE /api/nodes/:id',

    // Shares
    'POST /api/nodes/:id/shares',
    'GET /api/nodes/:id/shares',
    'GET /api/shared-with-me',
    'POST /api/shares/:id/leave',
    'DELETE /api/shares/:id',

    // Access requests
    'POST /api/nodes/:id/access-requests',
    'GET /api/access-requests',
    'POST /api/access-requests/:id/grant',
    'POST /api/access-requests/:id/decline',

    // Downloads (authenticated)
    'GET /api/nodes/:id/download',

    // Public links (management)
    'POST /api/nodes/:id/links',
    'GET /api/nodes/:id/links',
    'DELETE /api/links/:id',

    // Direct serving (anonymous, deliberately outside /api)
    'GET /d/:token',
];

//----------------------------------------------------------------------------------------------------------------------

// Route registration is pure composition -- no request is ever served, so the database never needs migrating and the
// storage root is never touched.
const config = testConfig();
const handle = createDatabase(config);
const auth = createAuth(handle, config);

const blob = new BlobRA(handle);
const nodeRA = new NodeRA(handle);
const shareRA = new ShareRA(handle);

const app = createApp(auth, {
    blobs: new BlobManager({ handle, blob, uploadMaxBytes: config.UPLOAD_MAX_BYTES }),
    nodes: new NodeManager(handle, nodeRA, blob),
    shares: new ShareManager(handle, nodeRA, shareRA),
    publicLinks: new PublicLinkManager(nodeRA, blob, new PublicLinkRA(handle), (userID, nodeID) =>
        shareRA.effectiveRole(userID, nodeID)),
});

afterAll(async () =>
{
    await handle.db.destroy();
});

//----------------------------------------------------------------------------------------------------------------------

describe('createApp route table', () =>
{
    // Exact equality catches every failure mode at once: a missing route, an unexpected one, and two routers
    // registering the same method+path (the duplicate appears twice on the actual side).
    it('registers exactly the declared wire surface', () =>
    {
        const actual = app.routes
            .filter((route) => route.method !== 'ALL')
            .map((route) => `${ route.method } ${ route.path }`);

        expect([ ...actual ].sort()).toEqual([ ...EXPECTED_ROUTES ].sort());
    });
});

//----------------------------------------------------------------------------------------------------------------------
