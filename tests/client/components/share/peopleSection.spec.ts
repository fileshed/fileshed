//----------------------------------------------------------------------------------------------------------------------
// People Section — resolve-before-grant, grant, in-place role change, revoke
//----------------------------------------------------------------------------------------------------------------------

import { type Mock, beforeEach, describe, expect, it, vi } from 'vitest';
import { type VueWrapper, flushPromises, mount } from '@vue/test-utils';

import type {
    AccessRequestListEntry,
    AccessRequestResponse,
    NodeResponse,
    ShareListEntry,
    ShareRole,
    UserSummary,
} from '@fileshed/core';

// Resource Access
import { ApiError } from '@client/resource-access/apiError.ts';
import { grantShare, listSharesForNode, revokeShare } from '@client/resource-access/shares.ts';
import {
    declineAccessRequest,
    grantAccessRequest,
    listAccessRequests,
} from '@client/resource-access/accessRequests.ts';
import { lookupUser } from '@client/resource-access/users.ts';

// Under test
import PeopleSection from '@client/components/share/peopleSection.vue';

//----------------------------------------------------------------------------------------------------------------------

const toastAdd = vi.hoisted(() => vi.fn());

vi.mock('@client/resource-access/shares.ts', () => ({
    grantShare: vi.fn(),
    listSharesForNode: vi.fn(),
    revokeShare: vi.fn(),
}));
vi.mock('@client/resource-access/accessRequests.ts', () => ({
    listAccessRequests: vi.fn(),
    grantAccessRequest: vi.fn(),
    declineAccessRequest: vi.fn(),
}));
vi.mock('@client/resource-access/users.ts', () => ({ lookupUser: vi.fn() }));
vi.mock('@nuxt/ui/composables', () => ({ useToast: () => ({ add: toastAdd }) }));

const grantShareMock = grantShare as unknown as Mock;
const listSharesMock = listSharesForNode as unknown as Mock;
const revokeShareMock = revokeShare as unknown as Mock;
const listRequestsMock = listAccessRequests as unknown as Mock;
const grantRequestMock = grantAccessRequest as unknown as Mock;
const declineRequestMock = declineAccessRequest as unknown as Mock;
const lookupUserMock = lookupUser as unknown as Mock;

//----------------------------------------------------------------------------------------------------------------------

const ISO = '2026-07-01T00:00:00.000Z';

const OWNER : UserSummary = { id: 'owner1', name: 'Owner One', email: 'owner@example.com', image: null };
const GRACE : UserSummary = { id: 'u2', name: 'Grace Hopper', email: 'grace@example.com', image: null };

function accessRequest(
    role : ShareRole,
    nodeID = 'f1',
    requesterID = 'u2',
    id = 'req1',
    message : string | null = null
) : AccessRequestResponse
{
    return {
        id, nodeID, requesterID, requestedRole: role, message, status: 'pending', createdAt: ISO, resolvedAt: null,
    };
}

// The incoming envelope pairs each pending request with its requester's summary, exactly as the server sends it --
// the pending-requests row never falls back to a raw id because the summary always rides with the request.
function incomingRequest(
    role : ShareRole,
    nodeID = 'f1',
    requester : UserSummary = GRACE,
    id = 'req1',
    message : string | null = null
) : AccessRequestListEntry
{
    return { request: accessRequest(role, nodeID, requester.id, id, message), requester };
}

function fileNode() : NodeResponse
{
    return {
        sharing: null,
        id: 'f1',
        name: 'report.txt',
        ownerID: 'owner1',
        parentID: null,
        createdAt: ISO,
        updatedAt: ISO,
        role: 'owner',
        type: 'file',
        blobID: 'b1',
        size: 100,
        mimeType: 'text/plain',
        trashedAt: null,
    };
}

// Each row of a shares-list response pairs the grant with its grantee's summary, exactly as the server sends it --
// the display never falls back to a placeholder because the summary always rides with the grant.
function shareEntry(role : 'viewer' | 'editor', grantee : UserSummary = GRACE) : ShareListEntry
{
    return {
        share: { id: 's1', nodeID: 'f1', granteeUserID: grantee.id, role, createdBy: 'owner1', createdAt: ISO },
        grantee,
    };
}

