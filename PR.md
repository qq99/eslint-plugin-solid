# Detect reactive reads across Solid 2 effect and Match boundaries

## Summary

This PR adds Solid 2 validation for a subtle but high-impact bug: reading a reactive
value in the untracked `effect`/`apply` callback of a split effect.

It also adds `solid/require-match-narrowing`, enabled as an error in `v2` and
`v2-strict`. Match branches that independently reread data selected by `when` must
instead consume it through the narrowing callback. The rule handles direct value
conditions, boolean predicates, aliases, and supported render callbacks, with import
and regression coverage. A report identifies an independent source read, not proof
of a hydration error. See `FEATURE_RELEASE.md` for the scoped `.2` prerelease.

It also extends the existing `solid/reactivity` rule to understand asynchronous and
generator-based Solid 2 computations, and adds the static-analysis support needed to
follow reactive values through local aliases, wrappers, imports, async values, and
typed snapshots.

For Solid 2 projects, the new rule is enabled as an error by both `v2` and
`v2-strict`. It remains inactive unless Solid 2 is selected through
`settings.solid.version`.

## The problem

Solid 2 split effects separate dependency collection from the imperative side effect:

```ts
createEffect(compute, apply);
```

`compute` runs with reactive tracking. `apply` receives the computed value outside
tracking. This is intentional, but it means the following code does not subscribe to
changes to `settings.theme`:

```ts
const [settings] = createStore({ theme: "light" });

createEffect(
  () => settings,
  (value) => {
    document.body.dataset.theme = value.theme; // reactive read outside tracking
  }
);
```

The fix is to read the required property while computing a plain snapshot:

```ts
createEffect(
  () => settings.theme,
  (theme) => {
    document.body.dataset.theme = theme;
  }
);
```

This bug is particularly easy to write when a store is returned from a memo, query
wrapper, async computation, or generator. A shallow object copy also does not
necessarily help: nested store proxies can remain inside the copied object.

## What this PR changes

### 1. New `solid/no-reactive-read-in-effect-callback` rule

The rule checks the apply callback of `createEffect` and `createRenderEffect` under
Solid 2 semantics. It reports `untrackedRead` when a potentially reactive value is
read there, with guidance to read it in compute and pass a plain snapshot instead.

The rule handles:

- Signals, memos, stores, projections, optimistic primitives, `merge`, `omit`, props,
  and supported query objects.
- Import aliases, namespace imports, local aliases, destructuring, object/array
  containers, and direct local helper calls.
- The `{ effect, error }` form and the options argument used by split effects.
- Setter callbacks, where the draft and previous-value parameters are treated as safe
  local values while captured reactive state is still checked.
- Explicit `untrack` callbacks, which are intentionally exempt because their reads are
  deliberately untracked.
- Conventional `onX` callback props when their TypeScript signature is known to return
  `void`. This avoids treating imperative notifications as reactive dependencies, while
  still reporting untyped/accessor-like functions, store methods, callback references,
  and reactive arguments passed to callbacks.

The rule distinguishes a plain scalar snapshot from a nested proxy. It can use local
type annotations, interfaces, aliases, generic arguments, and imported type aliases
without requiring full typed-linting parser services. Unknown, `any`, and object-like
values remain potentially reactive so that the rule errs toward not missing a bug.

The diagnostic says "Potentially reactive value" because a props parameter is not proof
of a reactive read in every invocation. A `number` prop can be a plain field or a getter
backed by a signal: `<Dropdown offset={8} />` and
`<Dropdown offset={isCompact() ? 8 : 16} />` satisfy the same props type. Only the latter
needs reactive tracking for changes to that input to rerun positioning.

Known plain objects and arguments passed to local helpers from apply remain allowed.
Component props are still checked regardless of scalar/literal types, `readonly`, defaults,
or currently visible literal JSX callers. The rule does not attempt to prove that every
consumer across exports, aliases, wrappers, and spreads supplies static props. A diagnostic
therefore identifies a potentially missing dependency, not a guaranteed runtime warning
or an observable bug with today's callers. Explicit `untrack` remains the escape hatch
when changes to a value intentionally should not rerun the effect.

