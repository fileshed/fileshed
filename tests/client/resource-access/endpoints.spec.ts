//----------------------------------------------------------------------------------------------------------------------
// Resource Access Endpoint Wiring
//
// One row per exported resource-access function, each asserting the real wire construction: the path it hits, the HTTP
// method, the query-string encoding, and the request body. This is the client's half of the route contract -- a
// wrong path, verb, query key, or body shape fails here rather than at runtime. fetch is the only mocked seam; the
// response is ignored, since request construction is what each row proves (the response contract is the helper's spec).
//----------------------------------------------------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Under test
import {
    copyNode,
    createNode,
    getChildren,
    getNode,
    getTrash,
    hardDeleteNode,
    patchNode,
    purgeBrokenLinks,
    restoreNode,
    trashNode,
} from '@client/resource-access/nodes.ts';
import { search } from '@client/resource-access/search.ts';
import {
    grantShare,
    leaveShare,
    listSharesForNode,
    revokeShare,
    sharedWithMe,
} from '@client/resource-access/shares.ts';
import {
    declineAccessRequest,
    grantAccessRequest,
    listAccessRequests,
    requestAccess,
} from '@client/resource-access/accessRequests.ts';
import {
    acceptDeletionOffer,
    declineDeletionOffer,
    listDeletionOffers,
} from '@client/resource-access/deletionOffers.ts';
import { createPublicLink, listLinksForNode, revokePublicLink } from '@client/resource-access/publicLinks.ts';
import { lookupUser } from '@client/resource-access/users.ts';
import { answerChallenge, claimBlob, uploadTicket } from '@client/resource-access/blobs.ts';
import {
    adminStatus,
    banUser,
    deleteBrandingLogo,
    fetchAdminSettings,
    fetchBranding,
    listUsers,
    patchAdminSettings,
    patchBranding,
    revokeUserSessions,
    sendTestEmail,
    setQuota,
    setUserPassword,
    setUserRole,
    unbanUser,
    uploadBrandingLogo,
} from '@client/resource-access/admin.ts';
import { completeSetup, fetchInstance } from '@client/resource-access/instance.ts';
import { downloadUrl } from '@client/resource-access/downloads.ts';

//----------------------------------------------------------------------------------------------------------------------

const fetchMock = vi.fn();

beforeEach(() =>
{
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
});

afterEach(() =>
{
    vi.unstubAllGlobals();
});

//----------------------------------------------------------------------------------------------------------------------

interface EndpointRow
{
    name : string;
    call : () => Promise<unknown>;
    method : string;
    path : string;
    query ?: Record<string, string>;
    body ?: unknown;
    rawBody ?: BodyInit;
}

const sha256 = 'a'.repeat(64);
const uploadBytes = new Blob([ 'file-bytes' ]);
const logoFile = new File([ 'logo-bytes' ], 'logo.png', { type: 'image/png' });

