//----------------------------------------------------------------------------------------------------------------------
// Open Node
//
// The intent engine decides what opening a node means; this carries it out, so every surface that opens nodes agrees on
// what opening does.
//----------------------------------------------------------------------------------------------------------------------

import { useRouter } from 'vue-router';

// Engines
import type { OpenAction } from '../engines/intent/index.ts';

// Resource Access
import { downloadURL } from '../resource-access/downloads.ts';

//----------------------------------------------------------------------------------------------------------------------

export interface OpenNode
{
    perform : (action : OpenAction) => void;
}

export function useOpenNode() : OpenNode
{
    const router = useRouter();

    function perform(action : OpenAction) : void
    {
        switch (action.kind)
        {
            case 'navigate': void router.push(`/folder/${ action.folderID }`); break;
            case 'edit':
            case 'annotate':
            case 'play':
            case 'play-playlist': window.open(`/file/${ action.nodeID }`, '_blank'); break;
            case 'view': window.open(downloadURL(action.nodeID, 'inline'), '_blank'); break;
            case 'download': window.open(downloadURL(action.nodeID), '_blank'); break;
            case 'none': break;
        }
    }

    return { perform };
}

//----------------------------------------------------------------------------------------------------------------------
