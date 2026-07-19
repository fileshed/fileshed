//----------------------------------------------------------------------------------------------------------------------
// @fileshed/core -- Domain Types and Zod Codecs
//
// Re-exports the package's public surface: domain models (models/) and their Zod boundary codecs (codecs/), shared
// by the client and server workspaces.
//----------------------------------------------------------------------------------------------------------------------

// Models
export type { Node, NodeType, FileNode, FolderNode, LinkNode } from './models/node.ts';

// Codecs
export { nodeCodec, parseNode } from './codecs/node.ts';

//----------------------------------------------------------------------------------------------------------------------
