//----------------------------------------------------------------------------------------------------------------------
// Manager Errors
//
// Typed errors managers throw to signal an HTTP-shaped outcome. The app's onError maps them to a status + our JSON
// error shape, keeping the routes thin and the mapping in one place.
//----------------------------------------------------------------------------------------------------------------------

// A caller authenticated but lacks the authority for this operation -> 403.
export class ForbiddenError extends Error
{
    constructor(message : string)
    {
        super(message);
        this.name = 'ForbiddenError';
    }
}

//----------------------------------------------------------------------------------------------------------------------
