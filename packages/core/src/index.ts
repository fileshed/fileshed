//----------------------------------------------------------------------------------------------------------------------
// @fileshed/core -- Domain Types and Zod Codecs
//
// DB row shapes never appear here -- they are a server resource-access implementation detail.
//----------------------------------------------------------------------------------------------------------------------

// Models
export type { Node, NodeType, FileNode, FolderNode, LinkNode } from './models/node.ts';

// Schemas
export { nodeCodec, parseNode } from './models/schemas/node.ts';

//----------------------------------------------------------------------------------------------------------------------
