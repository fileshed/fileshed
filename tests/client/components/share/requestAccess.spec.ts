//----------------------------------------------------------------------------------------------------------------------
// Request Access — ask for access, pending state, honest server outcomes
//
// The requester's card shown when a signed-in user opens a node they cannot resolve. Its contract: ask the target's
// owner at a chosen role, show the pending state on success, and surface the server's own verdict on failure rather
// than pre-guessing. The access-request resource access is the only mocked seam.
//----------------------------------------------------------------------------------------------------------------------

import { type Mock, beforeEach, describe, expect, it, vi } from 'vitest';
import { type VueWrapper, flushPromises, mount } from '@vue/test-utils';

import type { AccessRequestResponse, ShareRole } from '@fileshed/core';

// Resource Access
import { ApiError } from '@client/resource-access/apiError.ts';
import { requestAccess } from '@client/resource-access/accessRequests.ts';

// Under test
import RequestAccess from '@client/components/share/requestAccess.vue';

//----------------------------------------------------------------------------------------------------------------------

vi.mock('@client/resource-access/accessRequests.ts', () => ({ requestAccess: vi.fn() }));
// describeApiError lives beside a top-level useToast import; stubbing the composables module keeps @nuxt/ui's runtime
// (which pulls the Nuxt-only "#imports" specifier) out of the test.
vi.mock('@nuxt/ui/composables', () => ({ useToast: () => ({ add: vi.fn() }) }));

const requestAccessMock = requestAccess as unknown as Mock;

//----------------------------------------------------------------------------------------------------------------------

function pendingRequest(role : ShareRole, message : string | null = null) : AccessRequestResponse
{
    return {
        id: 'r1',
        nodeID: 'n1',
        requesterID: 'u9',
        requestedRole: role,
        message,
        status: 'pending',
        createdAt: '2026-07-01T00:00:00.000Z',
        resolvedAt: null,
    };
}

const STUBS = {
    UButton: {
        props: [ 'label' ],
        emits: [ 'click' ],
        template: '<button class="ubtn" @click="$emit(\'click\')">{{ label }}</button>',
    },
    USelect: {
        props: [ 'modelValue', 'items' ],
        emits: [ 'update:modelValue' ],
        template: '<select class="role-select" :value="modelValue" '
            + '@change="$emit(\'update:modelValue\', $event.target.value)">'
            + '<option v-for="item in items" :key="item.value" :value="item.value">{{ item.label }}</option></select>',
    },
    UTextarea: {
        props: [ 'modelValue' ],
        emits: [ 'update:modelValue' ],
        template: '<textarea class="message-input" :value="modelValue" '
            + '@input="$emit(\'update:modelValue\', $event.target.value)"></textarea>',
    },
    UIcon: true,
};

function mountCard() : VueWrapper
{
    return mount(RequestAccess, { props: { nodeID: 'n1' }, global: { stubs: STUBS } });
}

function clickButton(wrapper : VueWrapper, label : string) : Promise<void>
{
    const button = wrapper.findAll('.ubtn').find((candidate) => candidate.text() === label);

    return button ? button.trigger('click') : Promise.resolve();
}

//----------------------------------------------------------------------------------------------------------------------

describe('RequestAccess', () =>
{
    beforeEach(() =>
    {
        vi.clearAllMocks();
        requestAccessMock.mockResolvedValue(pendingRequest('viewer'));
    });

    it('asks the owner at the default viewer role and shows the pending state', async () =>
    {
        const wrapper = mountCard();

        await clickButton(wrapper, 'Request access');
        await flushPromises();

        expect(requestAccessMock).toHaveBeenCalledWith('n1', { requestedRole: 'viewer' });
        expect(wrapper.text()).toContain('Access requested');
        // Once requested, the ask form is gone -- there is nothing left to submit.
        expect(wrapper.find('.role-select').exists()).toBe(false);
    });

    it('asks at the role the requester picked', async () =>
    {
        requestAccessMock.mockResolvedValue(pendingRequest('editor'));
        const wrapper = mountCard();

        await wrapper.find('.role-select').setValue('editor');
        await clickButton(wrapper, 'Request access');
        await flushPromises();

        expect(requestAccessMock).toHaveBeenCalledWith('n1', { requestedRole: 'editor' });
        expect(wrapper.text()).toContain('editor');
    });

    it('sends a trimmed message when the requester writes one', async () =>
    {
        const wrapper = mountCard();

        await wrapper.find('.message-input').setValue('  Could I get viewer access?  ');
        await clickButton(wrapper, 'Request access');
        await flushPromises();

        expect(requestAccessMock).toHaveBeenCalledWith('n1', {
            requestedRole: 'viewer',
            message: 'Could I get viewer access?',
        });
    });

    it('omits the message entirely when it is left blank or only whitespace', async () =>
    {
        const wrapper = mountCard();

        await wrapper.find('.message-input').setValue('    ');
        await clickButton(wrapper, 'Request access');
        await flushPromises();

        expect(requestAccessMock).toHaveBeenCalledWith('n1', { requestedRole: 'viewer' });
    });

    it('surfaces a vanished node honestly and stays on the ask form', async () =>
    {
        requestAccessMock.mockRejectedValue(new ApiError(404, 'No node n1.'));
        const wrapper = mountCard();

        await clickButton(wrapper, 'Request access');
        await flushPromises();

        expect(wrapper.text()).toContain('This item no longer exists.');
        expect(wrapper.find('.role-select').exists()).toBe(true);
    });

    it('shows the server\'s reason when a request is refused', async () =>
    {
        requestAccessMock.mockRejectedValue(new ApiError(400, 'You already have a pending request for this node.'));
        const wrapper = mountCard();

        await clickButton(wrapper, 'Request access');
        await flushPromises();

        expect(wrapper.text()).toContain('You already have a pending request for this node.');
    });

    it('leaves the page via Back without asking for anything', async () =>
    {
        const wrapper = mountCard();

        await clickButton(wrapper, 'Back to files');

        expect(requestAccessMock).not.toHaveBeenCalled();
        expect(wrapper.emitted('back')).toHaveLength(1);
    });
});

//----------------------------------------------------------------------------------------------------------------------
