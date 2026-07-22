//----------------------------------------------------------------------------------------------------------------------
// New Item Requests
//
// A one-shot signal from the sidebar's "+ New" menu to the drive view, which owns the create dialogs and knows which
// folder is open. The layout can't reach into the view's dialogs, so it raises a request here and the drive view acts
// on it in whatever folder is current. The nonce makes a repeat of the same kind a distinct request, so asking for the
// same thing twice re-triggers the view's watcher instead of looking unchanged.
//----------------------------------------------------------------------------------------------------------------------

import { ref } from 'vue';
import { defineStore } from 'pinia';

//----------------------------------------------------------------------------------------------------------------------

export type NewItemKind = 'folder' | 'markdown' | 'text';

export interface NewItemRequest
{
    kind : NewItemKind;
    nonce : number;
}

//----------------------------------------------------------------------------------------------------------------------

export const useNewItemStore = defineStore('newItem', () =>
{
    const request = ref<NewItemRequest | null>(null);
    let counter = 0;

    function requestNew(kind : NewItemKind) : void
    {
        counter += 1;
        request.value = { kind, nonce: counter };
    }

    function consume() : void
    {
        request.value = null;
    }

    return { request, requestNew, consume };
});

//----------------------------------------------------------------------------------------------------------------------
