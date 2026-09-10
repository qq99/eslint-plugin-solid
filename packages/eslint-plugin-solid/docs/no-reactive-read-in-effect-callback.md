<!-- doc-gen HEADER -->
# solid/no-reactive-read-in-effect-callback
Disallow reading reactive values in the untracked apply callback of a Solid 2 split effect.
This rule is **off** by default.

[View source](../src/rules/no-reactive-read-in-effect-callback.ts) · [View tests](../test/rules/no-reactive-read-in-effect-callback.test.ts)
<!-- end-doc-gen -->

Solid 2 splits effects into two phases: `compute` tracks reactive dependencies and returns a
value; `apply` performs side effects using that value. Reading a signal or store in `apply`
does not subscribe the effect to changes, and can produce the development diagnostic
`STRICT_READ_UNTRACKED`.

This rule is enabled as an error in `v2` and `v2-strict`. When enabled separately, it requires
`settings: { solid: { version: 2 } }`; it does nothing for Solid 1 or an unspecified version.

## A store example

Suppose a component owns a settings store and uses an effect to update the page's theme:

```js
import { createEffect, createStore } from "solid-js";

const [settings] = createStore({ theme: "light" });

// Incorrect: returning the store does not read its theme.
createEffect(
  () => settings,
  (value) => {
    document.body.dataset.theme = value.theme; // error
  },
);
```

The compute function returns the same store proxy without reading any property. The apply
function reads `theme` outside tracking, so changing `settings.theme` does not update the
page's theme.

Read the property in compute, then pass its string value to apply:

```js
import { createEffect, createStore } from "solid-js";

const [settings] = createStore({ theme: "light" });

createEffect(
  () => settings.theme,
  (theme) => {
    document.body.dataset.theme = theme;
  },
);
```

Now compute subscribes to `settings.theme`, and apply receives a plain string each time it
changes. These setup snippets belong inside a component or another owned scope.

## Async computations and `await`

Awaiting a store does not turn it into a plain snapshot. The same rule applies when an
async memo or effect compute function resolves to a proxy:

```js
import { createEffect, createMemo, createStore } from "solid-js";

const [settings] = createStore({ theme: "light" });
const data = createMemo(async () => await Promise.resolve(settings));

createEffect(data, (value) => {
  document.body.dataset.theme = value.theme; // error: still a store proxy
});
```

Read the needed properties **before the first `await`**, then carry their plain values
through the async work. This minimal example uses an already-resolved Promise to isolate
the suspension boundary:

```js
const data = createMemo(async () => {
  const theme = settings.theme; // tracked dependency
  await Promise.resolve();
  return { theme }; // plain snapshot
});

createEffect(data, (value) => {
  document.body.dataset.theme = value.theme;
});
```

Solid settles async computations before their consumers receive the result. This rule
follows `await`, unshadowed `Promise.resolve`, and visible local/imported async helpers.
It distinguishes a Promise from its resolved value: calling a Promise's methods is not
a reactive property read, and promises nested in object fields are not automatically
unwrapped. The separate `solid/reactivity` rule reports tracked dependencies read after
the computation suspends; an `await` does not extend dependency tracking.

## Plain containers and nested stores

An object created in compute can collect several values. Reading its plain fields in apply is
safe:

```js
import { createEffect, createStore } from "solid-js";

const [settings] = createStore({ theme: "light" });
createEffect(
  () => ({ theme: settings.theme }),
  (value) => console.log(value.theme),
);
```

But wrapping a store in an object, returning a nested store, or making a shallow copy does not
necessarily remove its reactive proxies:

```js
import { createEffect, createStore } from "solid-js";

const [state] = createStore({ user: { name: "Ada" } });
createEffect(
  () => ({ ...state }),
  (value) => console.log(value.user.name), // error: user is still a store proxy
);
```

Read the fields the side effect needs in compute. For an array of objects, build plain records
from those fields:

```js
import { createEffect, createStore } from "solid-js";

const [state] = createStore({ users: [{ name: "Ada" }] });
createEffect(
  () => state.users.map((user) => ({ name: user.name })),
  (users) => console.log(users[0].name),
);
```

Moving the read into a helper called by apply does not establish tracking. The rule follows
local helper calls and captured values, including inside signal/store setter callbacks.

## What the rule checks

The rule checks the apply function of both `createEffect` and `createRenderEffect`, including
the third options argument and the `{ effect, error }` form. It recognizes imported Solid
signals, memos, stores, projections, optimistic primitives, `merge`/`omit`, and props parameters
using the plugin's props naming convention. Import aliases, namespace imports, and
`settings.solid.moduleSources` are supported.

