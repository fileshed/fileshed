//----------------------------------------------------------------------------------------------------------------------
// Deferred Row Controls
//
// A virtualized listing mounts a row every time it scrolls into view, so whatever a row carries is paid for again and
// again. Its menus are the expensive part and none of them can be reached before the pointer or the focus is on the
// row, so they wait for it: a row binds these listeners, and renders the cheap half of itself until one fires. A
// coarse pointer has no hover to wait for, so it gets everything from the start.
//----------------------------------------------------------------------------------------------------------------------

import { type Ref, ref } from 'vue';

//----------------------------------------------------------------------------------------------------------------------

const coarsePointer = globalThis.matchMedia?.('(pointer: coarse)').matches ?? false;

export interface DeferredControls
{
    ready : Ref<boolean>;
    listeners : Record<string, () => void>;
}

export function useDeferredControls() : DeferredControls
{
    const ready = ref(coarsePointer);

    function wake() : void
    {
        ready.value = true;
    }

    // pointerdown covers the right-click that arrives before any hover has registered; focusin covers the keyboard,
    // which reaches a row's own controls only after landing on the row itself.
    return { ready, listeners: { mouseenter: wake, pointerdown: wake, focusin: wake } };
}

//----------------------------------------------------------------------------------------------------------------------
