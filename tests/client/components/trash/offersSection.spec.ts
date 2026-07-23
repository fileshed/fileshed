//----------------------------------------------------------------------------------------------------------------------
// Offered To You — pending offers, save-a-copy, decline
//----------------------------------------------------------------------------------------------------------------------

import { type Mock, beforeEach, describe, expect, it, vi } from 'vitest';
import { type VueWrapper, flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';

import type { DeletionOfferResponse } from '@fileshed/core';

// Resource Access
import { ApiError } from '@client/resource-access/apiError.ts';
import {
    acceptDeletionOffer,
    declineDeletionOffer,
    listDeletionOffers,
} from '@client/resource-access/deletionOffers.ts';

// Under test
import OffersSection from '@client/components/trash/offersSection.vue';

//----------------------------------------------------------------------------------------------------------------------

const toastAdd = vi.hoisted(() => vi.fn());

vi.mock('@client/resource-access/deletionOffers.ts', () => ({
    listDeletionOffers: vi.fn(),
    acceptDeletionOffer: vi.fn(),
    declineDeletionOffer: vi.fn(),
}));
vi.mock('@nuxt/ui/composables', () => ({ useToast: () => ({ add: toastAdd }) }));

const listMock = listDeletionOffers as unknown as Mock;
const acceptMock = acceptDeletionOffer as unknown as Mock;
const declineMock = declineDeletionOffer as unknown as Mock;

//----------------------------------------------------------------------------------------------------------------------

const ISO = '2026-07-01T00:00:00.000Z';

function offer(id : string, name = 'report.pdf') : DeletionOfferResponse
{
    return {
        id,
        sha256: 'a'.repeat(64),
        name,
        mimeType: 'application/pdf',
        size: 2048,
        createdBy: 'owner1',
        createdAt: ISO,
        expiresAt: '2026-07-28T00:00:00.000Z',
    };
}

const STUBS = {
    UButton: {
        props: [ 'label', 'loading', 'disabled' ],
        template: '<button class="ubtn" :disabled="disabled" @click="$emit(\'click\')">{{ label }}</button>',
    },
    UIcon: true,
};

function mountSection() : VueWrapper
{
    const pinia = createPinia();
    setActivePinia(pinia);

    return mount(OffersSection, { global: { plugins: [ pinia ], stubs: STUBS } });
}

async function clickButton(wrapper : VueWrapper, label : string) : Promise<void>
{
    const button = wrapper.findAll('.ubtn').find((candidate) => candidate.text() === label);

    return button ? button.trigger('click') : Promise.resolve();
}

//----------------------------------------------------------------------------------------------------------------------

describe('OffersSection', () =>
{
    beforeEach(() =>
    {
        vi.clearAllMocks();
        listMock.mockResolvedValue({ offers: [] });
        acceptMock.mockResolvedValue({ id: 'copy1', type: 'file' });
        declineMock.mockResolvedValue(undefined);
    });

    it('renders nothing when there are no pending offers', async () =>
    {
        const wrapper = mountSection();
        await flushPromises();

        expect(wrapper.text()).not.toContain('Offered to you');
        expect(wrapper.find('section').exists()).toBe(false);
    });

    it('lists a pending offer with its file name and size', async () =>
    {
        listMock.mockResolvedValue({ offers: [ offer('o1', 'budget.xlsx') ] });
        const wrapper = mountSection();
        await flushPromises();

        expect(wrapper.text()).toContain('Offered to you');
        expect(wrapper.text()).toContain('budget.xlsx');
    });

    it('saves a copy into the caller\'s root, then drops the offer and confirms it', async () =>
    {
        listMock.mockResolvedValue({ offers: [ offer('o1', 'budget.xlsx') ] });
        const wrapper = mountSection();
        await flushPromises();

        await clickButton(wrapper, 'Save a copy');
        await flushPromises();

        expect(acceptMock).toHaveBeenCalledWith('o1', { parentID: null });
        expect(wrapper.text()).not.toContain('budget.xlsx');
        expect(toastAdd).toHaveBeenCalledWith(expect.objectContaining({ color: 'success' }));
    });

    it('declines an offer and drops it, minting no copy', async () =>
    {
        listMock.mockResolvedValue({ offers: [ offer('o1', 'budget.xlsx') ] });
        const wrapper = mountSection();
        await flushPromises();

        await clickButton(wrapper, 'Decline');
        await flushPromises();

        expect(declineMock).toHaveBeenCalledWith('o1');
        expect(acceptMock).not.toHaveBeenCalled();
        expect(wrapper.text()).not.toContain('budget.xlsx');
    });

    it('keeps the offer and toasts the error when a save-a-copy is rejected', async () =>
    {
        listMock.mockResolvedValue({ offers: [ offer('o1', 'budget.xlsx') ] });
        acceptMock.mockRejectedValue(new ApiError(403, 'That would exceed your storage quota.'));
        const wrapper = mountSection();
        await flushPromises();

        await clickButton(wrapper, 'Save a copy');
        await flushPromises();

        expect(wrapper.text()).toContain('budget.xlsx');
        expect(toastAdd).toHaveBeenCalledWith(expect.objectContaining({ color: 'error' }));
    });
});

//----------------------------------------------------------------------------------------------------------------------
