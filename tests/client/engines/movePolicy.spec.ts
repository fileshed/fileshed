//----------------------------------------------------------------------------------------------------------------------
// Move Policy
//----------------------------------------------------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';

import {
    canEnterFolder,
    canEnterFolderForMove,
    canMoveAllInto,
    canMoveInto,
} from '@client/engines/movePolicy.ts';

//----------------------------------------------------------------------------------------------------------------------

describe('canMoveInto', () =>
{
    it('allows moving into My Files, the empty root path', () =>
    {
        expect(canMoveInto('x', [])).toBe(true);
    });

    it('allows a destination that does not contain the moving node', () =>
    {
        expect(canMoveInto('x', [ 'a', 'b', 'c' ])).toBe(true);
    });

    it('rejects moving a folder into itself', () =>
    {
        expect(canMoveInto('x', [ 'x' ])).toBe(false);
    });

    it('rejects moving a folder into one of its own descendants', () =>
    {
        expect(canMoveInto('x', [ 'a', 'x', 'b' ])).toBe(false);
    });
});

//----------------------------------------------------------------------------------------------------------------------

describe('canEnterFolder', () =>
{
    it('refuses to descend into the moving folder itself', () =>
    {
        expect(canEnterFolder('x', 'x')).toBe(false);
    });

    it('allows descending into any other folder', () =>
    {
        expect(canEnterFolder('x', 'y')).toBe(true);
    });
});

//----------------------------------------------------------------------------------------------------------------------

describe('canMoveAllInto', () =>
{
    it('allows a destination that contains none of the moving nodes', () =>
    {
        expect(canMoveAllInto([ 'x', 'y' ], [ 'a', 'b' ])).toBe(true);
    });

    it('vetoes a destination inside any one selected folder\'s subtree', () =>
    {
        expect(canMoveAllInto([ 'x', 'y' ], [ 'a', 'y', 'b' ])).toBe(false);
    });

    it('allows moving the whole selection into My Files, the empty root path', () =>
    {
        expect(canMoveAllInto([ 'x', 'y' ], [])).toBe(true);
    });
});

//----------------------------------------------------------------------------------------------------------------------

describe('canEnterFolderForMove', () =>
{
    it('allows descending into a folder that is none of the moving nodes', () =>
    {
        expect(canEnterFolderForMove([ 'x', 'y' ], 'z')).toBe(true);
    });

    it('refuses to descend into any folder in the selection', () =>
    {
        expect(canEnterFolderForMove([ 'x', 'y' ], 'y')).toBe(false);
    });
});

//----------------------------------------------------------------------------------------------------------------------
