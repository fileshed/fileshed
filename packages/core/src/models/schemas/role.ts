//----------------------------------------------------------------------------------------------------------------------
// Role Codec
//
// Reusable enum codecs for the permission role and its share-grantable subset. shareRoleCodec omits 'owner' so a share
// or share request cannot validate an owner grant (requirements.md sec 3.4).
//----------------------------------------------------------------------------------------------------------------------

import { z } from 'zod';

// Models
import { roles, shareRoles } from '../role.ts';

//----------------------------------------------------------------------------------------------------------------------

export const roleCodec = z.enum(roles);

export const shareRoleCodec = z.enum(shareRoles);

//----------------------------------------------------------------------------------------------------------------------