// UInput/UButton/USelect/UAvatar reduced to plain elements: v-model round-trips through native events, buttons carry
// their label as text and pass aria-label/disabled through, and the select emits update:model-value on change.
const STUBS = {
    UInput: {
        props: [ 'modelValue' ],
        emits: [ 'update:modelValue' ],
        template: '<input class="email-input" :value="modelValue" '
            + '@input="$emit(\'update:modelValue\', $event.target.value)" />',
    },
    UButton: {
        props: [ 'label', 'loading', 'disabled' ],
        template: '<button class="ubtn" :disabled="disabled" @click="$emit(\'click\')">{{ label }}</button>',
    },
    USelect: {
        props: [ 'modelValue', 'items' ],
        emits: [ 'update:modelValue' ],
        template: '<select class="role-select" :value="modelValue" '
            + '@change="$emit(\'update:modelValue\', $event.target.value)">'
            + '<option v-for="item in items" :key="item.value" :value="item.value">{{ item.label }}</option></select>',
    },
    UAvatar: { props: [ 'src', 'alt', 'icon' ], template: '<span class="avatar" :data-alt="alt" />' },
    UBadge: { template: '<span class="badge"><slot /></span>' },
    UTooltip: { template: '<div><slot /></div>' },
};

function mountSection(owner : UserSummary | null = OWNER) : VueWrapper
{
    return mount(PeopleSection, {
        props: { node: fileNode(), owner },
        global: { stubs: STUBS },
    });
}

function clickButton(wrapper : VueWrapper, label : string) : Promise<void>
{
    const button = wrapper.findAll('.ubtn').find((candidate) => candidate.text() === label);

    return button ? button.trigger('click') : Promise.resolve();
}

//----------------------------------------------------------------------------------------------------------------------

