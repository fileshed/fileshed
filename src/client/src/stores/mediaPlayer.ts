//----------------------------------------------------------------------------------------------------------------------
// Media Player Store
//
// The open media page's playlist session: the queue of tracks, which one is current, and whether the next mounted
// track should start playing on its own. Playback state itself (position, volume, whether sound is coming out) lives
// with the native media element in the player components -- this store only decides WHAT plays, never how far along
// it is. Page-scoped like the annotator store: the host opens it on mount and resets it on leave.
//
// The autoplay flag is the one piece of playback the queue owns: opening the page arms nothing (the user presses
// play, as a single file always worked), while any queue-driven track change -- a row click, the transport's
// previous/next, the auto-advance when a track ends -- arms the incoming track to start immediately. Removing the
// current track does not arm: an edit to the list is not a request to start sound.
//
// Ended tracks route through advance(), which is NOT next(): it honours repeat-one, stops at the tail (or an
// exhausted shuffle cycle) unless repeat-all wraps around, and under shuffle jumps to a random not-yet-played
// file. A pressed Next never repeats-one and never dead-ends: an exhausted shuffle cycle just starts over.
//----------------------------------------------------------------------------------------------------------------------

import { computed, ref } from 'vue';
import { defineStore } from 'pinia';

import {
    MAX_CHILDREN_LIMIT,
    MEDIA_FOLDER_ADD_MAX_DEPTH,
    type NodeResponse,
    PLAYBACK_TOKEN_REFRESH_WINDOW_MS,
    PLAYLIST_SAVE_MIME,
    type UploadCommitMetadata,
} from '@fileshed/core';

// Engines
import {
    type MediaKind,
    type MediaQueue,
    type MediaTrack,
    type RepeatMode,
    appendTrack,
    brokenTrack,
    currentIndexOf,
    moveEntry,
    nextTrack,
    previousTrack,
    queueFromTrack,
    removeAt,
    selectAt,
    trackForPlay,
    trackFromNode,
    trackFromUrl,
    tracksOf,
    unplayedIndexes,
    withEntryFailed,
} from '../engines/media/queue.ts';

// Resource Access
import { mintPlaybackToken } from '../resource-access/accessTokens.ts';
import { answerChallenge, claimBlob, uploadTicket } from '../resource-access/blobs.ts';
import { fetchNodeBlob } from '../resource-access/content.ts';
import { type MediaTags, readMediaTags, releaseMediaTags } from '../resource-access/mediaTags.ts';
import { getChildren, getNode } from '../resource-access/nodes.ts';

// Engines
import { computeProofAnswer } from '../engines/claim.ts';
import {
    type PlaylistEntry,
    type PlaylistRow,
    parsePlaylist,
    serializePlaylist,
} from '../engines/media/playlistFile.ts';

// Utils
import { hashFile, readSampleWindows } from '../utils/hashFile.ts';
import { ensureExtension } from '../utils/formatters/formatExtension.ts';

//----------------------------------------------------------------------------------------------------------------------

