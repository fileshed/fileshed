//----------------------------------------------------------------------------------------------------------------------
// @fileshed/core -- Domain Types and Zod Codecs
//
// DB row shapes never appear here -- they are a server resource-access implementation detail.
//----------------------------------------------------------------------------------------------------------------------

// Models
export type { Node, FileNode, FolderNode, LinkNode } from './models/node.ts';
export { type NodeType, nodeTypes } from './models/node.ts';
export { type Role, type ShareRole, roles, shareRoles } from './models/role.ts';
export type { Share } from './models/share.ts';
export type { ShareRequest, PendingShareRequest, ResolvedShareRequest } from './models/shareRequest.ts';
export {
    type ShareRequestStatus,
    type ResolvedShareRequestStatus,
    shareRequestStatuses,
    resolvedShareRequestStatuses,
} from './models/shareRequest.ts';
export type { PublicLink } from './models/publicLink.ts';
export {
    type PublicLinkMode,
    type PublicLinkDisposition,
    publicLinkModes,
    publicLinkDispositions,
} from './models/publicLink.ts';
export type { Blob } from './models/blob.ts';
export type { DeletionOffer } from './models/deletionOffer.ts';
export { type StorageBackend, type StorageBackendKind, storageBackendKinds } from './models/storageBackend.ts';
export { type UserProfile, type UserRole, userRoles } from './models/userProfile.ts';

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

// Requests
export { isoDateTimeCodec } from './models/requests/common.ts';
export {
    type CreateFolderRequest,
    type CreateLinkRequest,
    type CreateNodeRequest,
    createFolderRequestCodec,
    createLinkRequestCodec,
    createNodeRequestCodec,
    type RenameRequest,
    type MoveRequest,
    type PatchNodeRequest,
    renameRequestCodec,
    moveRequestCodec,
    patchNodeRequestCodec,
    type NodeSortKey,
    nodeSortKeys,
    type SortDirection,
    sortDirections,
    type ChildrenQuery,
    childrenQueryCodec,
    type LinkTarget,
    linkTargetCodec,
    type NodeResponse,
    nodeResponseCodec,
    type NodeListResponse,
    nodeListResponseCodec,
    toNodeResponse,
} from './models/requests/nodes.ts';
export {
    type ClaimRequest,
    claimRequestCodec,
    type ClaimResponse,
    claimResponseCodec,
    type UploadCommitMetadata,
    uploadCommitMetadataCodec,
    type ChallengeAnswerRequest,
    challengeAnswerRequestCodec,
} from './models/requests/blobs.ts';
export { type MeResponse, meResponseCodec } from './models/requests/me.ts';

// Errors
export {
    UnauthorizedError,
    ForbiddenError,
    BadRequestError,
    NotFoundError,
    PayloadTooLargeError,
    TooManyRequestsError,
    type RegulationCode,
    type RegulationViolation,
    RegulationError,
    type BlobBackendErrorCode,
    BlobBackendError,
    BlobNotFoundError,
    HashMismatchError,
    SizeMismatchError,
    InvalidSha256Error,
    BackendNotFoundError,
    NoDefaultBackendError,
    UnsupportedBackendError,
    NodeRowCorruptionError,
} from './errors.ts';

//----------------------------------------------------------------------------------------------------------------------
