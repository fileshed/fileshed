//----------------------------------------------------------------------------------------------------------------------
// Reveal Token Modal — the one-time secret's whole client-side life
//
// The contract: opening shows the handed-in token in a non-dismissible modal (a stray overlay click must not eat a
// secret that cannot be shown again); the copy affordance confirms only when text actually landed and owns up with
// a toast when no mechanism worked -- plain-HTTP LAN origins have no clipboard API, and a silently dead button here
// loses the token forever; Done is the only way out and clears the value.
//----------------------------------------------------------------------------------------------------------------------

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type VueWrapper, flushPromises, mount } from '@vue/test-utils';
import { nextTick } from 'vue';

// Under test
import RevealToken from '@client/components/account/tokens/modals/revealToken.vue';

//----------------------------------------------------------------------------------------------------------------------

const { copyToClipboardMock, toastAdd } = vi.hoisted(() => ({
    copyToClipboardMock: vi.fn(),
    toastAdd: vi.fn(),
}));

vi.mock('@client/utils/copyToClipboard.ts', () => ({ copyToClipboard: copyToClipboardMock }));
vi.mock('@nuxt/ui/composables', () => ({ useToast: () => ({ add: toastAdd }) }));

//----------------------------------------------------------------------------------------------------------------------

const UModalStub = {
    name: 'UModal',
    props: [ 'open', 'title', 'description', 'dismissible' ],
    template: '<div class="umodal" :data-open="String(open)" :data-dismissible="String(dismissible)">'
        + '<slot name="body" /><slot name="footer" /></div>',
};

const UButtonStub = {
    name: 'UButton',
    props: [ 'label', 'icon' ],
    emits: [ 'click' ],
    template: '<button :data-label="label" @click="$emit(\'click\')">{{ label }}</button>',
};

interface RevealHandle { open : (token : string) => void }

async function mountOpen(token = 'fspat_secret') : Promise<VueWrapper>
{
    const wrapper = mount(RevealToken, { global: { stubs: { UModal: UModalStub, UButton: UButtonStub } } });
    (wrapper.vm as unknown as RevealHandle).open(token);
    await nextTick();

    return wrapper;
}

beforeEach(() =>
{
    vi.clearAllMocks();
});

//----------------------------------------------------------------------------------------------------------------------

describe('RevealToken', () =>
{
    it('opens non-dismissible with the handed-in token on display', async () =>
    {
        const wrapper = await mountOpen('fspat_only-shown-once');

        expect(wrapper.get('.umodal').attributes('data-open')).toBe('true');
        expect(wrapper.get('.umodal').attributes('data-dismissible')).toBe('false');
        expect(wrapper.get('[data-testid="minted-token"]').text()).toBe('fspat_only-shown-once');
    });

    it('confirms a successful copy, and owns up with a toast when no copy mechanism worked', async () =>
    {
        const wrapper = await mountOpen();

        copyToClipboardMock.mockResolvedValue(false);
        await wrapper.get('button[data-label="Copy"]').trigger('click');
        await flushPromises();
        expect(toastAdd).toHaveBeenCalledWith(expect.objectContaining({ color: 'error' }));
        expect(wrapper.find('button[data-label="Copied"]').exists()).toBe(false);

        copyToClipboardMock.mockResolvedValue(true);
        await wrapper.get('button[data-label="Copy"]').trigger('click');
        await flushPromises();
        expect(copyToClipboardMock).toHaveBeenCalledWith('fspat_secret');
        expect(wrapper.find('button[data-label="Copied"]').exists()).toBe(true);
    });

    it('closes only through Done, clearing the secret from its state', async () =>
    {
        const wrapper = await mountOpen('fspat_gone-after-done');

        await wrapper.get('button[data-label="Done"]').trigger('click');

        expect(wrapper.get('.umodal').attributes('data-open')).toBe('false');
        expect(wrapper.get('[data-testid="minted-token"]').text()).toBe('');
    });
});

//----------------------------------------------------------------------------------------------------------------------
