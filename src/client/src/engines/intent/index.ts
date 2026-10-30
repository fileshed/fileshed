//----------------------------------------------------------------------------------------------------------------------
// Intent Engine
//
// Callers reach for `intent.selection.applyClick` or `intent.handlers.resolveOpen` through this facade rather than
// importing a domain file directly.
//----------------------------------------------------------------------------------------------------------------------

// Intent
import {
    applyClick,
    canCopyNode,
    canCopySelection,
    canShareNode,
    clearSelection,
    emptySelection,
    isOwnedBy,
    ownsSelection,
    planTrash,
    reconcile,
    selectOnly,
} from './selection.ts';
import {
    canViewInline,
    defaultEditorMode,
    resolveDownload,
    resolveOpen,
    resolveSharedDownload,
    resolveSharedOpen,
} from './handlers.ts';
import { nodeMenu } from './menu.ts';

//----------------------------------------------------------------------------------------------------------------------

export const intent = {
    selection: {
        emptySelection,
        applyClick,
        clearSelection,
        reconcile,
        selectOnly,
        canCopyNode,
        canCopySelection,
        planTrash,
        isOwnedBy,
        canShareNode,
        ownsSelection,
    },
    handlers: {
        canViewInline,
        defaultEditorMode,
        resolveOpen,
        resolveSharedOpen,
        resolveDownload,
        resolveSharedDownload,
    },
    menu: {
        nodeMenu,
    },
} as const;

//----------------------------------------------------------------------------------------------------------------------

export type { SelectionState } from './selection.ts';
export type { EditorMode, OpenAction } from './handlers.ts';
export type { NodeMenuAction } from './menu.ts';

//----------------------------------------------------------------------------------------------------------------------
