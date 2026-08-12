//----------------------------------------------------------------------------------------------------------------------
// Access Token Domain Model
//
// A scope names a user-facing capability bundle; what a key stores is its permission statement -- a resource-to-
// actions record checked by exact containment, no hierarchy. Broader scopes therefore STORE the narrower actions
// (files:write carries read and download too), so one checkbox mints a usable key and verification stays a plain
// subset test. A key's statement is frozen at mint: scopes added to the vocabulary later never accrue to old keys.
//----------------------------------------------------------------------------------------------------------------------

export const accessTokenScopes = [
    'files:download',
    'files:read',
    'files:write',
    'shares:read',
    'shares:write',
    'account:read',
] as const;
export type AccessTokenScope = typeof accessTokenScopes[number];

export type PermissionStatement = Record<string, string[]>;

export interface AccessToken
{
    id : string;
    name : string;
    start : string | null;
    scopes : AccessTokenScope[];
    createdAt : Date;
    lastUsedAt : Date | null;
    expiresAt : Date | null;
}

//----------------------------------------------------------------------------------------------------------------------

export const scopeStatements : Record<AccessTokenScope, PermissionStatement> = {
    'files:download': { files: [ 'download' ] },
    'files:read': { files: [ 'read', 'download' ] },
    'files:write': { files: [ 'read', 'download', 'write' ] },
    'shares:read': { shares: [ 'read' ] },
    'shares:write': { shares: [ 'read', 'write' ] },
    'account:read': { account: [ 'read' ] },
};

// The union of the chosen scopes' statements -- what actually gets stored on a minted key.
export function statementForScopes(scopes : readonly AccessTokenScope[]) : PermissionStatement
{
    const merged : Record<string, Set<string>> = {};
    for(const scope of scopes)
    {
        for(const [ resource, actions ] of Object.entries(scopeStatements[scope]))
        {
            merged[resource] = merged[resource] ?? new Set();
            for(const action of actions) { merged[resource].add(action); }
        }
    }

    return Object.fromEntries(Object.entries(merged).map(([ resource, actions ]) => [ resource, [ ...actions ] ]));
}

// What a route demands is the single action it exercises, never a scope's full bundle -- a listing route demanding
// files:read's whole statement would wrongly require the download action too. Routes reference these by name so a
// typo'd resource or action is a compile error, not a silently unsatisfiable gate.
export const permissionDemands = {
    filesDownload: { files: [ 'download' ] },
    filesRead: { files: [ 'read' ] },
    filesWrite: { files: [ 'write' ] },
    sharesRead: { shares: [ 'read' ] },
    sharesWrite: { shares: [ 'write' ] },
    accountRead: { account: [ 'read' ] },
} satisfies Record<string, PermissionStatement>;

// Whether a held statement covers everything a demand names -- the containment test verification runs, for the places
// that must ask it themselves rather than at a route gate.
export function statementSatisfies(held : PermissionStatement, demanded : PermissionStatement) : boolean
{
    return Object.entries(demanded).every(([ resource, actions ]) =>
    {
        const granted = held[resource];
        return granted !== undefined && actions.every((action) => granted.includes(action));
    });
}

// The scopes a stored statement satisfies, for displaying a key's capabilities. A scope is granted when every
// action its statement demands is present.
export function scopesFromStatement(statement : PermissionStatement) : AccessTokenScope[]
{
    return accessTokenScopes.filter((scope) => statementSatisfies(statement, scopeStatements[scope]));
}

//----------------------------------------------------------------------------------------------------------------------