const rows : EndpointRow[] = [
    // Nodes
    { name: 'getNode', call: () => getNode('n1'), method: 'GET', path: '/api/nodes/n1' },
    {
        name: 'getChildren (root)',
        call: () => getChildren(null, { limit: 50 }),
        method: 'GET',
        path: '/api/nodes/children',
        query: { limit: '50' },
    },
    {
        name: 'getChildren (folder)',
        call: () => getChildren('n1', { sortKey: 'size', sortDirection: 'desc' }),
        method: 'GET',
        path: '/api/nodes/n1/children',
        query: { sortKey: 'size', sortDirection: 'desc' },
    },
    {
        name: 'createNode',
        call: () => createNode({ type: 'folder', name: 'Docs', parentID: null }),
        method: 'POST',
        path: '/api/nodes',
        body: { type: 'folder', name: 'Docs', parentID: null },
    },
    {
        name: 'patchNode',
        call: () => patchNode('n1', { name: 'renamed' }),
        method: 'PATCH',
        path: '/api/nodes/n1',
        body: { name: 'renamed' },
    },
    {
        name: 'getTrash',
        call: () => getTrash({ limit: 50, sortKey: 'name', sortDirection: 'asc' }),
        method: 'GET',
        path: '/api/trash',
        query: { limit: '50', sortKey: 'name', sortDirection: 'asc' },
    },
    {
        name: 'getTrash (filtered)',
        call: () => getTrash({ limit: 50, types: [ 'images', 'pdfs' ], updatedAfter: '2026-02-01T00:00:00.000Z' }),
        method: 'GET',
        path: '/api/trash',
        query: { limit: '50', types: 'images,pdfs', updatedAfter: '2026-02-01T00:00:00.000Z' },
    },
    { name: 'trashNode', call: () => trashNode('n1'), method: 'POST', path: '/api/nodes/n1/trash' },
    { name: 'restoreNode', call: () => restoreNode('n1'), method: 'POST', path: '/api/nodes/n1/restore' },
    {
        name: 'copyNode',
        call: () => copyNode('n1', { parentID: 'n2' }),
        method: 'POST',
        path: '/api/nodes/n1/copy',
        body: { parentID: 'n2' },
    },
    {
        name: 'purgeBrokenLinks',
        call: () => purgeBrokenLinks('n1'),
        method: 'POST',
        path: '/api/nodes/n1/purge-broken-links',
    },
    {
        name: 'hardDeleteNode (offerCopies)',
        call: () => hardDeleteNode('n1', true),
        method: 'DELETE',
        path: '/api/nodes/n1',
        query: { offerCopies: 'true' },
    },
    {
        name: 'hardDeleteNode (default)',
        call: () => hardDeleteNode('n1'),
        method: 'DELETE',
        path: '/api/nodes/n1',
        query: { offerCopies: 'false' },
    },

    // Search
    {
        name: 'search',
        call: () => search('report', { limit: 10, offset: 20 }),
        method: 'GET',
        path: '/api/search',
        query: { q: 'report', limit: '10', offset: '20' },
    },

    // Shares
    {
        name: 'grantShare',
        call: () => grantShare('n1', { granteeUserID: 'u2', role: 'viewer' }),
        method: 'POST',
        path: '/api/nodes/n1/shares',
        body: { granteeUserID: 'u2', role: 'viewer' },
    },
    { name: 'listSharesForNode', call: () => listSharesForNode('n1'), method: 'GET', path: '/api/nodes/n1/shares' },
    {
        name: 'lookupUser',
        call: () => lookupUser('grace@example.com'),
        method: 'GET',
        path: '/api/users/lookup',
        query: { email: 'grace@example.com' },
    },
    { name: 'sharedWithMe', call: () => sharedWithMe(), method: 'GET', path: '/api/shared-with-me' },
    {
        name: 'sharedWithMe (filtered)',
        call: () => sharedWithMe({ types: [ 'images' ], updatedBefore: '2026-03-01T00:00:00.000Z' }),
        method: 'GET',
        path: '/api/shared-with-me',
        query: { types: 'images', updatedBefore: '2026-03-01T00:00:00.000Z' },
    },
    { name: 'leaveShare', call: () => leaveShare('s1'), method: 'POST', path: '/api/shares/s1/leave' },
    { name: 'revokeShare', call: () => revokeShare('s1'), method: 'DELETE', path: '/api/shares/s1' },

    // Access requests
    {
        name: 'requestAccess',
        call: () => requestAccess('n1', { requestedRole: 'editor' }),
        method: 'POST',
        path: '/api/nodes/n1/access-requests',
        body: { requestedRole: 'editor' },
    },
    { name: 'listAccessRequests', call: () => listAccessRequests(), method: 'GET', path: '/api/access-requests' },
    {
        name: 'grantAccessRequest',
        call: () => grantAccessRequest('r1'),
        method: 'POST',
        path: '/api/access-requests/r1/grant',
    },
    {
        name: 'declineAccessRequest',
        call: () => declineAccessRequest('r1'),
        method: 'POST',
        path: '/api/access-requests/r1/decline',
    },

    // Deletion offers
    { name: 'listDeletionOffers', call: () => listDeletionOffers(), method: 'GET', path: '/api/deletion-offers' },
    {
        name: 'acceptDeletionOffer',
        call: () => acceptDeletionOffer('o1', { parentID: null }),
        method: 'POST',
        path: '/api/deletion-offers/o1/accept',
        body: { parentID: null },
    },
    {
        name: 'declineDeletionOffer',
        call: () => declineDeletionOffer('o1'),
        method: 'POST',
        path: '/api/deletion-offers/o1/decline',
    },

    // Public links
    {
        name: 'createPublicLink',
        call: () => createPublicLink('n1', { mode: 'download', disposition: 'attachment' }),
        method: 'POST',
        path: '/api/nodes/n1/links',
        body: { mode: 'download', disposition: 'attachment' },
    },
    { name: 'listLinksForNode', call: () => listLinksForNode('n1'), method: 'GET', path: '/api/nodes/n1/links' },
    { name: 'revokePublicLink', call: () => revokePublicLink('l1'), method: 'DELETE', path: '/api/links/l1' },

    // Blobs
    {
        name: 'claimBlob',
        call: () => claimBlob({ sha256, size: 10 }),
        method: 'POST',
        path: '/api/blobs/claim',
        body: { sha256, size: 10 },
    },
    {
        name: 'answerChallenge',
        call: () => answerChallenge('c1', { answer: 'x', name: 'f.txt', parentID: null, mimeType: 'text/plain' }),
        method: 'POST',
        path: '/api/blobs/claim/c1',
        body: { answer: 'x', name: 'f.txt', parentID: null, mimeType: 'text/plain' },
    },
    {
        name: 'uploadTicket',
        call: () => uploadTicket('tkt', uploadBytes, { name: 'f.txt', parentID: 'n2', mimeType: 'text/plain' }),
        method: 'PUT',
        path: '/api/uploads/tkt',
        query: { name: 'f.txt', parentID: 'n2', mimeType: 'text/plain' },
        rawBody: uploadBytes,
    },

    // Admin
    {
        name: 'listUsers',
        call: () => listUsers({ limit: 25, offset: 0 }),
        method: 'GET',
        path: '/api/admin/users',
        query: { limit: '25', offset: '0' },
    },
    {
        name: 'listUsers (search + sort)',
        call: () => listUsers({ search: 'ada', searchField: 'name', sortBy: 'email', sortDirection: 'desc' }),
        method: 'GET',
        path: '/api/admin/users',
        query: { search: 'ada', searchField: 'name', sortBy: 'email', sortDirection: 'desc' },
    },
    {
        name: 'banUser',
        call: () => banUser('u1', { reason: 'Spamming', expiresInDays: 7 }),
        method: 'POST',
        path: '/api/admin/users/u1/ban',
        body: { reason: 'Spamming', expiresInDays: 7 },
    },
    { name: 'unbanUser', call: () => unbanUser('u1'), method: 'POST', path: '/api/admin/users/u1/unban' },
    {
        name: 'setUserRole',
        call: () => setUserRole('u1', 'admin'),
        method: 'POST',
        path: '/api/admin/users/u1/role',
        body: { role: 'admin' },
    },
    {
        name: 'setUserPassword',
        call: () => setUserPassword('u1', 'a-brand-new-password'),
        method: 'POST',
        path: '/api/admin/users/u1/password',
        body: { password: 'a-brand-new-password' },
    },
    {
        name: 'revokeUserSessions',
        call: () => revokeUserSessions('u1'),
        method: 'POST',
        path: '/api/admin/users/u1/revoke-sessions',
    },
    {
        name: 'setQuota (limit)',
        call: () => setQuota('u1', 1000),
        method: 'PATCH',
        path: '/api/admin/users/u1',
        body: { quotaLimit: 1000 },
    },
    {
        name: 'setQuota (unlimited)',
        call: () => setQuota('u1', null),
        method: 'PATCH',
        path: '/api/admin/users/u1',
        body: { quotaLimit: null },
    },
    { name: 'adminStatus', call: () => adminStatus(), method: 'GET', path: '/api/admin/status' },
    { name: 'sendTestEmail', call: () => sendTestEmail(), method: 'POST', path: '/api/admin/email/test' },
    { name: 'fetchAdminSettings', call: () => fetchAdminSettings(), method: 'GET', path: '/api/admin/settings' },
    {
        name: 'patchAdminSettings',
        call: () => patchAdminSettings({ SIGN_UP_ENABLED: false }),
        method: 'PATCH',
        path: '/api/admin/settings',
        body: { changes: { SIGN_UP_ENABLED: false } },
    },
    { name: 'fetchBranding', call: () => fetchBranding(), method: 'GET', path: '/api/admin/branding' },
    {
        name: 'patchBranding',
        call: () => patchBranding({ primary: '#3b82f6' }),
        method: 'PATCH',
        path: '/api/admin/branding',
        body: { primary: '#3b82f6' },
    },
    {
        name: 'uploadBrandingLogo',
        call: () => uploadBrandingLogo(logoFile),
        method: 'POST',
        path: '/api/admin/branding/logo',
        rawBody: logoFile,
    },
    {
        name: 'deleteBrandingLogo',
        call: () => deleteBrandingLogo(),
        method: 'DELETE',
        path: '/api/admin/branding/logo',
    },

    // Instance & first-run setup
    { name: 'fetchInstance', call: () => fetchInstance(), method: 'GET', path: '/api/instance' },
    {
        name: 'completeSetup',
        call: () => completeSetup({ token: 'tok', name: 'Admin', email: 'a@example.com', password: 'pw12345678' }),
        method: 'POST',
        path: '/api/setup',
        body: { token: 'tok', name: 'Admin', email: 'a@example.com', password: 'pw12345678' },
    },
];

