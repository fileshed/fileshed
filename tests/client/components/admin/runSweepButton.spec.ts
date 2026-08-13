//----------------------------------------------------------------------------------------------------------------------
// Run Sweep Button — running a maintenance sweep on demand
//
// Only the admin RA is mocked; the real toast plumbing and the real description engine run, so what a spec reads in a
// toast is what an admin reads on the page. The contract: the counts the server returned are what gets reported, a
// refusal is shown rather than swallowed, and the host is only told to refresh when a sweep actually ran.
//----------------------------------------------------------------------------------------------------------------------

import { type Mock, beforeEach, describe, expect, it, vi } from 'vitest';
import { type VueWrapper, flushPromises, mount } from '@vue/test-utils';

import type { SweepRunResponse } from '@fileshed/core';

// Resource Access
import { ApiError } from '@client/resource-access/apiError.ts';
import { runSweep } from '@client/resource-access/admin.ts';

// Under test
import RunSweepButton from '@client/components/admin/runSweepButton.vue';

//----------------------------------------------------------------------------------------------------------------------

vi.mock('@client/resource-access/admin.ts', () => ({ runSweep: vi.fn() }));

const toasts : { title ?: string; description ?: string; color ?: string }[] = [];
vi.mock('@nuxt/ui/composables', () => ({
    useToast: () => ({ add: (toast : { title ?: string; description ?: string; color ?: string }) =>
    {
        toasts.push(toast);
    } }),
}));

const runSweepMock = runSweep as unknown as Mock;

//----------------------------------------------------------------------------------------------------------------------

const UButtonStub = {
    name: 'UButton',
    props: [ 'label', 'loading' ],
    emits: [ 'click' ],
    template: '<button class="run" :data-loading="loading" @click="$emit(\'click\')">{{ label }}</button>',
};

function mountButton(blockedReason ?: string) : VueWrapper
{
    return mount(RunSweepButton, {
        props: { sweep: 'gc' as const, label: 'Garbage collection', blockedReason },
        global: { stubs: { UButton: UButtonStub } },
    });
}

const RECLAIMED : SweepRunResponse = {
    sweep: 'gc',
    ranAt: '2026-08-12T10:00:00.000Z',
    summary: { candidates: 4, deleted: 3, kept: 1, bytesFailed: 0, bytesFreed: 2_500_000 },
};

//----------------------------------------------------------------------------------------------------------------------

describe('RunSweepButton', () =>
{
    beforeEach(() =>
    {
        vi.clearAllMocks();
        toasts.length = 0;
    });

    it('reports the counts the sweep returned, not a bare acknowledgement', async () =>
    {
        runSweepMock.mockResolvedValue(RECLAIMED);
        const wrapper = mountButton();

        await wrapper.find('.run').trigger('click');
        await flushPromises();

        expect(runSweepMock).toHaveBeenCalledWith('gc');
        expect(toasts[0]?.title).toBe('Garbage collection finished.');
        expect(toasts[0]?.description).toBe('2.5 MB reclaimed, 3 of 4 collected, 1 back in use.');
    });

    it('tells the host to refresh once the sweep has finished', async () =>
    {
        runSweepMock.mockResolvedValue(RECLAIMED);
        const wrapper = mountButton();

        await wrapper.find('.run').trigger('click');
        await flushPromises();

        expect(wrapper.emitted('ran')).toHaveLength(1);
    });

    it('stays busy until the sweep answers, so the page cannot ask twice', async () =>
    {
        let release : (value : SweepRunResponse) => void = () => undefined;
        runSweepMock.mockReturnValue(new Promise<SweepRunResponse>((resolve) => { release = resolve; }));

        const wrapper = mountButton();
        await wrapper.find('.run').trigger('click');

        expect(wrapper.find('.run').attributes('data-loading')).toBe('true');

        release(RECLAIMED);
        await flushPromises();

        expect(wrapper.find('.run').attributes('data-loading')).toBe('false');
    });

    it('shows the refusal when the sweep is already running, rather than doing nothing quietly', async () =>
    {
        runSweepMock.mockRejectedValue(new ApiError(
            409,
            'The garbage collection sweep is already running.',
            { code: 'sweep.alreadyRunning' }
        ));

        const wrapper = mountButton();
        await wrapper.find('.run').trigger('click');
        await flushPromises();

        expect(toasts[0]?.description).toBe('The garbage collection sweep is already running.');
        expect(toasts[0]?.color).toBe('error');
    });

    // The host blocks a run for a reason only it can see -- an unsaved retention on its own card, say. The admin has
    // to learn that from somewhere, and a click that quietly does nothing is not somewhere.
    it('refuses a run the host has blocked, and tells the admin why', async () =>
    {
        const wrapper = mountButton('Save this value first.');

        await wrapper.find('.run').trigger('click');
        await flushPromises();

        expect(runSweepMock).not.toHaveBeenCalled();
        expect(toasts[0]?.description).toBe('Save this value first.');
        expect(toasts[0]?.color).toBe('warning');
        expect(wrapper.emitted('ran')).toBeUndefined();
    });

    it('does not tell the host to refresh when the sweep never ran', async () =>
    {
        runSweepMock.mockRejectedValue(new ApiError(409, 'The garbage collection sweep is already running.', {}));

        const wrapper = mountButton();
        await wrapper.find('.run').trigger('click');
        await flushPromises();

        expect(wrapper.emitted('ran')).toBeUndefined();
    });
});

//----------------------------------------------------------------------------------------------------------------------
