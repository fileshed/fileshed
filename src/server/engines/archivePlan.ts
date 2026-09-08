//----------------------------------------------------------------------------------------------------------------------
// Archive Plan
//
// What a selection becomes inside an archive: which files go in, under what paths, which folders exist, and what was
// left out and why. Pure -- it is handed the walked subtree and the roles already resolved, and decides layout only.
//
// Paths are relative to the selection rather than to anyone's drive. A selected file is its own name at the archive
// root; a selected folder is a directory of that name with its tree beneath it. Nothing above the selection appears,
// so an archive of one deep folder does not carry the folders it happened to live under.
//
// A link resolves to what it points at, judged on its own terms: the caller's access to the TARGET decides, not
// their access to the link, and the bytes land under the link's own name because that is what the tree shows. A link
// to a folder is not followed -- it would reach outside the selection, and a link pointing back at an ancestor would
// have no end -- and the same content reached twice really is in the tree twice, so it is in the archive twice.
//
// What cannot go in is named in the manifest rather than failing the request:
//
// - A node the caller cannot read. Reachable mostly as a stale selection: a role resolves down the tree, so a folder
//   they can read has no descendant they cannot.
// - A trashed node. Trashing a folder stamps its whole subtree, so a trashed node under a live folder is one somebody
//   threw away on purpose; putting it back in an archive of that folder would undo the throwing away.
// - A link whose target is gone, unreadable, or a folder. The manifest names what it pointed at, so the note says
//   what is missing rather than only that something was.
//----------------------------------------------------------------------------------------------------------------------

// Models
import type { Node, Role } from '@fileshed/core';

//----------------------------------------------------------------------------------------------------------------------

export interface ArchiveFileEntry
{
    nodeID : string;
    blobID : string;
    size : number;

    // Where it lands inside the archive, '/'-separated and always relative.
    path : string;
}

export interface ArchiveOmission
{
    path : string;
    reason : string;
}

export interface ArchivePlan
{
    files : ArchiveFileEntry[];

    // Every folder the archive contains, parents before children, so an empty one still appears and the tree is
    // mirrored rather than implied by the files that happen to be in it.
    directories : string[];
    omissions : ArchiveOmission[];
}

export interface ArchivePlanInput
{
    // The ids the caller named, in the order they named them: what a colliding name is resolved against.
    selectedIDs : readonly string[];

    // Every node in the subtrees under those ids, the roots included.
    nodes : readonly Node[];

    // What the links among those nodes point at, by target id. A target can live anywhere, so these are fetched
    // rather than walked; one absent from here is a link with nothing on the other end.
    targets : ReadonlyMap<string, Node>;

    // The caller's resolved role per node id, targets included; absent or null means they cannot read it.
    roles : ReadonlyMap<string, Role | null>;
}

//----------------------------------------------------------------------------------------------------------------------

export const OMITTED_UNREADABLE = 'not readable by you';
export const OMITTED_TRASHED = 'in the trash';

// A link that could not be followed says what it pointed at, so the note names what is missing rather than only that
// something is.
export function omittedLink(target : Node | undefined, readable : boolean) : string
{
    if(target === undefined) { return 'a link to something that no longer exists'; }
    if(!readable) { return `a link to "${ target.name }", which is not readable by you`; }
    if(target.type === 'folder') { return `a link to the folder "${ target.name }", which is not followed`; }
    if(target.type === 'link') { return `a link to "${ target.name }", which is itself a link`; }

    return `a link to "${ target.name }", which is in the trash`;
}

//----------------------------------------------------------------------------------------------------------------------

// Anything a filesystem or an archive reader would choke on, plus the separators that would let a name climb out of
// the directory it belongs in. A name is a name here, never a path.
function safeSegment(name : string) : string
{
    const cleaned = name
        .replace(/[/\\]/gu, '_')
        // eslint-disable-next-line no-control-regex -- control characters are exactly what this strips
        .replace(/[\u0000-\u001f\u007f]/gu, '')
        .trim();

    if(cleaned === '' || cleaned === '.' || cleaned === '..') { return '_'; }

    return cleaned;
}

