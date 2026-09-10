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

### Custom reactive objects

Names beginning with `create` or `use` do not establish that a result is reactive. For a
factory imported from another file or library, list its **local name** in
`reactiveObjectFactories` if it returns a reactive object:

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

For example, this covers an imported `createSettingsStore()` that returns the store half of
`createStore`. An application using a query adapter that returns reactive objects can list
its query factory or local wrapper here too. These names describe object factories, not
functions returning accessor/setter tuples or plain data.

### Limits

This is syntax-based analysis, not a type-aware or cross-file proof. It uses visible
initializers to distinguish primitive fields from nested proxies; fields of an unknown
reactive object are treated as potentially reactive. It cannot fully follow mutations to
object shapes, dynamic calls, arbitrary higher-order functions, or reads hidden in imported
helpers. Passing a proxy to a library that reads it internally may therefore go undetected.

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
