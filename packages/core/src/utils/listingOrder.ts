//----------------------------------------------------------------------------------------------------------------------
// Listing Order
//
// The one statement of how FileShed orders a listing, and the only one any tier may sort by. The client calls the
// comparator below; the server builds its ORDER BY from the same field table, mapping each field to its column. A
// listing bigger than the client holds is ordered entirely by the database, and one smaller is re-ordered in the
// browser, so a reader scrolling past that line sees both -- they have to be the same order, row for row.
//
// Three rules, and every key obeys all three:
//
// - Folders lead. Always, whichever key sorts the rest and whichever direction it runs.
// - Absent sorts after every value. A folder is not measured and a link is a pointer, so neither has a size; nothing
//   but a file has a format. Absent is not zero and not the empty string -- it is nothing, and nothing goes at the
//   end ascending, which the direction then flips as it flips everything else.
// - Ties break on name, then id. A key that cannot separate two rows leaves them in an order a reader can predict
//   rather than the order their ids happen to fall in, and the id is there so the result is total. The tiebreak
//   never reverses: flipping it would shuffle equal rows under someone who only changed the direction.
//----------------------------------------------------------------------------------------------------------------------

// Models
import type { NodeSortKey, SortDirection } from '../models/requests/nodes.ts';
import type { NodeType } from '../models/node.ts';

// Utils
import { compareNames } from './naturalOrder.ts';

//----------------------------------------------------------------------------------------------------------------------

// Everything the ordering reads and nothing more, so both tiers can satisfy it: the client hands it the DTOs it
// already holds, and the server the columns it selects to sort a page it has not fetched yet. Size and format are
// optional because nothing but a file has them.
export interface ListingOrderRow
{
    id : string;
    name : string;
    type : NodeType;
    createdAt : string;
    updatedAt : string;
    size ?: number | null;
    mimeType ?: string | null;
}

//----------------------------------------------------------------------------------------------------------------------

// The fields a listing may be ordered by. Domain names: the server maps each to the column holding it.
export const listingSortFields = [ 'name', 'size', 'createdAt', 'updatedAt', 'type', 'mimeType' ] as const;
export type ListingSortField = typeof listingSortFields[number];

// What each sort key compares, in order. `kind` is three fields deep because "type" alone leaves every file in one
// undifferentiated block: files and links separate first, then formats, then names.
export const LISTING_SORT_FIELDS : Record<NodeSortKey, readonly ListingSortField[]> = {
    name: [ 'name' ],
    size: [ 'size' ],
    createdAt: [ 'createdAt' ],
    updatedAt: [ 'updatedAt' ],
    kind: [ 'type', 'mimeType', 'name' ],
};

// The fields after the key's own, in order, that settle a tie. Ascending whatever the direction.
export const LISTING_TIEBREAK_FIELDS = [ 'name', 'id' ] as const;

//----------------------------------------------------------------------------------------------------------------------

// Timestamps cross the wire as fixed-width UTC instants, so ordering them as text orders them as time -- and spares a
// date parse per comparison, of which a big folder runs a hundred thousand.
function compareText(left : string, right : string) : number
{
    if(left < right) { return -1; }

    return left > right ? 1 : 0;
}

// Absent after present, whatever the values are. Both absent is a tie, which the tiebreak below then settles.
function compareAbsent(left : boolean, right : boolean) : number
{
    if(left === right) { return 0; }

    return left ? 1 : -1;
}

function sizeOf(row : ListingOrderRow) : number | null
{
    return row.type === 'file' ? row.size ?? null : null;
}

function mimeTypeOf(row : ListingOrderRow) : string | null
{
    return row.type === 'file' ? row.mimeType ?? null : null;
}

function compareField(field : ListingSortField, left : ListingOrderRow, right : ListingOrderRow) : number
{
    switch (field)
    {
        case 'name': return compareNames(left.name, right.name);
        case 'createdAt': return compareText(left.createdAt, right.createdAt);
        case 'updatedAt': return compareText(left.updatedAt, right.updatedAt);
        case 'type': return compareText(left.type, right.type);

        case 'size':
        {
            const [ one, other ] = [ sizeOf(left), sizeOf(right) ];
            if(one === null || other === null) { return compareAbsent(one === null, other === null); }

            return one - other;
        }

        case 'mimeType':
        {
            const [ one, other ] = [ mimeTypeOf(left), mimeTypeOf(right) ];
            if(one === null || other === null) { return compareAbsent(one === null, other === null); }

            return compareNames(one, other);
        }
    }
}

//----------------------------------------------------------------------------------------------------------------------

// Folders lead every ordering, so they are ranked before the key is consulted at all and the direction never reaches
// this.
function placeRank(row : ListingOrderRow) : number
{
    return row.type === 'folder' ? 0 : 1;
}

export function compareListingNodes(
    key : NodeSortKey,
    direction : SortDirection,
    left : ListingOrderRow,
    right : ListingOrderRow
) : number
{
    const places = placeRank(left) - placeRank(right);
    if(places !== 0) { return places; }

    const sign = direction === 'asc' ? 1 : -1;

    for(const field of LISTING_SORT_FIELDS[key])
    {
        const compared = compareField(field, left, right);
        if(compared !== 0) { return compared * sign; }
    }

    return compareNames(left.name, right.name) || compareText(left.id, right.id);
}

//----------------------------------------------------------------------------------------------------------------------
