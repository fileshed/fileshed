//----------------------------------------------------------------------------------------------------------------------
// Playlist File Engine
//
// The .m3u8 dialect FileShed reads and writes. A saved playlist is a valid Extended M3U any player can open: one
// location line per entry -- a drive path relative to the playlist's own folder, or an absolute http(s) URL -- with
// the standard #EXTINF metadata line, the standard #PLAYLIST display title when one was given, plus a
// #FILESHED:node= comment (ignored by every other player) carrying the entry's node id. On open the node id is
// what survives renames and moves; the path is the fallback that survives export and re-import; a URL streams from
// wherever it points. Parsing tolerates plain unextended M3U: bare location lines are entries too.
//----------------------------------------------------------------------------------------------------------------------

export interface PlaylistEntry
{
    nodeID : string | null;
    url : string | null;
    path : string | null;
    title : string | null;
}

export interface ParsedPlaylist
{
    title : string | null;
    entries : PlaylistEntry[];
}

export interface PlaylistRow
{
    nodeID : string | null;
    url : string | null;
    relativePath : string | null;
    title : string;
}

function isRemoteUrl(line : string) : boolean
{
    return line.startsWith('http://') || line.startsWith('https://');
}

//----------------------------------------------------------------------------------------------------------------------

export function parsePlaylist(text : string) : ParsedPlaylist
{
    const entries : PlaylistEntry[] = [];

    let playlistTitle : string | null = null;
    let pendingNodeID : string | null = null;
    let pendingTitle : string | null = null;

    for(const raw of text.split(/\r?\n/u))
    {
        const line = raw.trim();

        if(line.startsWith('#'))
        {
            const nodeMatch = /^#FILESHED:node=(?<id>\S+)$/u.exec(line);
            if(nodeMatch?.groups?.['id'] !== undefined) { pendingNodeID = nodeMatch.groups['id']; }

            const infoMatch = /^#EXTINF:[^,]*,(?<title>.*)$/u.exec(line);
            if(infoMatch?.groups !== undefined) { pendingTitle = infoMatch.groups['title']?.trim() || null; }

            const titleMatch = /^#PLAYLIST:(?<title>.*)$/u.exec(line);
            if(titleMatch?.groups !== undefined) { playlistTitle = titleMatch.groups['title']?.trim() || null; }
        }
        else if(line.length > 0)
        {
            entries.push({
                nodeID: pendingNodeID,
                url: isRemoteUrl(line) ? line : null,
                path: isRemoteUrl(line) ? null : line,
                title: pendingTitle,
            });

            pendingNodeID = null;
            pendingTitle = null;
        }
    }

    return { title: playlistTitle, entries };
}

// Durations are written as -1 (unknown) -- the tags pipeline doesn't read them, and every M3U consumer treats -1 as
// "ask the file". A remote entry has no node comment; a broken one has no place here at all (the caller filters).
export function serializePlaylist(rows : readonly PlaylistRow[], title : string | null = null) : string
{
    const lines : string[] = [ '#EXTM3U' ];

    if(title !== null && title.trim().length > 0) { lines.push(`#PLAYLIST:${ title.trim() }`); }

    for(const row of rows)
    {
        if(row.nodeID !== null) { lines.push(`#FILESHED:node=${ row.nodeID }`); }

        lines.push(`#EXTINF:-1,${ row.title }`);
        lines.push(row.url ?? row.relativePath ?? row.title);
    }

    return `${ lines.join('\n') }\n`;
}

//----------------------------------------------------------------------------------------------------------------------
