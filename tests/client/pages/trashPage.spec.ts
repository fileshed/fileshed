//----------------------------------------------------------------------------------------------------------------------
// Trash Page — listing, restore, confirm-before-purge, empty trash, offers
//
// Drives the whole page against real child components (surface, offers section, confirm modals) and the real trash
// store, mocking only the resource-access boundary. The point is the behavior a user sees: trashed items render,
// Restore hits the restore endpoint, Delete forever and Empty trash both purge only after their confirm, the Empty
// trash action disables itself when there is nothing to purge, and the offers section stays hidden until an offer is
// pending.
//----------------------------------------------------------------------------------------------------------------------

import { type Mock, beforeEach, describe, expect, it, vi } from 'vitest';
import { type VueWrapper, flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';

import type { DeletionOfferResponse, MeResponse, NodeListResponse, NodeResponse } from '@fileshed/core';

// Stores
import { useSessionStore } from '@client/stores/session.ts';

// Resource Access
import { emptyTrash, getTrash, hardDeleteNode, restoreNode } from '@client/resource-access/nodes.ts';
import { updatePreferences } from '@client/resource-access/preferences.ts';
import { listDeletionOffers } from '@client/resource-access/deletionOffers.ts';

// Support
import { ME_ID, meFixture } from '../support.ts';

// Under test
import TrashPage from '@client/pages/trashPage.vue';

//----------------------------------------------------------------------------------------------------------------------

vi.mock('@client/resource-access/nodes.ts', () => ({
    getTrash: vi.fn(),
    restoreNode: vi.fn(),
    hardDeleteNode: vi.fn(),
    emptyTrash: vi.fn(),
}));
vi.mock('@client/resource-access/deletionOffers.ts', () => ({
    listDeletionOffers: vi.fn(),
    acceptDeletionOffer: vi.fn(),
    declineDeletionOffer: vi.fn(),
}));
vi.mock('@client/resource-access/preferences.ts', () => ({ updatePreferences: vi.fn() }));
vi.mock('@nuxt/ui/composables', () => ({ useToast: () => ({ add: vi.fn() }) }));

const getTrashMock = getTrash as unknown as Mock;
const restoreMock = restoreNode as unknown as Mock;
const purgeMock = hardDeleteNode as unknown as Mock;
const emptyTrashMock = emptyTrash as unknown as Mock;
const listOffersMock = listDeletionOffers as unknown as Mock;
const updatePreferencesMock = updatePreferences as unknown as Mock;

//----------------------------------------------------------------------------------------------------------------------

const ISO = '2026-07-01T00:00:00.000Z';
const BASE = { ownerID: ME_ID, parentID: null, createdAt: ISO, updatedAt: ISO, role: 'owner' as const };

function fileNode(id : string) : NodeResponse
{
    return { ...BASE, id, name: id, type: 'file', blobID: 'b1', size: 100, mimeType: 'text/plain', trashedAt: ISO };
}

function folderNode(id : string) : NodeResponse
{
    return { ...BASE, id, name: id, type: 'folder', trashedAt: ISO };
}

function page(nodes : NodeResponse[]) : NodeListResponse
{
    return { nodes, total: nodes.length, limit: 50, offset: 0, owners: [] };
}

function offer(id : string, name : string) : DeletionOfferResponse
{
    return {
        id,
        sha256: 'a'.repeat(64),
        name,
        mimeType: 'text/plain',
        size: 64,
        createdBy: 'owner1',
        createdAt: ISO,
        expiresAt: '2026-07-28T00:00:00.000Z',
    };
}

const STUBS = {
    UButton: {
        props: [ 'label' ],
        template: '<button class="ubtn" :aria-label="$attrs[\'aria-label\']" @click="$emit(\'click\')">'
            + '{{ label }}</button>',
    },
    UFieldGroup: { template: '<div><slot /></div>' },
    // The filter row is its own unit with its own spec; here it is inert chrome so the page's toggle and listing stay
    // the subject.
    FilterRow: { name: 'FilterRow', template: '<div class="filter-row" />' },
    UIcon: true,
    // Renders the body slot only while open, mirroring a real modal -- so the confirm button is absent until the page
    // opens the dialog.
    UModal: {
        props: [ 'open' ],
        template: '<div v-if="open" class="modal"><slot name="body" /></div>',
    },
};

async function mountTrash(
    nodes : NodeResponse[],
    offers : DeletionOfferResponse[] = [],
    me : MeResponse | null = null
) : Promise<VueWrapper>
{
    getTrashMock.mockResolvedValue(page(nodes));
    listOffersMock.mockResolvedValue({ offers });

    const pinia = createPinia();
    setActivePinia(pinia);
    useSessionStore().me = me;

    const wrapper = mount(TrashPage, { global: { plugins: [ pinia ], stubs: STUBS } });
    await flushPromises();

    return wrapper;
}

function rowAction(wrapper : VueWrapper, name : string, action : string) : ReturnType<VueWrapper['find']>
{
    return wrapper.get(`[aria-label="${ name }"]`).find(`[aria-label="${ action }"]`);
}

//----------------------------------------------------------------------------------------------------------------------

describe('TrashPage', () =>
{
    beforeEach(() =>
    {
        vi.clearAllMocks();
        restoreMock.mockResolvedValue(undefined);
        purgeMock.mockResolvedValue(undefined);
        emptyTrashMock.mockResolvedValue({ purged: 0 });
    });

    it('lists the caller\'s trashed roots', async () =>
    {
        const wrapper = await mountTrash([ folderNode('project'), fileNode('notes.txt') ]);

        expect(getTrashMock).toHaveBeenCalled();
        expect(wrapper.text()).toContain('project');
        expect(wrapper.text()).toContain('notes.txt');
    });

    it('shows the empty state when there is nothing in the trash', async () =>
    {
        const wrapper = await mountTrash([]);

        expect(wrapper.text()).toContain('Trash is empty');
    });

    it('restores a node through the restore endpoint', async () =>
    {
        const wrapper = await mountTrash([ fileNode('notes.txt') ]);

        await rowAction(wrapper, 'notes.txt', 'Restore').trigger('click');
        await flushPromises();

        expect(restoreMock).toHaveBeenCalledWith('notes.txt');
        expect(purgeMock).not.toHaveBeenCalled();
    });

    it('does not purge on Delete forever until the destructive confirm is accepted', async () =>
    {
        const wrapper = await mountTrash([ fileNode('notes.txt') ]);

        await rowAction(wrapper, 'notes.txt', 'Delete forever').trigger('click');
        await flushPromises();

        // The confirm modal has opened, but nothing is deleted yet.
        expect(purgeMock).not.toHaveBeenCalled();

        await wrapper.get('[aria-label="Confirm delete forever"]').trigger('click');
        await flushPromises();

        expect(purgeMock).toHaveBeenCalledWith('notes.txt');
    });

    it('states the deployment\'s effective retention in days, not a vague period', async () =>
    {
        const wrapper = await mountTrash([], [], meFixture({ limits: { trashRetentionDays: 2 } }));

        expect(wrapper.text()).toContain('permanently deleted after 2 days.');
    });

    it('pluralizes a one-day retention correctly', async () =>
    {
        const wrapper = await mountTrash([], [], meFixture({ limits: { trashRetentionDays: 1 } }));

        expect(wrapper.text()).toContain('permanently deleted after 1 day.');
    });

    it('disables the Empty trash action when there is nothing in the trash', async () =>
    {
        const wrapper = await mountTrash([]);

        expect(wrapper.get('[aria-label="Empty trash"]').attributes('disabled')).toBeDefined();
    });

    it('enables the Empty trash action once the trash holds something', async () =>
    {
        const wrapper = await mountTrash([ fileNode('notes.txt') ]);

        expect(wrapper.get('[aria-label="Empty trash"]').attributes('disabled')).toBeUndefined();
    });

    it('does not empty the trash until the Empty trash confirm is accepted', async () =>
    {
        const wrapper = await mountTrash([ fileNode('notes.txt') ]);

        await wrapper.get('[aria-label="Empty trash"]').trigger('click');
        await flushPromises();

        // The confirm modal has opened, but nothing is purged yet.
        expect(emptyTrashMock).not.toHaveBeenCalled();

        await wrapper.get('[aria-label="Confirm empty trash"]').trigger('click');
        await flushPromises();

        expect(emptyTrashMock).toHaveBeenCalled();
        expect(wrapper.text()).toContain('Trash is empty');
    });

    it('hides the offers section when no deletion offers are pending', async () =>
    {
        const wrapper = await mountTrash([ fileNode('notes.txt') ]);

        expect(wrapper.text()).not.toContain('Offered to you');
    });

    it('surfaces the offers section above the trash when an offer is pending', async () =>
    {
        const wrapper = await mountTrash([ fileNode('notes.txt') ], [ offer('o1', 'shared.txt') ]);

        expect(wrapper.text()).toContain('Offered to you');
        expect(wrapper.text()).toContain('shared.txt');
    });
});

//----------------------------------------------------------------------------------------------------------------------

describe('TrashPage — view toggle', () =>
{
    beforeEach(() =>
    {
        vi.clearAllMocks();
        restoreMock.mockResolvedValue(undefined);
        purgeMock.mockResolvedValue(undefined);
        emptyTrashMock.mockResolvedValue({ purged: 0 });
    });

    it('shows the grid/list view toggle in the header', async () =>
    {
        const wrapper = await mountTrash([]);

        expect(wrapper.find('[aria-label="Grid view"]').exists()).toBe(true);
        expect(wrapper.find('[aria-label="List view"]').exists()).toBe(true);
    });

    // The toggle rides the shared viewMode preference: switching it changes the surface and persists through the
    // preferences endpoint, exactly as the drive's own toggle does.
    it('switches the surface to the list view and persists the choice when List is clicked', async () =>
    {
        updatePreferencesMock.mockResolvedValue(meFixture({ preferences: { viewMode: 'list' } }));
        const wrapper = await mountTrash(
            [ fileNode('notes.txt') ],
            [],
            meFixture({ preferences: { viewMode: 'grid' } })
        );
        const session = useSessionStore();

        // Grid is the seeded preference, so the trashed roots are a wall of cards -- no row list yet.
        expect(wrapper.find('ul').exists()).toBe(false);

        await wrapper.find('[aria-label="List view"]').trigger('click');
        await flushPromises();

        expect(session.viewMode).toBe('list');
        expect(updatePreferencesMock).toHaveBeenCalledWith({ viewMode: 'list' });
        expect(wrapper.find('ul').exists()).toBe(true);
    });

    it('leaves the preference untouched when the already-active mode is clicked', async () =>
    {
        const wrapper = await mountTrash([], [], meFixture({ preferences: { viewMode: 'grid' } }));

        await wrapper.find('[aria-label="Grid view"]').trigger('click');
        await flushPromises();

        expect(updatePreferencesMock).not.toHaveBeenCalled();
    });
});

//----------------------------------------------------------------------------------------------------------------------
