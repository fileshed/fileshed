//----------------------------------------------------------------------------------------------------------------------
// Location Engine
//
// Turns a search hit's location into the line a result row draws, and decides whether "go to containing folder" is
// even offered.
//
// The anchor is the same one the drive puts at the head of its breadcrumb: a foreign chain roots under Shared with me,
// an own-tree chain under the caller's files root. A chain too long for a row keeps its anchor and the folders nearest
// the file -- those say where the file lives -- and drops the middle to an ellipsis. Pure, no I/O.
//----------------------------------------------------------------------------------------------------------------------

import { MAX_LOCATION_SEGMENTS, type NodeLocation } from '@fileshed/core';

//----------------------------------------------------------------------------------------------------------------------

export const LOCATION_ELLIPSIS = '…';

export interface LocationLine
{
    // Anchor first, ending at the containing folder. A dropped middle appears as a single ellipsis segment.
    segments : string[];

    // The whole chain unabbreviated, for the row's tooltip.
    full : string;
}

//----------------------------------------------------------------------------------------------------------------------

export function locationSegments(location : NodeLocation, rootLabel : string) : string[]
{
    return [
        location.foreign ? 'Shared with me' : rootLabel,
        ...location.crumbs.map((crumb) => crumb.name),
    ];
}

export function locationLine(
    location : NodeLocation,
    rootLabel : string,
    limit : number = MAX_LOCATION_SEGMENTS
) : LocationLine
{
    const segments = locationSegments(location, rootLabel);
    const full = segments.join(' / ');

    if(segments.length <= limit) { return { segments, full }; }

    // The anchor and the ellipsis take two of the budget; the rest goes to the tail, nearest the file.
    const anchor = segments[0] ?? rootLabel;
    const tail = segments.slice(segments.length - (limit - 2));

    return { segments: [ anchor, LOCATION_ELLIPSIS, ...tail ], full };
}

//----------------------------------------------------------------------------------------------------------------------

// Where "go to containing folder" lands, or null when there is nowhere to send the caller. A hit whose parent the
// caller cannot resolve has no visible containing folder -- the location line says Shared with me and stops -- so the
// action is withheld rather than navigating into a 404.
export function containingFolderRoute(
    location : NodeLocation,
    parentID : string | null,
    nodeID : string
) : string | null
{
    if(parentID === null) { return location.foreign ? null : `/?select=${ nodeID }`; }

    const nearest = location.crumbs.at(-1);
    if(nearest?.id !== parentID) { return null; }

    return `/folder/${ parentID }?select=${ nodeID }`;
}

//----------------------------------------------------------------------------------------------------------------------
