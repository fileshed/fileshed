//----------------------------------------------------------------------------------------------------------------------
// User Summary Hover
//----------------------------------------------------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';
import { type VueWrapper, mount } from '@vue/test-utils';

import type { UserSummary } from '@fileshed/core';

import UserSummaryHover from '@client/components/userSummaryHover.vue';

//----------------------------------------------------------------------------------------------------------------------

const SUMMARY : UserSummary = { id: 'u1', name: 'Ada Lovelace', email: 'ada@example.com', image: null };

// The real primitive opens its content on hover/focus via a floating portal, which jsdom can't meaningfully drive --
// the stub renders both slots unconditionally so the trigger wiring and the content markup are both assertable.
const STUBS = {
    UPopover: {
        props: [ 'mode' ],
        template: '<div class="popover" :data-mode="mode"><slot />'
            + '<div class="content"><slot name="content" /></div></div>',
    },
    UAvatar: { props: [ 'src', 'alt' ], template: '<span class="avatar" :data-alt="alt" />' },
};

function mountHover(summary : UserSummary = SUMMARY) : VueWrapper
{
    return mount(UserSummaryHover, {
        props: { summary },
        slots: { default: '<span class="trigger-content"></span>' },
        global: { stubs: STUBS },
    });
}

//----------------------------------------------------------------------------------------------------------------------

describe('UserSummaryHover', () =>
{
    it('opens the popover in hover mode rather than the click default', () =>
    {
        const wrapper = mountHover();

        expect(wrapper.find('.popover').attributes('data-mode')).toBe('hover');
    });

    it('wraps the slotted trigger in a real button, reachable by keyboard tab', () =>
    {
        const wrapper = mountHover();

        const button = wrapper.find('button[type="button"]');
        expect(button.exists()).toBe(true);
        expect(button.find('.trigger-content').exists()).toBe(true);
    });

    it('shows the avatar, display name, and email in the summary card', () =>
    {
        const wrapper = mountHover();

        const content = wrapper.find('.content');
        expect(content.find('.avatar').attributes('data-alt')).toBe('Ada Lovelace');
        expect(content.text()).toContain('Ada Lovelace');
        expect(content.text()).toContain('ada@example.com');
    });

    it('mutes the email so the display name reads as the primary line', () =>
    {
        const wrapper = mountHover();

        const email = wrapper.find('.content p.text-muted');
        expect(email.text()).toBe('ada@example.com');
    });
});

//----------------------------------------------------------------------------------------------------------------------
