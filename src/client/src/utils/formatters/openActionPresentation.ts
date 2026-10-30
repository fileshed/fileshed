//----------------------------------------------------------------------------------------------------------------------
// Open Action Presentation
//----------------------------------------------------------------------------------------------------------------------

// Models
import type { OpenAction } from '../../engines/intent/index.ts';

//----------------------------------------------------------------------------------------------------------------------

const OPEN_ACTION_ICONS : Readonly<Record<OpenAction['kind'], string>> = {
    'navigate': 'i-lucide-folder-open',
    'edit': 'i-lucide-file-pen',
    'annotate': 'i-lucide-pen-tool',
    'play': 'i-lucide-play',
    'play-playlist': 'i-lucide-list-music',
    'view': 'i-lucide-external-link',
    'download': 'i-lucide-download',
    'none': 'i-lucide-external-link',
};

// The glyph on an Open entry, saying what opening this node will do.
export function openActionIcon(action : OpenAction) : string
{
    return OPEN_ACTION_ICONS[action.kind];
}

//----------------------------------------------------------------------------------------------------------------------
