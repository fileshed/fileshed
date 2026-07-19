//----------------------------------------------------------------------------------------------------------------------
// Role Codec
//
// Reusable enum codecs for the permission role and its share-grantable subset. shareRoleCodec omits 'owner' so a share
// or share request cannot validate an owner grant (requirements.md sec 3.4).
//----------------------------------------------------------------------------------------------------------------------

import { z } from 'zod';

//----------------------------------------------------------------------------------------------------------------------

export const roleCodec = z.enum([ 'viewer', 'editor', 'owner' ]);

export const shareRoleCodec = z.enum([ 'viewer', 'editor' ]);

//----------------------------------------------------------------------------------------------------------------------