//----------------------------------------------------------------------------------------------------------------------

describe('resource-access endpoint wiring', () =>
{
    for(const row of rows)
    {
        it(`${ row.name } issues ${ row.method } ${ row.path }`, async () =>
        {
            await row.call().catch(() => undefined);

            expect(fetchMock).toHaveBeenCalledTimes(1);
            const [ url, init ] = fetchMock.mock.calls[0] as [ string, RequestInit ];
            const parsed = new URL(url, 'http://localhost');

            expect(init.method).toBe(row.method);
            expect(parsed.pathname).toBe(row.path);
            expect(Object.fromEntries(parsed.searchParams)).toEqual(row.query ?? {});
            expect(init.credentials).toBe('include');

            if(row.rawBody !== undefined)
            {
                expect(init.body).toBe(row.rawBody);
            }
            else if(row.body !== undefined)
            {
                expect(JSON.parse(init.body as string)).toEqual(row.body);
            }
            else
            {
                expect(init.body).toBeUndefined();
            }
        });
    }
});

//----------------------------------------------------------------------------------------------------------------------

describe('downloadUrl', () =>
{
    it('builds the authed download path with no query when disposition is omitted', () =>
    {
        expect(downloadUrl('n1')).toBe('/api/nodes/n1/download');
    });

    it('appends the disposition when one is given', () =>
    {
        expect(downloadUrl('n1', 'inline')).toBe('/api/nodes/n1/download?disposition=inline');
        expect(downloadUrl('n1', 'attachment')).toBe('/api/nodes/n1/download?disposition=attachment');
    });
});

//----------------------------------------------------------------------------------------------------------------------