It follows local aliases, destructuring, object/array containers, direct local helper calls,
and the callbacks of setters and common synchronous array methods. Setter drafts and
previous-value parameters are safe to read; captured reactive state still needs to be read in
compute. Passing an accessor without calling it is not itself a reactive read.

Explicit reads inside `untrack(() => ...)` are allowed. They intentionally do not become
dependencies; use them only when changes to that value should not rerun the effect.

### Scalar snapshots and callback props

Type annotations can establish that a copied field is a primitive, not a nested proxy.
For example, calling `.trim()` on the string below is safe because compute already read
the reactive property:

```ts
import { createEffect } from "solid-js";

function Search(props: { query: string }) {
  createEffect(
    () => props.query,
    (query) => { console.log(query.trim()); },
  );
}
```

This refinement follows supported local type aliases, interfaces, generic arguments, and
imports. It works without typed-linting configuration, including in Oxlint. `any`, `unknown`,
unresolved types, and unions that can contain objects remain potentially reactive. A direct
`props.query` read in apply still warns even when its result is a string.

Direct calls to conventional `onX` props with a known void-returning callback signature,
such as `props.onChange?.(value)`, are treated as imperative notifications. This convention
assumes the callback's identity is not an effect dependency. If changing the callback should
rerun the effect, read it in compute explicitly. Accessor-like or untyped functions, functions
on stores, reading a callback without calling it, and reactive arguments passed to a callback
are not exempted.

### Imported factories and local wrappers

The rule automatically recognizes `useQuery` and `useInfiniteQuery` imported from
`@tanstack/solid-query`, including aliases and namespace imports. It also follows imports into
local source files to inspect factory return values. For example, a local
`createWebsitesQuery()` wrapper that returns `useQuery(...)` needs no rule configuration.

Local tracing supports named/default exports, re-exports, relative imports, and path aliases
from the linted file's nearest `tsconfig.json`. Wrappers returning Solid stores, signals,
accessors, or plain containers containing them are also recognized when their return values
can be followed. Reading scalar fields into a plain snapshot stays valid.

This works in both ESLint and Oxlint without enabling typed linting. The rule uses TypeScript
to resolve modules and local variable bindings; it does not run a full project type check or
execute imported code. A real on-disk filename is needed for cross-file tracing. Browser
playgrounds and virtual inputs still get the single-file and built-in library checks.

### Custom reactive objects

Names beginning with `create` or `use` do not establish that a result is reactive. For a
factory from an unsupported library, or a wrapper whose implementation cannot be followed,
list its **local name** in `reactiveObjectFactories` if it returns a reactive object:

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

For example, this covers a `createSettingsStore()` from a library that exposes only type
declarations. These names describe object factories, not functions returning
accessor/setter tuples or plain data. Ordinary local wrappers and the supported query APIs
do not need to be listed.

### Limits

This is bounded source analysis, not a type-level proof of reactivity. It uses visible
initializers and supported scalar type annotations to distinguish primitive fields from
nested proxies; fields of an unknown reactive object are treated as potentially reactive.
It cannot fully follow mutations to
object shapes, dynamic calls, arbitrary higher-order functions, Promise chains/combinators
(such as `.then` and `Promise.all`), async iterators, or reads hidden in imported
helpers. Passing a proxy to a library that reads it internally may therefore go undetected.

Cross-file tracing inspects return values, not side effects inside imported helpers. It
does not inspect implementations in `node_modules` or infer reactivity from `.d.ts` files.
Missing files, unsupported expressions, parse errors, and analysis limits leave a value
unclassified. Work is bounded to 32 local modules per linted file and 1,000 analysis steps per
import or type lookup. Type refinement uses the current source buffer, shares the bounded
local module cache, and does not load external library declarations. It is not a replacement
for TypeScript's full type checker. The factory override remains available for unresolved
reactive factories.

Nested tracking functions, scheduled callbacks, returned cleanup functions, and the bundle's
error handler are outside this rule's apply analysis. There is no automatic fix: choosing
which dependencies to track and which nested values to copy requires application knowledge.

<!-- doc-gen OPTIONS -->
## Rule Options

Options shown here are the defaults. Manually configuring an array will *replace* the defaults.

```js
{
  "solid/no-reactive-read-in-effect-callback": ["off", { 
    // Local names of additional functions that return reactive objects.
    reactiveObjectFactories: [], // Array<string>
  }]
}
```
<!-- end-doc-gen -->
