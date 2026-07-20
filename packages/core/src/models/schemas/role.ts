//----------------------------------------------------------------------------------------------------------------------
// Role Codec
//
// Reusable enum codecs for the permission role and its share-grantable subset. shareRoleCodec omits 'owner' so a share
// or share request cannot validate an owner grant.
//----------------------------------------------------------------------------------------------------------------------

import { z } from 'zod';

// Models
import { type Role, type ShareRole, roles, shareRoles } from '../role.ts';

// Utils
import { type Equals, typeAssert } from '../../utils/typeAssert.ts';

//----------------------------------------------------------------------------------------------------------------------

export const roleCodec = z.enum(roles);

export const shareRoleCodec = z.enum(shareRoles);

typeAssert<Equals<z.output<typeof roleCodec>, Role>>();
typeAssert<Equals<z.output<typeof shareRoleCodec>, ShareRole>>();

//----------------------------------------------------------------------------------------------------------------------
