//----------------------------------------------------------------------------------------------------------------------
// About Modal — what the instance reports about itself
//
// The dialog exists to answer "what am I running" and "where do I report this": it names the version, the commit it
// was built from, and the branch when there was one, and it hands the commit to the clipboard rather than asking for
// it to be retyped. A build that recorded no commit or branch shows neither row instead of an empty one, and a copy
// that fails says so -- a toast claiming success over an empty clipboard is worse than no copy at all.
//----------------------------------------------------------------------------------------------------------------------

import { type Mock, beforeEach, describe, expect, it, vi } from 'vitest';
import { type VueWrapper, flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';

import { ISSUES_URL, type VersionResponse } from '@fileshed/core';

// Resource Access
import { fetchVersion } from '@client/resource-access/version.ts';

// Stores
import { useSessionStore } from '@client/stores/session.ts';

// Utils
import { copyToClipboard } from '@client/utils/copyToClipboard.ts';

// Under test
import AboutModal from '@client/components/layout/modals/aboutModal.vue';

//----------------------------------------------------------------------------------------------------------------------

vi.mock('@client/utils/copyToClipboard.ts', () => ({ copyToClipboard: vi.fn() }));
vi.mock('@client/resource-access/version.ts', () => ({ fetchVersion: vi.fn() }));
vi.mock('@client/resource-access/instance.ts', () => ({ fetchInstance: vi.fn() }));

const toasts : { title ?: string; color ?: string }[] = [];
vi.mock('@nuxt/ui/composables', () => ({
    useToast: () => ({ add: (toast : { title ?: string; color ?: string }) => { toasts.push(toast); } }),
}));

const copyMock = copyToClipboard as unknown as Mock;
const fetchVersionMock = fetchVersion as unknown as Mock;

//----------------------------------------------------------------------------------------------------------------------

const UModalStub = {
    name: 'UModal',
    props: [ 'open', 'title' ],
    template: '<div class="modal" :data-open="String(open)"><slot name="body" /></div>',
};

const UButtonStub = {
    name: 'UButton',
    props: [ 'icon', 'color', 'variant', 'size' ],
    emits: [ 'click' ],
    template: '<button class="copy" @click="$emit(\'click\')" />',
};

interface ModalHandle { open : () => void }

function buildFixture(overrides : Partial<VersionResponse> = {}) : VersionResponse
{
    return { version: '0.2.1', commit: 'a0931ee', branch: null, ...overrides };
}

async function openWith(build : VersionResponse | null) : Promise<VueWrapper>
{
    useSessionStore().build = build;

    const wrapper = mount(AboutModal, { global: { stubs: { UModal: UModalStub, UButton: UButtonStub } } });

    (wrapper.vm as unknown as ModalHandle).open();
    await flushPromises();

    return wrapper;
}

//----------------------------------------------------------------------------------------------------------------------

beforeEach(() =>
{
    setActivePinia(createPinia());
    vi.clearAllMocks();
    toasts.length = 0;
    copyMock.mockResolvedValue(true);

    // A request that never settles: the dialog is opened with the build already in the store, so what these specs
    // assert is what it renders, never what a fetch happened to win a race with.
    fetchVersionMock.mockReturnValue(new Promise(() => { /* never settles */ }));
});

//----------------------------------------------------------------------------------------------------------------------

describe('AboutModal', () =>
{
    it('names the version and the commit it was built from', async () =>
    {
        const wrapper = await openWith(buildFixture());

        expect(wrapper.get('.modal').attributes('data-open')).toBe('true');
        expect(wrapper.text()).toContain('0.2.1');
        expect(wrapper.text()).toContain('a0931ee');
    });

    it('names the branch when the build recorded one, and omits the row when it did not', async () =>
    {
        const onBranch = await openWith(buildFixture({ branch: 'topic-branch' }));

        expect(onBranch.text()).toContain('topic-branch');
        expect(onBranch.text()).toContain('Branch');

        const released = await openWith(buildFixture({ branch: null }));

        expect(released.text()).not.toContain('Branch');
    });

    it('omits the commit row for a build that recorded none', async () =>
    {
        const wrapper = await openWith(buildFixture({ commit: null }));

        expect(wrapper.text()).not.toContain('Commit');
    });

    it('copies the commit and confirms it landed', async () =>
    {
        const wrapper = await openWith(buildFixture());

        await wrapper.get('button.copy').trigger('click');
        await flushPromises();

        expect(copyMock).toHaveBeenCalledWith('a0931ee');
        expect(toasts[0]?.color).toBe('success');
    });

    it('says the copy failed rather than claiming it worked', async () =>
    {
        copyMock.mockResolvedValue(false);
        const wrapper = await openWith(buildFixture());

        await wrapper.get('button.copy').trigger('click');
        await flushPromises();

        expect(toasts[0]?.color).toBe('error');
    });

    it('offers somewhere to report a bug', async () =>
    {
        const wrapper = await openWith(buildFixture());

        const report = wrapper.findAll('a').find((anchor) => anchor.text() === 'Report a bug');

        expect(report?.attributes('href')).toBe(ISSUES_URL);
        expect(report?.attributes('rel')).toBe('noopener');
    });

    it('waits for the version rather than rendering an empty readout', async () =>
    {
        const wrapper = await openWith(null);

        expect(wrapper.text()).toContain('Reading the version');
        expect(wrapper.text()).not.toContain('Version');
    });
});

//----------------------------------------------------------------------------------------------------------------------
