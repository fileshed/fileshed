//----------------------------------------------------------------------------------------------------------------------
// Link Section — list live links, create one, copy either form of it, revoke
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
        url: '/d/tok123',
        createdAt: ISO,
        revokedAt: null,
        ...overrides,
    };
}

const STUBS = {
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

function offersCreate(wrapper : VueWrapper) : boolean
{
    return wrapper.findAll('.ubtn').some((candidate) => candidate.text() === 'Create link');
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

    // One button, because there is one kind of link. Choosing between rendering and saving happens when the URL is
    // handed out, not when the token is minted.
    it('creates a link with nothing to choose', async () =>
    {
        const wrapper = mountSection();
        await flushPromises();

        await clickButton(wrapper, 'Create link');
        await flushPromises();

        expect(createLinkMock).toHaveBeenCalledWith('f1');
        expect(wrapper.findAll('.ubtn').filter((button) => button.text().startsWith('Create'))).toHaveLength(1);
    });

    // A second token would grant exactly what the first one already grants, so once a file has a live link there is
    // nothing left to offer.
    it('stops offering to create once the file has a live link', async () =>
    {
        listLinksMock.mockResolvedValue({ links: [ link() ] });
        const wrapper = mountSection();
        await flushPromises();

        expect(offersCreate(wrapper)).toBe(false);
    });

    it('offers to create again once the last live link is revoked', async () =>
    {
        listLinksMock.mockResolvedValueOnce({ links: [ link() ] }).mockResolvedValue({ links: [] });
        const wrapper = mountSection();
        await flushPromises();
        expect(offersCreate(wrapper)).toBe(false);

        await wrapper.find('[aria-label="Revoke link"]').trigger('click');
        await flushPromises();

        expect(offersCreate(wrapper)).toBe(true);
    });

    // The API may mint more links than this dialog offers to, so the listing shows what is there rather than
    // assuming the one it would have created.
    it('lists every live link the API reports, not just one', async () =>
    {
        listLinksMock.mockResolvedValue({
            links: [ link({ id: 'a', token: 'aaa', url: '/d/aaa' }), link({ id: 'b', token: 'bbb', url: '/d/bbb' }) ],
        });
        const wrapper = mountSection();
        await flushPromises();

        expect(wrapper.text()).toContain('/d/aaa');
        expect(wrapper.text()).toContain('/d/bbb');
        expect(wrapper.findAll('[aria-label="Revoke link"]')).toHaveLength(2);
    });

    it('copies the link\'s absolute URL to the clipboard and toasts', async () =>
    {
        listLinksMock.mockResolvedValue({ links: [ link() ] });
        const wrapper = mountSection();
        await flushPromises();

        await wrapper.find('[aria-label="Copy link"]').trigger('click');
        await flushPromises();

        expect(writeText).toHaveBeenCalledWith(`${ window.location.origin }/d/tok123`);
        expect(toastAdd).toHaveBeenCalledWith(expect.objectContaining({ color: 'success' }));
    });

    // The same row hands out the same token either way; the download form is the URL plus the flag that makes a
    // recipient's browser save it.
    it('copies the download form of the very same link', async () =>
    {
        listLinksMock.mockResolvedValue({ links: [ link() ] });
        const wrapper = mountSection();
        await flushPromises();

        await wrapper.find('[aria-label="Copy download link"]').trigger('click');
        await flushPromises();

        expect(writeText).toHaveBeenCalledWith(`${ window.location.origin }/d/tok123?download`);
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