The rule recognizes `useQuery` and `useInfiniteQuery` from `@tanstack/solid-query`,
and can follow supported local wrappers and re-exports. Other unresolved reactive
object factories can be supplied through the `reactiveObjectFactories` option:

```json
{
  "settings": { "solid": { "version": 2 } },
  "rules": {
    "solid/no-reactive-read-in-effect-callback": [
      "error",
      { "reactiveObjectFactories": ["createSettingsStore"] }
    ]
  }
}
```

There is intentionally no autofix. Moving a read into compute or choosing the correct
snapshot shape requires application-level knowledge.

### 2. Async and generator support in `solid/reactivity`

In Solid 2, `createEffect` and `createRenderEffect` compute functions can be async.
Reactive dependency tracking stops at the first suspension point, just as it does for
other async computations. Reads after `await`, `yield`, or an async `for await` boundary
are now reported as `readAfterAwait` when appropriate.

The implementation also understands async generators used by Solid 2 computations:

- Reads before the first `yield` are tracked.
- Later reads are treated as occurring after suspension.
- `yield*` delegation is modeled separately from a generator's final `return` value.
- Async generator yields are unwrapped according to Solid's consumption boundary.
- `action` generators remain intentionally untracked and are not incorrectly reported.

The existing behavior for Solid 1 and unspecified Solid versions is preserved. The
one-phase `createTrackedEffect` remains synchronous and is not treated as an async
split-effect computation.

### 3. Shared bounded value/import/type analysis

The new analysis is split into focused utilities:

- `reactive-values.ts` models scalars, stores, accessors, plain containers, promises,
  iterators, yielded values, and final iterator returns.
- `reactive-imports.ts` follows local source files, aliases, default/named/namespace
  imports, re-exports, path aliases, supported Solid factories, and query factories.
- `reactive-types.ts` extracts conservative scalar and callback facts from local and
  imported TypeScript declarations.

This is source analysis, not execution and not a replacement for TypeScript's full type
checker. It does not inspect `node_modules` implementations or declaration files as
runtime implementations. Cross-file work is bounded to 32 local modules and 1,000
analysis steps per lookup. Unsupported expressions, dynamic calls, arbitrary Promise
combinators, custom iterator implementations, manual iterator consumption, and hidden
side effects remain outside the analysis boundary.

The published Node plugin's resolver uses its pinned `@typescript/typescript6` compatibility API,
so the consuming project's TypeScript compiler version cannot change the analysis quality or
results. The dependency is kept external in the Node plugin build.

In particular, projects using TypeScript 6 or TypeScript 7 receive the same resolver and type
refinement behavior as projects using TypeScript 5.x. This guarantee covers the rule's analysis;
the configured ESLint parser still needs to support the syntax in the linted source.

The standalone exception is for a real workspace package, `eslint-solid-standalone`, which bundles
ESLint and this plugin for the Solid playground and web workers. That bundle already externalizes
TypeScript and injects it at runtime. Its Rollup alias maps the compatibility import to that
injected API, preserving virtual-input scalar/type checks without attempting local filesystem
tracing. The standalone bundle's API is therefore governed by the TypeScript implementation its
host injects; the normal published Node plugin does not have this exception. Making the standalone
artifact independent of its host would require bundling the pinned compiler API into that browser
artifact, which is a separate size/runtime tradeoff.

Oxlint is a separate reason not to depend on parser services here. Oxlint's native type-aware
linting runs through its own type-aware pipeline, but its JavaScript plugin API does not pass those
TypeScript services to arbitrary ESLint-compatible plugins. The rule therefore uses its own bounded
source analysis and works under Oxlint without requiring typed-linting configuration.

### 4. Configuration, documentation, and integration coverage

- Registers the new rule in the plugin.
- Enables it as an error in `v2` and `v2-strict`.
- Adds generated rule documentation and updates the reactivity documentation.
- Updates the README rule table and Solid 2 configuration description.
- Extends standalone-bundle coverage for scalar refinement, Promise provenance,
  generator delegation, and virtual inputs.
