//----------------------------------------------------------------------------------------------------------------------
// Regulation Constants
//----------------------------------------------------------------------------------------------------------------------

// Models
import type { ErrorKind, RegulationCode } from '../errors.ts';

//----------------------------------------------------------------------------------------------------------------------

// Which refusal each code is: an authorization failure, where the caller understood the request but lacks the authority
// to place, link, trash or share here, or a legal request against an illegal state. The Record is total, so a new code
// can't ship unclassified.
export const REGULATION_CODE_KINDS : Record<RegulationCode, Extract<ErrorKind, 'forbidden' | 'illegalState'>> = {
    'link.targetIsLink': 'illegalState',
    'link.noAccess': 'forbidden',
    'parent.notFolder': 'illegalState',
    'parent.trashed': 'illegalState',
    'parent.crossOwner': 'forbidden',
    'parent.tooDeep': 'illegalState',
    'move.intoSelf': 'illegalState',
    'move.intoDescendant': 'illegalState',
    'trash.linkNotTrashable': 'illegalState',
    'trash.notOwner': 'forbidden',
    'copy.sourceNotFile': 'illegalState',
    'replace.notFile': 'illegalState',
    'replace.notEditor': 'forbidden',
    'share.linkNotShareable': 'illegalState',
    'share.notOwner': 'forbidden',
    'share.granteeIsOwner': 'illegalState',
    'shareRequest.notPending': 'illegalState',
    'shareRequest.notOwner': 'forbidden',
    'quota.exceeded': 'illegalState',
};

//----------------------------------------------------------------------------------------------------------------------
