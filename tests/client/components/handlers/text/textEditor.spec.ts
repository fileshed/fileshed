//----------------------------------------------------------------------------------------------------------------------
// Text Editor — gutter compartment and live theme swap
//
// The editor holds the gutter and the chosen colorscheme in Compartments so a preference change is a reconfigure, not a
// teardown. What this guards over a real CodeMirror view: with the gutter preference off there is no line-number
// gutter, turning it on adds one without losing the document, and swapping the theme leaves the document intact.
// Colors are a browser concern and are not asserted.
//----------------------------------------------------------------------------------------------------------------------

import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { type VueWrapper, mount } from '@vue/test-utils';

// Under test
import TextEditor from '@client/components/handlers/text/textEditor.vue';

//----------------------------------------------------------------------------------------------------------------------

// CodeMirror's view measures its layout through a ResizeObserver, which jsdom does not implement. A no-op stand-in is
// enough for the view to construct and reconfigure -- nothing here depends on real measurements.
beforeAll(() =>
{
    if(!('ResizeObserver' in globalThis))
    {
        globalThis.ResizeObserver = class
        {
            observe() : void { /* no measurements needed in jsdom */ }
            unobserve() : void { /* no measurements needed in jsdom */ }
            disconnect() : void { /* no measurements needed in jsdom */ }
        };
    }
});

let wrapper : VueWrapper | null = null;

afterEach(() =>
{
    wrapper?.unmount();
    wrapper = null;
});

function mountEditor(gutter : boolean, theme = 'ayu-dark') : VueWrapper
{
    return mount(TextEditor, {
        attachTo: document.body,
        props: { modelValue: 'line one\nline two', mode: 'plain', readOnly: false, theme, gutter },
    });
}

//----------------------------------------------------------------------------------------------------------------------

describe('TextEditor gutter and theme', () =>
{
    it('shows no line-number gutter when the gutter preference is off', () =>
    {
        wrapper = mountEditor(false);

        expect(wrapper.find('.cm-lineNumbers').exists()).toBe(false);
    });

    it('adds the line-number gutter when the preference turns on, keeping the document', async () =>
    {
        wrapper = mountEditor(false);

        await wrapper.setProps({ gutter: true });

        expect(wrapper.find('.cm-lineNumbers').exists()).toBe(true);
        expect(wrapper.find('.cm-content').text()).toContain('line one');
    });

    it('swaps the theme without losing the document', async () =>
    {
        wrapper = mountEditor(true, 'ayu-dark');

        await wrapper.setProps({ theme: 'nord' });

        expect(wrapper.find('.cm-lineNumbers').exists()).toBe(true);
        expect(wrapper.find('.cm-content').text()).toContain('line two');
    });
});

//----------------------------------------------------------------------------------------------------------------------
