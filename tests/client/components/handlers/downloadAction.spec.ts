//----------------------------------------------------------------------------------------------------------------------
// Download Action -- the shared identity-bar control
//
// It is an anchor rather than a fetch on purpose: the browser streams the transfer, so a file too large to hold in
// memory still downloads.
//----------------------------------------------------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';

// Under test
import DownloadAction from '@client/components/handlers/downloadAction.vue';

//----------------------------------------------------------------------------------------------------------------------

const stubs = {
    UTooltip: { props: [ 'text' ], template: '<span class="tooltip" :data-text="text"><slot /></span>' },
    UButton: {
        name: 'UButton',
        props: [ 'icon', 'color', 'variant', 'href' ],
        template: '<a :href="href" :data-icon="icon" />',
    },
};

function mountAction(nodeID : string) : ReturnType<typeof mount>
{
    return mount(DownloadAction, { props: { nodeID }, global: { stubs } });
}

//----------------------------------------------------------------------------------------------------------------------

describe('DownloadAction', () =>
{
    // No ?disposition=: the endpoint defaults to attachment, which is what a Download means.
    it('links to the authed download endpoint for its node, asking for no disposition', () =>
    {
        const wrapper = mountAction('f1');

        expect(wrapper.get('a').attributes('href')).toBe('/api/nodes/f1/download');
    });

    it('names itself for a caller who cannot see the icon', () =>
    {
        const wrapper = mountAction('f1');

        expect(wrapper.get('a').attributes('aria-label')).toBe('Download');
        expect(wrapper.get('.tooltip').attributes('data-text')).toBe('Download');
    });
});

//----------------------------------------------------------------------------------------------------------------------
