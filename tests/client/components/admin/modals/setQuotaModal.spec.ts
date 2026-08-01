//----------------------------------------------------------------------------------------------------------------------
// Set Quota Modal — the three states a quota can be in
//
// Only the admin RA is mocked. A quota is inherit, explicitly unlimited, or an explicit cap, and each has to reach
// the wire as its own value: null, 0, and the byte count. Inherit and explicit-unlimited look the same on an
// instance that defaults to unlimited and diverge the moment the default tightens, so the control names the live
// default and the modal prefills whichever state the account is already in.
//----------------------------------------------------------------------------------------------------------------------

import { type Mock, beforeEach, describe, expect, it, vi } from 'vitest';
import { type VueWrapper, flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';

import { type AdminUserResponse, UNLIMITED_QUOTA } from '@fileshed/core';

// Resource Access
import { setQuota } from '@client/resource-access/admin.ts';

// Under test
import SetQuotaModal from '@client/components/admin/modals/setQuotaModal.vue';

//----------------------------------------------------------------------------------------------------------------------

vi.mock('@client/resource-access/admin.ts', () => ({ setQuota: vi.fn() }));
vi.mock('@nuxt/ui/composables', () => ({ useToast: () => ({ add: vi.fn() }) }));

const setQuotaMock = setQuota as unknown as Mock;

//----------------------------------------------------------------------------------------------------------------------

interface ModeItem { value : string; label : string; description : string }

function user(overrides : Partial<AdminUserResponse> = {}) : AdminUserResponse
{
    return {
        id: 'u1',
        email: 'member@example.com',
        name: 'Member',
        role: 'user',
        quotaLimit: null,
        quotaEffective: null,
        banned: false,
        banReason: null,
        banExpires: null,
        usedBytes: 0,
        createdAt: '2026-07-01T00:00:00.000Z',
        ...overrides,
    };
}

const URadioGroupStub = {
    name: 'URadioGroup',
    props: [ 'modelValue', 'items' ],
    emits: [ 'update:modelValue' ],
    template: '<div class="modes" :data-mode="modelValue" />',
};

const UInputStub = {
    name: 'UInput',
    props: [ 'modelValue' ],
    emits: [ 'update:modelValue' ],
    template: '<input class="cap-input" :value="modelValue" '
        + '@input="$emit(\'update:modelValue\', $event.target.value)" />',
};

const UButtonStub = {
    name: 'UButton',
    props: [ 'label', 'disabled' ],
    emits: [ 'click' ],
    template: '<button :class="`btn-${ label?.toLowerCase() }`" :disabled="disabled" '
        + '@click="$emit(\'click\')">{{ label }}</button>',
};

const UModalStub = {
    name: 'UModal',
    props: [ 'open', 'title' ],
    template: '<div class="modal"><slot name="body" /></div>',
};

const UFormFieldStub = { name: 'UFormField', props: [ 'label', 'help' ], template: '<div><slot /></div>' };

async function mountModal(
    target : AdminUserResponse,
    defaultQuota : number = UNLIMITED_QUOTA
) : Promise<VueWrapper>
{
    const wrapper = mount(SetQuotaModal, {
        props: { defaultQuota },
        global: {
            stubs: {
                URadioGroup: URadioGroupStub,
                UInput: UInputStub,
                UButton: UButtonStub,
                UModal: UModalStub,
                UFormField: UFormFieldStub,
            },
        },
    });

    (wrapper.vm as unknown as { open : (target : AdminUserResponse) => void }).open(target);
    await flushPromises();

    return wrapper;
}

function mode(wrapper : VueWrapper) : string | undefined
{
    return wrapper.find('.modes').attributes('data-mode');
}

async function chooseMode(wrapper : VueWrapper, value : string) : Promise<void>
{
    wrapper.findComponent(URadioGroupStub).vm.$emit('update:modelValue', value);
    await flushPromises();
}

function modeItems(wrapper : VueWrapper) : ModeItem[]
{
    return wrapper.findComponent(URadioGroupStub).props('items') as ModeItem[];
}

function saveButton(wrapper : VueWrapper) : HTMLButtonElement
{
    return wrapper.find('.btn-save').element as HTMLButtonElement;
}

function capInput(wrapper : VueWrapper) : string
{
    return (wrapper.find('.cap-input').element as HTMLInputElement).value;
}

//----------------------------------------------------------------------------------------------------------------------

describe('SetQuotaModal', () =>
{
    beforeEach(() =>
    {
        setActivePinia(createPinia());
        vi.clearAllMocks();
        setQuotaMock.mockResolvedValue(user());
    });

    //------------------------------------------------------------------------------------------------------------------
    // The three states reaching the wire
    //------------------------------------------------------------------------------------------------------------------

    it('saves the inherit state as null, so the account follows the instance default', async () =>
    {
        const wrapper = await mountModal(user({ quotaLimit: 5000 }), 10_000);

        await chooseMode(wrapper, 'default');
        await wrapper.find('.btn-save').trigger('click');
        await flushPromises();

        expect(setQuotaMock).toHaveBeenCalledWith('u1', null);
    });

    it('saves explicit unlimited as zero, pinning the account above a tightened default', async () =>
    {
        const wrapper = await mountModal(user({ quotaLimit: null }), 10_000);

        await chooseMode(wrapper, 'unlimited');
        await wrapper.find('.btn-save').trigger('click');
        await flushPromises();

        expect(setQuotaMock).toHaveBeenCalledWith('u1', UNLIMITED_QUOTA);
    });

    it('saves a custom cap as its byte count', async () =>
    {
        const wrapper = await mountModal(user(), 10_000);

        await chooseMode(wrapper, 'custom');
        await wrapper.find('.cap-input').setValue('20gb');
        await wrapper.find('.btn-save').trigger('click');
        await flushPromises();

        expect(setQuotaMock).toHaveBeenCalledWith('u1', 20_000_000_000);
    });

    //------------------------------------------------------------------------------------------------------------------
    // Prefill — the modal opens on the state the account is already in
    //------------------------------------------------------------------------------------------------------------------

    it('opens on inherit for an account with no limit of its own', async () =>
    {
        expect(mode(await mountModal(user({ quotaLimit: null })))).toBe('default');
    });

    it('opens on unlimited for an account explicitly pinned there', async () =>
    {
        expect(mode(await mountModal(user({ quotaLimit: UNLIMITED_QUOTA })))).toBe('unlimited');
    });

    it('opens on a custom cap, prefilled with the stored size in human units', async () =>
    {
        const wrapper = await mountModal(user({ quotaLimit: 20_000 }));

        expect(mode(wrapper)).toBe('custom');
        expect(capInput(wrapper)).toBe('20 kB');
    });

    // The prefill is a rounded rendering, so reading it back as a size would put 2,100,000 on the wire for an admin
    // who only came here to weigh the other two options. The echo underneath carries the count the rendering hides.
    it('keeps a prefilled cap byte-exact through a trip across the other options', async () =>
    {
        const wrapper = await mountModal(user({ quotaLimit: 2_097_152 }));

        expect(capInput(wrapper)).toBe('2.1 MB');
        expect(wrapper.text()).toContain(`= ${ (2_097_152).toLocaleString() } bytes (2.1 MB)`);

        await chooseMode(wrapper, 'unlimited');
        await chooseMode(wrapper, 'custom');
        await wrapper.find('.btn-save').trigger('click');
        await flushPromises();

        expect(setQuotaMock).toHaveBeenCalledWith('u1', 2_097_152);
    });

    it('sends the parsed size once the prefilled cap is edited', async () =>
    {
        const wrapper = await mountModal(user({ quotaLimit: 2_097_152 }));

        await wrapper.find('.cap-input').setValue('3gb');
        await wrapper.find('.btn-save').trigger('click');
        await flushPromises();

        expect(setQuotaMock).toHaveBeenCalledWith('u1', 3_000_000_000);
    });

    //------------------------------------------------------------------------------------------------------------------
    // The live default, and keeping the two unlimited-looking states apart
    //------------------------------------------------------------------------------------------------------------------

    it('names the current instance default on the inherit option', async () =>
    {
        const items = modeItems(await mountModal(user(), 20_000));

        expect(items.find((item) => item.value === 'default')?.description).toContain('20 kB');
    });

    it('says so when the instance default is itself unlimited', async () =>
    {
        const items = modeItems(await mountModal(user(), UNLIMITED_QUOTA));

        expect(items.find((item) => item.value === 'default')?.description).toContain('unlimited');
    });

    it('offers all three states as distinct choices', async () =>
    {
        expect(modeItems(await mountModal(user())).map((item) => item.value))
            .toEqual([ 'default', 'unlimited', 'custom' ]);
    });

    //------------------------------------------------------------------------------------------------------------------
    // Validation
    //------------------------------------------------------------------------------------------------------------------

    it('refuses to save a custom cap that is blank or not a size', async () =>
    {
        const wrapper = await mountModal(user());

        await chooseMode(wrapper, 'custom');
        expect(saveButton(wrapper).disabled).toBe(true);

        await wrapper.find('.cap-input').setValue('20 gigawatts');
        expect(saveButton(wrapper).disabled).toBe(true);

        await wrapper.find('.btn-save').trigger('click');
        await flushPromises();

        expect(setQuotaMock).not.toHaveBeenCalled();
    });

    // Zero is the Unlimited option wearing a disguise; accepting it here would let a custom cap silently mean
    // something the admin picked a different radio for.
    it('refuses a custom cap of zero rather than treating it as unlimited', async () =>
    {
        const wrapper = await mountModal(user());

        await chooseMode(wrapper, 'custom');
        await wrapper.find('.cap-input').setValue('0');

        expect(saveButton(wrapper).disabled).toBe(true);

        await wrapper.find('.btn-save').trigger('click');
        await flushPromises();

        expect(setQuotaMock).not.toHaveBeenCalled();
    });

    it('leaves Save live for the two states that need no size typed', async () =>
    {
        const wrapper = await mountModal(user());

        await chooseMode(wrapper, 'default');
        expect(saveButton(wrapper).disabled).toBe(false);

        await chooseMode(wrapper, 'unlimited');
        expect(saveButton(wrapper).disabled).toBe(false);
    });
});

//----------------------------------------------------------------------------------------------------------------------