// Two selected roots can carry the same name from different folders, and the archive has only one root to put them
// in. The second gets a numbered suffix, before the extension where there is one, which is what every browser does
// to a repeated download.
function uniquePath(taken : Set<string>, path : string) : string
{
    if(!taken.has(path)) { return path; }

    const slash = path.lastIndexOf('/');
    const directory = slash === -1 ? '' : path.slice(0, slash + 1);
    const name = path.slice(slash + 1);

    const dot = name.lastIndexOf('.');
    const stem = dot > 0 ? name.slice(0, dot) : name;
    const extension = dot > 0 ? name.slice(dot) : '';

    for(let index = 2; ; index += 1)
    {
        const candidate = `${ directory }${ stem } (${ index })${ extension }`;
        if(!taken.has(candidate)) { return candidate; }
    }
}

//----------------------------------------------------------------------------------------------------------------------

function omissionFor(node : Node, readable : boolean) : string | null
{
    if(!readable) { return OMITTED_UNREADABLE; }
    if(node.type !== 'link' && node.trashedAt !== null) { return OMITTED_TRASHED; }

    return null;
}

//----------------------------------------------------------------------------------------------------------------------

// Every id a selected root's subtree covers, so a root nested inside another selected root is not laid out twice.
function markCovered(node : Node, childrenOf : ReadonlyMap<string, Node[]>, covered : Set<string>) : void
{
    if(covered.has(node.id)) { return; }

    covered.add(node.id);

    for(const child of childrenOf.get(node.id) ?? [])
    {
        markCovered(child, childrenOf, covered);
    }
}

//----------------------------------------------------------------------------------------------------------------------

export function planArchive(input : ArchivePlanInput) : ArchivePlan
{
    const byID = new Map(input.nodes.map((node) => [ node.id, node ]));
    const childrenOf = new Map<string, Node[]>();

    for(const node of input.nodes.filter((candidate) => candidate.parentID !== null))
    {
        const parentID = node.parentID ?? '';
        const siblings = childrenOf.get(parentID) ?? [];

        siblings.push(node);
        childrenOf.set(parentID, siblings);
    }

    const plan : ArchivePlan = { files: [], directories: [], omissions: [] };
    const taken = new Set<string>();

    // A selection can name a folder and something already inside it; the folder's own walk carries the child, so the
    // child is not also laid out at the archive root.
    const covered = new Set<string>();
    const roots = input.selectedIDs
        .map((id) => byID.get(id))
        .filter((node) : node is Node => node !== undefined);

    for(const root of roots)
    {
        markCovered(root, childrenOf, covered);
    }

    function place(node : Node, parentPath : string) : void
    {
        const readable = (input.roles.get(node.id) ?? null) !== null;
        const path = uniquePath(taken, `${ parentPath }${ safeSegment(node.name) }`);

        const omission = omissionFor(node, readable);
        if(omission !== null)
        {
            plan.omissions.push({ path, reason: omission });
            return;
        }

        // A link is judged on what it points at: the caller's access to the TARGET decides, and the bytes land under
        // the link's own name, because the link's name is what the tree shows.
        if(node.type === 'link')
        {
            const target = input.targets.get(node.targetNodeID);
            const targetReadable = target !== undefined && (input.roles.get(target.id) ?? null) !== null;

            if(target !== undefined && targetReadable && target.type === 'file' && target.trashedAt === null)
            {
                taken.add(path);
                plan.files.push({ nodeID: target.id, blobID: target.blobID, size: target.size, path });

                return;
            }

            plan.omissions.push({ path, reason: omittedLink(target, targetReadable) });

            return;
        }

        taken.add(path);

        if(node.type === 'folder')
        {
            plan.directories.push(path);

            for(const child of childrenOf.get(node.id) ?? [])
            {
                place(child, `${ path }/`);
            }

            return;
        }

        plan.files.push({ nodeID: node.id, blobID: node.blobID, size: node.size, path });
    }

    // A root that another selected root already contains is laid out once, inside that one.
    const outermost = roots.filter((root) => root.parentID === null || !covered.has(root.parentID));

    for(const root of outermost)
    {
        place(root, '');
    }

    return plan;
}

//----------------------------------------------------------------------------------------------------------------------
