//----------------------------------------------------------------------------------------------------------------------
// Sharing Badges
//
// The badges state how far a node reaches beyond its owner, and the two sharings are independent: granted to people,
// published behind a link, both, or neither. Icons carry no words, so the tooltip is where the state is named -- and
// naming a count means getting the singular right.
//----------------------------------------------------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';
import { type VueWrapper, mount } from '@vue/test-utils';

import type { NodeSharing } from '@fileshed/core';

// Under test
import SharingBadges from '@client/components/share/sharingBadges.vue';

//----------------------------------------------------------------------------------------------------------------------

const STUBS = {
    UTooltip: { props: [ 'text' ], template: '<span class="badge" :data-text="text"><slot /></span>' },
    UIcon: { props: [ 'name' ], template: '<i :data-icon="name" />' },
};

function mountBadges(sharing : NodeSharing | null) : VueWrapper
{
    return mount(SharingBadges, { props: { sharing }, global: { stubs: STUBS } });
}

function labels(wrapper : VueWrapper) : string[]
{
    return wrapper.findAll('.badge').map((badge) => badge.attributes('data-text') ?? '');
}

//----------------------------------------------------------------------------------------------------------------------

describe('SharingBadges', () =>
{
    // Most nodes are neither shared nor published, and the listing carries no entry for them at all -- which must
    // render as nothing, not as an empty slot the layout has to hold open.
    it('renders nothing for a node with no sharing at all', () =>
    {
        expect(labels(mountBadges(null))).toEqual([]);
        expect(labels(mountBadges({ granteeCount: 0, linkUrl: null }))).toEqual([]);
    });

    it('names how many people a node is shared with', () =>
    {
        expect(labels(mountBadges({ granteeCount: 2, linkUrl: null }))).toEqual([ 'Shared with 2 people' ]);
    });

    it('says person, not people, for a single grantee', () =>
    {
        expect(labels(mountBadges({ granteeCount: 1, linkUrl: null }))).toEqual([ 'Shared with 1 person' ]);
    });

    it('marks a node anyone with the URL can fetch', () =>
    {
        expect(labels(mountBadges({ granteeCount: 0, linkUrl: '/d/tok' }))).toEqual([ 'Public link' ]);
    });

    // The two are different sharings -- "I gave someone access" and "anyone with the URL can fetch this" -- so a node
    // that is both shows both, never one standing in for the other.
    it('shows both badges when a node is shared and published at once', () =>
    {
        expect(labels(mountBadges({ granteeCount: 3, linkUrl: '/d/tok' })))
            .toEqual([ 'Shared with 3 people', 'Public link' ]);
    });
});

//----------------------------------------------------------------------------------------------------------------------
