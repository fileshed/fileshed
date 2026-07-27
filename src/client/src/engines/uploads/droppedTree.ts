//----------------------------------------------------------------------------------------------------------------------
// Dropped Tree Engine
//
// The shape a folder upload travels in: files at each level plus named subfolders, however it arrived -- an OS
// drag-and-drop (traversed from FileSystemEntry handles in resource access) or the folder picker input, whose files
// carry their place in webkitRelativePath. Both converge here so the uploads store has exactly one folder-upload
// shape to walk.
//----------------------------------------------------------------------------------------------------------------------

export interface DroppedFolder
{
    name : string;
    files : File[];
    folders : DroppedFolder[];
}

export interface DroppedPayload
{
    files : File[];
    folders : DroppedFolder[];
}

//----------------------------------------------------------------------------------------------------------------------

// Builds the tree the folder picker input describes: each file's webkitRelativePath ("Music/Album/track.mp3") names
// the folders above it, with the file seated at the deepest one. A file with no relative path is loose.
export function payloadFromRelativePaths(files : readonly File[]) : DroppedPayload
{
    const payload : DroppedPayload = { files: [], folders: [] };

    function folderFor(segments : readonly string[]) : DroppedFolder | null
    {
        let level : DroppedPayload | DroppedFolder = payload;

        for(const segment of segments)
        {
            let next : DroppedFolder | undefined = level.folders.find((folder) => folder.name === segment);

            if(next === undefined)
            {
                next = { name: segment, files: [], folders: [] };
                level.folders.push(next);
            }

            level = next;
        }

        return level === payload ? null : level as DroppedFolder;
    }

    for(const file of files)
    {
        const relativePath : string | undefined = file.webkitRelativePath;
        const segments = (relativePath ?? '').split('/')
            .slice(0, -1)
            .filter((segment) => segment.length > 0);
        const home = folderFor(segments);

        if(home === null) { payload.files.push(file); }
        else { home.files.push(file); }
    }

    return payload;
}

//----------------------------------------------------------------------------------------------------------------------
