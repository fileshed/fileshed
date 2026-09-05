//----------------------------------------------------------------------------------------------------------------------
// Drive Page — two-row header, selection bar, and modal wiring
//----------------------------------------------------------------------------------------------------------------------

import { type Mock, beforeEach, describe, expect, it, vi } from 'vitest';
import { type VNode, h } from 'vue';
import { type VueWrapper, flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { type Router, createMemoryHistory, createRouter } from 'vue-router';

import type { ContextMenuItem } from '@nuxt/ui';

import type { LinkTarget, MeResponse, NodeListResponse, NodeResponse } from '@fileshed/core';

// Stores
import { useSessionStore } from '@client/stores/session.ts';
import { useDriveStore } from '@client/stores/drive.ts';

// Components
import DriveHeader from '@client/components/drive/driveHeader.vue';
import type { DriveCrumb } from '@client/components/drive/linkCrumbCard/types.ts';

// Resource Access
import { takeLegacyViewMode } from '@client/resource-access/legacyViewMode.ts';
import { copyNode, getChildren } from '@client/resource-access/nodes.ts';
import { updatePreferences } from '@client/resource-access/preferences.ts';

// Support
import { ME_ID, meFixture } from '../support.ts';

// Under test
import DrivePage from '@client/pages/drivePage.vue';

//----------------------------------------------------------------------------------------------------------------------

vi.mock('@client/resource-access/nodes.ts', () => ({
    getChildren: vi.fn(),
    getNode: vi.fn(),
    createNode: vi.fn(),
    patchNode: vi.fn(),
    trashNode: vi.fn(),
    copyNode: vi.fn(),
    hardDeleteNode: vi.fn(),
    getNodeSharing: vi.fn(),
}));

vi.mock('@client/resource-access/legacyViewMode.ts', () => ({ takeLegacyViewMode: vi.fn(() => null) }));
vi.mock('@client/resource-access/preferences.ts', () => ({ updatePreferences: vi.fn() }));
vi.mock('@nuxt/ui/composables', () => ({ useToast: () => ({ add: vi.fn() }) }));

const getChildrenMock = getChildren as unknown as Mock;
const copyNodeMock = copyNode as unknown as Mock;
const takeLegacyViewModeMock = takeLegacyViewMode as unknown as Mock;
const updatePreferencesMock = updatePreferences as unknown as Mock;

// Rename and Move are opened imperatively by the page; these stubs record the open(...) call so the selection-bar
// wiring (the same path the context menu funnels through) is observable.
const renameOpen = vi.fn();
const moveOpen = vi.fn();
const shareOpen = vi.fn();
const scrollToIndex = vi.fn();

//----------------------------------------------------------------------------------------------------------------------

const ISO = '2026-07-01T00:00:00.000Z';

const BASE = { ownerID: ME_ID, parentID: null, createdAt: ISO, updatedAt: ISO, role: 'owner' as const };

type Overrides = Partial<Pick<NodeResponse, 'ownerID' | 'role' | 'sharing'>>;

function fileNode(id : string, overrides : Overrides = {}) : NodeResponse
{
    return {
        ...BASE,
        id,
        name: id,
        type: 'file',
        blobID: 'b1',
        size: 100,
        mimeType: 'text/plain',
        trashedAt: null,
        ...overrides,
    };
}

function folderNode(id : string, overrides : Overrides = {}) : NodeResponse
{
    return { ...BASE, id, name: id, type: 'folder', trashedAt: null, ...overrides };
}

function linkNode(
    id : string,
    target : LinkTarget | null = { id: 't1', type: 'file', name: 'x', ownerID: 'owner1' },
    overrides : Overrides = {}
) : NodeResponse
{
    return { ...BASE, id, name: id, type: 'link', targetNodeID: 't1', target, ...overrides };
}

function page(nodes : NodeResponse[]) : NodeListResponse
{
    return { nodes, total: nodes.length, limit: 50, offset: 0, owners: [] };
}

const PLAIN_CLICK = { metaKey: false, ctrlKey: false, shiftKey: false };
const TOGGLE_CLICK = { metaKey: true, ctrlKey: false, shiftKey: false };

// UButton renders its label as text; aria-label and disabled fall through as attributes so the action buttons stay
// queryable. The four modals are stubbed away -- their own specs cover them; here Rename/Move expose an open spy.
const STUBS = {
    UButton: { props: [ 'label' ], template: '<button class="ubtn" @click="$emit(\'click\')">{{ label }}</button>' },
    UTooltip: { template: '<div><slot /></div>' },
    UFieldGroup: { template: '<div><slot /></div>' },
    UDropdownMenu: { template: '<div><slot /></div>' },
    UBreadcrumb: { template: '<nav class="crumbs" />' },
    UIcon: true,
    RenameNode: {
        name: 'RenameNode',
        setup(_props : unknown, { expose } : { expose : (api : unknown) => void }) : () => null
        {
            expose({ open: renameOpen });

            return () => null;
        },
    },
    MoveNodes: {
        name: 'MoveNodes',
        setup(_props : unknown, { expose } : { expose : (api : unknown) => void }) : () => null
        {
            expose({ open: moveOpen });

            return () => null;
        },
    },
    ShareDialog: {
        name: 'ShareDialog',
        setup(_props : unknown, { expose } : { expose : (api : unknown) => void }) : () => null
        {
            expose({ open: shareOpen });

            return () => null;
        },
    },
    NewFolder: true,
    NewDocument: true,
    FilterBar: { name: 'FilterBar', template: '<div class="filter-bar" />' },
    NodeList: true,
    // buildMenu is declared as a real prop (not just a passthrough attr) so the kebab specs can pull the live
    // function off the stub and invoke it directly, exactly as NodeGrid would when a row's kebab opens. The grid also
    // exposes scrollToIndex, which is how the page brings a node into view -- with only the rows in view mounted, the
    // listing has to be told to go there.
    NodeGrid: {
        name: 'NodeGrid',
        props: [ 'buildMenu' ],
        setup(_props : unknown, { expose } : { expose : (api : unknown) => void }) : () => VNode
        {
            expose({ scrollToIndex });

            return () => h('div', { class: 'node-grid' });
        },
    },
};

// The default signed-in caller owns every fixture node (BASE.ownerID is ME_ID) -- the ordinary My Files case.
// Foreign-node tests pass an ownerID override on the node fixture instead of changing `me`.
async function mountDrive(
    nodes : NodeResponse[],
    me : MeResponse | null = meFixture(),
    at = '/'
) : Promise<VueWrapper>
{
    getChildrenMock.mockResolvedValue(page(nodes));

    const pinia = createPinia();
    setActivePinia(pinia);
    useSessionStore().me = me;

    const router = createRouter({
        history: createMemoryHistory(),
        routes: [
            { path: '/', name: 'drive', component: { template: '<div />' } },
            { path: '/folder/:id', name: 'folder', component: { template: '<div />' } },
        ],
    });
    router.push(at);
    await router.isReady();

    const wrapper = mount(DrivePage, { global: { plugins: [ pinia, router ], stubs: STUBS } });
    await flushPromises();

    return wrapper;
}

// The router the page is actually driving, for specs that assert on navigation the page performs itself.
function routerOf(wrapper : VueWrapper) : Router
{
    return wrapper.vm.$router;
}

async function select(wrapper : VueWrapper, node : NodeResponse, modifiers = PLAIN_CLICK) : Promise<void>
{
    wrapper.findComponent({ name: 'NodeGrid' }).vm.$emit('select', node, modifiers);

    await flushPromises();
}

// The live buildMenu function NodeGrid receives, pulled straight off the stub so a kebab spec can call it exactly as
// a row's own kebab would when it opens.
function buildMenuOf(wrapper : VueWrapper) : (node : NodeResponse) => ContextMenuItem[][]
{
    const grid = wrapper.findComponent({ name: 'NodeGrid' });

    return grid.props('buildMenu') as (node : NodeResponse) => ContextMenuItem[][];
}

function menuLabels(groups : ContextMenuItem[][]) : string[]
{
    return groups.flat().map((item) => item.label ?? '');
}

//----------------------------------------------------------------------------------------------------------------------

describe('DrivePage — action row', () =>
{
    beforeEach(() => vi.clearAllMocks());

    it('shows the filter bar and the view toggle, with no selection bar, when idle', async () =>
    {
        const wrapper = await mountDrive([ fileNode('f1'), folderNode('d1') ]);

        expect(wrapper.find('.filter-bar').exists()).toBe(true);
        expect(wrapper.find('[aria-label="Grid view"]').exists()).toBe(true);
        expect(wrapper.find('[aria-label="List view"]').exists()).toBe(true);
        expect(wrapper.text()).not.toContain('selected');
        expect(wrapper.find('[aria-label="Move"]').exists()).toBe(false);
    });

    it('swaps the filter bar out for the selection bar once a selection is active', async () =>
    {
        const wrapper = await mountDrive([ fileNode('f1') ]);
        expect(wrapper.find('.filter-bar').exists()).toBe(true);

        await select(wrapper, fileNode('f1'));

        expect(wrapper.find('.filter-bar').exists()).toBe(false);
        expect(wrapper.text()).toContain('1 selected');
    });
});

//----------------------------------------------------------------------------------------------------------------------

describe('DrivePage — selection bar', () =>
{
    beforeEach(() => vi.clearAllMocks());

    it('keeps the breadcrumb and view toggle visible once a selection is active', async () =>
    {
        const wrapper = await mountDrive([ fileNode('f1') ]);

        await select(wrapper, fileNode('f1'));

        expect(wrapper.find('nav.crumbs').exists()).toBe(true);
        expect(wrapper.find('[aria-label="Grid view"]').exists()).toBe(true);
        expect(wrapper.find('[aria-label="List view"]').exists()).toBe(true);
    });

    it('swaps the sort control for the selection bar, with icon-and-text actions', async () =>
    {
        const wrapper = await mountDrive([ fileNode('f1') ]);

        await select(wrapper, fileNode('f1'));

        expect(wrapper.text()).toContain('1 selected');
        expect(wrapper.find('[aria-label="Move"]').exists()).toBe(true);
        // The action buttons carry their text label, not icon-only.
        expect(wrapper.find('[aria-label="Move"]').text()).toBe('Move');
        expect(wrapper.find('[aria-label="Copy"]').text()).toBe('Copy');
        expect(wrapper.find('[aria-label="Trash"]').text()).toBe('Trash');
    });

    it('offers Rename only for a single selection', async () =>
    {
        const wrapper = await mountDrive([ fileNode('f1'), fileNode('f2') ]);

        await select(wrapper, fileNode('f1'));
        expect(wrapper.find('[aria-label="Rename"]').exists()).toBe(true);

        await select(wrapper, fileNode('f2'), TOGGLE_CLICK);
        expect(wrapper.text()).toContain('2 selected');
        expect(wrapper.find('[aria-label="Rename"]').exists()).toBe(false);
    });

    it('disables Copy when the selection includes a non-file, enables it for files only', async () =>
    {
        const wrapper = await mountDrive([ fileNode('f1'), folderNode('d1') ]);

        await select(wrapper, fileNode('f1'));
        expect(wrapper.find('[aria-label="Copy"]').attributes('disabled')).toBeUndefined();

        await select(wrapper, folderNode('d1'), TOGGLE_CLICK);
        expect(wrapper.find('[aria-label="Copy"]').attributes('disabled')).toBeDefined();
    });

    it('labels the destructive action Trash for files and folders, Remove for a links-only selection', async () =>
    {
        const files = await mountDrive([ fileNode('f1') ]);
        await select(files, fileNode('f1'));
        expect(files.find('[aria-label="Trash"]').exists()).toBe(true);
        expect(files.find('[aria-label="Remove"]').exists()).toBe(false);

        const links = await mountDrive([ linkNode('l1') ]);
        await select(links, linkNode('l1'));
        expect(links.find('[aria-label="Remove"]').exists()).toBe(true);
        expect(links.find('[aria-label="Trash"]').exists()).toBe(false);
    });
});

//----------------------------------------------------------------------------------------------------------------------

describe('DrivePage — selection bar, mixed-ownership selections', () =>
{
    beforeEach(() => vi.clearAllMocks());

    it('offers Move and Trash when every selected node is directly owned by the caller', async () =>
    {
        const wrapper = await mountDrive([ fileNode('f1'), fileNode('f2') ]);

        await select(wrapper, fileNode('f1'));
        await select(wrapper, fileNode('f2'), TOGGLE_CLICK);

        expect(wrapper.find('[aria-label="Move"]').exists()).toBe(true);
        expect(wrapper.find('[aria-label="Trash"]').exists()).toBe(true);
    });

    it('drops Move and Trash the instant one selected node is foreign, even alongside owned nodes', async () =>
    {
        const owned = fileNode('f1');
        const foreign = fileNode('f2', { ownerID: 'someone-else', role: 'editor' });
        const wrapper = await mountDrive([ owned, foreign ]);

        await select(wrapper, owned);
        await select(wrapper, foreign, TOGGLE_CLICK);

        expect(wrapper.text()).toContain('2 selected');
        expect(wrapper.find('[aria-label="Move"]').exists()).toBe(false);
        expect(wrapper.find('[aria-label="Trash"]').exists()).toBe(false);
        expect(wrapper.find('[aria-label="Remove"]').exists()).toBe(false);
    });

    it('drops Move and Trash for a wholly foreign selection, but leaves Copy available for files', async () =>
    {
        const foreignA = fileNode('f1', { ownerID: 'someone-else', role: 'viewer' });
        const foreignB = fileNode('f2', { ownerID: 'someone-else', role: 'viewer' });
        const wrapper = await mountDrive([ foreignA, foreignB ]);

        await select(wrapper, foreignA);
        await select(wrapper, foreignB, TOGGLE_CLICK);

        expect(wrapper.find('[aria-label="Move"]').exists()).toBe(false);
        expect(wrapper.find('[aria-label="Trash"]').exists()).toBe(false);
        expect(wrapper.find('[aria-label="Copy"]').attributes('disabled')).toBeUndefined();
    });

    it('drops Move and Trash for a foreign node even when its resolved role reads owner by inheritance', async () =>
    {
        // The shape a folder-link traversal or a shared folder's own contributions produce: the resolver's `role`
        // says 'owner', but ownerID still names the real owner -- the trap this whole feature exists to close.
        const contribution = fileNode('f1', { ownerID: 'contributor', role: 'owner' });
        const wrapper = await mountDrive([ contribution ]);

        await select(wrapper, contribution);

        expect(wrapper.find('[aria-label="Move"]').exists()).toBe(false);
        expect(wrapper.find('[aria-label="Trash"]').exists()).toBe(false);
        expect(wrapper.find('[aria-label="Rename"]').exists()).toBe(false);
        expect(wrapper.find('[aria-label="Share"]').exists()).toBe(false);
    });
});

//----------------------------------------------------------------------------------------------------------------------
// The kebab (per-node context menu) is gated identically to the selection bar, node by node -- direct ownership
// (node.ownerID), never the resolved `role`. An owner sees the full set; a non-owner never gets an action the server
// would refuse, and a non-owned file still gets Save a copy rather than a bare Open.
//----------------------------------------------------------------------------------------------------------------------

describe('DrivePage — kebab menu, ownership gating', () =>
{
    beforeEach(() => vi.clearAllMocks());

    it('offers the full owner set for an owned file: Open, Download, Share, Rename, Move, copy, Trash', async () =>
    {
        const node = fileNode('f1');
        const wrapper = await mountDrive([ node ]);

        expect(menuLabels(buildMenuOf(wrapper)(node))).toEqual(
            [ 'Open', 'Download', 'Share', 'Rename', 'Move', 'Make a copy', 'Trash' ]
        );
    });

    it('offers the owner set for an owned folder, with no copy (a folder has no bytes)', async () =>
    {
        const node = folderNode('d1');
        const wrapper = await mountDrive([ node ]);

        expect(menuLabels(buildMenuOf(wrapper)(node))).toEqual([ 'Open', 'Share', 'Rename', 'Move', 'Trash' ]);
    });

    // A node with a live public link hands it out from the menu itself, in either form, beside Share -- the dialog is
    // where links are minted and killed, not where an existing one is fetched.
    it('offers both copy-link entries beside Share for a node with a live public link', async () =>
    {
        const node = fileNode('f1', { sharing: { granteeCount: 0, linkUrl: '/d/tok' } });
        const wrapper = await mountDrive([ node ]);

        expect(menuLabels(buildMenuOf(wrapper)(node))).toEqual(
            [ 'Open', 'Download', 'Share', 'Copy link', 'Copy download link', 'Rename', 'Move', 'Make a copy', 'Trash' ]
        );
    });

    // Nothing to copy, no entries: a node shared with people but never published carries no link.
    it('offers no copy-link entries for a node that is shared but not published', async () =>
    {
        const node = fileNode('f1', { sharing: { granteeCount: 2, linkUrl: null } });
        const wrapper = await mountDrive([ node ]);

        expect(menuLabels(buildMenuOf(wrapper)(node))).toEqual(
            [ 'Open', 'Download', 'Share', 'Rename', 'Move', 'Make a copy', 'Trash' ]
        );
    });

    it('offers Open, Download, Rename, Move, Remove for an owned link -- never Share, a link has no ACL', async () =>
    {
        const node = linkNode('l1');
        const wrapper = await mountDrive([ node ]);

        expect(menuLabels(buildMenuOf(wrapper)(node))).toEqual([ 'Open', 'Download', 'Rename', 'Move', 'Remove' ]);
    });

    it('offers only Remove for an owned dead link', async () =>
    {
        const node = linkNode('l1', null);
        const wrapper = await mountDrive([ node ]);

        expect(menuLabels(buildMenuOf(wrapper)(node))).toEqual([ 'Remove' ]);
    });

    it('offers only Open, Download and Save a copy for a file the caller does not own', async () =>
    {
        const node = fileNode('f1', { ownerID: 'someone-else', role: 'editor' });
        const wrapper = await mountDrive([ node ]);

        expect(menuLabels(buildMenuOf(wrapper)(node))).toEqual([ 'Open', 'Download', 'Save a copy' ]);
    });

    it('offers only Open for a folder the caller does not own', async () =>
    {
        const node = folderNode('d1', { ownerID: 'someone-else', role: 'viewer' });
        const wrapper = await mountDrive([ node ]);

        expect(menuLabels(buildMenuOf(wrapper)(node))).toEqual([ 'Open' ]);
    });

    it('offers only Open and Download for a resolved link the caller does not own', async () =>
    {
        const target : LinkTarget = { id: 't2', type: 'file', name: 'y', ownerID: 'owner2' };
        const node = linkNode('l1', target, { ownerID: 'someone-else', role: 'viewer' });
        const wrapper = await mountDrive([ node ]);

        expect(menuLabels(buildMenuOf(wrapper)(node))).toEqual([ 'Open', 'Download' ]);
    });

    it('offers nothing for a dead link the caller does not own -- no target to open, nothing to administer', async () =>
    {
        const node = linkNode('l1', null, { ownerID: 'someone-else', role: 'viewer' });
        const wrapper = await mountDrive([ node ]);

        expect(buildMenuOf(wrapper)(node)).toEqual([]);
    });

    it('reads as a non-owner\'s menu for a contribution whose role is owner but ownerID names someone else', async () =>
    {
        // The exact trap a folder owner's own contributions set: role is 'owner' by inheritance, but ownerID is the
        // contributor's. The menu must read as a non-owner's, not an owner's.
        const node = fileNode('f1', { ownerID: 'contributor', role: 'owner' });
        const wrapper = await mountDrive([ node ]);

        expect(menuLabels(buildMenuOf(wrapper)(node))).toEqual([ 'Open', 'Download', 'Save a copy' ]);
    });

    it('wires a non-owner\'s Save a copy to the same copy mutation as the owner\'s Make a copy', async () =>
    {
        copyNodeMock.mockResolvedValue(undefined);
        const node = fileNode('f1', { ownerID: 'someone-else', role: 'viewer' });
        const wrapper = await mountDrive([ node ]);

        const groups = buildMenuOf(wrapper)(node);
        const saveACopy = groups.flat().find((item) => item.label === 'Save a copy');
        saveACopy?.onSelect?.();
        await flushPromises();

        expect(copyNodeMock).toHaveBeenCalledWith('f1', expect.objectContaining({ parentID: null }));
    });
});

//----------------------------------------------------------------------------------------------------------------------
// What the copy-link entries actually put on the clipboard: the app's own origin in front of the token's /d path, and
// the download form of that same token. Whether they are offered at all is settled by the menu-label assertions above.
//----------------------------------------------------------------------------------------------------------------------

describe('DrivePage — copying a public link', () =>
{
    const writeText = vi.fn(async () => undefined);

    beforeEach(() =>
    {
        vi.clearAllMocks();
        Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    });

    async function chooseFromKebab(wrapper : VueWrapper, node : NodeResponse, label : string) : Promise<void>
    {
        const item = buildMenuOf(wrapper)(node).flat()
            .find((entry) => entry.label === label);
        item?.onSelect?.(new Event('click'));

        await flushPromises();
    }

    it('copies the link as it renders, and the download form of the same token', async () =>
    {
        const node = fileNode('f1', { sharing: { granteeCount: 0, linkUrl: '/d/tok' } });
        const wrapper = await mountDrive([ node ]);

        await chooseFromKebab(wrapper, node, 'Copy link');
        await chooseFromKebab(wrapper, node, 'Copy download link');

        expect(writeText).toHaveBeenNthCalledWith(1, `${ window.location.origin }/d/tok`);
        expect(writeText).toHaveBeenNthCalledWith(2, `${ window.location.origin }/d/tok?download`);
    });
});

//----------------------------------------------------------------------------------------------------------------------
// Which node the chosen Download actually asks for. That it is offered at all, and to whom, is settled by the exact
// menu-label assertions above.
//----------------------------------------------------------------------------------------------------------------------

describe('DrivePage — Download', () =>
{
    beforeEach(() => vi.clearAllMocks());

    function downloadViaKebab(wrapper : VueWrapper, node : NodeResponse) : void
    {
        const item = buildMenuOf(wrapper)(node).flat()
            .find((entry) => entry.label === 'Download');
        item?.onSelect?.(new Event('click'));
    }

    it('sends a file through the authed download endpoint', async () =>
    {
        const node = fileNode('f1');
        const wrapper = await mountDrive([ node ]);
        const open = vi.spyOn(window, 'open').mockReturnValue(null);

        downloadViaKebab(wrapper, node);

        expect(open).toHaveBeenCalledWith('/api/nodes/f1/download', '_blank');
    });

    it('downloads a link by its target id, not the link id', async () =>
    {
        const target : LinkTarget = { id: 't2', type: 'file', name: 'y', ownerID: 'owner2' };
        const node = linkNode('l1', target);
        const wrapper = await mountDrive([ node ]);
        const open = vi.spyOn(window, 'open').mockReturnValue(null);

        downloadViaKebab(wrapper, node);

        expect(open).toHaveBeenCalledWith('/api/nodes/t2/download', '_blank');
    });
});

//----------------------------------------------------------------------------------------------------------------------

// Every file surface -- the editors, the annotator, the players -- opens at /file/:id in a fresh tab rather than
// navigating the drive away. Folder navigation stays in place (covered elsewhere).
describe('DrivePage — opening a file surface in a new tab', () =>
{
    beforeEach(() => vi.clearAllMocks());

    function openViaKebab(wrapper : VueWrapper, node : NodeResponse) : void
    {
        const item = buildMenuOf(wrapper)(node).flat()
            .find((entry) => entry.label === 'Open');
        item?.onSelect?.(new Event('click'));
    }

    it('opens an editable text file at /file/:id in a new tab', async () =>
    {
        const node = fileNode('f1');
        const wrapper = await mountDrive([ node ]);
        const open = vi.spyOn(window, 'open').mockReturnValue(null);

        openViaKebab(wrapper, node);

        expect(open).toHaveBeenCalledWith('/file/f1', '_blank');
    });

    it('opens a PDF for annotation at /file/:id in a new tab', async () =>
    {
        const node : NodeResponse = { ...fileNode('p1'), mimeType: 'application/pdf', size: 1000 };
        const wrapper = await mountDrive([ node ]);
        const open = vi.spyOn(window, 'open').mockReturnValue(null);

        openViaKebab(wrapper, node);

        expect(open).toHaveBeenCalledWith('/file/p1', '_blank');
    });

    it('opens a media file in the player at /file/:id in a new tab', async () =>
    {
        const node : NodeResponse = { ...fileNode('v1'), mimeType: 'video/mp4' };
        const wrapper = await mountDrive([ node ]);
        const open = vi.spyOn(window, 'open').mockReturnValue(null);

        openViaKebab(wrapper, node);

        expect(open).toHaveBeenCalledWith('/file/v1', '_blank');
    });
});

//----------------------------------------------------------------------------------------------------------------------

describe('DrivePage — rename and move wiring', () =>
{
    beforeEach(() => vi.clearAllMocks());

    it('opens the rename modal for the single selected node', async () =>
    {
        const node = fileNode('f1');
        const wrapper = await mountDrive([ node ]);
        await select(wrapper, node);

        await wrapper.find('[aria-label="Rename"]').trigger('click');

        expect(renameOpen).toHaveBeenCalledWith(node);
    });

    it('opens the move modal for the whole selection', async () =>
    {
        const f1 = fileNode('f1');
        const f2 = fileNode('f2');
        const wrapper = await mountDrive([ f1, f2 ]);
        await select(wrapper, f1);
        await select(wrapper, f2, TOGGLE_CLICK);

        await wrapper.find('[aria-label="Move"]').trigger('click');

        expect(moveOpen).toHaveBeenCalledWith([ f1, f2 ]);
    });
});

//----------------------------------------------------------------------------------------------------------------------

describe('DrivePage — share wiring', () =>
{
    beforeEach(() => vi.clearAllMocks());

    it('opens the share dialog for a single selected file', async () =>
    {
        const node = fileNode('f1');
        const wrapper = await mountDrive([ node ]);
        await select(wrapper, node);

        await wrapper.find('[aria-label="Share"]').trigger('click');

        expect(shareOpen).toHaveBeenCalledWith(node);
    });

    it('offers Share for a single selected folder', async () =>
    {
        const node = folderNode('d1');
        const wrapper = await mountDrive([ node ]);
        await select(wrapper, node);

        await wrapper.find('[aria-label="Share"]').trigger('click');

        expect(shareOpen).toHaveBeenCalledWith(node);
    });

    it('does not offer Share for a link (a link carries no ACL)', async () =>
    {
        const node = linkNode('l1');
        const wrapper = await mountDrive([ node ]);
        await select(wrapper, node);

        expect(wrapper.find('[aria-label="Share"]').exists()).toBe(false);
    });

    it('does not offer Share for a multi-node selection', async () =>
    {
        const f1 = fileNode('f1');
        const f2 = fileNode('f2');
        const wrapper = await mountDrive([ f1, f2 ]);
        await select(wrapper, f1);
        await select(wrapper, f2, TOGGLE_CLICK);

        expect(wrapper.find('[aria-label="Share"]').exists()).toBe(false);
    });
});

//----------------------------------------------------------------------------------------------------------------------

describe('DrivePage — legacy view-mode migration', () =>
{
    beforeEach(() => vi.clearAllMocks());

    it('adopts a legacy localStorage view mode when the profile carries none, then persists it', async () =>
    {
        takeLegacyViewModeMock.mockReturnValueOnce('list');
        updatePreferencesMock.mockResolvedValue(meFixture({ preferences: { viewMode: 'list' } }));

        await mountDrive([], meFixture({ preferences: {} }));
        const session = useSessionStore();

        expect(session.viewMode).toBe('list');
        expect(updatePreferencesMock).toHaveBeenCalledWith({ viewMode: 'list' });
    });

    it('ignores a legacy localStorage view mode when the profile already has one', async () =>
    {
        takeLegacyViewModeMock.mockReturnValueOnce('list');

        await mountDrive([], meFixture({ preferences: { viewMode: 'grid' } }));
        const session = useSessionStore();

        expect(session.viewMode).toBe('grid');
        expect(updatePreferencesMock).not.toHaveBeenCalled();
    });

    it('does nothing when there is no legacy localStorage view mode to migrate', async () =>
    {
        takeLegacyViewModeMock.mockReturnValueOnce(null);

        await mountDrive([], meFixture({ preferences: {} }));
        const session = useSessionStore();

        expect(session.viewMode).toBe('grid');
        expect(updatePreferencesMock).not.toHaveBeenCalled();
    });
});

//----------------------------------------------------------------------------------------------------------------------

describe('DrivePage — breadcrumb link marker', () =>
{
    beforeEach(() => vi.clearAllMocks());

    // Only a link crumb carries the marker payload (slot + link node); an ordinary folder crumb stays a plain
    // navigable label. The link crumb's `to` navigation belongs to the marked card, so it carries no bare `to`.
    it('marks a link breadcrumb crumb with link details and leaves folder crumbs plain', async () =>
    {
        const wrapper = await mountDrive([]);
        const store = useDriveStore();

        store.breadcrumb = [
            folderNode('docs'),
            linkNode('lnk', { id: 't1', type: 'folder', name: 'Shared Docs', ownerID: 'bob' }),
        ];
        await flushPromises();

        const crumbs = wrapper.findComponent(DriveHeader).props('crumbs') as DriveCrumb[];
        const linkCrumb = crumbs.find((crumb) => crumb.link !== undefined);
        const folderCrumb = crumbs.find((crumb) => crumb.label === 'docs');

        expect(linkCrumb?.slot).toBe('link');
        expect(linkCrumb?.link?.node.id).toBe('lnk');
        expect(folderCrumb?.link).toBeUndefined();
        expect(folderCrumb?.to).toBe('/folder/docs');
    });
});

//----------------------------------------------------------------------------------------------------------------------
// A foreign chain -- one that does not root in the caller's own tree -- steers the crumb root to Shared with me
// instead of My Files. The foreign ancestor names in between still render as ordinary crumbs; only the root changes.
//----------------------------------------------------------------------------------------------------------------------

describe('DrivePage — breadcrumb root anchor', () =>
{
    beforeEach(() => vi.clearAllMocks());

    it('roots an own-tree chain at My Files, with the drive icon and the root path', async () =>
    {
        const wrapper = await mountDrive([]);
        const store = useDriveStore();

        store.breadcrumb = [ folderNode('docs') ];
        await flushPromises();

        const crumbs = wrapper.findComponent(DriveHeader).props('crumbs') as DriveCrumb[];

        expect(crumbs[0]).toMatchObject({ label: 'My Files', icon: 'i-lucide-hard-drive', to: '/' });
    });

    it('roots a foreign chain at Shared with me, with the users icon and the shared path', async () =>
    {
        const wrapper = await mountDrive([]);
        const store = useDriveStore();

        // A folder link's target subtree, walked cold: the root ancestor the grant let the caller resolve belongs to
        // someone else -- the sharer, not the caller.
        store.breadcrumb = [ folderNode('shared-root', { ownerID: 'bob' }) ];
        await flushPromises();

        const crumbs = wrapper.findComponent(DriveHeader).props('crumbs') as DriveCrumb[];

        expect(crumbs[0]).toMatchObject({ label: 'Shared with me', icon: 'i-lucide-users', to: '/shared' });
    });

    it('still renders the foreign ancestor names as ordinary crumbs beneath the Shared with me root', async () =>
    {
        const wrapper = await mountDrive([]);
        const store = useDriveStore();

        store.breadcrumb = [ folderNode('shared-root', { ownerID: 'bob' }), folderNode('deeper', { ownerID: 'bob' }) ];
        await flushPromises();

        const crumbs = wrapper.findComponent(DriveHeader).props('crumbs') as DriveCrumb[];

        expect(crumbs.map((crumb) => crumb.label)).toEqual([ 'Shared with me', 'shared-root', 'deeper' ]);
    });
});

//----------------------------------------------------------------------------------------------------------------------

//----------------------------------------------------------------------------------------------------------------------
// Arrival selection — landing in a folder already pointed at a node
//----------------------------------------------------------------------------------------------------------------------

describe('DrivePage — arrival selection', () =>
{
    beforeEach(() => vi.clearAllMocks());

    // What finishes a search result's go-to-folder: the caller lands in the folder with the file they went looking for
    // already picked out, instead of scanning a full listing for it again.
    it('selects the node named by the select query param once the listing arrives', async () =>
    {
        const wrapper = await mountDrive([ fileNode('f1'), fileNode('f2') ], meFixture(), '/?select=f2');

        expect(wrapper.text()).toContain('1 selected');
    });

    // Only the rows in view are mounted, so a node the caller was sent to is nowhere on screen until the listing is
    // told to go to it -- marking it selected would leave them staring at a folder that looks untouched.
    it('scrolls the listing to the node it was sent to, not just marking it', async () =>
    {
        await mountDrive([ fileNode('f1'), fileNode('f2'), fileNode('f3') ], meFixture(), '/?select=f3');
        await flushPromises();

        expect(scrollToIndex).toHaveBeenCalledWith(2);
    });

    // The param is a one-shot instruction, not standing state: leaving it in the URL would re-select the node on every
    // later refresh and load-more, fighting whatever the caller has clicked since.
    it('strips the select param from the URL once it has been honoured', async () =>
    {
        const wrapper = await mountDrive([ fileNode('f1') ], meFixture(), '/?select=f1');
        await flushPromises();

        expect(routerOf(wrapper).currentRoute.value.query.select).toBeUndefined();
    });

    it('selects nothing when the named node is not in the listing', async () =>
    {
        const wrapper = await mountDrive([ fileNode('f1') ], meFixture(), '/?select=missing');

        expect(wrapper.text()).not.toContain('selected');
    });

    it('leaves the selection empty when no select param rides the route', async () =>
    {
        const wrapper = await mountDrive([ fileNode('f1') ]);

        expect(wrapper.text()).not.toContain('selected');
    });
});

//----------------------------------------------------------------------------------------------------------------------
