//----------------------------------------------------------------------------------------------------------------------
// Compile-Time Type Assertions
//
// Binds a Zod codec's inferred output to its hand-written canonical type. The type argument must resolve to `true`, so
// a codec that drifts from the type it should match fails the build at the assertion's call site rather than diverging
// silently. Runtime is a deliberate no-op -- the whole proof lives in the types.
//----------------------------------------------------------------------------------------------------------------------

// Mutual assignability. Wrapped in tuples so a union argument is compared as a whole rather than distributing over it.
export type Equals<A, B> = [ A ] extends [ B ] ? ([ B ] extends [ A ] ? true : false) : false;

export function typeAssert<T extends true>(_proof ?: T) : void { /* proof rides in the type argument */ }

//----------------------------------------------------------------------------------------------------------------------
