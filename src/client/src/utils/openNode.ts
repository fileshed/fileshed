//----------------------------------------------------------------------------------------------------------------------
// Open Node
//
// The one place an open intent becomes an effect. The intent engine decides what opening a node MEANS; this carries
// that verdict out, so every surface that can open something -- the drive, Shared with me, the search results, the
// suggestions dropdown -- agrees on what opening does. A folder navigates in place; every file surface opens in a
// fresh tab, leaving the surface behind it standing.
//----------------------------------------------------------------------------------------------------------------------

import { useRouter } from 'vue-router';

// Engines
import type { OpenAction } from '../engines/intent/index.ts';

// Resource Access
import { downloadUrl } from '../resource-access/downloads.ts';

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
            case 'view': window.open(downloadUrl(action.nodeID, 'inline'), '_blank'); break;
            case 'download': window.open(downloadUrl(action.nodeID), '_blank'); break;
            case 'none': break;
        }
    }

    return { perform };
}

//----------------------------------------------------------------------------------------------------------------------
