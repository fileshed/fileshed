//----------------------------------------------------------------------------------------------------------------------
// Media Keyboard Engine — shortcut resolution
//----------------------------------------------------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';

import { resolveMediaShortcut } from '@client/engines/media/keyboard.ts';

//----------------------------------------------------------------------------------------------------------------------

describe('resolveMediaShortcut', () =>
{
    it('resolves space to a play/pause toggle', () =>
    {
        expect(resolveMediaShortcut(' ')).toEqual({ type: 'toggle-play' });
    });

    it('resolves the horizontal arrows to a forward and backward seek', () =>
    {
        expect(resolveMediaShortcut('ArrowRight')).toEqual({ type: 'seek', deltaSeconds: 5 });
        expect(resolveMediaShortcut('ArrowLeft')).toEqual({ type: 'seek', deltaSeconds: -5 });
    });

    it('resolves the vertical arrows to a volume raise and lower', () =>
    {
        expect(resolveMediaShortcut('ArrowUp')).toEqual({ type: 'volume', delta: 0.1 });
        expect(resolveMediaShortcut('ArrowDown')).toEqual({ type: 'volume', delta: -0.1 });
    });

    it('resolves an unrelated key to no action', () =>
    {
        expect(resolveMediaShortcut('a')).toBeNull();
        expect(resolveMediaShortcut('Escape')).toBeNull();
        expect(resolveMediaShortcut('Enter')).toBeNull();
    });
});

//----------------------------------------------------------------------------------------------------------------------