describe('PeopleSection', () =>
{
    beforeEach(() =>
    {
        vi.clearAllMocks();
        listSharesMock.mockResolvedValue({ shares: [] });
        listRequestsMock.mockResolvedValue({ incoming: [], outgoing: [] });
        grantShareMock.mockResolvedValue(shareEntry('viewer').share);
        grantRequestMock.mockResolvedValue(accessRequest('viewer'));
        declineRequestMock.mockResolvedValue(accessRequest('viewer'));
        revokeShareMock.mockResolvedValue(undefined);
    });

    it('renders a grantee\'s real name and email straight from the shares-list summary', async () =>
    {
        listSharesMock.mockResolvedValue({ shares: [ shareEntry('editor') ] });
        const wrapper = mountSection();
        await flushPromises();

        expect(wrapper.text()).toContain('Grace Hopper');
        expect(wrapper.text()).toContain('grace@example.com');
    });

    it('resolves an entered email to a real user and shows them before any grant', async () =>
    {
        lookupUserMock.mockResolvedValue(GRACE);
        const wrapper = mountSection();
        await flushPromises();

        await wrapper.find('.email-input').setValue('grace@example.com');
        await clickButton(wrapper, 'Look up');
        await flushPromises();

        expect(lookupUserMock).toHaveBeenCalledWith('grace@example.com');
        expect(wrapper.text()).toContain('Grace Hopper');
        // Resolving is not granting: nothing is written until the sharer confirms.
        expect(grantShareMock).not.toHaveBeenCalled();
    });

    it('shows an inline "no user" message when the email matches no account', async () =>
    {
        lookupUserMock.mockRejectedValue(new ApiError(404, 'No user with that email.'));
        const wrapper = mountSection();
        await flushPromises();

        await wrapper.find('.email-input').setValue('nobody@example.com');
        await clickButton(wrapper, 'Look up');
        await flushPromises();

        expect(wrapper.text()).toContain('No user with that email.');
        expect(grantShareMock).not.toHaveBeenCalled();
    });

    it('grants the resolved user at the selected role', async () =>
    {
        lookupUserMock.mockResolvedValue(GRACE);
        const wrapper = mountSection();
        await flushPromises();

        await wrapper.find('.email-input').setValue('grace@example.com');
        await clickButton(wrapper, 'Look up');
        await flushPromises();

        await clickButton(wrapper, 'Share');
        await flushPromises();

        expect(grantShareMock).toHaveBeenCalledWith('f1', { granteeUserID: 'u2', role: 'viewer' });
    });

    it('changes an existing grant\'s role in place via a re-grant', async () =>
    {
        listSharesMock.mockResolvedValue({ shares: [ shareEntry('viewer') ] });
        const wrapper = mountSection();
        await flushPromises();

        await wrapper.find('.role-select').setValue('editor');
        await flushPromises();

        expect(grantShareMock).toHaveBeenCalledWith('f1', { granteeUserID: 'u2', role: 'editor' });
    });

    it('revokes a grant', async () =>
    {
        listSharesMock.mockResolvedValue({ shares: [ shareEntry('viewer') ] });
        const wrapper = mountSection();
        await flushPromises();

        await wrapper.find('[aria-label="Remove access"]').trigger('click');
        await flushPromises();

        expect(revokeShareMock).toHaveBeenCalledWith('s1');
    });

    it('shows the owner and offers no revoke against them', async () =>
    {
        listSharesMock.mockResolvedValue({ shares: [] });
        const wrapper = mountSection();
        await flushPromises();

        expect(wrapper.text()).toContain('Owner One');
        expect(wrapper.text()).toContain('Owner');
        expect(wrapper.find('[aria-label="Remove access"]').exists()).toBe(false);
    });

    it('hides the pending-requests group when no one has asked', async () =>
    {
        const wrapper = mountSection();
        await flushPromises();

        expect(wrapper.text()).not.toContain('Pending requests');
    });

    it('surfaces a pending request for this node with the requester\'s summary and requested role', async () =>
    {
        listRequestsMock.mockResolvedValue({ incoming: [ incomingRequest('editor', 'f1', GRACE) ], outgoing: [] });
        const wrapper = mountSection();
        await flushPromises();

        expect(wrapper.text()).toContain('Pending requests');
        // The requester's real name and email, straight from the enrichment -- never their raw id.
        expect(wrapper.text()).toContain('Grace Hopper');
        expect(wrapper.text()).toContain('grace@example.com');
        expect(wrapper.text()).toContain('editor');
    });

    it('shows the requester\'s message as quoted text when the request carries one', async () =>
    {
        listRequestsMock.mockResolvedValue({
            incoming: [ incomingRequest('viewer', 'f1', GRACE, 'req1', 'Could I get viewer access please?') ],
            outgoing: [],
        });
        const wrapper = mountSection();
        await flushPromises();

        expect(wrapper.text()).toContain('Could I get viewer access please?');
    });

    it('shows no message line when the request carries none', async () =>
    {
        listRequestsMock.mockResolvedValue({ incoming: [ incomingRequest('viewer') ], outgoing: [] });
        const wrapper = mountSection();
        await flushPromises();

        expect(wrapper.find('.italic').exists()).toBe(false);
    });

    it('does not surface a request that targets a different node', async () =>
    {
        listRequestsMock.mockResolvedValue({ incoming: [ incomingRequest('viewer', 'other-node') ], outgoing: [] });
        const wrapper = mountSection();
        await flushPromises();

        expect(wrapper.text()).not.toContain('Pending requests');
    });

    it('approves a request, minting the grant and dropping the pending row', async () =>
    {
        listRequestsMock.mockResolvedValueOnce({ incoming: [ incomingRequest('viewer') ], outgoing: [] });
        const wrapper = mountSection();
        await flushPromises();
        expect(wrapper.text()).toContain('Pending requests');

        // The refetch after approving carries the newly minted grant and no remaining request.
        listSharesMock.mockResolvedValue({ shares: [ shareEntry('viewer') ] });

        await clickButton(wrapper, 'Approve');
        await flushPromises();

        expect(grantRequestMock).toHaveBeenCalledWith('req1');
        expect(wrapper.text()).toContain('Grace Hopper');
        expect(wrapper.text()).not.toContain('Pending requests');
    });

    it('denies a request, dropping the row without minting any grant', async () =>
    {
        listRequestsMock.mockResolvedValueOnce({ incoming: [ incomingRequest('viewer') ], outgoing: [] });
        const wrapper = mountSection();
        await flushPromises();
        expect(wrapper.text()).toContain('Pending requests');

        await clickButton(wrapper, 'Deny');
        await flushPromises();

        expect(declineRequestMock).toHaveBeenCalledWith('req1');
        expect(grantRequestMock).not.toHaveBeenCalled();
        expect(grantShareMock).not.toHaveBeenCalled();
        expect(wrapper.text()).not.toContain('Pending requests');
    });
});

//----------------------------------------------------------------------------------------------------------------------
