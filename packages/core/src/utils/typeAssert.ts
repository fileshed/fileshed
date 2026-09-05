//----------------------------------------------------------------------------------------------------------------------
// Compile-Time Type Assertions
//
// Binds a Zod codec's inferred output to its hand-written canonical type. The type argument must resolve to `true`, so
// a codec that drifts from the type it should match fails the build at the assertion's call site rather than diverging
// silently. Runtime is a deliberate no-op -- the whole proof lives in the types.
//----------------------------------------------------------------------------------------------------------------------

// Identity, not mutual assignability. Assignability is blind in exactly the direction this assertion exists to
// watch: an optional property missing from one side is still assignable to the other, so a codec that had stopped
// producing an optional field went on proving it matched. Comparing two identical conditional types instead makes
// the checker compare the types themselves -- optionality, readonly and all -- and it does not distribute over a
// union argument either, which is what the tuples used to be for.
export type Equals<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;

export function typeAssert<T extends true>(_proof ?: T) : void { /* proof rides in the type argument */ }

//----------------------------------------------------------------------------------------------------------------------
