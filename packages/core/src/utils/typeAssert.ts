//----------------------------------------------------------------------------------------------------------------------
// Compile-Time Type Assertions
//----------------------------------------------------------------------------------------------------------------------

// Identity, not mutual assignability. Assignability is blind in exactly the direction this assertion exists to
// watch: an optional property missing from one side is still assignable to the other, so a codec that stopped
// producing an optional field would still prove it matched. Comparing two identical conditional types instead makes
// the checker compare the types themselves -- optionality, readonly and all -- and it does not distribute over a
// union argument either.
export type Equals<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;

export function typeAssert<T extends true>(_proof ?: T) : void { /* proof rides in the type argument */ }

//----------------------------------------------------------------------------------------------------------------------
