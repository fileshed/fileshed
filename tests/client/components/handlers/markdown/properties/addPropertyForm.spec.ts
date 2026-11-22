//----------------------------------------------------------------------------------------------------------------------
// Add Property Form — naming and typing a new property
//
// The contract: a new property needs a name that is not blank and not already taken; it goes out trimmed, with the
// starting value for the chosen kind, and the name field clears for the next one. The keys the editor reads that the
// file doesn't have yet are suggested, and one picked goes out with the starting value of the kind the editor reads.
//----------------------------------------------------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';
import { type VueWrapper, mount } from '@vue/test-utils';

// Under test
import AddPropertyForm from '@client/components/handlers/markdown/properties/addPropertyForm.vue';

//----------------------------------------------------------------------------------------------------------------------

const stubs = {
    UInput: {
        props: [ 'modelValue' ],
        emits: [ 'update:modelValue' ],
        template: '<input class="u-input" :value="modelValue" '
            + '@input="$emit(\'update:modelValue\', $event.target.value)" />',
    },
    USelect: {
        props: [ 'modelValue', 'items' ],
        emits: [ 'update:modelValue' ],
        template: '<select :value="modelValue" @change="$emit(\'update:modelValue\', $event.target.value)">'
            + '<option v-for="item in items" :key="item.value" :value="item.value">{{ item.label }}</option>'
            + '</select>',
    },
    UButton: {
        props: [ 'disabled', 'type', 'label' ],
        template: '<button :type="type" :disabled="disabled">{{ label }}</button>',
    },
};

function mountForm(keys : string[] = []) : VueWrapper
{
    return mount(AddPropertyForm, { props: { keys }, global: { stubs } });
}

//----------------------------------------------------------------------------------------------------------------------

describe('AddPropertyForm', () =>
{
    it('adds the trimmed name with the starting value for its kind, then clears the name', async () =>
    {
        const wrapper = mountForm();

        await wrapper.get('.u-input').setValue('  tags ');
        await wrapper.get('select').setValue('list');
        await wrapper.get('form').trigger('submit');

        expect(wrapper.emitted('add')).toEqual([ [ 'tags', [] ] ]);
        expect(wrapper.get<HTMLInputElement>('.u-input').element.value).toBe('');
    });

    it('refuses a blank name', async () =>
    {
        const wrapper = mountForm();

        await wrapper.get('.u-input').setValue('   ');
        await wrapper.get('form').trigger('submit');

        expect(wrapper.emitted('add')).toBeUndefined();
        expect(wrapper.get<HTMLButtonElement>('button').element.disabled).toBe(true);
    });

    it('refuses a name that is already taken, and says so', async () =>
    {
        const wrapper = mountForm([ 'title' ]);

        await wrapper.get('.u-input').setValue('title');
        await wrapper.get('form').trigger('submit');

        expect(wrapper.emitted('add')).toBeUndefined();
        expect(wrapper.text()).toContain('already a property named');
    });

    it('suggests the keys the editor reads that the file doesn\'t have yet', () =>
    {
        const wrapper = mountForm([ 'title', 'lang' ]);

        const suggested = wrapper.findAll('button:not([type="submit"])').map((button) => button.text());

        expect(suggested).toEqual([ 'tags', 'strict-line-breaks' ]);
    });

    it('adds a suggested key with the starting value of the kind the editor reads', async () =>
    {
        const wrapper = mountForm();
        const suggestions = wrapper.findAll('button:not([type="submit"])');

        await suggestions.find((button) => button.text() === 'strict-line-breaks')?.trigger('click');
        await suggestions.find((button) => button.text() === 'tags')?.trigger('click');

        expect(wrapper.emitted('add')).toEqual([ [ 'strict-line-breaks', false ], [ 'tags', [] ] ]);
    });
});

//----------------------------------------------------------------------------------------------------------------------
