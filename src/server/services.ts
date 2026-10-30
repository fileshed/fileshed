//----------------------------------------------------------------------------------------------------------------------
// Service Composition
//
// Construction touches neither the database nor the storage root, so a spec can compose the graph over an unmigrated
// handle.
//----------------------------------------------------------------------------------------------------------------------

import {
    DEFAULT_SKIPPED_UPLOAD_NAMES,
    type InstanceLimits,
    MS_PER_DAY,
    type SocialProviderID,
    TICKET_TTL_MS,
    UNLIMITED_QUOTA,
    parseSkippedNames,
} from '@fileshed/core';

// Resource Access
import { AuthRA } from './resource-access/auth/index.ts';
import type { Auth } from './resource-access/auth/instance.ts';
import type { DatabaseHandle } from './resource-access/database/database.ts';
import { BlobRA } from './resource-access/blob/index.ts';
import { MediaTagsRA } from './resource-access/mediaTags/index.ts';
import { NodeRA } from './resource-access/nodes/index.ts';
import { ShareRA } from './resource-access/shares/index.ts';
import { UserRA } from './resource-access/users/index.ts';

// Managers
import { AccessTokenManager } from './managers/accessToken.ts';
import { AccountDeletionManager, deleteAccount } from './managers/accountDeletion.ts';
import { runAccountDeletionOnce } from './managers/accountDeletionSweep.ts';
import { AdminManager } from './managers/admin.ts';
import { ArchiveManager } from './managers/archive.ts';
import { AvatarManager } from './managers/avatar.ts';
import { BlobManager } from './managers/blob.ts';
import { BrandingManager } from './managers/branding.ts';
import { CredentialManager } from './managers/credentials.ts';
import { DeletionOfferManager } from './managers/deletionOffer.ts';
import { runGcOnce } from './managers/gc.ts';
import { LastRunTracker } from './managers/lastRun.ts';
import type { MailManager } from './managers/mail.ts';
import { MediaTagManager } from './managers/mediaTags.ts';
import { NodeManager } from './managers/node.ts';
import { runStagedUploadsOnce } from './managers/stagedUploads.ts';
import { PublicLinkManager } from './managers/publicLink.ts';
import { SessionManager } from './managers/session.ts';
import type { SettingsManager } from './managers/settings.ts';
import { SetupManager } from './managers/setup.ts';
import { ShareManager } from './managers/share.ts';
import { StatusManager } from './managers/status.ts';
import { SweepManager } from './managers/sweeps.ts';
import { runTrashPurgeOnce } from './managers/trashPurge.ts';
import { UserManager } from './managers/user.ts';

// Utils
import type { Config } from './utils/config.ts';
import type { BuildInfo } from './utils/version.ts';

//----------------------------------------------------------------------------------------------------------------------

export interface AppServices
{
    sessions : SessionManager;
    accessTokens : AccessTokenManager;
    blobs : BlobManager;
    mediaTags : MediaTagManager;
    credentials : CredentialManager;
    avatars : AvatarManager;
    nodes : NodeManager;
    shares : ShareManager;
    publicLinks : PublicLinkManager;
    archives : ArchiveManager;
    deletionOffers : DeletionOfferManager;
    adminStatus : StatusManager;
    sweeps : SweepManager;
    users : UserManager;
    setup : SetupManager;
    settings : SettingsManager;
    branding : BrandingManager;
    admins : AdminManager;
    accountDeletions : AccountDeletionManager;
    mail : MailManager;

    // The size caps /api/instance publishes, resolved per request so a raised cap needs no restart.
    limits : () => Promise<InstanceLimits>;

    // The OAuth providers frozen into this process's auth instance at boot, for /api/instance.
    providers : SocialProviderID[];

    // What this process reports itself as, for /api/version and the OpenAPI document.
    build : BuildInfo;
}

// The settings and mail managers come in already built: the auth instance this graph is composed over needs the mail
// manager, and the settings manager is sealed with the same secret that instance was built from.
export interface ServiceDeps
{
    config : Config;
    handle : DatabaseHandle;
    auth : Auth;
    settings : SettingsManager;
    mail : MailManager;
    providers : SocialProviderID[];
    build : BuildInfo;
    started : Date;
}

//----------------------------------------------------------------------------------------------------------------------