export const useMediaPlayerStore = defineStore('mediaPlayer', () =>
{
    const queue = ref<MediaQueue | null>(null);
    const autoplay = ref(false);
    const shuffle = ref(false);
    const repeat = ref<RepeatMode>('off');

    // The files already heard this shuffle cycle. Off the reactive state -- nothing renders it -- and cleared
    // whenever shuffle toggles or a cycle exhausts under repeat-all.
    const playedIDs = new Set<string>();

    // The playlist FILE this session answers to: adopted by opening one (replace mode) or by Save As, and what the
    // Save button overwrites, guarded by the blob it last read or wrote. hostFolderID is where the routed file
    // lives -- the folder a Save As lands in when no playlist is adopted yet.
    const playlistNode = ref<NodeResponse | null>(null);
    const playlistTitle = ref<string | null>(null);
    const playlistBusy = ref(false);
    let playlistBlobID : string | null = null;
    const hostFolderID = ref<string | null>(null);

    // Folder id -> path segments from the root, cached because a queue's tracks mostly share folders.
    const folderSegmentsCache = new Map<string, string[]>();

    // Bumped only when WHAT should be playing changes -- open, a row click, previous/next, or the current track
    // being removed out from under playback. The host keys the mounted player on this, so editing the rest of the
    // list never remounts (and never restarts) the playing track.
    const playToken = ref(0);

    // The cast session's playback token: a short-lived download-scoped key the host appends to every drive track's
    // src, so a receiver handed the URL fetches bytes without a cookie jar. Minted when a cast session STARTS and
    // never before -- in-page playback is a same-origin request that carries the session cookie, so a key would only
    // put a credential in a URL that never needed one, where every proxy log on the way records it. Refreshed on a
    // track change inside the final window; a failed mint leaves it null and in-page playback is unbothered.
    const playbackToken = ref<{ id : string; token : string; expiresAt : number } | null>(null);
    let tokenMintInFlight = false;

    // Embedded tags by node, read lazily as tracks join the queue. An entry is absent until the read settles and
    // null when the file carries none -- both render as the filename, so tags only ever upgrade a row. Removing a
    // track keeps its entry: the tags are facts about the file, and the file may still sit elsewhere in the queue.
    const tags = ref(new Map<string, MediaTags | null>());
    const tagReadsInFlight = new Set<string>();

    const track = computed(() => queue.value?.current ?? null);
    const tracks = computed(() => { return queue.value === null ? [] : tracksOf(queue.value); });
    const currentIndex = computed(() => { return queue.value === null ? -1 : currentIndexOf(queue.value); });
    const hasPrevious = computed(() => queue.value !== null && queue.value.before.length > 0);

    // Next is a live control past the tail once shuffle or wrap-around can supply a track from elsewhere.
    const hasNext = computed(() =>
    {
        if(queue.value === null) { return false; }
        if(queue.value.after.length > 0) { return true; }

        return tracks.value.length > 1 && (shuffle.value || repeat.value === 'all');
    });

    //------------------------------------------------------------------------------------------------------------------

    function tagsFor(nodeID : string) : MediaTags | null
    {
        return tags.value.get(nodeID) ?? null;
    }

    function loadTags(entry : MediaTrack) : void
    {
        if(tags.value.has(entry.nodeID) || tagReadsInFlight.has(entry.nodeID)) { return; }

        tagReadsInFlight.add(entry.nodeID);
        void readMediaTags(entry.nodeID).then((read) =>
        {
            tagReadsInFlight.delete(entry.nodeID);
            tags.value.set(entry.nodeID, read);
        });
    }

    //------------------------------------------------------------------------------------------------------------------

    async function mintToken(previousID : string | null) : Promise<void>
    {
        if(tokenMintInFlight) { return; }

        tokenMintInFlight = true;
        try
        {
            const minted = await mintPlaybackToken(previousID);
            playbackToken.value = { id: minted.id, token: minted.token, expiresAt: Date.parse(minted.expiresAt) };
        }
        catch { /* in-page playback still rides the cookie; the next track change retries */ }
        finally
        {
            tokenMintInFlight = false;
        }
    }

    // A receiver is taking over, and it fetches the URL itself with no cookie jar to carry a session. This is the
    // only thing that mints a playback key. The token arriving changes the current track's src, so the element
    // reloads onto it on its own -- landing back where the listener was is the player's business, and it tells the
    // two apart by seeing a src that changed in nothing but its token.
    async function beginCasting() : Promise<void>
    {
        if(playbackToken.value !== null) { return; }

        await mintToken(null);
    }

    // A refresh and nothing else: no token means nothing is casting, and a track change is no reason to mint one.
    function refreshPlaybackTokenIfNeeded() : void
    {
        const stamp = playbackToken.value;
        if(stamp === null) { return; }

        if(stamp.expiresAt - Date.now() > PLAYBACK_TOKEN_REFRESH_WINDOW_MS) { return; }

        void mintToken(stamp.id);
    }

    //------------------------------------------------------------------------------------------------------------------

    function open(node : NodeResponse, kind : MediaKind) : void
    {
        const opened = trackForPlay(node, kind);
        queue.value = queueFromTrack(opened);
        autoplay.value = false;
        playToken.value += 1;
        playedIDs.clear();
        playlistNode.value = null;
        playlistTitle.value = null;
        playlistBlobID = null;
        hostFolderID.value = node.parentID;
        loadTags(opened);
    }

    // Non-media nodes have no seat in the queue and are dropped here rather than surfaced -- the picker only offers
    // media files, so there is nothing for a user to act on. Adding to an emptied playlist seats the track as
    // current without starting it. Whether a seat was taken is the return, so a bulk add can count its catch.
    function add(node : NodeResponse) : boolean
    {
        const added = trackFromNode(node);
        if(added === null) { return false; }

        queue.value = queue.value === null ? queueFromTrack(added) : appendTrack(queue.value, added);
        loadTags(added);

        return true;
    }

    // A whole folder joins the queue in listing order: its media files first, then each subfolder's, recursively.
    // The walk is depth-capped and reads one listing page per folder -- the same slice of a folder the picker
    // itself shows. Returns how many tracks were seated.
    async function addFolder(folderID : string) : Promise<number>
    {
        let seated = 0;

        async function walk(parentID : string, depth : number) : Promise<void>
        {
            if(depth > MEDIA_FOLDER_ADD_MAX_DEPTH) { return; }

            const page = await getChildren(parentID, { limit: MAX_CHILDREN_LIMIT, sortKey: 'name' });

            for(const child of page.nodes)
            {
                if(child.type === 'file' && add(child)) { seated += 1; }
            }

            // Serial on purpose: playlist order IS the walk order, and parallel listing fetches would interleave
            // subfolders' tracks nondeterministically.
            for(const child of page.nodes)
            {
                // eslint-disable-next-line no-await-in-loop -- ordered traversal, see above
                if(child.type === 'folder') { await walk(child.id, depth + 1); }
            }
        }

        await walk(folderID, 0);

        return seated;
    }

    function select(index : number) : void
    {
        if(queue.value === null) { return; }

        const selected = selectAt(queue.value, index);
        if(selected === queue.value) { return; }

        // A deliberate click on a failed track is a retry: the mark clears so playback actually attempts it.
        queue.value = selected.current.failed
            ? withEntryFailed(selected, selected.current.entryID, false)
            : selected;
        autoplay.value = true;
        playToken.value += 1;
        refreshPlaybackTokenIfNeeded();
    }

    // Reordering never changes WHAT is playing -- the current entry travels -- so no remount and no autoplay.
    function move(from : number, to : number) : void
    {
        if(queue.value === null) { return; }

        queue.value = moveEntry(queue.value, from, to);
    }

    // Restart whatever is current: a fresh mount of the same track, playing.
    function replay() : void
    {
        autoplay.value = true;
        playToken.value += 1;
        refreshPlaybackTokenIfNeeded();
    }

    function jumpTo(index : number) : void
    {
        if(queue.value === null) { return; }

        const target = selectAt(queue.value, index);
        queue.value = target;
        autoplay.value = true;
        playToken.value += 1;
        refreshPlaybackTokenIfNeeded();
    }

    // The shuffle jump: a random row whose file hasn't played this cycle. An exhausted cycle either starts over
    // (wrapAround) or reports false so the caller can stop.
    function shuffleJump(wrapAround : boolean) : boolean
    {
        if(queue.value === null) { return false; }

        let candidates = unplayedIndexes(queue.value, playedIDs);

        if(candidates.length === 0)
        {
            if(!wrapAround) { return false; }

            playedIDs.clear();
            playedIDs.add(queue.value.current.nodeID);
            candidates = unplayedIndexes(queue.value, playedIDs);

            if(candidates.length === 0)
            {
                replay();

                return true;
            }
        }

        const index = candidates[Math.floor(Math.random() * candidates.length)];
        if(index !== undefined) { jumpTo(index); }

        return true;
    }

    function next() : void
    {
        if(queue.value === null) { return; }

        playedIDs.add(queue.value.current.nodeID);

        // A pressed Next under shuffle keeps shuffling; an exhausted cycle starts over rather than dead-ending a
        // control the user just pressed.
        if(shuffle.value && tracks.value.length > 1)
        {
            shuffleJump(true);

            return;
        }

        const advanced = nextTrack(queue.value);

        if(advanced === null)
        {
            if(repeat.value === 'all' && tracks.value.length > 0) { jumpTo(0); }

            return;
        }

        queue.value = advanced;
        autoplay.value = true;
        playToken.value += 1;
        refreshPlaybackTokenIfNeeded();
    }

    // The ended-track advance. Unlike a pressed Next, this honours repeat-one, and at the queue's end (or an
    // exhausted shuffle cycle) it stops unless repeat-all wraps it around.
    function advance() : void
    {
        if(queue.value === null) { return; }

        if(repeat.value === 'one')
        {
            replay();

            return;
        }

        playedIDs.add(queue.value.current.nodeID);

        if(shuffle.value && tracks.value.length > 1)
        {
            shuffleJump(repeat.value === 'all');

            return;
        }

        const advanced = nextTrack(queue.value);

        if(advanced === null)
        {
            if(repeat.value === 'all' && tracks.value.length > 1) { jumpTo(0); }
            else if(repeat.value === 'all') { replay(); }

            return;
        }

        queue.value = advanced;
        autoplay.value = true;
        playToken.value += 1;
        refreshPlaybackTokenIfNeeded();
    }

    function previous() : void
    {
        if(queue.value === null) { return; }

        const stepped = previousTrack(queue.value);
        if(stepped === null) { return; }

        queue.value = stepped;
        autoplay.value = true;
        playToken.value += 1;
        refreshPlaybackTokenIfNeeded();
    }

    // A track error while the session's token is dead is a credential problem, not a media problem: re-mint and
    // remount the same track rather than letting the skip path eat the queue. (Playback position is not restored;
    // only a single file outlasting the whole token lifetime can land here.) A genuine media failure marks the
    // seat before skipping, so queue-driven playback never walks into it again -- a deliberate click retries.
    function handleTrackError() : void
    {
        const stamp = playbackToken.value;
        if(stamp !== null && stamp.expiresAt <= Date.now())
        {
            playbackToken.value = null;
            void mintToken(stamp.id).then(() =>
            {
                if(playbackToken.value !== null)
                {
                    autoplay.value = true;
                    playToken.value += 1;
                }
            });
            return;
        }

        if(queue.value !== null)
        {
            queue.value = withEntryFailed(queue.value, queue.value.current.entryID, true);
        }

        next();
    }

    //------------------------------------------------------------------------------------------------------------------
    // Playlist files -- opening resolves entries node-id-first (survives renames), then by relative path (survives
    // export and re-import), then keeps a visible broken row; saving serializes the queue back to the dialect.
    //------------------------------------------------------------------------------------------------------------------

    // A relative drive path walked segment by segment from the playlist's folder. '..' climbs; a missing segment is
    // a miss, not an error.
    async function resolvePath(baseFolderID : string | null, path : string) : Promise<NodeResponse | null>
    {
        const segments = path.split('/')
            .map((segment) => segment.trim())
            .filter((segment) => segment.length > 0 && segment !== '.');

        let cursor : string | null = baseFolderID;

        for(let index = 0; index < segments.length; index += 1)
        {
            const segment = segments[index];
            if(segment === undefined) { return null; }

            if(segment === '..')
            {
                // eslint-disable-next-line no-await-in-loop -- the walk is a chain; each level needs its parent
                cursor = cursor === null ? null : (await getNode(cursor)).parentID;
            }
            else if(index === segments.length - 1)
            {
                // eslint-disable-next-line no-await-in-loop -- final segment lookup ends the chain
                const page = await getChildren(cursor, { name: segment, limit: 2 });

                return page.nodes.find((node) => node.type === 'file') ?? null;
            }
            else
            {
                // eslint-disable-next-line no-await-in-loop -- the walk is a chain; each level needs its parent
                const page = await getChildren(cursor, { name: segment, types: [ 'folders' ], limit: 1 });
                const folder = page.nodes[0];
                if(folder === undefined || folder.type !== 'folder') { return null; }

                cursor = folder.id;
            }
        }

        return null;
    }

    async function resolveEntry(
        entry : PlaylistEntry,
        baseFolderID : string | null,
        index : number
    ) : Promise<MediaTrack>
    {
        if(entry.url !== null)
        {
            const remote = trackFromUrl(entry.url);

            return entry.title === null ? remote : { ...remote, name: entry.title };
        }

        if(entry.nodeID !== null)
        {
            try
            {
                const resolved = trackFromNode(await getNode(entry.nodeID));
                if(resolved !== null) { return resolved; }
            }
            catch { /* the id is gone or out of reach; the path below is the fallback */ }
        }

        if(entry.path !== null)
        {
            const found = await resolvePath(baseFolderID, entry.path).catch(() => null);
            const resolved = found === null ? null : trackFromNode(found);
            if(resolved !== null) { return resolved; }
        }

        return brokenTrack(entry.title ?? entry.path ?? 'Unknown entry', String(index));
    }

    function seatTracks(list : readonly MediaTrack[], mode : 'replace' | 'append') : void
    {
        if(mode === 'replace')
        {
            queue.value = null;
            autoplay.value = false;
            playToken.value += 1;
            playedIDs.clear();
        }

        for(const entry of list)
        {
            queue.value = queue.value === null ? queueFromTrack(entry) : appendTrack(queue.value, entry);
            if(entry.remoteUrl === null && !entry.broken) { loadTags(entry); }
        }
    }

    // Opening in replace mode adopts the file: Save then overwrites it. An append pours a playlist's tracks into
    // the current session without changing whose file it is.
    async function openPlaylistNode(
        node : NodeResponse,
        mode : 'replace' | 'append'
    ) : Promise<{ resolved : number; broken : number }>
    {
        playlistBusy.value = true;

        try
        {
            const text = await (await fetchNodeBlob(node.id)).text();
            const { title, entries } = parsePlaylist(text);

            const list : MediaTrack[] = [];
            for(let index = 0; index < entries.length; index += 1)
            {
                const entry = entries[index];

                if(entry !== undefined)
                {
                    // eslint-disable-next-line no-await-in-loop -- entries resolve serially to keep playlist order
                    list.push(await resolveEntry(entry, node.parentID, index));
                }
            }

            seatTracks(list, mode);

            if(mode === 'replace' && node.type === 'file')
            {
                playlistNode.value = node;
                playlistTitle.value = title;
                playlistBlobID = node.blobID;
                hostFolderID.value = node.parentID;
            }

            const broken = list.filter((entry) => entry.broken).length;

            return { resolved: list.length - broken, broken };
        }
        finally
        {
            playlistBusy.value = false;
        }
    }

    async function folderSegments(folderID : string | null) : Promise<string[]>
    {
        if(folderID === null) { return []; }

        const cached = folderSegmentsCache.get(folderID);
        if(cached !== undefined) { return cached; }

        const node = await getNode(folderID);
        const segments = [ ...await folderSegments(node.parentID), node.name ];
        folderSegmentsCache.set(folderID, segments);

        return segments;
    }

    function relativePath(baseSegments : readonly string[], fileSegments : readonly string[]) : string
    {
        let common = 0;
        while(common < baseSegments.length
            && common < fileSegments.length - 1
            && baseSegments[common] === fileSegments[common])
        {
            common += 1;
        }

        const ups = '../'.repeat(baseSegments.length - common);

        return `${ ups }${ fileSegments.slice(common).join('/') }`;
    }

    function rowTitle(entry : MediaTrack) : string
    {
        const read = tagsFor(entry.nodeID);
        if(read?.title && read.artist) { return `${ read.artist } - ${ read.title }`; }

        return read?.title ?? entry.name;
    }

    async function buildRows(targetFolderID : string | null) : Promise<PlaylistRow[]>
    {
        const baseSegments = await folderSegments(targetFolderID);
        const rows : PlaylistRow[] = [];

        for(const entry of tracks.value.filter((candidate) => !candidate.broken))
        {
            if(entry.remoteUrl !== null)
            {
                rows.push({ nodeID: null, url: entry.remoteUrl, relativePath: null, title: rowTitle(entry) });
            }
            else
            {
                try
                {
                    // eslint-disable-next-line no-await-in-loop -- each row's path depends on its own ancestor walk
                    const node = await getNode(entry.nodeID);
                    // eslint-disable-next-line no-await-in-loop -- each row's path depends on its own ancestor walk
                    const fileSegments = [ ...await folderSegments(node.parentID), node.name ];

                    rows.push({
                        nodeID: entry.nodeID,
                        url: null,
                        relativePath: relativePath(baseSegments, fileSegments),
                        title: rowTitle(entry),
                    });
                }
                catch { /* a track deleted since it was queued has no place in the saved file */ }
            }
        }

        return rows;
    }

    async function commitPlaylist(file : File, commit : UploadCommitMetadata) : Promise<NodeResponse>
    {
        const sha256 = await hashFile(file);
        const claim = await claimBlob({ sha256, size: file.size });

        if(claim.upload) { return uploadTicket(claim.ticket, file, commit); }

        const windows = await readSampleWindows(file, claim.ranges);
        const answer = await computeProofAnswer(claim.nonce, windows);

        return answerChallenge(claim.challengeID, { answer, ...commit });
    }

    async function savePlaylistAs(name : string, title : string | null = null) : Promise<void>
    {
        playlistBusy.value = true;

        try
        {
            const finalName = ensureExtension(name.trim(), '.m3u8');
            const finalTitle = title === null || title.trim().length === 0 ? null : title.trim();
            const parentID = playlistNode.value?.parentID ?? hostFolderID.value;
            const rows = await buildRows(parentID);
            const file = new File([ serializePlaylist(rows, finalTitle) ], finalName, { type: PLAYLIST_SAVE_MIME });

            // Saving onto the adopted file's own name overwrites it -- the server happily mints duplicate names,
            // and "Save As" pre-fills the current one, so create-always would fork a copy on the most obvious path.
            const adopted = playlistNode.value;
            const overwriting = adopted !== null && adopted.name === finalName && adopted.parentID === parentID;
            const commit : UploadCommitMetadata = overwriting
                ? { replaceNodeID: adopted.id, mimeType: PLAYLIST_SAVE_MIME }
                : { name: finalName, parentID, mimeType: PLAYLIST_SAVE_MIME };

            const saved = await commitPlaylist(file, commit);

            playlistNode.value = saved;
            playlistTitle.value = finalTitle;
            playlistBlobID = saved.type === 'file' ? saved.blobID : null;
        }
        finally
        {
            playlistBusy.value = false;
        }
    }

    async function savePlaylist() : Promise<void>
    {
        const target = playlistNode.value;
        if(target === null) { return; }

        playlistBusy.value = true;

        try
        {
            const rows = await buildRows(target.parentID);
            const file = new File(
                [ serializePlaylist(rows, playlistTitle.value) ],
                target.name,
                { type: PLAYLIST_SAVE_MIME }
            );

            const commit : UploadCommitMetadata = playlistBlobID === null
                ? { replaceNodeID: target.id, mimeType: PLAYLIST_SAVE_MIME }
                : { replaceNodeID: target.id, ifBlobID: playlistBlobID, mimeType: PLAYLIST_SAVE_MIME };

            const saved = await commitPlaylist(file, commit);

            playlistNode.value = saved;
            playlistBlobID = saved.type === 'file' ? saved.blobID : null;
        }
        finally
        {
            playlistBusy.value = false;
        }
    }

    // Retitling is a write-through: the new title lands in the file's bytes, and the ref only keeps it once the
    // save landed. Clearing to blank removes the title (the header falls back to the file name).
    async function retitlePlaylist(title : string) : Promise<void>
    {
        if(playlistNode.value === null) { return; }

        const formerTitle = playlistTitle.value;
        const trimmed = title.trim();
        playlistTitle.value = trimmed.length === 0 ? null : trimmed;

        try
        {
            await savePlaylist();
        }
        catch(caught)
        {
            playlistTitle.value = formerTitle;
            throw caught;
        }
    }

    //------------------------------------------------------------------------------------------------------------------

    function toggleShuffle() : void
    {
        shuffle.value = !shuffle.value;
        playedIDs.clear();
    }

    function cycleRepeat() : void
    {
        if(repeat.value === 'off') { repeat.value = 'all'; }
        else if(repeat.value === 'all') { repeat.value = 'one'; }
        else { repeat.value = 'off'; }
    }

    function removeTrack(index : number) : void
    {
        if(queue.value === null) { return; }

        const removingCurrent = index === currentIndexOf(queue.value);
        const remaining = removeAt(queue.value, index);
        if(remaining === queue.value) { return; }

        queue.value = remaining;
        autoplay.value = false;

        if(removingCurrent) { playToken.value += 1; }
    }

    function reset() : void
    {
        queue.value = null;
        autoplay.value = false;
        playToken.value = 0;
        playbackToken.value = null;
        shuffle.value = false;
        repeat.value = 'off';
        playedIDs.clear();
        playlistNode.value = null;
        playlistTitle.value = null;
        playlistBlobID = null;
        hostFolderID.value = null;
        folderSegmentsCache.clear();

        for(const read of tags.value.values())
        {
            if(read !== null) { releaseMediaTags(read); }
        }

        tags.value = new Map();
        tagReadsInFlight.clear();
    }

    //------------------------------------------------------------------------------------------------------------------

    return {
        queue,
        autoplay,
        playToken,
        playbackToken,
        shuffle,
        repeat,
        playlistNode,
        playlistTitle,
        playlistBusy,
        tags,
        track,
        tracks,
        currentIndex,
        hasPrevious,
        hasNext,
        tagsFor,
        open,
        add,
        addFolder,
        select,
        move,
        next,
        previous,
        advance,
        beginCasting,
        handleTrackError,
        toggleShuffle,
        cycleRepeat,
        openPlaylistNode,
        savePlaylist,
        savePlaylistAs,
        retitlePlaylist,
        removeTrack,
        reset,
    };
});

//----------------------------------------------------------------------------------------------------------------------
