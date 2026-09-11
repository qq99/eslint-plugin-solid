import { run, tsOnly } from "../ruleTester";
import rule from "../../src/rules/no-reactive-read-in-effect-callback";

const settings = { solid: { version: 2 } };

export const cases = run("no-reactive-read-in-effect-callback", rule, {
  valid: [
    {
      // A props-like name does not make a locally known plain object reactive.
      code: `import { createEffect } from "solid-js";
const props = { offset: 8 };
const options = props;
createEffect(() => 1, () => console.log(options.offset));`,
      settings,
    },
    {
      // A helper's known argument takes precedence over the props convention.
      code: `import { createEffect } from "solid-js";
const options = { offset: 8 };
function updatePosition(props) { console.log(props.offset); }
createEffect(() => 1, () => updatePosition(options));`,
      settings,
    },
    {
      // An intentional non-dependency is explicit even for component props.
      code: `import { createEffect, untrack } from "solid-js";
function Dropdown(props) {
  createEffect(() => 1, () => console.log(untrack(() => props.offset)));
}`,
      settings,
    },
    {
      // Merging plain data does not introduce reactive dependencies.
      code: `import { createEffect, merge, omit } from "solid-js";
const options = omit(merge({ theme: "light", hidden: true }, {}), "hidden");
createEffect(() => options, (value) => console.log(value.theme));`,
      settings,
    },
    {
      // Supplying an argument means the helper's default expression never runs.
      code: `import { createEffect, createSignal } from "solid-js";
const [count] = createSignal(0);
function log(value = count()) { console.log(value); }
createEffect(() => 1, () => log(1));`,
      settings,
    },
    {
      // Calling a generator only creates an iterator.
      code: `import { createEffect, createSignal } from "solid-js";
const [count] = createSignal(0);
function* values() { yield count(); }
createEffect(() => 1, () => values());`,
      settings,
    },
    {
      // Circular aliases/defaults must not recurse forever during linting.
      code: `import { createEffect } from "solid-js";
const a = b, b = a;
const { value = value } = {};
createEffect(() => ({ a, value }), (result) => console.log(result.a));`,
      settings,
    },
    {
      code: `import { createEffect, createStore } from "solid-js";
const [state] = createStore({ theme: "light" });
createEffect(() => ({ ...state }), (value) => console.log(value.theme.toUpperCase()));`,
      settings,
    },
    {
      code: `import { createEffect, createStore } from "solid-js";
const [settings] = createStore({ theme: "light" });
createEffect(() => settings.theme, (theme) => { document.body.dataset.theme = theme; });`,
      settings,
    },
    {
      code: `import { createEffect, createStore } from "solid-js";
const [settings] = createStore({ theme: "light" });
createEffect(() => ({ theme: settings.theme }), (value) => console.log(value.theme));`,
      settings,
    },
    {
      code: `import { createEffect, createStore } from "solid-js";
const [settings] = createStore({ theme: "light" });
createEffect(() => settings.theme, (theme) => console.log(theme.toUpperCase()));`,
      settings,
    },
    {
      code: `import { createEffect, createStore } from "solid-js";
const [state] = createStore({ users: [{ name: "Ada" }] });
createEffect(() => state.users.map((user) => ({ name: user.name })),
  (users) => console.log(users[0].name));`,
      settings,
    },
    {
      code: `import { createEffect } from "solid-js";
function createOptions() { return { theme: "light" }; }
const options = createOptions();
createEffect(() => options, (value) => console.log(value.theme));`,
      settings,
    },
    {
      code: `import { createEffect } from "solid-js";
import { useOptions } from "options";
const options = useOptions();
createEffect(() => options, (value) => console.log(value.theme));`,
      settings,
    },
    {
      code: `import { createEffect, createSignal, createMemo } from "solid-js";
const [count, setCount] = createSignal(0);
createEffect(count, (value) => {
  setCount((previous) => previous + value);
  createMemo(() => count());
  setTimeout(() => console.log(count()));
});`,
      settings,
    },
    {
      code: `import { createEffect, createStore } from "solid-js";
const [state, setState] = createStore({ count: 0 });
createEffect(() => 1, (value) => setState((draft) => { draft.count += value; }));`,
      settings,
    },
    {
      code: `import { createEffect, createSignal, untrack } from "solid-js";
const [count] = createSignal(0);
createEffect(() => 1, () => untrack(() => console.log(count())));`,
      settings,
    },
    {
      code: `import { createEffect, createSignal } from "solid-js";
const [count] = createSignal(0);
function run(count) { createEffect(() => 1, () => count()); }
run(() => 1);`,
      settings,
    },
    {
      code: `import { createEffect, createStore } from "solid-js";
function run(createStore) {
  const [state] = createStore();
  createEffect(() => state, (value) => console.log(value.name));
}`,
      settings,
    },
    {
      code: `import { createEffect } from "other-library";
import { createSignal } from "solid-js";
const [count] = createSignal(0);
createEffect(() => 1, () => count());`,
      settings,
    },
    {
      code: `import { createEffect } from "solid-js";
function log(value = { name: "Ada" }) { console.log(value.name); }
createEffect(() => 1, () => log());`,
      settings,
    },
    {
      code: `import { createEffect } from "solid-js";
function log(props) { console.log(props.name); }
createEffect(() => ({ name: "Ada" }), (value) => log(value));`,
      settings,
    },
    {
      code: `import { createEffect, createSignal } from "solid-js";
const [count] = createSignal(0);
createEffect(() => count, (read) => register(read));`,
      settings,
    },
    {
      code: `import { createEffect, createSignal } from "solid-js";
const [count] = createSignal(0);
createEffect(() => 1, () => count());`,
      settings: {},
    },
    {
      code: `import { createEffect, createSignal } from "solid-js";
const [count] = createSignal(0);
createEffect(() => 1, () => count());`,
      settings: { solid: { version: 1 } },
    },
  ],
  invalid: [
    ...["8", "isCompact() ? 8 : 16"].map((offset) => ({
      // Visible JSX callers do not prove a component's props are always static.
      code: `import { createEffect, createSignal } from "solid-js";
function Dropdown(props) {
  createEffect(() => 1, () => console.log(props.offset));
}
function App() {
  const [isCompact] = createSignal(false);
  return <Dropdown offset={${offset}} />;
}`,
      settings,
      errors: [{ messageId: "untrackedRead", data: { name: "props.offset" } }],
    })),
    {
      // A default object only applies when the caller omits the argument.
      code: `import { createEffect } from "solid-js";
function Dropdown(props = { offset: 8 }) {
  createEffect(() => 1, () => console.log(props.offset));
}`,
      settings,
      errors: [{ messageId: "untrackedRead", data: { name: "props.offset" } }],
    },
    {
      code: `import { createEffect, createStore, merge, omit } from "solid-js";
const [state] = createStore({ name: "Ada", hidden: true });
const data = omit(merge({}, state), "hidden");
createEffect(() => data, (value) => console.log(value.name));`,
      settings,
      errors: [{ messageId: "untrackedRead" }],
    },
    {
      code: `import { createEffect, createSignal } from "solid-js";
const [count] = createSignal(0);
function log(value = count()) { console.log(value); }
createEffect(() => 1, () => log());`,
      settings,
      errors: [{ messageId: "untrackedRead" }],
    },
    {
      // The initializer's shape is unknown, so nested store data may be a proxy.
      code: `import { createEffect, createStore } from "solid-js";
const [state] = createStore({ user: loadUser() });
createEffect(() => state.user, (user) => console.log(user.name));`,
      settings,
      errors: [{ messageId: "untrackedRead" }],
    },
    {
      // Shallow spreads retain nested proxies.
      code: `import { createEffect, createStore } from "solid-js";
const [state] = createStore({ user: { name: "Ada" } });
createEffect(() => ({ ...state }), (value) => console.log(value.user.name));`,
      settings,
      errors: [{ messageId: "untrackedRead" }],
    },
    {
      code: `import { createEffect, createStore } from "solid-js";
const [state] = createStore({ name: "Ada" });
createEffect(() => state, (value) => { let alias; alias = value; console.log(alias.name); });`,
      settings,
      errors: [{ messageId: "untrackedRead" }],
    },
    {
      code: `import { createEffect, createStore } from "solid-js";
const [state] = createStore({ name: "Ada" });
createEffect(() => flag ? state : null, (value) => console.log(value?.["name"]));`,
      settings,
      errors: [{ messageId: "untrackedRead" }],
      [tsOnly]: true,
    },
    {
      code: `import { createEffect, createStore } from "solid-js";
const [state] = createStore({ name: "Ada" });
createEffect(() => state, (value, previous) => console.log(previous.name));`,
      settings,
      errors: [{ messageId: "untrackedRead" }],
    },
    {
      code: `import { createEffect, createOptimistic } from "solid-js";
const [count] = createOptimistic(0);
createEffect(count, () => count());`,
      settings,
      errors: [{ messageId: "untrackedRead" }],
    },
    {
      code: `import { createEffect, createOptimisticStore } from "solid-js";
const [state] = createOptimisticStore({ name: "Ada" });
createEffect(() => state, (value) => console.log(value.name));`,
      settings,
      errors: [{ messageId: "untrackedRead" }],
    },
    {
      code: `import { createEffect, createStore } from "solid-js";
const [settings] = createStore({ theme: "light" });
createEffect(() => settings, (value) => { document.body.dataset.theme = value.theme; });`,
      settings,
      errors: [{ messageId: "untrackedRead" }],
    },
    {
      code: `import { createEffect, createSignal } from "solid-js";
const [count] = createSignal(0);
createEffect(() => 1, () => console.log(count()));`,
      settings,
      errors: [{ messageId: "untrackedRead" }],
    },
    {
      code: `import { createEffect, createSignal } from "solid-js";
const [count] = createSignal(0);
createEffect(count, () => console.log(count()), { defer: true });`,
      settings,
      errors: [{ messageId: "untrackedRead" }],
    },
    {
      code: `import { createRenderEffect, createSignal } from "solid-js";
const [count] = createSignal(0);
createRenderEffect(count, () => console.log(count()));`,
      settings,
      errors: [{ messageId: "untrackedRead" }],
    },
    {
      code: `import { createEffect, createStore } from "solid-js";
const [state] = createStore({ name: "Ada" });
const callbacks = { effect(value) { console.log(value.name); }, error: console.error };
createEffect(() => state, callbacks, { defer: true });`,
      settings,
      errors: [{ messageId: "untrackedRead" }],
    },
    {
      code: `import { createEffect, createSignal } from "solid-js";
import { compute } from "./compute";
const [count] = createSignal(0);
createEffect(compute, () => count());`,
      settings,
      errors: [{ messageId: "untrackedRead" }],
    },
    {
      code: `import { createEffect, createStore } from "solid-js";
const [state] = createStore({ user: { name: "Ada" } });
createEffect(() => state.user, ({ name }) => console.log(name));`,
      settings,
      errors: [{ messageId: "untrackedRead" }],
    },
    {
      code: `import { createEffect, createStore } from "solid-js";
const [state] = createStore({ user: { name: "Ada" } });
createEffect(() => 1, () => { const { user } = state; });`,
      settings,
      errors: [{ messageId: "untrackedRead" }],
    },
    {
      code: `import { createEffect, createStore } from "solid-js";
const [state] = createStore({ name: "Ada" });
createEffect(() => 1, () => console.log({ ...state }));`,
      settings,
      errors: [{ messageId: "untrackedRead" }],
    },
    {
      code: `import { createEffect, createStore } from "solid-js";
const [state] = createStore({ name: "Ada" });
function log(value) { console.log(value.name); }
createEffect(() => 1, () => log(state));`,
      settings,
      errors: [{ messageId: "untrackedRead" }],
    },
    {
      code: `import { createEffect, createStore } from "solid-js";
const [state] = createStore({ name: "Ada" });
createEffect(() => state, (value) => {
  function log() { console.log(value.name); }
  log();
});`,
      settings,
      errors: [{ messageId: "untrackedRead" }],
    },
    {
      code: `import { createEffect, createStore } from "solid-js";
const [state] = createStore({ name: "Ada" });
createEffect(() => ({ state }), (value) => console.log(value.state.name));`,
      settings,
      errors: [{ messageId: "untrackedRead" }],
    },
    {
      code: `import { createEffect, createStore } from "solid-js";
const [state] = createStore({ name: "Ada" });
createEffect(() => ({ nested: { state } }), ({ nested: { state: value } }) => console.log(value.name));`,
      settings,
      errors: [{ messageId: "untrackedRead" }],
    },
    {
      code: `import { createEffect, createStore } from "solid-js";
const [state] = createStore({ name: "Ada" });
createEffect(() => [state], ([value]) => console.log(value.name));`,
      settings,
      errors: [{ messageId: "untrackedRead" }],
    },
    {
      code: `import { createEffect, createStore } from "solid-js";
const [state] = createStore({ name: "Ada" });
const compute = () => { const result = { state }; return result; };
createEffect(compute, ({ state: value }) => { const alias = value; console.log(alias.name); });`,
      settings,
      errors: [{ messageId: "untrackedRead" }],
    },
    {
      code: `import { createEffect, createStore } from "solid-js";
const [state] = createStore({ name: "Ada" });
createEffect(() => ({ state }), ({ state: { name } }) => console.log(name));`,
      settings,
      errors: [{ messageId: "untrackedRead" }],
    },
    {
      code: `import { createEffect, createSignal } from "solid-js";
const [count] = createSignal(0);
createEffect(() => count, (read) => console.log(read()));`,
      settings,
      errors: [{ messageId: "untrackedRead" }],
    },
    {
      code: `import { createEffect, createSignal } from "solid-js";
const [count] = createSignal(0);
createEffect(() => 1, () => { const read = count; console.log(read()); });`,
      settings,
      errors: [{ messageId: "untrackedRead" }],
    },
    {
      code: `import { createEffect, createStore, createSignal } from "solid-js";
const [state] = createStore({ name: "Ada" });
const [name, setName] = createSignal("");
createEffect(() => state, (value) => setName(() => value.name));`,
      settings,
      errors: [{ messageId: "untrackedRead" }],
    },
    {
      code: `import { createEffect, createStore } from "solid-js";
const [state] = createStore({ name: "Ada" });
function log(value) { console.log(value.name); if (again) log(value); }
createEffect(() => state, (value) => log(value));`,
      settings,
      errors: [{ messageId: "untrackedRead" }],
    },
    {
      code: `import { createEffect as effect, createStore as store } from "solid-js";
const [state] = store({ name: "Ada" });
effect(() => state, (value) => console.log(value.name));`,
      settings,
      errors: [{ messageId: "untrackedRead" }],
    },
    {
      code: `import * as Solid from "solid-js";
const [state] = Solid.createStore({ name: "Ada" });
Solid.createEffect(() => state, (value) => console.log(value.name));`,
      settings,
      errors: [{ messageId: "untrackedRead" }],
    },
    {
      code: `import { createEffect, createSignal } from "@solidjs/signals";
const [count] = createSignal(0);
createEffect(count, () => count());`,
      settings,
      errors: [{ messageId: "untrackedRead" }],
    },
    {
      code: `import { createEffect } from "solid-js";
function Theme(props) { createEffect(() => 1, () => console.log(props.theme)); }`,
      settings,
      errors: [{ messageId: "untrackedRead" }],
    },
    {
      code: `import { createEffect, createProjection } from "solid-js";
const state = createProjection(() => ({ name: "Ada" }));
createEffect(() => state, (value) => console.log(value.name));`,
      settings,
      errors: [{ messageId: "untrackedRead" }],
    },
    {
      code: `import { createEffect, createMemo, createSignal } from "solid-js";
const [count] = createSignal(0);
const doubled = createMemo(() => count() * 2);
createEffect(count, () => doubled());`,
      settings,
      errors: [{ messageId: "untrackedRead" }],
    },
    {
      code: `import { createEffect, createStore } from "solid-js";
const [state] = createStore({ name: "Ada" });
createEffect(() => state, (value) => [1].forEach(() => console.log(value.name)));`,
      settings,
      errors: [{ messageId: "untrackedRead" }],
    },
    {
      code: `import { createEffect, createStore, reconcile } from "solid-js";
import { createWebsitesQuery } from "./queries";
const websites = createWebsitesQuery();
const [sites, setSites] = createStore([]);
function apply(body) {
  setSites((draft) => { reconcile(body.sites, "id")(draft); });
  console.log(body.imageBaseUrl);
}
createEffect(() => ({ body: websites.data, error: websites.isError }), ({ body }) => apply(body));`,
      options: [{ reactiveObjectFactories: ["createWebsitesQuery"] }],
      settings,
      errors: [{ messageId: "untrackedRead" }, { messageId: "untrackedRead" }],
    },
    {
      code: `import { createEffect, createSignal } from "my-renderer";
const [count] = createSignal(0);
createEffect(count, () => count());`,
      settings: { solid: { version: 2, moduleSources: ["my-renderer"] } },
      errors: [{ messageId: "untrackedRead" }],
    },
    {
      code: `import { createEffect, createStore } from "solid-js";
const [state] = createStore({ name: "Ada" });
const apply = ((value) => console.log((value!).name)) satisfies Function;
createEffect(() => state as typeof state, apply);`,
      settings,
      errors: [{ messageId: "untrackedRead" }],
      [tsOnly]: true,
    },
  ],
});
