//----------------------------------------------------------------------------------------------------------------------
// Link Crumb Card — marker and hover contents
//----------------------------------------------------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';
import { type VueWrapper, mount } from '@vue/test-utils';

import type { LinkTarget, NodeResponse, UserSummary } from '@fileshed/core';

import LinkCrumbCard from '@client/components/drive/linkCrumbCard/linkCrumbCard.vue';

//----------------------------------------------------------------------------------------------------------------------

const ISO = '2026-07-01T00:00:00.000Z';

function linkNode(target : LinkTarget | null) : NodeResponse
{
    return {
        id: 'lnk',
        name: 'Case Test\'s Docs',
        ownerID: 'recipient',
        parentID: 'docs',
        createdAt: ISO,
        updatedAt: ISO,
        role: 'owner',
        type: 'link',
        targetNodeID: 't1',
        target,
    };
}

function ownerSummary(id : string, name : string) : UserSummary
{
    return { id, name, email: `${ id }@example.com`, image: null };
}

// UPopover renders its trigger AND its content so both the marker and the hover card are queryable in one mount.
const STUBS = {
    UPopover: { template: '<div class="popover"><slot /><slot name="content" /></div>' },
    UIcon: { props: [ 'name' ], template: '<i :data-icon="name" />' },
    UAvatar: { props: [ 'src', 'alt' ], template: '<span class="avatar" :data-alt="alt" />' },
    RouterLink: { props: [ 'to' ], template: '<a :href="to"><slot /></a>' },
};

function mountCard(node : NodeResponse, owner : UserSummary | null) : VueWrapper
{
    return mount(LinkCrumbCard, { props: { node, owner }, global: { stubs: STUBS } });
}

//----------------------------------------------------------------------------------------------------------------------

describe('LinkCrumbCard', () =>
{
    it('marks a live folder link with the link badge', () =>
    {
        const node = linkNode({ id: 't1', type: 'folder', name: 'Documents', ownerID: 'owner' });

        const wrapper = mountCard(node, ownerSummary('owner', 'Owner One'));

        expect(wrapper.find('[data-icon="i-lucide-link"]').exists()).toBe(true);
    });

    // A dead link drops the link badge and shows the broken glyph instead -- the same convention the drive rows use.
    it('drops the link badge and shows the broken glyph on a dead link', () =>
    {
        const wrapper = mountCard(linkNode(null), null);

        expect(wrapper.find('[data-icon="i-lucide-link"]').exists()).toBe(false);
        expect(wrapper.find('[data-icon="i-lucide-unlink"]').exists()).toBe(true);
    });

    it('names the target it links to and the target owner in the hover card', () =>
    {
        const node = linkNode({ id: 't1', type: 'folder', name: 'Quarterly Reports', ownerID: 'owner' });

        const wrapper = mountCard(node, ownerSummary('owner', 'Bob Smith'));

        expect(wrapper.text()).toContain('Links to');
        expect(wrapper.text()).toContain('Quarterly Reports');
        expect(wrapper.text()).toContain('Bob Smith');
    });

    // The hover card states the broken condition instead of naming a target it can no longer resolve.
    it('states the broken condition and names no target for a dead link', () =>
    {
        const wrapper = mountCard(linkNode(null), null);

        expect(wrapper.text()).toContain('broken');
        expect(wrapper.text()).not.toContain('Links to');
    });
});

//----------------------------------------------------------------------------------------------------------------------
