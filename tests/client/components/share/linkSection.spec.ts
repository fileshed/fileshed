//----------------------------------------------------------------------------------------------------------------------
// Link Section — list live links, create view/download links, copy, revoke
//----------------------------------------------------------------------------------------------------------------------

import { type Mock, beforeEach, describe, expect, it, vi } from 'vitest';
import { type VueWrapper, flushPromises, mount } from '@vue/test-utils';

import type { NodeResponse, PublicLinkResponse } from '@fileshed/core';

// Resource Access
import { createPublicLink, listLinksForNode, revokePublicLink } from '@client/resource-access/publicLinks.ts';

// Under test
import LinkSection from '@client/components/share/linkSection.vue';

//----------------------------------------------------------------------------------------------------------------------

const toastAdd = vi.hoisted(() => vi.fn());

vi.mock('@client/resource-access/publicLinks.ts', () => ({
    createPublicLink: vi.fn(),
    listLinksForNode: vi.fn(),
    revokePublicLink: vi.fn(),
}));
vi.mock('@nuxt/ui/composables', () => ({ useToast: () => ({ add: toastAdd }) }));

const createLinkMock = createPublicLink as unknown as Mock;
const listLinksMock = listLinksForNode as unknown as Mock;
const revokeLinkMock = revokePublicLink as unknown as Mock;

const writeText = vi.fn().mockResolvedValue(undefined);

//----------------------------------------------------------------------------------------------------------------------

const ISO = '2026-07-01T00:00:00.000Z';

function fileNode() : NodeResponse
{
    return {
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

function link(overrides : Partial<PublicLinkResponse> = {}) : PublicLinkResponse
{
    return {
        id: 'l1',
        nodeID: 'f1',
        token: 'tok123',
        mode: 'view',
        disposition: 'inline',
        url: '/d/tok123',
        createdAt: ISO,
        revokedAt: null,
        ...overrides,
    };
}

const STUBS = {
    UBadge: { props: [ 'label' ], template: '<span class="badge">{{ label }}</span>' },
    UButton: {
        props: [ 'label', 'loading' ],
        template: '<button class="ubtn" @click="$emit(\'click\')">{{ label }}</button>',
    },
    UTooltip: { template: '<div><slot /></div>' },
};

function mountSection() : VueWrapper
{
    return mount(LinkSection, { props: { node: fileNode() }, global: { stubs: STUBS } });
}

function clickButton(wrapper : VueWrapper, label : string) : Promise<void>
{
    const button = wrapper.findAll('.ubtn').find((candidate) => candidate.text() === label);

    return button ? button.trigger('click') : Promise.resolve();
}

//----------------------------------------------------------------------------------------------------------------------

describe('LinkSection', () =>
{
    beforeEach(() =>
    {
        vi.clearAllMocks();
        listLinksMock.mockResolvedValue({ links: [] });
        createLinkMock.mockResolvedValue(link());
        revokeLinkMock.mockResolvedValue(undefined);
        Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    });

    it('lists only live links, dropping any that are revoked', async () =>
    {
        listLinksMock.mockResolvedValue({
            links: [
                link({ id: 'live', token: 'aaa', url: '/d/aaa' }),
                link({ id: 'dead', token: 'bbb', url: '/d/bbb', revokedAt: ISO }),
            ],
        });
        const wrapper = mountSection();
        await flushPromises();

        expect(wrapper.text()).toContain('/d/aaa');
        expect(wrapper.text()).not.toContain('/d/bbb');
    });

    it('creates an inline view link', async () =>
    {
        const wrapper = mountSection();
        await flushPromises();

        await clickButton(wrapper, 'Create view link');
        await flushPromises();

        expect(createLinkMock).toHaveBeenCalledWith('f1', { mode: 'view', disposition: 'inline' });
    });

    it('creates an attachment download link', async () =>
    {
        const wrapper = mountSection();
        await flushPromises();

        await clickButton(wrapper, 'Create download link');
        await flushPromises();

        expect(createLinkMock).toHaveBeenCalledWith('f1', { mode: 'download', disposition: 'attachment' });
    });

    it('copies the link\'s absolute URL to the clipboard and toasts', async () =>
    {
        listLinksMock.mockResolvedValue({ links: [ link() ] });
        const wrapper = mountSection();
        await flushPromises();

        await wrapper.find('[aria-label="Copy link"]').trigger('click');
        await flushPromises();

        expect(writeText).toHaveBeenCalledWith(expect.stringContaining('/d/tok123'));
        expect(toastAdd).toHaveBeenCalledWith(expect.objectContaining({ color: 'success' }));
    });

    it('revokes a link', async () =>
    {
        listLinksMock.mockResolvedValue({ links: [ link() ] });
        const wrapper = mountSection();
        await flushPromises();

        await wrapper.find('[aria-label="Revoke link"]').trigger('click');
        await flushPromises();

        expect(revokeLinkMock).toHaveBeenCalledWith('l1');
    });
});

//----------------------------------------------------------------------------------------------------------------------
