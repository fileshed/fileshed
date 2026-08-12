//----------------------------------------------------------------------------------------------------------------------
// Node List — header and owner facet wiring
//----------------------------------------------------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';
import { type VueWrapper, mount } from '@vue/test-utils';

import type { NodeResponse, UserSummary } from '@fileshed/core';

import NodeList from '@client/components/drive/nodeList.vue';

//----------------------------------------------------------------------------------------------------------------------

function folderNode(id : string, ownerID : string) : NodeResponse
{
    return {
        id,
        name: id,
        ownerID,
        parentID: null,
        createdAt: '2026-07-01T00:00:00.000Z',
        updatedAt: '2026-07-01T00:00:00.000Z',
        role: 'owner' as const,
        type: 'folder',
        trashedAt: null,
    };
}

const STUBS = {
    UIcon: true,
    NodeRow: {
        props: [ 'node', 'selected', 'menuItems', 'owners' ],
        template: '<div class="node-row" :data-id="node.id" :data-owners="owners.map((o) => o.id).join(\',\')" '
            + ':data-link="node.sharing?.linkUrl ?? \'none\'" />',
    },
};

function mountList(nodes : NodeResponse[], owners : UserSummary[]) : VueWrapper
{
    return mount(NodeList, {
        props: {
            nodes,
            selection: new Set<string>(),
            sortKey: 'name',
            sortDirection: 'asc',
            buildMenu: () => [ [ { label: 'x' } ] ],
            owners,
        },
        global: { stubs: STUBS },
    });
}

//----------------------------------------------------------------------------------------------------------------------

describe('NodeList — Owner column header', () =>
{
    it('renders Owner as a plain header cell rather than a sort button', () =>
    {
        const wrapper = mountList([], []);
        const header = wrapper.find('.grid');

        const ownerCell = header.findAll('span').find((span) => span.text() === 'Owner');
        expect(ownerCell).toBeDefined();

        const sortButtonLabels = header.findAll('button').map((button) => button.text());
        expect(sortButtonLabels).not.toContain('Owner');
    });

    // Owner sits immediately after Name -- Drive's convention, matching the search results page -- not at the end
    // of the row before the kebab.
    it('places Owner immediately after Name, ahead of Size, Modified, and Type', () =>
    {
        const wrapper = mountList([], []);
        const header = wrapper.find('.grid');

        const labels = [ ...header.element.children ].map((el) => el.textContent?.trim());

        expect(labels).toEqual([ 'Name', 'Owner', 'Size', 'Modified', 'Type' ]);
    });

    it('still emits sort for the real sortable columns after the header layout change', async () =>
    {
        const wrapper = mountList([], []);

        await wrapper.find('button').trigger('click');

        expect(wrapper.emitted('sort')?.[0]).toEqual([ 'name' ]);
    });
});

//----------------------------------------------------------------------------------------------------------------------

// Each row states its own node's sharing -- never the one beside it.
describe('NodeList — sharing wiring', () =>
{
    it('gives each row the sharing its own node carries', () =>
    {
        const linked = folderNode('first', 'u1');
        linked.sharing = { granteeCount: 0, linkUrl: '/d/tok' };

        const rows = mountList([ linked, folderNode('second', 'u1') ], []).findAll('.node-row');

        expect(rows[0]?.attributes('data-link')).toBe('/d/tok');
        expect(rows[1]?.attributes('data-link')).toBe('none');
    });
});

//----------------------------------------------------------------------------------------------------------------------

describe('NodeList — owner facet wiring', () =>
{
    it('passes the whole owners facet through to every row unfiltered', () =>
    {
        const owners : UserSummary[] = [
            { id: 'u1', name: 'Ada Lovelace', email: 'ada@example.com', image: null },
            { id: 'u2', name: 'Grace Hopper', email: 'grace@example.com', image: null },
        ];
        const nodes = [ folderNode('a', 'u1'), folderNode('b', 'u2') ];

        const wrapper = mountList(nodes, owners);
        const rows = wrapper.findAll('.node-row');

        expect(rows).toHaveLength(2);
        expect(rows[0]?.attributes('data-owners')).toBe('u1,u2');
        expect(rows[1]?.attributes('data-owners')).toBe('u1,u2');
    });
});

//----------------------------------------------------------------------------------------------------------------------
