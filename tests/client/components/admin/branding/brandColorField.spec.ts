//----------------------------------------------------------------------------------------------------------------------
// Brand Color Field — pick, see the ramp, get warned
//
// The field's promises: the ramp always shows eleven shades (generated when set, the pinned build defaults when
// not); the hex input always carries the EFFECTIVE color, override or default (the shed 500, #ff9900, for an
// unset primary); the contrast line warns below WCAG's 4.5:1 for white text; "Use default" emits null; and
// typed input commits only a real #rrggbb, lowercased, with garbage quietly restoring the effective value.
//----------------------------------------------------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';

// Under test
import BrandColorField from '@client/components/admin/branding/brandColorField.vue';

//----------------------------------------------------------------------------------------------------------------------

const UInputStub = {
    name: 'UInput',
    props: [ 'modelValue', 'placeholder' ],
    emits: [ 'update:modelValue' ],
    template: '<input class="hex-input" :value="modelValue" '
        + '@input="$emit(\'update:modelValue\', $event.target.value)" />',
};

function mountField(modelValue : string | null) : ReturnType<typeof mount>
{
    return mount(BrandColorField, {
        props: { label: 'Primary color', description: 'The brand color.', token: 'primary' as const, modelValue },
        global: {
            stubs: {
                UInput: UInputStub,
                UButton: { name: 'UButton', props: [ 'label' ], template: '<button>{{ label }}</button>' },
                UPopover: { name: 'UPopover', template: '<div><slot /><slot name="content" /></div>' },
                UColorPicker: true,
            },
        },
    });
}

//----------------------------------------------------------------------------------------------------------------------

describe('BrandColorField', () =>
{
    it('always shows the eleven-shade ramp -- the generated one when set, the default tokens when not', () =>
    {
        expect(mountField('#3b82f6').find('[data-testid="ramp"]')
            .element.children).toHaveLength(11);
        expect(mountField(null).find('[data-testid="ramp"]')
            .element.children).toHaveLength(11);
    });

    it('carries the effective hex in the input -- the override when set, the default color when not', () =>
    {
        const overridden = mountField('#3b82f6').find('.hex-input').element as HTMLInputElement;
        expect(overridden.value).toBe('#3b82f6');

        const unset = mountField(null).find('.hex-input').element as HTMLInputElement;
        expect(unset.value).toBe('#ff9900');
    });

    it('warns below 4.5:1 for white text and approves above it', () =>
    {
        expect(mountField('#f59e0b').text()).toContain('below 4.5:1');
        expect(mountField('#1d4ed8').text()).toContain('✓');
    });

    it('emits null from Use default', async () =>
    {
        const wrapper = mountField('#3b82f6');
        const useDefault = wrapper.findAll('button').find((button) => button.text() === 'Use default');

        await useDefault?.trigger('click');

        expect(wrapper.emitted('update:modelValue')).toEqual([ [ null ] ]);
    });

    it('commits a typed hex lowercased on blur, and garbage restores the effective value silently', async () =>
    {
        const wrapper = mountField(null);
        const input = wrapper.find('.hex-input');

        await input.setValue('#AB12CD');
        await input.trigger('blur');
        expect(wrapper.emitted('update:modelValue')).toEqual([ [ '#ab12cd' ] ]);

        const garbage = mountField(null);
        await garbage.find('.hex-input').setValue('cornflower');
        await garbage.find('.hex-input').trigger('blur');
        expect(garbage.emitted('update:modelValue')).toBeUndefined();
        expect((garbage.find('.hex-input').element as HTMLInputElement).value).toBe('#ff9900');
    });
});

//----------------------------------------------------------------------------------------------------------------------
