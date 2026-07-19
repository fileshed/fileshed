//----------------------------------------------------------------------------------------------------------------------
// @fileshed/core -- Domain Types and Zod Codecs
//
// DB row shapes never appear here -- they are a server resource-access implementation detail.
//----------------------------------------------------------------------------------------------------------------------

// Models
export type { Node, NodeType, FileNode, FolderNode, LinkNode } from './models/node.ts';
export type { Role, ShareRole } from './models/role.ts';
export type { Share } from './models/share.ts';
export type { ShareRequest, PendingShareRequest, ResolvedShareRequest } from './models/shareRequest.ts';
export type { PublicLink, PublicLinkMode, PublicLinkDisposition } from './models/publicLink.ts';
export type { Blob } from './models/blob.ts';
export type { DeletionOffer } from './models/deletionOffer.ts';
export type { StorageBackend, StorageBackendKind } from './models/storageBackend.ts';
export type { UserProfile, UserRole } from './models/userProfile.ts';

// Schemas
export { nodeCodec, parseNode } from './models/schemas/node.ts';
export { roleCodec, shareRoleCodec } from './models/schemas/role.ts';
export { shareCodec, parseShare } from './models/schemas/share.ts';
export { shareRequestCodec, parseShareRequest } from './models/schemas/shareRequest.ts';
export { publicLinkCodec, parsePublicLink } from './models/schemas/publicLink.ts';
export { blobCodec, parseBlob } from './models/schemas/blob.ts';
export { deletionOfferCodec, parseDeletionOffer } from './models/schemas/deletionOffer.ts';
export { storageBackendCodec, parseStorageBackend } from './models/schemas/storageBackend.ts';
export { userProfileCodec, parseUserProfile } from './models/schemas/userProfile.ts';

//----------------------------------------------------------------------------------------------------------------------
