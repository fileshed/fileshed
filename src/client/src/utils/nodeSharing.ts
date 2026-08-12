//----------------------------------------------------------------------------------------------------------------------
// Node Sharing
//----------------------------------------------------------------------------------------------------------------------

import { type Ref, ref, watch } from 'vue';

import type { NodeSharing } from '@fileshed/core';

// Resource Access
import { getNode } from '../resource-access/nodes.ts';

//----------------------------------------------------------------------------------------------------------------------

export interface NodeSharingState
{
    sharing : Ref<NodeSharing | null>;
}

// One node's sharing for a surface holding its id and nothing else -- the media bar, which names the playing track
// rather than the routed file. Everywhere else the node itself is in hand and carries this already. A read that fails
// leaves it null: no badges beats a header that breaks over a fact it only decorates. A stale response never wins, so
// a fast switch between tracks cannot leave the previous one's badges on screen.
export function useNodeSharing(nodeID : Ref<string | null>) : NodeSharingState
{
    const sharing = ref<NodeSharing | null>(null);

    function load(id : string | null) : void
    {
        if(id === null)
        {
            sharing.value = null;
            return;
        }

        void getNode(id)
            .then((node) => { if(nodeID.value === id) { sharing.value = node.sharing; } })
            .catch(() => { if(nodeID.value === id) { sharing.value = null; } });
    }

    watch(nodeID, load, { immediate: true });

    return { sharing };
}

//----------------------------------------------------------------------------------------------------------------------
