//----------------------------------------------------------------------------------------------------------------------
// Editor Header Slot — the header teleport seam
//
// The seam every handler family uses to place its identity into the editor layout header. Its whole job is the guarded
// teleport: it lands its slot into #editor-header-center when that target exists, and renders nothing (no Teleport
// warning) when it does not -- the case a standalone unit mount hits. What this guards: with the target present its
// slot content teleports into it; with the target absent nothing renders anywhere.
//----------------------------------------------------------------------------------------------------------------------

import { afterEach, describe, expect, it } from 'vitest';
import { type VueWrapper, mount } from '@vue/test-utils';
import { nextTick } from 'vue';

// Under test
import EditorHeaderSlot from '@client/components/handlers/editorHeaderSlot.vue';

//----------------------------------------------------------------------------------------------------------------------

const HEADER_ID = 'editor-header-center';

function makeTarget() : void
{
    const el = document.createElement('div');
    el.id = HEADER_ID;
    document.body.appendChild(el);
}

async function mountSlot() : Promise<VueWrapper>
{
    const wrapper = mount(EditorHeaderSlot, {
        slots: { default: '<span class="probe">identity</span>' },
    });
    await nextTick();

    return wrapper;
}

//----------------------------------------------------------------------------------------------------------------------

describe('EditorHeaderSlot', () =>
{
    afterEach(() => { document.getElementById(HEADER_ID)?.remove(); });

    it('teleports its slot into the header target when the target is present', async () =>
    {
        makeTarget();

        await mountSlot();

        const target = document.getElementById(HEADER_ID);
        expect(target?.querySelector('.probe')?.textContent).toBe('identity');
    });

    it('renders nothing when the header target is absent', async () =>
    {
        const wrapper = await mountSlot();

        expect(wrapper.find('.probe').exists()).toBe(false);
        expect(document.querySelector('.probe')).toBeNull();
    });
});

//----------------------------------------------------------------------------------------------------------------------
