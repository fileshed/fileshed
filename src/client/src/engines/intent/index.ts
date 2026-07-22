//----------------------------------------------------------------------------------------------------------------------
// Intent Engine
//
// Interpreting user gestures into typed intents: what the user means to operate on, which operations apply to it,
// and what opening a node should do. Per-domain engines compose into one facade grouped by domain, so a caller
// reaches for `intent.selection.applyClick` or `intent.handlers.resolveOpen` rather than importing the chunk file
// directly. Pure, no I/O.
//----------------------------------------------------------------------------------------------------------------------

// Intent
import { applyClick, canCopySelection, clearSelection, emptySelection, planTrash, reconcile } from './selection.ts';
import { canViewInline, defaultEditorMode, resolveOpen } from './handlers.ts';

//----------------------------------------------------------------------------------------------------------------------

export const intent = {
    selection: {
        emptySelection,
        applyClick,
        clearSelection,
        reconcile,
        canCopySelection,
        planTrash,
    },
    handlers: {
        canViewInline,
        defaultEditorMode,
        resolveOpen,
    },
} as const;

//----------------------------------------------------------------------------------------------------------------------
// Re-exports
//----------------------------------------------------------------------------------------------------------------------

export type { SelectionState, ClickModifiers, TrashMode, TrashPlan } from './selection.ts';
export { emptySelection, applyClick, clearSelection, reconcile, canCopySelection, planTrash } from './selection.ts';

export type { EditorMode, OpenAction } from './handlers.ts';
export { EDITOR_MAX_BYTES, canViewInline, defaultEditorMode, resolveOpen } from './handlers.ts';

//----------------------------------------------------------------------------------------------------------------------