export function composeServices(deps : ServiceDeps) : AppServices
{
    const { config, handle, settings, mail, providers, build, started } = deps;

    const auth = new AuthRA(deps.auth, handle);
    const blobRA = new BlobRA(handle);
    const nodeRA = new NodeRA(handle);
    const shareRA = new ShareRA(handle);
    const userRA = new UserRA(handle);
    const tracker = new LastRunTracker();

    // The tunables are closures over the settings manager, resolved per use: an admin override applies to the very
    // next request, and with no override each supplier answers the config value it names. DEFAULT_QUOTA_BYTES has no
    // config twin -- its floor is the vocabulary's own fallback, unlimited.
    const uploadMaxBytes = () : Promise<number> => settings.numberValue('UPLOAD_MAX_BYTES', config.UPLOAD_MAX_BYTES);
    const skippedUploadNames = async () : Promise<string[]> =>
        parseSkippedNames(await settings.stringValue('SKIPPED_UPLOAD_NAMES', DEFAULT_SKIPPED_UPLOAD_NAMES));
    const avatarMaxBytes = () : Promise<number> => settings.numberValue('AVATAR_MAX_BYTES', config.AVATAR_MAX_BYTES);
    const trashPurgeDays = () : Promise<number> => settings.numberValue('TRASH_PURGE_DAYS', config.TRASH_PURGE_DAYS);
    const gcGraceDays = () : Promise<number> => settings.numberValue('GC_GRACE_DAYS', config.GC_GRACE_DAYS);
    const gcGraceMs = async () : Promise<number> => await gcGraceDays() * MS_PER_DAY;
    const accountDeletionDays = () : Promise<number> =>
        settings.numberValue('ACCOUNT_DELETION_DAYS', config.ACCOUNT_DELETION_DAYS);
    const defaultQuota = () : Promise<number> => settings.numberValue('DEFAULT_QUOTA_BYTES', UNLIMITED_QUOTA);

    const avatars = new AvatarManager({ handle, blob: blobRA, avatarMaxBytes });
    const accountDeletions = new AccountDeletionManager({ auth, handle, deletionDays: accountDeletionDays });

    const nodes = new NodeManager({
        handle,
        orphanedBlobs: (tx) => new BlobRA(tx),
        policy: {
            offerGraceMs: gcGraceMs,
            defaultQuota,
        },
    });
    const mediaTags = new MediaTagManager({ blob: blobRA, tags: new MediaTagsRA(handle) });
    const blobs = new BlobManager({
        handle,
        blob: blobRA,
        uploadMaxBytes,
        skippedUploadNames,
        uploadChunkBytes: config.UPLOAD_CHUNK_BYTES,
        defaultQuota,
        responder: nodes,
        tags: mediaTags,
    });

    // One deletion, however it was asked for: an admin deleting somebody and a self-requested deletion falling due
    // are the same act on the same dependencies.
    const purgeAccount = (userID : string) : Promise<void> => deleteAccount({
        auth,
        nodes: nodeRA,
        shares: shareRA,
        purger: nodes,
        avatars,
    }, userID);

    // Both grace windows are resolved per sweep rather than closed over once, so an admin who lowers a retention and
    // then runs the sweep gets the window they just set, not the one this process booted with. The staged-upload window
    // is no setting at all: it is the ticket TTL, the point past which no chunk of that upload can still be honoured.
    const sweeps = new SweepManager({
        runners: {
            gc: () => runGcOnce({ blob: blobRA, graceMs: gcGraceMs }),
            trashPurge: () => runTrashPurgeOnce({
                nodes: nodeRA,
                purger: nodes,
                graceMs: async () => await trashPurgeDays() * MS_PER_DAY,
            }),
            stagedUploads: () => runStagedUploadsOnce({ blob: blobRA, ttlMs: TICKET_TTL_MS }),
            accountDeletion: () => runAccountDeletionOnce({
                users: userRA,
                deleteAccount: purgeAccount,
                windowMs: async () => await accountDeletionDays() * MS_PER_DAY,
            }),
        },
        tracker,
    });

    return {
        sessions: new SessionManager(auth),
        accessTokens: new AccessTokenManager(auth),
        blobs,
        mediaTags,
        credentials: new CredentialManager(auth),
        avatars,
        nodes,
        shares: new ShareManager(handle),
        publicLinks: new PublicLinkManager({ handle, blob: blobRA }),
        archives: new ArchiveManager({ handle, blob: blobRA }),
        deletionOffers: new DeletionOfferManager({ handle, materializer: nodes }),
        adminStatus: new StatusManager({
            handle,
            blob: blobRA,
            tracker,
            build,
            started,
            activeProviders: providers.length,
            emailEnabled: () => mail.isConfigured(),
            signUpEnabled: () => settings.booleanValue('SIGN_UP_ENABLED', true),
        }),
        sweeps,
        users: new UserManager({
            handle,
            defaultQuota,
            trashRetentionDays: trashPurgeDays,
            accountDeletionDays,
            deletionSchedule: (userID) => accountDeletions.scheduleFor(userID),
        }),
        setup: new SetupManager({ auth, handle, operatorToken: config.FILESHED_SETUP_TOKEN ?? null }),
        settings,
        branding: new BrandingManager({ handle, blob: blobRA, maxBytes: avatarMaxBytes }),
        admins: new AdminManager({ auth, handle, deleteAccount: purgeAccount, defaultQuota }),
        accountDeletions,
        mail,
        limits: async () =>
        {
            const [ upload, avatar, skipped ] = await Promise.all([
                uploadMaxBytes(),
                avatarMaxBytes(),
                skippedUploadNames(),
            ]);

            return { uploadMaxBytes: upload, avatarMaxBytes: avatar, skippedUploadNames: skipped };
        },
        providers,
        build,
    };
}

//----------------------------------------------------------------------------------------------------------------------
