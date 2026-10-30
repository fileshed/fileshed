//----------------------------------------------------------------------------------------------------------------------
// Media Keyboard Engine
//----------------------------------------------------------------------------------------------------------------------

const SEEK_STEP_SECONDS = 5;
const VOLUME_STEP = 0.1;

export type MediaShortcut
    = | { type : 'toggle-play' }
    | { type : 'seek'; deltaSeconds : number }
    | { type : 'volume'; delta : number };

//----------------------------------------------------------------------------------------------------------------------

export function resolveMediaShortcut(key : string) : MediaShortcut | null
{
    switch (key)
    {
        case ' ':
        case 'Spacebar':
            return { type: 'toggle-play' };

        case 'ArrowRight': return { type: 'seek', deltaSeconds: SEEK_STEP_SECONDS };
        case 'ArrowLeft': return { type: 'seek', deltaSeconds: -SEEK_STEP_SECONDS };
        case 'ArrowUp': return { type: 'volume', delta: VOLUME_STEP };
        case 'ArrowDown': return { type: 'volume', delta: -VOLUME_STEP };
        default: return null;
    }
}

//----------------------------------------------------------------------------------------------------------------------
