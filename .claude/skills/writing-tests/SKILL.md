---
name: writing-tests
description: Load whenever writing, reviewing, or fixing unit or integration tests in this repo. Enforces spec-first tests derived from requirements and contracts — not reverse-engineered from the implementation — with disciplined mocking and no coverage theater.
---

# Writing Tests for FileShed

Most AI-written tests are slop. They end up testing the mocking framework, or they test the code the AI just wrote instead of the spec, so they pass no matter what. The tell: fix a real bug and a "passing" test breaks, because it was coded to the implementation, not the requirement. This skill exists to stop that. Follow it for every test you write, review, or fix.

Tests live in `tests/{server,client,core}/` mirroring source, named `*.spec.ts`, run with Vitest.

## Spec-first, always

Decide what the code **should** do before you look at what it does.

Derive each test case from, in order of preference:

1. `docs/design/requirements.md` — the behavior it mandates.
2. The task description you were given.
3. The exported function's contract — its name, signature, and documented pre/postconditions.

Write the expected values by hand from that spec. Then read the implementation only to learn how to *call* the code — never to decide what the answer is.

If you cannot state what the spec requires for a case, **stop and ask**. Do not reverse-engineer the expectation from the implementation body. A test whose expected value came from the code under test proves nothing except that the code does what it does.

**Never** run the code and paste its output back as the assertion. That enshrines current behavior — bugs and all — as the "correct" answer.

```typescript
// BAD — expectation lifted from whatever the code currently returns
it('computes usage', () =>
{
    const used = usageFor(user, nodes);
    expect(used).toBe(4_294_967_296);  // where did this number come from? the code.
});

// GOOD — expectation derived from requirements §5: charged usage is the sum of
// logical size of owned, non-purged file nodes, including trashed.
it('charges owned file nodes including trashed, excluding purged', () =>
{
    const nodes =
    [
        ownedFile({ size: 1000, trashedAt: null }),
        ownedFile({ size: 500, trashedAt: new Date() }),   // trashed still counts
        ownedFile({ size: 999, purgedAt: new Date() }),    // purged does not
    ];

    expect(usageFor(userID, nodes)).toBe(1500);
});
```

## The bugfix litmus test

When you fix a bug and a test starts failing, the **test** is the first suspect, not your fix.

A correct test asserts the spec. Fixing a bug moves the code toward the spec, so a spec-derived test should pass *harder*, not break. If it breaks, it was almost certainly coded to the old, buggy implementation.

In review, say this out loud: "This test failed after the bugfix — checking whether it encoded the bug." Then re-derive the expectation from the spec. Only change the code (not the test) if the spec genuinely says the test was right and the "bug" was not a bug.

## Mocking discipline

- **Engines are pure** (no I/O). Test them with **real data and zero mocks**. If an engine needs a mock, it is not pure — fix the layering, don't mock around it.
- **Managers** orchestrate. Mock **only the resource-access boundary** (DB, blob backends). **Never mock engines** — run the real engine so the manager test exercises real logic.
- Prefer asserting an **observable outcome** (return value, resulting state) over asserting that a mock was called.
- If a test's primary assertion is a mock call count or argument, and an observable outcome exists, it is testing the mocking framework. Rewrite it to assert the outcome, or delete it.

```typescript
// BAD — asserts the framework, not the behavior
it('saves the node', async () =>
{
    await manager.rename(id, 'report.pdf');
    expect(ra.rename).toHaveBeenCalledWith(id, 'report.pdf');
});

// GOOD — mock only the RA boundary, assert the observable result
it('rejects a rename to an empty name', async () =>
{
    const ra = { rename: vi.fn() };
    const manager = new NodeManager(ra);

    await expect(manager.rename(id, '   ')).rejects.toThrow(/name/i);
    expect(ra.rename).not.toHaveBeenCalled();  // secondary: the write never happened
});
```

The mock-call check is fine as a **secondary** assertion (proving a write did or didn't happen). It must not be the whole test.

## Name tests after behavior

Each test must fail for a reason a reader can name from the test title alone. Name it after the requirement, not the method.

```typescript
// BAD
describe('save()', () =>
{
    it('works', () => { /* ... */ });
    it('test 2', () => { /* ... */ });
});

// GOOD
describe('NodeManager.upload', () =>
{
    it('rejects an upload when the owner quota would be exceeded', () => { /* ... */ });
    it('resurrects a graveyarded blob on a successful proof-of-possession', () => { /* ... */ });
});
```

## No coverage theater

Do not write tests that exist only to move the coverage number:

- No tests for trivial getters or pass-throughs.
- No snapshot tests standing in for real assertions.
- No re-asserting what the type checker already guarantees.
- No testing library or framework internals (Kysely, Hono, Zod, Vitest — they have their own tests).

A test that cannot fail for a describable, spec-level reason should not exist.

## Structure

- `tests/` mirrors source; one `*.spec.ts` per unit under test.
- One `describe` block per unit (`ClassName.method` or the function name).
- Arrange / Act / Assert, separated by blank lines.

```typescript
//----------------------------------------------------------------------------------------------------------------------
// Permission Engine — effective role resolution
//----------------------------------------------------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';

import { effectiveRole } from '@server/engines/permission.ts';

//----------------------------------------------------------------------------------------------------------------------

describe('effectiveRole', () =>
{
    it('takes the max of direct share, inherited share, and ownership', () =>
    {
        const grants = [ { role: 'viewer' as const }, { role: 'editor' as const } ];

        const role = effectiveRole({ userID, node, grants, isOwner: false });

        expect(role).toBe('editor');
    });

    it('resolves a dead link (revoked share) to no access', () =>
    {
        const role = effectiveRole({ userID, node, grants: [], isOwner: false });

        expect(role).toBe(null);
    });
});

//----------------------------------------------------------------------------------------------------------------------
```
