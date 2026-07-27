//----------------------------------------------------------------------------------------------------------------------
// Create Access Token — the mint form
//
// The contract: the catalog renders one checkbox per scope in the vocabulary; presets only tick real checkboxes, so
// the minted request carries exactly what is visibly selected; the expiry choices map to whole days or null; and a
// successful mint hands the one-time value to the reveal modal while the form resets immediately -- the secret never
// lives in the form.
//----------------------------------------------------------------------------------------------------------------------

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type VueWrapper, flushPromises, mount } from '@vue/test-utils';

import { accessTokenScopes } from '@fileshed/core';

// Catalog
import { fullAccessPreset, readOnlyPreset, scopeCatalog } from '@client/components/account/tokens/scopeCatalog.ts';

// Under test
import CreateAccessToken from '@client/components/account/tokens/createAccessToken.vue';

//----------------------------------------------------------------------------------------------------------------------

const { createAccessTokenMock, copyToClipboardMock, toastAdd } = vi.hoisted(() => ({
    createAccessTokenMock: vi.fn(),
    copyToClipboardMock: vi.fn(),
    toastAdd: vi.fn(),
}));
vi.mock('@client/resource-access/accessTokens.ts', () => ({ createAccessToken: createAccessTokenMock }));
vi.mock('@client/utils/copyToClipboard.ts', () => ({ copyToClipboard: copyToClipboardMock }));
vi.mock('@nuxt/ui/composables', () => ({ useToast: () => ({ add: toastAdd }) }));

//----------------------------------------------------------------------------------------------------------------------

const UInputStub = {
    name: 'UInput',
    props: [ 'modelValue', 'placeholder' ],
    emits: [ 'update:modelValue' ],
    template: '<input class="u-input" :value="modelValue" '
        + '@input="$emit(\'update:modelValue\', $event.target.value)" />',
};

const UButtonStub = {
    name: 'UButton',
    props: [ 'label', 'icon', 'disabled', 'loading' ],
    emits: [ 'click' ],
    template: '<button :data-label="label" :disabled="disabled || null" @click="$emit(\'click\')">{{ label }}</button>',
};

const UFormFieldStub = {
    name: 'UFormField',
    props: [ 'label', 'help' ],
    template: '<div class="form-field" :data-label="label"><slot /></div>',
};

const UCheckboxStub = {
    name: 'UCheckbox',
    props: [ 'modelValue', 'ariaLabel' ],
    emits: [ 'update:modelValue' ],
    template: '<input type="checkbox" class="u-checkbox" :aria-label="ariaLabel" :checked="modelValue" '
        + '@change="$emit(\'update:modelValue\', $event.target.checked)" />',
};

const USelectStub = {
    name: 'USelect',
    props: [ 'modelValue', 'items' ],
    emits: [ 'update:modelValue' ],
    template: '<select class="u-select" :value="modelValue" '
        + '@change="$emit(\'update:modelValue\', $event.target.value)">'
        + '<option v-for="item in items" :key="item.value" :value="item.value">{{ item.label }}</option></select>',
};

const UBadgeStub = { name: 'UBadge', template: '<span class="u-badge"><slot /></span>' };

const UModalStub = {
    name: 'UModal',
    props: [ 'open', 'title', 'description', 'dismissible' ],
    template: '<div class="umodal" :data-open="String(open)" :data-dismissible="String(dismissible)">'
        + '<slot name="body" /><slot name="footer" /></div>',
};

function mountForm() : VueWrapper
{
    return mount(CreateAccessToken, {
        global: {
            stubs: {
                UInput: UInputStub,
                UButton: UButtonStub,
                UFormField: UFormFieldStub,
                UCheckbox: UCheckboxStub,
                USelect: USelectStub,
                UBadge: UBadgeStub,
                UModal: UModalStub,
            },
        },
    });
}

function mintedResponse(token = 'fspat_secret123') : unknown
{
    return {
        token,
        accessToken: {
            id: 'k1',
            name: 'my script',
            start: 'fspat_secret',
            scopes: [ 'files:read' ],
            createdAt: '2026-07-27T00:00:00.000Z',
            lastUsedAt: null,
            expiresAt: null,
        },
    };
}

beforeEach(() =>
{
    vi.clearAllMocks();
});

//----------------------------------------------------------------------------------------------------------------------

