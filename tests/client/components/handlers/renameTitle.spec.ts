//----------------------------------------------------------------------------------------------------------------------
// Rename Title — Docs-style inline rename in the editor header
//
// The contract: read-only shows the plain name; editable shows a click-to-rename affordance; clicking swaps in an
// input with the name's stem pre-selected so retyping keeps the extension; Enter or blur commits the trimmed name
// through the rename prop; Escape, a blank entry, or an unchanged entry all revert without a call; and a failed
// rename surfaces a toast while the display keeps the old name.
//----------------------------------------------------------------------------------------------------------------------

import { afterEach, describe, expect, it, vi } from 'vitest';
import { type VueWrapper, flushPromises, mount } from '@vue/test-utils';

// Under test
import RenameTitle from '@client/components/handlers/renameTitle.vue';

//----------------------------------------------------------------------------------------------------------------------

const toastAdd = vi.hoisted(() => vi.fn());
vi.mock('@nuxt/ui/composables', () => ({ useToast: () => ({ add: toastAdd }) }));

let wrapper : VueWrapper | null = null;

function mountTitle(options : Partial<{ name : string; readOnly : boolean; rename : Mockable }> = {}) : VueWrapper
{
    wrapper = mount(RenameTitle, {
        attachTo: document.body,
        props: {
            name: options.name ?? 'notes.md',
            readOnly: options.readOnly ?? false,
            rename: options.rename ?? vi.fn().mockResolvedValue(undefined),
        },
    });

    return wrapper;
}

type Mockable = (name : string) => Promise<void>;

async function openEditor(view : VueWrapper) : Promise<void>
{
    await view.get('button').trigger('click');
    await flushPromises();
}

afterEach(() =>
{
    wrapper?.unmount();
    wrapper = null;
    toastAdd.mockClear();
});

//----------------------------------------------------------------------------------------------------------------------

describe('RenameTitle', () =>
{
    it('shows the plain name with no rename affordance when read-only', () =>
    {
        const view = mountTitle({ readOnly: true });

        expect(view.find('button').exists()).toBe(false);
        expect(view.find('input').exists()).toBe(false);
        expect(view.text()).toBe('notes.md');
    });

    it('offers the name as a rename control when editable', () =>
    {
        const view = mountTitle();

        const button = view.get('button');
        expect(button.text()).toBe('notes.md');
        expect(button.attributes('title')).toBe('Rename');
    });

    it('opens an input prefilled with the name, stem selected so the extension survives a retype', async () =>
    {
        const view = mountTitle({ name: 'notes.md' });
        await openEditor(view);

        const input = view.get('input').element;
        expect(input.value).toBe('notes.md');
        expect(input.selectionStart).toBe(0);
        expect(input.selectionEnd).toBe('notes'.length);
    });

    it('commits the trimmed name on Enter and leaves edit mode', async () =>
    {
        const rename = vi.fn().mockResolvedValue(undefined);
        const view = mountTitle({ rename });
        await openEditor(view);

        await view.get('input').setValue('  journal.md  ');
        await view.get('input').trigger('keydown.enter');
        await flushPromises();

        expect(rename).toHaveBeenCalledWith('journal.md');
        expect(view.find('input').exists()).toBe(false);
    });

    it('commits on blur', async () =>
    {
        const rename = vi.fn().mockResolvedValue(undefined);
        const view = mountTitle({ rename });
        await openEditor(view);

        await view.get('input').setValue('journal.md');
        await view.get('input').trigger('blur');
        await flushPromises();

        expect(rename).toHaveBeenCalledWith('journal.md');
    });

    it('cancels on Escape without renaming', async () =>
    {
        const rename = vi.fn().mockResolvedValue(undefined);
        const view = mountTitle({ rename });
        await openEditor(view);

        await view.get('input').setValue('changed.md');
        await view.get('input').trigger('keydown.esc');
        await flushPromises();

        expect(rename).not.toHaveBeenCalled();
        expect(view.find('input').exists()).toBe(false);
        expect(view.get('button').text()).toBe('notes.md');
    });

    it('reverts silently on a blank or unchanged entry', async () =>
    {
        const rename = vi.fn().mockResolvedValue(undefined);
        const view = mountTitle({ rename });

        await openEditor(view);
        await view.get('input').setValue('   ');
        await view.get('input').trigger('keydown.enter');

        await openEditor(view);
        await view.get('input').trigger('keydown.enter');
        await flushPromises();

        expect(rename).not.toHaveBeenCalled();
    });

    it('surfaces a failed rename as a toast and keeps the old name on display', async () =>
    {
        const rename = vi.fn().mockRejectedValue(new Error('boom'));
        const view = mountTitle({ rename });
        await openEditor(view);

        await view.get('input').setValue('journal.md');
        await view.get('input').trigger('keydown.enter');
        await flushPromises();

        expect(toastAdd).toHaveBeenCalled();
        expect(view.get('button').text()).toBe('notes.md');
    });
});

//----------------------------------------------------------------------------------------------------------------------
