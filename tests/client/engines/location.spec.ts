//----------------------------------------------------------------------------------------------------------------------
// Location Engine — the location line, and where its action goes
//
// A location renders as an anchor plus the folders the caller may see: the caller's own files root, or Shared with me
// when the chain does not root in their tree. A chain too long for a result row keeps the anchor and the folders
// nearest the file, dropping the middle to an ellipsis. The go-to-folder action exists only when there is a folder the
// caller can actually open. Pure logic, real data, no mocks.
//----------------------------------------------------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';

import type { NodeLocation } from '@fileshed/core';

// Under test
import { LOCATION_ELLIPSIS, containingFolderRoute, locationLine } from '@client/engines/location.ts';

//----------------------------------------------------------------------------------------------------------------------

function chain(...names : string[]) : NodeLocation
{
    return { crumbs: names.map((name) => ({ id: `${ name }-id`, name })), foreign: false };
}

//----------------------------------------------------------------------------------------------------------------------

describe('locationLine', () =>
{
    it('heads an own-tree chain with the caller\'s own root label', () =>
    {
        const line = locationLine(chain('Projects', 'Q3'), 'My Files');

        expect(line.segments).toEqual([ 'My Files', 'Projects', 'Q3' ]);
    });

    // The root label is the caller's own -- renaming it in preferences has to follow through to a location line, or
    // search would name a root the drive no longer calls that.
    it('honours a renamed files root', () =>
    {
        const line = locationLine(chain('Projects'), 'Chris\'s Shed');

        expect(line.segments).toEqual([ 'Chris\'s Shed', 'Projects' ]);
    });

    it('heads a foreign chain with Shared with me instead of the files root', () =>
    {
        const line = locationLine({ ...chain('Team Docs'), foreign: true }, 'My Files');

        expect(line.segments).toEqual([ 'Shared with me', 'Team Docs' ]);
    });

    // A location at the root has no folders to name, so the anchor stands alone.
    it('renders the anchor alone for an empty chain', () =>
    {
        expect(locationLine({ crumbs: [], foreign: false }, 'My Files').segments).toEqual([ 'My Files' ]);
        expect(locationLine({ crumbs: [], foreign: true }, 'My Files').segments).toEqual([ 'Shared with me' ]);
    });

    // A deep chain is cut in the MIDDLE: the anchor says which tree, the last folders say where in it. Dropping the
    // tail instead would leave the reader knowing everything except the part that locates the file.
    it('drops the middle of a chain too long to render, keeping the anchor and the nearest folders', () =>
    {
        const line = locationLine(chain('One', 'Two', 'Three', 'Four', 'Five'), 'My Files', 4);

        expect(line.segments).toEqual([ 'My Files', LOCATION_ELLIPSIS, 'Four', 'Five' ]);
    });

    it('leaves a chain that exactly fits the budget intact', () =>
    {
        const line = locationLine(chain('One', 'Two', 'Three'), 'My Files', 4);

        expect(line.segments).toEqual([ 'My Files', 'One', 'Two', 'Three' ]);
    });

    // The abbreviated line is for the row; the tooltip still owes the reader the whole path.
    it('carries the unabbreviated chain regardless of what was dropped', () =>
    {
        const line = locationLine(chain('One', 'Two', 'Three', 'Four', 'Five'), 'My Files', 4);

        expect(line.full).toBe('My Files / One / Two / Three / Four / Five');
    });
});

//----------------------------------------------------------------------------------------------------------------------

describe('containingFolderRoute', () =>
{
    // Arriving selected is what finishes the action: the caller lands in the folder already pointed at the file.
    it('targets the containing folder and names the hit to select on arrival', () =>
    {
        const route = containingFolderRoute(chain('Projects', 'Q3'), 'Q3-id', 'file1');

        expect(route).toBe('/folder/Q3-id?select=file1');
    });

    it('sends a node at the caller\'s own root to the files root', () =>
    {
        const route = containingFolderRoute({ crumbs: [], foreign: false }, null, 'file1');

        expect(route).toBe('/?select=file1');
    });

    // A file shared straight off someone else's root has no folder the caller may open, and their root is not the
    // caller's to navigate to.
    it('offers nowhere to go for a node at another owner\'s root', () =>
    {
        expect(containingFolderRoute({ crumbs: [], foreign: true }, null, 'file1')).toBe(null);
    });

    // The parent is out of reach, so the chain never reaches it. Sending the caller there would be a 404.
    it('offers nowhere to go when the chain stops short of the direct parent', () =>
    {
        expect(containingFolderRoute({ crumbs: [], foreign: true }, 'hidden', 'file1')).toBe(null);
    });

    // The nearest visible crumb being an ANCESTOR rather than the parent means the walk was cut: the parent itself is
    // unreachable, so the action must not offer that ancestor as a stand-in.
    it('refuses to stand an ancestor in for an unreachable parent', () =>
    {
        const location : NodeLocation = { crumbs: [ { id: 'shareRoot', name: 'Team Docs' } ], foreign: true };

        expect(containingFolderRoute(location, 'someHiddenParent', 'file1')).toBe(null);
    });
});

//----------------------------------------------------------------------------------------------------------------------
