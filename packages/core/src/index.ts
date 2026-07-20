//----------------------------------------------------------------------------------------------------------------------
// @fileshed/core -- Domain Types and Zod Codecs
//
// DB row shapes never appear here -- they are a server resource-access implementation detail.
//----------------------------------------------------------------------------------------------------------------------

// Models
export type { Node, FileNode, FolderNode, LinkNode } from './models/node.ts';
export { type NodeType, nodeTypes, isDirectOwner } from './models/node.ts';
export {
    type Role,
    type ShareRole,
    roles,
    shareRoles,
    roleRank,
    maxRole,
    isRoleAtLeast,
} from './models/role.ts';
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
export {
    type CreateFolderRequest,
    type CreateLinkRequest,
    type CreateNodeRequest,
    type CopyNodeRequest,
    type RenameRequest,
    type MoveRequest,
    type PatchNodeRequest,
    type NodeSortKey,
    nodeSortKeys,
    type SortDirection,
    sortDirections,
    type ChildrenQuery,
    type DeleteNodeQuery,
    type LinkTarget,
    type NodeResponse,
    type NodeListResponse,
} from './models/requests/nodes.ts';
export {
    type ClaimRequest,
    type ClaimResponse,
    type UploadCommitMetadata,
    type ChallengeAnswerRequest,
} from './models/requests/blobs.ts';
export { type MeResponse } from './models/requests/me.ts';
export {
    type CreatePublicLinkRequest,
    type PublicLinkResponse,
    type PublicLinkListResponse,
} from './models/requests/publicLinks.ts';
export {
    type GrantShareRequest,
    type ShareResponse,
    type ShareListResponse,
    type SharedTarget,
    type SharedWithMeEntry,
    type SharedWithMeResponse,
} from './models/requests/shares.ts';
export {
    type CreateAccessRequest,
    type AccessRequestResponse,
    type AccessRequestListResponse,
} from './models/requests/accessRequests.ts';
export { type SetQuotaRequest } from './models/requests/admin.ts';
export {
    type DeletionOfferResponse,
    type DeletionOfferListResponse,
    type AcceptDeletionOfferRequest,
} from './models/requests/deletionOffers.ts';

// Request Schemas
export { isoDateTimeCodec } from './models/requests/schemas/common.ts';
export {
    createFolderRequestCodec,
    createLinkRequestCodec,
    createNodeRequestCodec,
    copyNodeRequestCodec,
    renameRequestCodec,
    moveRequestCodec,
    patchNodeRequestCodec,
    childrenQueryCodec,
    deleteNodeQueryCodec,
    linkTargetCodec,
    nodeResponseCodec,
    nodeListResponseCodec,
    toNodeResponse,
} from './models/requests/schemas/nodes.ts';
export {
    claimRequestCodec,
    claimResponseCodec,
    uploadCommitMetadataCodec,
    challengeAnswerRequestCodec,
} from './models/requests/schemas/blobs.ts';
export { meResponseCodec } from './models/requests/schemas/me.ts';
export {
    createPublicLinkRequestCodec,
    publicLinkResponseCodec,
    publicLinkListResponseCodec,
    toPublicLinkResponse,
    toPublicLinkListResponse,
} from './models/requests/schemas/publicLinks.ts';
export {
    grantShareRequestCodec,
    shareResponseCodec,
    shareListResponseCodec,
    sharedTargetCodec,
    sharedWithMeEntryCodec,
    sharedWithMeResponseCodec,
    toShareResponse,
} from './models/requests/schemas/shares.ts';
export {
    createAccessRequestCodec,
    accessRequestResponseCodec,
    accessRequestListResponseCodec,
    toAccessRequestResponse,
} from './models/requests/schemas/accessRequests.ts';
export { setQuotaRequestCodec } from './models/requests/schemas/admin.ts';
export {
    acceptDeletionOfferRequestCodec,
    deletionOfferResponseCodec,
    deletionOfferListResponseCodec,
    toDeletionOfferResponse,
    toDeletionOfferListResponse,
} from './models/requests/schemas/deletionOffers.ts';

// Utils
export { type Equals, typeAssert } from './utils/typeAssert.ts';

// Constants
export * from './constants/index.ts';

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
