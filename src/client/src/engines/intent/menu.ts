//----------------------------------------------------------------------------------------------------------------------
// Node Menu Engine
//
// Gated by direct ownership (node.ownerID), never the resolved `role`, the same way the selection bar is. A dead link
// owned by someone else offers nothing: there is no target to open and no administering it. A foreign node gets Open
// plus whatever asks only read access -- Save a copy and Add a link -- so a non-owner is never left with a bare Open.
// Every owner-only action (Share, the copy-link entries, Rename, Move, Trash/Remove) is absent for a node the caller
// does not directly own.
//----------------------------------------------------------------------------------------------------------------------

import type { NodeResponse } from '@fileshed/core';

// Intent
import { resolveDownload } from './handlers.ts';
import { canCopyNode, isOwnedBy } from './selection.ts';

// Utils
import { isDeadLink } from '../../utils/formatters/index.ts';

//----------------------------------------------------------------------------------------------------------------------

// saveCopy and makeCopy are the same copy, offered to a non-owner and an owner under different names; remove is a
// link's hard delete where anything else goes to the trash.
export type NodeMenuAction
    = | 'open'
    | 'download'
    | 'saveCopy'
    | 'addLink'
    | 'share'
    | 'copyLink'
    | 'copyDownloadLink'
    | 'rename'
    | 'move'
    | 'makeCopy'
    | 'trash'
    | 'remove';

//----------------------------------------------------------------------------------------------------------------------

// The node's menu as groups of actions, in display order.
export function nodeMenu(node : NodeResponse, userID : string | null) : NodeMenuAction[][]
{
    const owned = isOwnedBy(node, userID);

    if(isDeadLink(node)) { return owned ? [ [ 'remove' ] ] : []; }

    const open : NodeMenuAction[] = resolveDownload(node) === null ? [ 'open' ] : [ 'open', 'download' ];
    const copyable = canCopyNode(node);

    // Placing a link asks only read access -- it is a pointer in the caller's own tree, not a change to what it points
    // at. A link is the one thing that cannot be linked: the server refuses a link to a link.
    const linkable = node.type !== 'link';

    if(!owned)
    {
        const foreign : NodeMenuAction[] = [];
        if(copyable) { foreign.push('saveCopy'); }
        if(linkable) { foreign.push('addLink'); }

        return foreign.length > 0 ? [ open, foreign ] : [ open ];
    }

    const groups : NodeMenuAction[][] = [ open ];

    // A node with a live public link hands it out from here, in either form, without the share dialog: the dialog is
    // where links are minted and killed, not where an existing one is fetched.
    if(node.type !== 'link')
    {
        const hasLink = (node.sharing?.linkURL ?? null) !== null;
        groups.push(hasLink ? [ 'share', 'copyLink', 'copyDownloadLink' ] : [ 'share' ]);
    }

    const edit : NodeMenuAction[] = [ 'rename', 'move' ];
    if(linkable) { edit.push('addLink'); }
    if(copyable) { edit.push('makeCopy'); }
    groups.push(edit);

    groups.push([ node.type === 'link' ? 'remove' : 'trash' ]);

    return groups;
}

//----------------------------------------------------------------------------------------------------------------------
