//----------------------------------------------------------------------------------------------------------------------
// Property Row — one property's control
//
// The contract: a number is typed as text and goes out only once the text reads as a finite number, and the field
// shows the property's value again when it loses focus; clearing a date sends nothing (removal is the remove button);
// a nested value shows as YAML with no control to edit it; and a value the editor ignores carries a note saying so.
//----------------------------------------------------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';
import { type VueWrapper, mount } from '@vue/test-utils';

// Engines
import type { Property } from '@client/engines/markdown/properties.ts';

// Under test
import PropertyRow from '@client/components/handlers/markdown/properties/propertyRow.vue';

//----------------------------------------------------------------------------------------------------------------------

const stubs = {
    UInput: {
        props: [ 'modelValue', 'type' ],
        emits: [ 'update:modelValue', 'blur' ],
        template: '<input class="u-input" :type="type ?? \'text\'" :value="modelValue" '
            + '@input="$emit(\'update:modelValue\', $event.target.value)" @blur="$emit(\'blur\')" />',
    },
    UButton: { emits: [ 'click' ], template: '<button @click="$emit(\'click\')" />' },
};

function mountRow(property : Property) : VueWrapper
{
    return mount(PropertyRow, { props: { property, readOnly: false }, global: { stubs } });
}

//----------------------------------------------------------------------------------------------------------------------

describe('PropertyRow', () =>
{
    it('sends a number only once the typed text reads as one', async () =>
    {
        const wrapper = mountRow({ kind: 'number', key: 'weight', value: 3 });
        const input = wrapper.get('.u-input');

        await input.setValue('-');
        await input.setValue('');
        await input.setValue('4.25');

        expect(wrapper.emitted('update')).toEqual([ [ 4.25 ] ]);
    });

    it('shows the property\'s value again when a half-typed number loses focus', async () =>
    {
        const wrapper = mountRow({ kind: 'number', key: 'weight', value: 3 });
        const input = wrapper.get<HTMLInputElement>('.u-input');

        await input.setValue('-');
        await input.trigger('blur');

        expect(input.element.value).toBe('3');
    });

    it('sends nothing when a date is cleared', async () =>
    {
        const wrapper = mountRow({ kind: 'date', key: 'date', value: '2024-01-15' });

        await wrapper.get('.u-input').setValue('');

        expect(wrapper.emitted('update')).toBeUndefined();
    });

    it('shows a nested value as YAML with no control', () =>
    {
        const wrapper = mountRow({ kind: 'nested', key: 'author', yaml: 'name: Ada\n' });

        expect(wrapper.find('.u-input').exists()).toBe(false);
        expect(wrapper.get('pre').text()).toBe('name: Ada');
    });

    it('asks to be removed', async () =>
    {
        const wrapper = mountRow({ kind: 'text', key: 'title', value: 'x' });

        await wrapper.get('button').trigger('click');

        expect(wrapper.emitted('remove')).toHaveLength(1);
    });

    it('notes a value the editor ignores, and nothing for one it reads', () =>
    {
        const ignored = mountRow({ kind: 'text', key: 'lang', value: 'English please' });
        const read = mountRow({ kind: 'text', key: 'lang', value: 'en' });

        expect(ignored.text()).toContain('The editor ignores this value');
        expect(read.text()).not.toContain('ignores');
    });
});

//----------------------------------------------------------------------------------------------------------------------
