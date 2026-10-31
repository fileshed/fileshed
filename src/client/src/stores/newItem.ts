//----------------------------------------------------------------------------------------------------------------------
// New Item Requests
//
// The layout can't reach into the drive view's create dialogs, so the sidebar's "+ New" menu raises a request here and
// the view acts on it in whatever folder is open. The nonce makes a repeat of the same kind a distinct request, so
// asking twice re-triggers the view's watcher instead of looking unchanged.
//----------------------------------------------------------------------------------------------------------------------

import { ref } from 'vue';
import { defineStore } from 'pinia';

//----------------------------------------------------------------------------------------------------------------------

export type NewItemKind = 'folder' | 'link' | 'markdown' | 'text';

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
