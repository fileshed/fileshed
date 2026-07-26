//----------------------------------------------------------------------------------------------------------------------
// Save Indicator — the save-state priority
//
// The one-line readout the editing families share. Its whole contract is the priority order: a save error outranks an
// in-flight save, which outranks unsaved changes, which outranks a settled "Saved"; a clean session that has never
// saved shows nothing. What this guards: each rung wins over the ones below it, an error is toned as an error, and the
// empty state renders no element at all.
//----------------------------------------------------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';
import { type VueWrapper, mount } from '@vue/test-utils';

// Under test
import SaveIndicator from '@client/components/handlers/saveIndicator.vue';

//----------------------------------------------------------------------------------------------------------------------

interface State
{
    saving : boolean;
    dirty : boolean;
    lastSavedAt : number | null;
    saveError : string | null;
}

function mountIndicator(overrides : Partial<State> = {}) : VueWrapper
{
    const props : State = { saving: false, dirty: false, lastSavedAt: null, saveError: null, ...overrides };

    return mount(SaveIndicator, { props });
}

//----------------------------------------------------------------------------------------------------------------------

describe('SaveIndicator', () =>
{
    it('shows nothing for a clean session that has never saved', () =>
    {
        const wrapper = mountIndicator();

        expect(wrapper.find('span').exists()).toBe(false);
    });

    it('reads "Saved" once a save has landed and nothing is pending', () =>
    {
        const wrapper = mountIndicator({ lastSavedAt: Date.now() });

        expect(wrapper.text()).toBe('Saved');
    });

    it('reads "Unsaved changes" while the buffer is dirty', () =>
    {
        const wrapper = mountIndicator({ dirty: true, lastSavedAt: Date.now() });

        expect(wrapper.text()).toBe('Unsaved changes');
    });

    it('reads "Saving…" while a save is in flight, over unsaved changes', () =>
    {
        const wrapper = mountIndicator({ saving: true, dirty: true });

        expect(wrapper.text()).toBe('Saving…');
    });

    it('reads the error state, toned as an error, over everything else', () =>
    {
        const wrapper = mountIndicator({ saveError: 'boom', saving: true, dirty: true });

        expect(wrapper.text()).toBe('Couldn\'t save');
        expect(wrapper.get('span').classes()).toContain('text-error');
    });
});

//----------------------------------------------------------------------------------------------------------------------