- Adds ESLint and Oxlint integration coverage for the built plugin.
- Excludes analysis fixtures from the repository's own lint/typecheck inputs.

## Why this is not a duplicate of an existing rule

The existing rules cover adjacent but different failure modes:

| Existing rule                        | What it checks                                                                                                 | Why this PR is still needed                                                                                                                                                                         |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `solid/reactivity`                   | Whether reactive reads occur in a tracked scope, including reads after `await`/`yield` in tracked computations | Solid 2's apply callback is intentionally modeled as an imperative/called-function scope, so the existing rule does not trace whether the value crossing into it is still a store or another proxy. |
| `solid/no-single-arg-create-effect`  | Whether a Solid 2 effect uses the required two-argument API                                                    | It does not inspect the values returned by compute or read by apply.                                                                                                                                |
| `solid/no-write-in-pure-computation` | Writes from pure component/compute scopes                                                                      | This PR checks reads from the untracked apply scope.                                                                                                                                                |
| `solid/no-unused-signal`             | Signals that are only written or only read                                                                     | It does not detect a reactive object being read after it crossed the compute/apply boundary.                                                                                                        |
| `solid/no-react-deps`                | Legacy dependency-array usage                                                                                  | It is unrelated to reactive proxy reads in the apply callback.                                                                                                                                      |

The new rule therefore addresses a distinct boundary: not “was this expression read in
some untracked function?” but “did a reactive value escape compute and then get read in
the untracked half of a Solid 2 split effect?” Its value analysis is what separates this
from a generic untracked-read warning and prevents false positives for plain snapshots.

## Tests and validation

Current `.2` preparation: `pnpm run ci` passed all nine tasks, including 3,435
rule tests across the supported parsers, 10 integration tests, standalone tests,
both builds, documentation generation, lint, and typechecking.

Earlier branch-wide validation:

- `pnpm --filter eslint-plugin-solid test` — 47 test files, 1,069 tests passed.
- `pnpm --filter test exec vitest run async-effects.test.ts` — ESLint/Oxlint integration
  test passed.
- `pnpm --filter eslint-solid-standalone test` — standalone bundle test passed.
- `pnpm lint` — passed with zero warnings.
- `pnpm tsc` — passed.
- `pnpm --filter eslint-plugin-solid build` — plugin build and declaration generation
  passed.
- A lint run with a `typescript@7.0.2` consumer environment — no crash, and the expected
  `untrackedRead` diagnostic was reached using the plugin-owned API.

Additional validation for the clarified props policy:

- All six effect-callback rule test files passed across TypeScript, Babel, and Espree:
  664 tests, including new coverage for known plain props, helper arguments, explicit
  `untrack`, literal and conditional JSX callers, defaults, and scalar/readonly/literal types.
- Lint on the changed TypeScript files and the repository TypeScript check passed.
- Extracted positioning-effect bodies were exercised with pinned Solid development
  runtimes (`solid-js` and `@solidjs/signals`) on both rc.5 and rc.8. All eight scenarios
  passed on each version. Literal props produced no strict-read warnings; reactive props
  read in apply warned and missed prop-only updates; moving those reads into compute
  removed the warnings and reacted to updates. DOM and Floating UI operations were stubbed;
  this verifies dependency tracking and diagnostics, not browser layout.

Manual validation was also performed against four separate Solid 2 RC.5 repositories,
with the goals of confirming that linting does not crash on real applications and of
removing false positives found in those applications.

## Reviewer disclosure

This PR was created with Astra and has not yet received a thorough human review. Please
treat it as a draft for careful review of the Solid 2 semantics, especially:

- whether the compute/apply distinction and async/generator suspension model exactly
  match Solid 2 RC.5;
- whether the conservative value classification is appropriately strict for stores,
  nested containers, promises, and imported wrappers;
- whether enabling the rule as an error in both Solid 2 presets is appropriate;
- whether the bounded local-module/type analysis has acceptable performance and useful
  fallback behavior; and
- whether any real-world patterns from the four RC.5 repositories still produce false
  positives or missed diagnostics.
