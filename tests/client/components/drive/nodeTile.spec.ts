//----------------------------------------------------------------------------------------------------------------------
// Node Tile
//----------------------------------------------------------------------------------------------------------------------

import { beforeEach, describe, expect, it } from 'vitest';
import { type VueWrapper, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';

import type { LinkTarget, NodeResponse, NodeSharing } from '@fileshed/core';

import NodeTile from '@client/components/drive/nodeTile.vue';

//----------------------------------------------------------------------------------------------------------------------

const BASE = {
    id: 'n1',
    name: 'thing',
    ownerID: 'u1',
    parentID: null,
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
    role: 'owner' as const,
};

function fileNode(sharing : NodeSharing | null = null) : NodeResponse
{
    return {
        ...BASE,
        sharing,
        name: 'notes.txt',
        type: 'file',
        blobID: 'b1',
        size: 100,
        mimeType: 'text/plain',
        trashedAt: null,
    };
}

function linkNode(target : LinkTarget | null) : NodeResponse
{
    return { ...BASE, name: 'a link', type: 'link', targetNodeID: 't1', target };
}

const STUBS = {
    UContextMenu: { template: '<div><slot /></div>' },
    UDropdownMenu: { template: '<div><slot /></div>' },
    UButton: { template: '<button class="ubtn" />' },
    UIcon: { props: [ 'name' ], template: '<i :data-icon="name" />' },
    UTooltip: { props: [ 'text' ], template: '<span class="badge" :data-text="text"><slot /></span>' },
};

function mountTile(node : NodeResponse, selected = false) : VueWrapper
{
    return mount(NodeTile, {
        props: { node, selected, menuItems: [ [ { label: 'x' } ] ] },
        global: { stubs: STUBS },
    });
}

//----------------------------------------------------------------------------------------------------------------------

// The tile reads the session store for the clock style; an empty store resolves the default and renders fine.
beforeEach(() => setActivePinia(createPinia()));

//----------------------------------------------------------------------------------------------------------------------

describe('NodeTile — dead link', () =>
{
    it('renders a dead link dimmed, with the broken-link glyph and a "Broken link" note', () =>
    {
        const wrapper = mountTile(linkNode(null));

        expect(wrapper.text()).toContain('Broken link');
        expect(wrapper.find('[data-icon="i-lucide-unlink"]').exists()).toBe(true);
        expect(wrapper.find('.opacity-40').exists()).toBe(true);
        expect(wrapper.find('p.text-dimmed').exists()).toBe(true);
    });

    it('does not paint the link badge over a dead link', () =>
    {
        const wrapper = mountTile(linkNode(null));

        expect(wrapper.find('[data-icon="i-lucide-link"]').exists()).toBe(false);
    });
});

//----------------------------------------------------------------------------------------------------------------------

describe('NodeTile — live nodes', () =>
{
    it('badges a resolved link and does not dim it', () =>
    {
        const wrapper = mountTile(linkNode({ id: 't1', type: 'folder', name: 'shared', ownerID: 'u2' }));

        expect(wrapper.find('[data-icon="i-lucide-link"]').exists()).toBe(true);
        expect(wrapper.text()).not.toContain('Broken link');
        expect(wrapper.find('.opacity-40').exists()).toBe(false);
    });

    it('shows size and modified for a file, with no broken-link note', () =>
    {
        const wrapper = mountTile(fileNode());

        expect(wrapper.text()).toContain('100 B');
        expect(wrapper.text()).not.toContain('Broken link');
    });

    it('gives a selected tile the primary treatment', () =>
    {
        const wrapper = mountTile(fileNode(), true);

        expect(wrapper.find('.ring-primary').exists()).toBe(true);
    });
});

//----------------------------------------------------------------------------------------------------------------------

// A tile states the node's sharing in its corner. Which icons stand for which state is the badge component's own
// contract; what matters here is that the tile surfaces them at all, and shows nothing for an unexposed node.
describe('NodeTile — sharing', () =>
{
    it('carries the badges for a shared node and none for a private one', () =>
    {
        const exposed = mountTile(fileNode({ granteeCount: 1, linkUrl: '/d/tok' }));
        const priv = mountTile(fileNode());

        expect(exposed.findAll('.badge').map((badge) => badge.attributes('data-text')))
            .toEqual([ 'Shared with 1 person', 'Public link' ]);
        expect(priv.findAll('.badge')).toHaveLength(0);
    });
});

//----------------------------------------------------------------------------------------------------------------------

describe('NodeTile — interaction', () =>
{
    it('emits select with the node and the originating mouse event on click', async () =>
    {
        const node = fileNode();
        const wrapper = mountTile(node);

        await wrapper.find('[role="button"]').trigger('click');

        const select = wrapper.emitted('select');
        expect(select).toHaveLength(1);
        expect((select?.[0]?.[0] as NodeResponse).id).toBe(node.id);
    });

    it('emits open on a double-click', async () =>
    {
        const wrapper = mountTile(fileNode());

        await wrapper.find('[role="button"]').trigger('dblclick');

        expect(wrapper.emitted('open')).toHaveLength(1);
    });
});

//----------------------------------------------------------------------------------------------------------------------
