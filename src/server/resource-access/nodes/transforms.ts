//----------------------------------------------------------------------------------------------------------------------
// Node Row <-> Domain Transforms
//
// The row carries every variant's columns as nullable, so structurally a single row could claim to be a file with a
// target or a link with a size. The per-type CHECK of migration 001 makes such a row unstorable, so nodeFromRow treats
// one as store corruption and throws a typed error rather than coercing it away.
//----------------------------------------------------------------------------------------------------------------------

/* eslint-disable camelcase -- rowFromNode builds snake_case DB rows (house convention for Kysely inserts) */

import type { Insertable, Selectable } from 'kysely';

// Models
import { type Node, RowCorruptionError } from '@fileshed/core';

// Resource Access
import type { NodeTable } from '../database/database.ts';

//----------------------------------------------------------------------------------------------------------------------
// Row -> Domain
//----------------------------------------------------------------------------------------------------------------------

// A stored timestamp reads back as a Date (Postgres) or an ISO string (SQLite); new Date normalizes both (database.ts).
function toDate(value : Date | string) : Date
{
    return new Date(value);
}

function toNullableDate(value : Date | string | null) : Date | null
{
    return value === null ? null : new Date(value);
}

export function nodeFromRow(row : Selectable<NodeTable>) : Node
{
    const base = {
        id: row.id,
        name: row.name,
        ownerID: row.owner_id,
        parentID: row.parent_id,
        created: toDate(row.created),
        updated: toDate(row.updated),
    };

    switch (row.type)
    {
        case 'file':
        {
            if(row.blob_id === null || row.size === null || row.mime_type === null || row.target_node_id !== null)
            {
                throw new RowCorruptionError('node', row.id, `a file must carry a blob, size and mime type, and `
                    + 'no target');
            }

            return {
                ...base,
                type: 'file',
                blobID: row.blob_id,
                size: row.size,
                mimeType: row.mime_type,
                trashedAt: toNullableDate(row.trashed_at),
            };
        }

        case 'folder':
        {
            if(row.blob_id !== null || row.size !== null || row.mime_type !== null || row.target_node_id !== null)
            {
                throw new RowCorruptionError('node', row.id, `a folder must carry no file or link fields`);
            }

            return {
                ...base,
                type: 'folder',
                trashedAt: toNullableDate(row.trashed_at),
            };
        }

        case 'link':
        {
            if(row.target_node_id === null || row.blob_id !== null || row.size !== null || row.mime_type !== null
                || row.trashed_at !== null)
            {
                throw new RowCorruptionError('node', row.id, `a link must carry a target and no file or trash `
                    + 'fields');
            }

            return {
                ...base,
                type: 'link',
                targetNodeID: row.target_node_id,
            };
        }
    }
}

//----------------------------------------------------------------------------------------------------------------------
// Domain -> Row
//----------------------------------------------------------------------------------------------------------------------

export function rowFromNode(node : Node) : Insertable<NodeTable>
{
    const base = {
        id: node.id,
        type: node.type,
        name: node.name,
        owner_id: node.ownerID,
        parent_id: node.parentID,
        created: node.created.toISOString(),
        updated: node.updated.toISOString(),
    };

    switch (node.type)
    {
        case 'file':
            return {
                ...base,
                blob_id: node.blobID,
                size: node.size,
                mime_type: node.mimeType,
                target_node_id: null,
                trashed_at: node.trashedAt === null ? null : node.trashedAt.toISOString(),
            };

        case 'folder':
            return {
                ...base,
                blob_id: null,
                size: null,
                mime_type: null,
                target_node_id: null,
                trashed_at: node.trashedAt === null ? null : node.trashedAt.toISOString(),
            };

        case 'link':
            return {
                ...base,
                blob_id: null,
                size: null,
                mime_type: null,
                target_node_id: node.targetNodeID,
                trashed_at: null,
            };
    }
}

//----------------------------------------------------------------------------------------------------------------------
