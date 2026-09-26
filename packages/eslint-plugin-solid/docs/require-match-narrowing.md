<!-- doc-gen HEADER -->
# solid/require-match-narrowing
Require Match branches to consume the data selected by their condition through a narrowing callback.
This rule is **off** by default.

[View source](../src/rules/require-match-narrowing.ts) · [View tests](../test/rules/require-match-narrowing.test.ts)
<!-- end-doc-gen -->

Solid 2's non-keyed `Match` callback receives a narrowed accessor to the value of
`when`. With `keyed`, the callback receives the value itself. A boolean predicate
such as `props.detail?.locked === false` carries only a boolean into that
callback; it does not carry `props.detail`.

This rule encourages branches to consume their selected data through that
callback. It prevents a pattern that caused detached elements during hydration
on an SSR artwork page. The client compiler put a memo inside the `detail` prop
getter. Reading that getter repeatedly in the selected branch allocated extra
hydration IDs that the server's plain prop did not allocate. Consuming the
callback accessor avoided those repeated getter evaluations. Extracting a
component was not necessary for the fix.

A report identifies an independent source read, **not proof of a hydration
error**. Ordinary JSX reads can update correctly, and hydration also depends on
the compiler, runtime, and agreement between server and client inputs. The
non-keyed callback accessor remains reactive; it is not an immutable snapshot.

This rule is enabled as an error in `v2` and `v2-strict`. When enabled
separately, it requires `settings: { solid: { version: 2 } }` and does nothing
for Solid 1 or an unspecified version.

## Incorrect: boolean condition and a branch read

```tsx
import { Match, Switch } from "solid-js";

function Artwork(props) {
  return (
    <Switch>
      <Match when={props.detail?.locked === false}>
        <h1>{props.detail?.title}</h1>
      </Match>
    </Switch>
  );
}
```

The condition checks `props.detail.locked`, while the branch independently
reads `props.detail.title`. Return the selected detail object and consume the
callback accessor instead:

## Correct: return the value from `when`

```tsx
import { Match, Switch } from "solid-js";

function Artwork(props) {
  return (
    <Switch>
      <Match when={props.detail?.locked === false ? props.detail : undefined}>
        {(detail) => <h1>{detail().title}</h1>}
      </Match>
    </Switch>
  );
}
```

The callback can also render a component: `{(detail) => <Artwork detail={detail()} />}`.
With `keyed`, use `{(detail) => <Artwork detail={detail} />}`; changing keying also
changes when the branch remounts.

Changing only `when` is incomplete. The rule still reports independent reads in
explicit predicate-to-value forms such as `predicate ? props.detail : undefined`
or `predicate && props.detail`, and in direct value conditions such as
`when={props.detail}`:

```tsx
<Match when={props.detail?.locked === false ? props.detail : undefined}>
  <h1>{props.detail?.title}</h1>
</Match>
```

## Scope and limitations

- Unrelated inputs remain valid: `when={props.ready === true}` with
  `{props.title}`, or a condition and branch using two different signals.
- Obvious plain constants are ignored. The rule does not require type information
  and conservatively treats unknown data sources as potentially reactive.
- Comparisons, negation, global `Boolean(...)`, and combinations of predicates
  are recognized. Arithmetic and `typeof` are not boolean predicates. Direct
  value conditions match reads of that value, without treating its sibling
  properties as selected data.
- Stable local aliases and destructuring are followed. Arbitrary helper bodies,
  callbacks supplied through variables, and dynamic property identity are not
  analyzed across functions.
- Inline render callbacks of `Match`, `Show`, `For`, and `Repeat` are inspected,
  including their `children` attribute forms. Event handlers and other deferred
  functions are skipped. Nested `Show`/`Match` conditions are treated as guards;
  independent source reads in their rendered contents are still checked.
- Imports from `solid-js`, `@solidjs/web`, and configured
  `settings.solid.moduleSources` are recognized, including aliases and namespace
  imports. Foreign and shadowed components are ignored. An unbound `Match` name
  is also recognized, following the plugin's convention for implicit imports.

There is no automatic fix: selecting which value to pass, rewriting its uses,
and preserving the condition's truthiness require application context.

## Hydration regression

Browser verification with the affected app's compiler and runtime reproduced
detached elements for the original pattern, incomplete rewrites, and direct
value conditions. Consuming the narrowed callback value reused the server
element. The automated lint tests cover these source patterns using the
existing test dependencies.

To reproduce the runtime failure, preserve the different server and client
prop expressions, even when they supply identical data. For example, the
client expression `detail={route?.[1] === undefined ? null : readDetail()}`
compiled to a getter that allocated a memo on each read, while the server
passed a plain object. Using the same plain object expression in both entry
points can hide the failure.

A browser check should capture the element through a client `ref`, then assert
that it is connected and is the server-rendered element. Checking only visible
text can pass while Solid creates a detached replacement. The production
runtime can also omit the development hydration warning.