describe('CreateAccessToken', () =>
{
    it('offers one checkbox per scope in the vocabulary, and the catalog covers every scope exactly once', () =>
    {
        const wrapper = mountForm();

        expect(wrapper.findAll('input.u-checkbox')).toHaveLength(accessTokenScopes.length);
        expect(scopeCatalog.map((entry) => entry.scope).sort()).toEqual([ ...accessTokenScopes ].sort());
    });

    it('stays unsubmittable until it has a name and at least one scope', async () =>
    {
        const wrapper = mountForm();
        const submit = wrapper.get('button[data-label="Create token"]');

        expect(submit.attributes('disabled')).toBeDefined();

        await wrapper.get('input.u-input').setValue('my script');
        expect(submit.attributes('disabled')).toBeDefined();

        await wrapper.get(`input[aria-label="${ scopeCatalog[1]?.label }"]`).setValue(true);
        expect(submit.attributes('disabled')).toBeUndefined();
    });

    it('mints exactly the visibly selected scopes with the chosen expiry in days', async () =>
    {
        createAccessTokenMock.mockResolvedValue(mintedResponse());
        const wrapper = mountForm();

        await wrapper.get('input.u-input').setValue('  my script  ');
        await wrapper.get('input[aria-label="Read files"]').setValue(true);
        await wrapper.get('input[aria-label="Read account"]').setValue(true);
        await wrapper.get('select.u-select').setValue('30');
        await wrapper.get('button[data-label="Create token"]').trigger('click');

        expect(createAccessTokenMock).toHaveBeenCalledWith(
            'my script',
            expect.arrayContaining([ 'files:read', 'account:read' ]),
            30
        );
    });

    it('maps No expiry to a null expiry', async () =>
    {
        createAccessTokenMock.mockResolvedValue(mintedResponse());
        const wrapper = mountForm();

        await wrapper.get('input.u-input').setValue('forever');
        await wrapper.get('input[aria-label="Read files"]').setValue(true);
        await wrapper.get('select.u-select').setValue('never');
        await wrapper.get('button[data-label="Create token"]').trigger('click');

        expect(createAccessTokenMock).toHaveBeenCalledWith('forever', [ 'files:read' ], null);
    });

    it('presets tick real checkboxes rather than minting an alias', async () =>
    {
        createAccessTokenMock.mockResolvedValue(mintedResponse());
        const wrapper = mountForm();

        await wrapper.get('button[data-label="Full access"]').trigger('click');

        for(const scope of fullAccessPreset)
        {
            const entry = scopeCatalog.find((candidate) => candidate.scope === scope);
            const box = wrapper.get(`input[aria-label="${ entry?.label }"]`).element as HTMLInputElement;
            expect(box.checked).toBe(true);
        }

        await wrapper.get('input.u-input').setValue('everything');
        await wrapper.get('button[data-label="Create token"]').trigger('click');

        expect(createAccessTokenMock)
            .toHaveBeenCalledWith('everything', expect.arrayContaining(fullAccessPreset), 90);

        const readOnly = mountForm();
        await readOnly.get('button[data-label="Read-only"]').trigger('click');
        const checked = readOnly.findAll('input.u-checkbox')
            .filter((box) => (box.element as HTMLInputElement).checked);
        expect(checked).toHaveLength(readOnlyPreset.length);
    });

    it('hands the minted value to the reveal modal and resets the form immediately', async () =>
    {
        createAccessTokenMock.mockResolvedValue(mintedResponse('fspat_only-shown-once'));
        const wrapper = mountForm();

        await wrapper.get('input.u-input').setValue('my script');
        await wrapper.get('input[aria-label="Read files"]').setValue(true);
        await wrapper.get('button[data-label="Create token"]').trigger('click');
        await flushPromises();

        expect(wrapper.get('.umodal').attributes('data-open')).toBe('true');
        expect(wrapper.get('[data-testid="minted-token"]').text()).toBe('fspat_only-shown-once');
        expect(wrapper.emitted('created')).toHaveLength(1);

        expect((wrapper.get('input.u-input').element as HTMLInputElement).value).toBe('');
        const anyChecked = wrapper.findAll('input.u-checkbox')
            .some((box) => (box.element as HTMLInputElement).checked);
        expect(anyChecked).toBe(false);
    });
});

//----------------------------------------------------------------------------------------------------------------------
