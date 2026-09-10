import { run } from "../ruleTester";
import rule from "../../src/rules/no-reactive-read-in-effect-callback";

const settings = { solid: { version: 2 } };
const prelude = `import { createEffect, createRenderEffect, createMemo, createSignal, createStore } from "solid-js";
const [state] = createStore({ name: "Ada" });
const [count] = createSignal(0);
`;
const errors = [{ messageId: "untrackedRead" }];

run("no-reactive-read-in-effect-callback async", rule, {
  valid: [
    ...[
      // Snapshot dependencies before suspension; only plain data reaches apply.
      `createEffect(async () => {
  const name = state.name;
  await tick();
  return { name };
}, (value) => console.log(value.name));`,
      `const data = createMemo(async () => await Promise.resolve({ name: state.name }));
createEffect(data, (value) => console.log(value.name));`,
      `createEffect(() => Promise.resolve(state.name), (value) => console.log(value.toUpperCase()));`,
      // Promises in fields are not recursively unwrapped by a computation.
      `async function getStore() { return state; }
createEffect(() => ({ pending: getStore() }), (value) => { value.pending.then(consume); });`,
      `createEffect(() => ({ pending: Promise.resolve(state) }), (value) => { value.pending.catch(log); });`,
      // A non-computation signal initializer stores a Promise as data.
      `const [pending] = createSignal(Promise.resolve(state));
createEffect(() => ({ pending: pending() }), (value) => { value.pending.then(consume); });`,
      `async function getStore() { return state; }
createEffect(() => 1, () => { getStore().then(consume); });`,
      // Mixed branches must retain the difference between a Promise and its value.
      `createEffect(() => ({ pending: flag ? Promise.resolve(state) : { name: "plain" } }),
  (value) => console.log(value.pending.name));`,
      `async function getStore() { return flag ? Promise.resolve(state) : { name: "plain" }; }
createEffect(() => ({ pending: getStore() }), (value) => { value.pending.then(consume); });`,
      // A function called Promise.resolve is not necessarily the built-in.
      `function run(Promise) {
  createEffect(() => Promise.resolve(state), (value) => console.log(value.name));
}`,
      `const Promise = { resolve: (value) => ({ name: "plain" }) };
createEffect(() => Promise.resolve(state), (value) => console.log(value.name));`,
      // An async helper may be recursive without making analysis recurse forever.
      `async function loop() { return await loop(); }
createEffect(loop, (value) => console.log(value.name));`,
      // Generator invocation returns an iterator, not the function's return value.
      `function* getStore() { return state; }
createEffect(() => ({ iterator: getStore() }), (value) => { value.iterator.next(); });`,
      // Invoking an async helper from apply does not make its snapshot reactive.
      `async function log(value) { await tick(); console.log(value.name); }
createEffect(() => ({ name: state.name }), (value) => { void log(value); });`,
    ].map((code) => ({ code: prelude + code, settings })),
  ],
  invalid: [
    ...[
      `createEffect(async () => await state, (value) => console.log(value.name));`,
      `createRenderEffect(async () => await state, (value) => console.log(value.name));`,
      `createEffect(async () => await Promise.resolve(state), (value) => console.log(value.name));`,
      `createEffect(() => Promise.resolve(state), (value) => console.log(value.name));`,
      `createEffect(async () => { await tick(); return state; }, (value) => console.log(value.name));`,
      `const data = createMemo(async () => await Promise.resolve(state));
createEffect(data, (value) => console.log(value.name));`,
      `const [data] = createSignal(async () => await Promise.resolve(state));
createEffect(() => data(), (value) => console.log(value.name));`,
      `async function getStore() { return state; }
createEffect(async () => await getStore(), (value) => console.log(value.name));`,
      `async function getStore() { return state; }
createEffect(getStore, (value) => console.log(value.name));`,
      `async function identity(value) { return await Promise.resolve(value); }
createEffect(() => identity(state), (value) => console.log(value.name));`,
      `createEffect(async () => await Promise.resolve({ state }), ({ state: value }) => console.log(value.name));`,
      `createEffect(async () => await state, ({ name }) => console.log(name));`,
      `createEffect(async () => await state, (value, previous) => console.log(previous.name));`,
      `createEffect(async () => await Promise.resolve(count), (read) => console.log(read()));`,
      `createEffect(async () => await state, { effect: (value) => console.log(value.name), error: log });`,
      `createEffect(() => flag ? Promise.resolve(state) : { name: "plain" }, (value) => console.log(value.name));`,
      `createEffect(() => flag ? { name: "plain" } : Promise.resolve(state), (value) => console.log(value.name));`,
      `createEffect(() => flag ? Promise.resolve(state) : Promise.resolve({ name: "plain" }),
  (value) => console.log(value.name));`,
      `async function getStore() { if (flag) return Promise.resolve(state); return { name: "plain" }; }
createEffect(getStore, (value) => console.log(value.name));`,
      // A captured store remains reactive after an async helper suspends.
      `async function log(value) { await tick(); console.log(value.name); }
createEffect(() => state, (value) => { void log(value); });`,
      // The helper receives a Promise; only its awaited result is a proxy.
      `async function log(pending) { const value = await pending; console.log(value.name); }
createEffect(() => ({ pending: Promise.resolve(state) }), (value) => { void log(value.pending); });`,
      `async function log(pending) { const { name } = await pending; console.log(name); }
createEffect(() => ({ pending: Promise.resolve(state) }), (value) => { void log(value.pending); });`,
    ].map((code) => ({ code: prelude + code, settings, errors })),
  ],
});
