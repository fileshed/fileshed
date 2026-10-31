//----------------------------------------------------------------------------------------------------------------------
// Node Codec -- discriminated union validation
//----------------------------------------------------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';

import { type FolderNode, type LinkNode, isHiddenTrash, nodeCodec } from '@fileshed/core';

//----------------------------------------------------------------------------------------------------------------------

describe('nodeCodec', () =>
{
    it('parses a valid file node', () =>
    {
        const fileNode = {
            id: 'node_file_1',
            type: 'file',
            name: 'report.pdf',
            ownerID: 'user_1',
            parentID: null,
            mimeType: 'application/pdf',
            blobID: 'blob_1',
            size: 2048,
            created: new Date('2026-01-01T00:00:00.000Z'),
            updated: new Date('2026-01-02T00:00:00.000Z'),
            trashed: null,
        };

        const result = nodeCodec.safeParse(fileNode);

        expect(result.success).toBe(true);
    });

    it('parses a valid folder node', () =>
    {
        const folderNode = {
            id: 'node_folder_1',
            type: 'folder',
            name: 'Photos',
            ownerID: 'user_1',
            parentID: null,
            created: new Date('2026-01-01T00:00:00.000Z'),
            updated: new Date('2026-01-01T00:00:00.000Z'),
            trashed: null,
        };

        const result = nodeCodec.safeParse(folderNode);

        expect(result.success).toBe(true);
    });

    it('parses a valid link node', () =>
    {
        const linkNode = {
            id: 'node_link_1',
            type: 'link',
            name: 'Shared report.pdf',
            ownerID: 'user_2',
            parentID: 'node_folder_1',
            targetNodeID: 'node_file_1',
            created: new Date('2026-01-03T00:00:00.000Z'),
            updated: new Date('2026-01-03T00:00:00.000Z'),
        };

        const result = nodeCodec.safeParse(linkNode);

        expect(result.success).toBe(true);
    });

    // blobID is files-only. A link substituting a file's exclusive field for its own required one (targetNodeID) must
    // not validate as either variant.
    it('rejects a link node carrying a blobID instead of a targetNodeID', () =>
    {
        const malformedLink = {
            id: 'node_link_2',
            type: 'link',
            name: 'Shared report.pdf',
            ownerID: 'user_2',
            parentID: null,
            blobID: 'blob_1',
            created: new Date('2026-01-03T00:00:00.000Z'),
            updated: new Date('2026-01-03T00:00:00.000Z'),
        };

        const result = nodeCodec.safeParse(malformedLink);

        expect(result.success).toBe(false);
    });

    // size is files-only. A folder is never charged a size of its own.
    it('rejects a folder node carrying a size field', () =>
    {
        const malformedFolder = {
            id: 'node_folder_2',
            type: 'folder',
            name: 'Photos',
            ownerID: 'user_1',
            parentID: null,
            size: 4096,
            created: new Date('2026-01-01T00:00:00.000Z'),
            updated: new Date('2026-01-01T00:00:00.000Z'),
            trashed: null,
        };

        const result = nodeCodec.safeParse(malformedFolder);

        expect(result.success).toBe(false);
    });

    // mime_type is files-only. A folder's type is structural; a link's derives from its target at resolution time.
    it('rejects a folder node carrying a mimeType', () =>
    {
        const malformedFolder = {
            id: 'node_folder_3',
            type: 'folder',
            name: 'Photos',
            ownerID: 'user_1',
            parentID: null,
            mimeType: 'inode/directory',
            created: new Date('2026-01-01T00:00:00.000Z'),
            updated: new Date('2026-01-01T00:00:00.000Z'),
            trashed: null,
        };

        const result = nodeCodec.safeParse(malformedFolder);

        expect(result.success).toBe(false);
    });

    // links are deleted directly, never trashed -- dead links persist as stubs, not trash entries. A trashed link is an
    // unrepresentable state.
    it('rejects a link node carrying a trashed timestamp', () =>
    {
        const malformedLink = {
            id: 'node_link_3',
            type: 'link',
            name: 'Shared report.pdf',
            ownerID: 'user_2',
            parentID: null,
            targetNodeID: 'node_file_1',
            created: new Date('2026-01-03T00:00:00.000Z'),
            updated: new Date('2026-01-03T00:00:00.000Z'),
            trashed: null,
        };

        const result = nodeCodec.safeParse(malformedLink);

        expect(result.success).toBe(false);
    });

    // type is one of file|folder|link -- no other variant exists.
    it('rejects a node whose type falls outside file, folder, and link', () =>
    {
        const unknownTypeNode = {
            id: 'node_x',
            type: 'shortcut',
            name: 'Mystery',
            ownerID: 'user_1',
            parentID: null,
            created: new Date('2026-01-01T00:00:00.000Z'),
            updated: new Date('2026-01-01T00:00:00.000Z'),
        };

        const result = nodeCodec.safeParse(unknownTypeNode);

        expect(result.success).toBe(false);
    });
});

//----------------------------------------------------------------------------------------------------------------------

describe('isHiddenTrash', () =>
{
    const folder = (trashed : Date | null) : FolderNode => ({
        id: 'node_folder',
        type: 'folder',
        name: 'Shared',
        ownerID: 'owner',
        parentID: null,
        created: new Date('2026-01-01T00:00:00.000Z'),
        updated: new Date('2026-01-01T00:00:00.000Z'),
        trashed,
    });

    it('hides a trashed node from anyone but its direct owner', () =>
    {
        const trashed = folder(new Date('2026-02-01T00:00:00.000Z'));

        expect(isHiddenTrash(trashed, 'recipient')).toBe(true);
        expect(isHiddenTrash(trashed, 'owner')).toBe(false);
    });

    it('hides nothing that is not in the trash', () =>
    {
        expect(isHiddenTrash(folder(null), 'recipient')).toBe(false);
    });

    it('never hides a link, which has no trash state of its own', () =>
    {
        const link : LinkNode = {
            id: 'node_link',
            type: 'link',
            name: 'Shared',
            ownerID: 'owner',
            parentID: null,
            targetNodeID: 'node_folder',
            created: new Date('2026-01-01T00:00:00.000Z'),
            updated: new Date('2026-01-01T00:00:00.000Z'),
        };

        expect(isHiddenTrash(link, 'recipient')).toBe(false);
    });
});

//----------------------------------------------------------------------------------------------------------------------
