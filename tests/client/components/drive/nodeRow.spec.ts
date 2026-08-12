//----------------------------------------------------------------------------------------------------------------------
// Node Row — Owner column
//----------------------------------------------------------------------------------------------------------------------

import { beforeEach, describe, expect, it } from 'vitest';
import { type VueWrapper, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';

import type { LinkTarget, NodeResponse, UserSummary } from '@fileshed/core';

import NodeRow from '@client/components/drive/nodeRow.vue';

//----------------------------------------------------------------------------------------------------------------------

function fileNode(ownerID = 'u1') : NodeResponse
{
    return {
        id: 'n1',
        name: 'notes.txt',
        ownerID,
        parentID: null,
        createdAt: '2026-07-01T00:00:00.000Z',
        updatedAt: '2026-07-01T00:00:00.000Z',
        role: 'owner' as const,
        type: 'file',
        blobID: 'b1',
        size: 100,
        mimeType: 'text/plain',
        trashedAt: null,
    };
}

function linkNode(ownerID : string, target : LinkTarget | null) : NodeResponse
{
    return {
        id: 'l1',
        name: 'a link',
        ownerID,
        parentID: null,
        createdAt: '2026-07-01T00:00:00.000Z',
        updatedAt: '2026-07-01T00:00:00.000Z',
        role: 'owner' as const,
        type: 'link',
        targetNodeID: 't1',
        target,
    };
}

const STUBS = {
    UContextMenu: { template: '<div><slot /></div>' },
    UDropdownMenu: { template: '<div><slot /></div>' },
    UButton: { template: '<button class="ubtn" />' },
    UIcon: { props: [ 'name' ], template: '<i :data-icon="name" />' },
    UserSummaryHover: {
        props: [ 'summary' ],
        template: '<div class="user-summary-hover" :data-owner-id="summary.id"><slot /></div>',
    },
    UAvatar: { props: [ 'src', 'alt' ], template: '<span class="avatar" :data-alt="alt" :data-src="src" />' },
};

// The owner hover card and the kebab's menu are mounted when the pointer arrives on the row, which is the only way
// either can be reached, so a spec about them puts the pointer there first.
async function mountRow(node : NodeResponse, owners : UserSummary[]) : Promise<VueWrapper>
{
    const wrapper = mount(NodeRow, {
        props: { node, selected: false, menuItems: [ [ { label: 'x' } ] ], owners },
        global: { stubs: STUBS },
    });

    await wrapper.find('.group').trigger('mouseenter');

    return wrapper;
}

//----------------------------------------------------------------------------------------------------------------------

// The row reads the session store for the clock style; an empty store resolves the default and renders fine.
beforeEach(() => setActivePinia(createPinia()));

//----------------------------------------------------------------------------------------------------------------------

describe('NodeRow — owner column', () =>
{
    it('shows the owner avatar behind the hover summary when the facet carries that owner', async () =>
    {
        const owners : UserSummary[]
            = [ { id: 'u1', name: 'Ada Lovelace', email: 'ada@example.com', image: 'https://cdn.example/ada.png' } ];
        const wrapper = await mountRow(fileNode('u1'), owners);

        const hover = wrapper.find('.user-summary-hover');
        expect(hover.attributes('data-owner-id')).toBe('u1');

        const avatar = hover.find('.avatar');
        expect(avatar.attributes('data-alt')).toBe('Ada Lovelace');
        expect(avatar.attributes('data-src')).toBe('https://cdn.example/ada.png');
    });

    it('passes an imageless owner through with no src, so the avatar falls back to initials', async () =>
    {
        const owners : UserSummary[] = [ { id: 'u1', name: 'Ada Lovelace', email: 'ada@example.com', image: null } ];
        const wrapper = await mountRow(fileNode('u1'), owners);

        expect(wrapper.find('.user-summary-hover .avatar').attributes('data-src')).toBeUndefined();
    });

    it('falls back to a bare avatar keyed by the raw owner id when the facet has no match', async () =>
    {
        const wrapper = await mountRow(fileNode('u1'), []);

        expect(wrapper.find('.user-summary-hover').exists()).toBe(false);
        expect(wrapper.find('.avatar').attributes('data-alt')).toBe('u1');
    });

    it('picks the row\'s own owner out of a multi-owner facet rather than the first entry', async () =>
    {
        const owners : UserSummary[] = [
            { id: 'u1', name: 'Ada Lovelace', email: 'ada@example.com', image: null },
            { id: 'u2', name: 'Grace Hopper', email: 'grace@example.com', image: null },
        ];
        const wrapper = await mountRow(fileNode('u2'), owners);

        expect(wrapper.find('.user-summary-hover').attributes('data-owner-id')).toBe('u2');
        expect(wrapper.find('.avatar').attributes('data-alt')).toBe('Grace Hopper');
    });
});

//----------------------------------------------------------------------------------------------------------------------

// A row is mounted again every time it scrolls back into view, so what it carries is paid for over and over. Neither
// the hover card nor the kebab's menu can be reached before the pointer is on the row, so neither is built until it
// arrives -- and the row still shows the owner's avatar and reserves the kebab's place in the meantime.
describe('NodeRow — controls the pointer has not reached', () =>
{
    it('shows the owner avatar with no hover card until the pointer is on the row', () =>
    {
        const owners : UserSummary[] = [ { id: 'u1', name: 'Ada Lovelace', email: 'ada@example.com', image: null } ];
        const wrapper = mount(NodeRow, {
            props: { node: fileNode('u1'), selected: false, menuItems: [ [ { label: 'x' } ] ], owners },
            global: { stubs: STUBS },
        });

        expect(wrapper.find('.user-summary-hover').exists()).toBe(false);
        expect(wrapper.find('.avatar').attributes('data-alt')).toBe('Ada Lovelace');
        expect(wrapper.find('.ubtn').exists()).toBe(false);
    });

    it('builds the hover card and the kebab once the pointer arrives', async () =>
    {
        const owners : UserSummary[] = [ { id: 'u1', name: 'Ada Lovelace', email: 'ada@example.com', image: null } ];
        const wrapper = await mountRow(fileNode('u1'), owners);

        expect(wrapper.find('.user-summary-hover').exists()).toBe(true);
        expect(wrapper.find('.ubtn').exists()).toBe(true);
    });

    // The keyboard never hovers: focus landing on the row is what makes its own controls tabbable.
    it('builds them for a keyboard that focuses the row', async () =>
    {
        const wrapper = mount(NodeRow, {
            props: { node: fileNode('u1'), selected: false, menuItems: [ [ { label: 'x' } ] ], owners: [] },
            global: { stubs: STUBS },
        });

        await wrapper.find('.group').trigger('focusin');

        expect(wrapper.find('.ubtn').exists()).toBe(true);
    });
});

//----------------------------------------------------------------------------------------------------------------------

describe('NodeRow — column order', () =>
{
    // Owner sits immediately after Name -- Drive's convention, matching the search results page -- not at the row's
    // end before the kebab.
    it('places the owner cell immediately after the name, ahead of size, modified, and type', async () =>
    {
        const owners : UserSummary[] = [ { id: 'u1', name: 'Ada Lovelace', email: 'ada@example.com', image: null } ];
        const wrapper = await mountRow(fileNode('u1'), owners);

        const cells = [ ...wrapper.find('.group').element.children ];

        expect(cells[0]?.textContent).toContain('notes.txt');
        expect(cells[1]?.querySelector('.user-summary-hover')).not.toBeNull();
        expect(cells[2]?.textContent?.trim()).toBe('100 B');
        expect(cells[4]?.textContent?.trim()).toBe('Document');
    });
});

//----------------------------------------------------------------------------------------------------------------------

describe('NodeRow — owner column for a link', () =>
{
    // A link placed via "Add to my files" points at someone else's file; the Owner column must name that someone
    // (the target's owner), not the recipient who placed the link.
    it('shows the resolved target\'s owner, not the link\'s own owner', async () =>
    {
        const owners : UserSummary[] = [
            { id: 'recipient', name: 'Recipient', email: 'recipient@example.com', image: null },
            { id: 'original-owner', name: 'Ada Lovelace', email: 'ada@example.com', image: null },
        ];
        const target : LinkTarget = { id: 't1', type: 'file', name: 'shared.txt', ownerID: 'original-owner' };
        const wrapper = await mountRow(linkNode('recipient', target), owners);

        expect(wrapper.find('.user-summary-hover').attributes('data-owner-id')).toBe('original-owner');
        expect(wrapper.find('.avatar').attributes('data-alt')).toBe('Ada Lovelace');
    });

    // A dead link has no resolvable target, so it falls back to displaying its own (the recipient's) ownership.
    it('falls back to the link\'s own owner when the target is unresolved (dead link)', async () =>
    {
        const owners : UserSummary[]
            = [ { id: 'recipient', name: 'Recipient', email: 'recipient@example.com', image: null } ];
        const wrapper = await mountRow(linkNode('recipient', null), owners);

        expect(wrapper.find('.user-summary-hover').attributes('data-owner-id')).toBe('recipient');
    });
});

//----------------------------------------------------------------------------------------------------------------------
