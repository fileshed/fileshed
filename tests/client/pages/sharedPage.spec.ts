//----------------------------------------------------------------------------------------------------------------------
// Shared With Me Page — listing, open flows, role-gated recipient menu
//
// Drives the whole page against the real shared surface and the real shared store, mocking only the resource-access
// boundary and the router. The behavior a recipient sees: their incoming grants render with owner attribution and
// role, opening a folder navigates in and a file follows the handler seam, and the kebab offers only recipient actions
// (open, save a copy of a file, leave) -- never the owner-only move/trash/rename.
//----------------------------------------------------------------------------------------------------------------------

import { type Mock, beforeEach, describe, expect, it, vi } from 'vitest';
import { type VueWrapper, flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { type Router, createMemoryHistory, createRouter } from 'vue-router';

import type { MeResponse, ShareRole, SharedTarget, SharedWithMeEntry, UserSummary } from '@fileshed/core';

// Stores
import { useSessionStore } from '@client/stores/session.ts';

// Components
import SharedTile from '@client/components/shared/sharedTile.vue';

// Resource Access
import { copyNode } from '@client/resource-access/nodes.ts';
import { updatePreferences } from '@client/resource-access/preferences.ts';
import { leaveShare, sharedWithMe } from '@client/resource-access/shares.ts';

// Support
import { ME_ID, SCROLL_AREA_STUB, meFixture } from '../support.ts';

// Under test
import SharedPage from '@client/pages/sharedPage.vue';

//----------------------------------------------------------------------------------------------------------------------

vi.mock('@client/resource-access/nodes.ts', () => ({ copyNode: vi.fn() }));
vi.mock('@client/resource-access/shares.ts', () => ({ sharedWithMe: vi.fn(), leaveShare: vi.fn() }));
vi.mock('@client/resource-access/preferences.ts', () => ({ updatePreferences: vi.fn() }));
vi.mock('@nuxt/ui/composables', () => ({ useToast: () => ({ add: vi.fn() }) }));

const sharedWithMeMock = sharedWithMe as unknown as Mock;
const leaveShareMock = leaveShare as unknown as Mock;
const copyNodeMock = copyNode as unknown as Mock;
const updatePreferencesMock = updatePreferences as unknown as Mock;

// AddToFilesModal is opened imperatively by the page; the page's own contract is that it hands the modal the shared
// target and lets the modal own the picker, the placement, and the toast -- all covered by the modal's own spec.
const addToFilesOpen = vi.fn();

//----------------------------------------------------------------------------------------------------------------------

const OWNER : UserSummary = { id: 'owner1', name: 'Ada Lovelace', email: 'ada@example.com', image: null };

function fileTarget(id : string, name : string, mimeType = 'text/plain', size = 20) : SharedTarget
{
    return { id, type: 'file', name, ownerID: 'owner1', mimeType, size };
}

function folderTarget(id : string, name : string) : SharedTarget
{
    return { id, type: 'folder', name, ownerID: 'owner1' };
}

function entry(target : SharedTarget, role : ShareRole = 'viewer', placed = false, shareID = 's1') : SharedWithMeEntry
{
    return {
        share: {
            id: shareID,
            nodeID: target.id,
            granteeUserID: ME_ID,
            role,
            createdBy: 'owner1',
            createdAt: '2026-07-01T00:00:00.000Z',
        },
        target,
        owner: OWNER,
        placed,
    };
}

const STUBS = {
    UScrollArea: SCROLL_AREA_STUB,
    UButton: {
        props: [ 'label' ],
        template: '<button class="ubtn" :aria-label="$attrs[\'aria-label\']" @click="$emit(\'click\')">'
            + '{{ label }}</button>',
    },
    UAvatar: { props: [ 'src', 'alt' ], template: '<span class="avatar" :data-alt="alt" />' },
    UBadge: { template: '<span class="badge"><slot /></span>' },
    UFieldGroup: { template: '<div><slot /></div>' },
    // The filter row is its own unit with its own spec; here it is inert chrome so the page's toggle and listing stay
    // the subject.
    FilterRow: { name: 'FilterRow', template: '<div class="filter-row" />' },
    UIcon: true,
    // The kebab renders its items as buttons so a menu action is clickable in the test, exactly as the real dropdown
    // would invoke each item's onSelect.
    UDropdownMenu: {
        props: [ 'items' ],
        computed: { flat() : { label : string; onSelect ?: () => void }[] { return (this.items ?? []).flat(); } },
        template: '<div class="kebab"><button v-for="item in flat" :key="item.label" class="menu-item" '
            + '@click="item.onSelect && item.onSelect()">{{ item.label }}</button><slot /></div>',
    },
    AddToFilesModal: {
        name: 'AddToFilesModal',
        setup(_props : unknown, { expose } : { expose : (api : unknown) => void }) : () => null
        {
            expose({ open: addToFilesOpen });

            return () => null;
        },
    },
};

async function mountShared(
    entries : SharedWithMeEntry[],
    me : MeResponse | null = null
) : Promise<{ wrapper : VueWrapper; router : Router }>
{
    sharedWithMeMock.mockResolvedValue({ entries });

    const pinia = createPinia();
    setActivePinia(pinia);
    useSessionStore().me = me;

    const router = createRouter({
        history: createMemoryHistory(),
        routes: [
            { path: '/', name: 'shared', component: { template: '<div />' } },
            { path: '/folder/:id', name: 'folder', component: { template: '<div />' } },
            { path: '/file/:id', name: 'file', component: { template: '<div />' } },
        ],
    });
    router.push('/');
    await router.isReady();

    const wrapper = mount(SharedPage, { global: { plugins: [ pinia, router ], stubs: STUBS } });
    await flushPromises();

    return { wrapper, router };
}

function menuLabels(wrapper : VueWrapper) : string[]
{
    return wrapper.findAll('.menu-item').map((item) => item.text());
}

function clickMenu(wrapper : VueWrapper, label : string) : Promise<void>
{
    const item = wrapper.findAll('.menu-item').find((candidate) => candidate.text() === label);

    return item ? item.trigger('click') : Promise.resolve();
}

//----------------------------------------------------------------------------------------------------------------------

describe('SharedPage', () =>
{
    beforeEach(() =>
    {
        vi.clearAllMocks();
        leaveShareMock.mockResolvedValue(undefined);
        copyNodeMock.mockResolvedValue(undefined);
    });

    it('marks an already-placed shared item "In your files"', async () =>
    {
        const { wrapper } = await mountShared([ entry(fileTarget('f1', 'report.txt'), 'viewer', true) ]);

        expect(wrapper.text()).toContain('In your files');
        expect(wrapper.text()).not.toContain('drive');
    });

    it('lists incoming grants with owner attribution and the caller\'s role', async () =>
    {
        const { wrapper } = await mountShared([ entry(fileTarget('f1', 'report.txt'), 'editor') ]);

        expect(sharedWithMeMock).toHaveBeenCalled();
        expect(wrapper.text()).toContain('report.txt');
        // The owner's real name from the enrichment, never their raw id.
        expect(wrapper.text()).toContain('Ada Lovelace');
        expect(wrapper.text()).toContain('editor');
    });

    it('shows the empty state when nothing has been shared', async () =>
    {
        const { wrapper } = await mountShared([]);

        expect(wrapper.text()).toContain('Nothing has been shared with you yet.');
    });

    it('navigates into a shared folder when its row is opened', async () =>
    {
        const { wrapper, router } = await mountShared([ entry(folderTarget('dir1', 'Team')) ]);
        const push = vi.spyOn(router, 'push');

        await wrapper.get('[aria-label="Team"]').trigger('dblclick');

        expect(push).toHaveBeenCalledWith('/folder/dir1');
    });

    it('opens a shared text file in the editor in a new tab when its row is opened', async () =>
    {
        const { wrapper } = await mountShared([ entry(fileTarget('f1', 'notes.txt')) ]);
        const open = vi.spyOn(window, 'open').mockReturnValue(null);

        await wrapper.get('[aria-label="notes.txt"]').trigger('dblclick');

        expect(open).toHaveBeenCalledWith('/file/f1', '_blank');
    });

    it('offers a file recipient open, save-a-copy, and leave -- never the owner-only actions', async () =>
    {
        const { wrapper } = await mountShared([ entry(fileTarget('f1', 'report.txt')) ]);

        const labels = menuLabels(wrapper);
        expect(labels).toContain('Open');
        expect(labels).toContain('Save a copy');
        expect(labels).toContain('Leave share');
        expect(labels).not.toContain('Rename');
        expect(labels).not.toContain('Move');
        expect(labels).not.toContain('Trash');
    });

    it('offers no save-a-copy for a folder, which carries no bytes to copy', async () =>
    {
        const { wrapper } = await mountShared([ entry(folderTarget('dir1', 'Team')) ]);

        const labels = menuLabels(wrapper);
        expect(labels).toContain('Open');
        expect(labels).toContain('Leave share');
        expect(labels).not.toContain('Save a copy');
    });

    // Viewer is the weakest grant there is, and the server serves bytes to it: whatever a recipient can view, they
    // can download.
    it('offers Download to a viewer-grant file recipient', async () =>
    {
        const { wrapper } = await mountShared([ entry(fileTarget('f1', 'report.txt'), 'viewer') ]);

        expect(menuLabels(wrapper)).toContain('Download');
    });

    it('offers no Download for a shared folder, which carries no bytes', async () =>
    {
        const { wrapper } = await mountShared([ entry(folderTarget('dir1', 'Team')) ]);

        expect(menuLabels(wrapper)).not.toContain('Download');
    });

    it('sends a shared file through the authed download endpoint', async () =>
    {
        const { wrapper } = await mountShared([ entry(fileTarget('f1', 'report.txt'), 'viewer') ]);
        const open = vi.spyOn(window, 'open').mockReturnValue(null);

        await clickMenu(wrapper, 'Download');

        expect(open).toHaveBeenCalledWith('/api/nodes/f1/download', '_blank');
    });

    it('offers "Add to my files" for an unplaced shared item', async () =>
    {
        const { wrapper } = await mountShared([ entry(fileTarget('f1', 'report.txt'), 'viewer', false) ]);

        expect(menuLabels(wrapper)).toContain('Add to my files');
    });

    it('offers neither "Add to my files" nor a stand-in nav action once the item is already placed', async () =>
    {
        const { wrapper } = await mountShared([ entry(fileTarget('f1', 'report.txt'), 'viewer', true) ]);

        const labels = menuLabels(wrapper);
        expect(labels).not.toContain('Add to my files');
        expect(labels).not.toContain('Show in my files');
    });

    it('opens the add-to-files picker with the shared target when chosen from the kebab', async () =>
    {
        const target = fileTarget('f1', 'report.txt');
        const { wrapper } = await mountShared([ entry(target, 'viewer', false) ]);

        await clickMenu(wrapper, 'Add to my files');

        expect(addToFilesOpen).toHaveBeenCalledWith(target);
    });

    it('saves a copy of a shared file into My Files', async () =>
    {
        const { wrapper } = await mountShared([ entry(fileTarget('f1', 'report.txt')) ]);

        await clickMenu(wrapper, 'Save a copy');
        await flushPromises();

        expect(copyNodeMock).toHaveBeenCalledWith('f1', { parentID: null });
    });

    it('leaves a share and drops it from the listing', async () =>
    {
        const { wrapper } = await mountShared([ entry(fileTarget('f1', 'report.txt'), 'viewer', false, 's7') ]);

        // The refetch after leaving returns the caller's now-shorter set of grants.
        sharedWithMeMock.mockResolvedValue({ entries: [] });

        await clickMenu(wrapper, 'Leave share');
        await flushPromises();

        expect(leaveShareMock).toHaveBeenCalledWith('s7');
        expect(wrapper.text()).not.toContain('report.txt');
        expect(wrapper.text()).toContain('Nothing has been shared with you yet.');
    });
});

//----------------------------------------------------------------------------------------------------------------------

describe('SharedPage — view toggle', () =>
{
    beforeEach(() =>
    {
        vi.clearAllMocks();
        leaveShareMock.mockResolvedValue(undefined);
        copyNodeMock.mockResolvedValue(undefined);
    });

    it('shows the grid/list view toggle in the header', async () =>
    {
        const { wrapper } = await mountShared([]);

        expect(wrapper.find('[aria-label="Grid view"]').exists()).toBe(true);
        expect(wrapper.find('[aria-label="List view"]').exists()).toBe(true);
    });

    // The toggle rides the shared viewMode preference: switching it changes the surface and persists through the
    // preferences endpoint, exactly as the drive's own toggle does.
    it('switches the surface to the list view and persists the choice when List is clicked', async () =>
    {
        updatePreferencesMock.mockResolvedValue(meFixture({ preferences: { viewMode: 'list' } }));
        const { wrapper } = await mountShared(
            [ entry(fileTarget('f1', 'report.txt')) ],
            meFixture({ preferences: { viewMode: 'grid' } })
        );
        const session = useSessionStore();

        // Grid is the seeded preference, so the listing is a wall of cards -- no rows yet.
        expect(wrapper.findComponent(SharedTile).exists()).toBe(true);

        await wrapper.find('[aria-label="List view"]').trigger('click');
        await flushPromises();

        expect(session.viewMode).toBe('list');
        expect(updatePreferencesMock).toHaveBeenCalledWith({ viewMode: 'list' });
        expect(wrapper.findComponent(SharedTile).exists()).toBe(false);
        expect(wrapper.find('[aria-label="report.txt"]').exists()).toBe(true);
    });

    it('leaves the preference untouched when the already-active mode is clicked', async () =>
    {
        const { wrapper } = await mountShared([], meFixture({ preferences: { viewMode: 'grid' } }));

        await wrapper.find('[aria-label="Grid view"]').trigger('click');
        await flushPromises();

        expect(updatePreferencesMock).not.toHaveBeenCalled();
    });
});

//----------------------------------------------------------------------------------------------------------------------
