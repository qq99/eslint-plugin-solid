import path from "path";
import { run } from "../ruleTester";
import rule from "../../src/rules/no-reactive-read-in-effect-callback";

const settings = { solid: { version: 2 } };
const filename = path.join(__dirname, "../fixtures/reactive-imports/consumer.ts");
const prelude = `import { createEffect, createRenderEffect, createMemo, createSignal, createStore, action } from "solid-js";
const [state] = createStore({ name: "Ada" });
const [count] = createSignal(1);
`;
const errors = [{ messageId: "untrackedRead" }];

run("no-reactive-read-in-effect-callback generators", rule, {
  valid: [
    ...[
      `const data = createMemo(async function* () { yield { name: state.name }; });
createEffect(data, (value) => console.log(value.name));`,
      `createEffect(async function* () { yield { name: state.name }; }, (value) => console.log(value.name));`,
      // Final returns are not emitted, including a stream with no yields.
      `const data = createMemo(async function* () { yield { name: "plain" }; return state; });
createEffect(data, (value) => console.log(value.name));`,
      `createEffect(async function* () { return state; }, (value) => console.log(value.name));`,
      // Nested generator bodies are independent streams.
      `createEffect(async function* () {
  async function* unused() { yield state; }
  yield { name: "plain" };
}, (value) => console.log(value.name));`,
      // A sync generator is not an AsyncIterable; compute returns the iterator itself.
      `function* stream() { yield state; return state; }
createEffect(stream, (iterator) => { iterator.next(); });`,
      // Neither calling a generator nor awaiting it unwraps its yielded values.
      `async function* stream() { yield state; }
createEffect(() => ({ stream: stream() }), (value) => { value.stream.next(); });`,
      `async function* stream() { yield state; }
async function use(stream) { const iterator = await stream; iterator.next(); }
createEffect(() => 1, () => { void use(stream()); });`,
      `async function* stream() { yield count(); }
createEffect(() => 1, () => { stream(); });`,
      // Creating an iterator as signal data does not consume it recursively.
      `async function* stream() { yield state; }
const [read] = createSignal(stream());
createEffect(() => ({ stream: read() }), (value) => { value.stream.next(); });`,
      // Consumption unwraps only one stream, not a stream it yields as a value.
      `async function* inner() { yield state; }
createEffect(async function* () { yield inner(); }, (value) => { value.next(); });`,
      `createEffect(async function* () { yield { pending: Promise.resolve(state) }; },
  (value) => { value.pending.then(consume); });`,
      // Delegation emits the child's yields, not its final return.
      `async function* stream() { yield { name: "plain" }; return state; }
createEffect(async function* () { yield* stream(); }, (value) => console.log(value.name));`,
      // A yield expression receives a value from next(); it is not its own operand.
      `createEffect(async function* () {
  const received = yield { other: state };
  yield { received };
}, (value) => console.log(value.received));`,
      `createEffect(async function* () { yield* [{ name: "plain" }]; }, (value) => console.log(value.name));`,
      // Calling an action is not consuming its yielded values as reactive data.
      `const save = action(function* () { yield tick(); console.log(count()); });
createEffect(() => 1, () => { void save(); });`,
      `const save = action(async function* () { await tick(); yield; console.log(count()); });
createEffect(() => 1, () => { void save(); });`,
      // Recursive delegation stays bounded.
      `async function* loop() { yield* loop(); }
createEffect(loop, (value) => console.log(value.name));`,
    ].map((code) => ({ code: prelude + code, settings })),
    ...["snapshotStream", "finalReturnStream", "syncStream"].map((name) => ({
      code: `import { createEffect } from "solid-js";
import { ${name} } from "@fixtures/generators";
createEffect(${name}, (value) => console.log(value.name));`,
      settings,
      filename,
    })),
    {
      code: `import { createEffect } from "solid-js";
import { proxyStream } from "@fixtures/generators";
createEffect(() => ({ stream: proxyStream() }), (value) => { value.stream.next(); });`,
      settings,
      filename,
    },
  ],
  invalid: [
    {
      code: `import { createEffect } from "solid-js";
import { delegatedPromiseReturn } from "@fixtures/generators";
createEffect(delegatedPromiseReturn, (result) => console.log(result.value.name));`,
      settings,
      filename,
      errors,
    },
    ...[
      `const data = createMemo(async function* () { yield state; });
createEffect(data, (value) => console.log(value.name));`,
      `createEffect(async function* () { yield state; }, (value) => console.log(value.name));`,
      `createRenderEffect(async function* () { yield state; }, (value) => console.log(value.name));`,
      `const [data] = createSignal(async function* () { yield state; });
createEffect(data, (value) => console.log(value.name));`,
      `createEffect(async function* () { yield { state }; }, ({ state: value }) => console.log(value.name));`,
      `createEffect(async function* () { yield state; }, ({ name }) => console.log(name));`,
      `createEffect(async function* () { yield state; }, (value, previous) => console.log(previous.name));`,
      `createEffect(async function* () { yield count; }, (read) => console.log(read()));`,
      `createEffect(async function* () { yield state; }, { effect: (value) => console.log(value.name) });`,
      // Native async generators await their yielded promises.
      `createEffect(async function* () { yield Promise.resolve(state); }, (value) => console.log(value.name));`,
      `createEffect(async function* () { yield await Promise.resolve(state); }, (value) => console.log(value.name));`,
      `async function* stream(value) { yield value; }
const data = createMemo(() => stream(state));
createEffect(data, (value) => console.log(value.name));`,
      `async function* stream() { yield state; }
createEffect(async () => stream(), (value) => console.log(value.name));`,
      `async function* stream() { yield state; }
createEffect(() => Promise.resolve(stream()), (value) => console.log(value.name));`,
      // Both sides of mixed plain/promise/iterator branches matter.
      `async function* stream() { yield state; }
createEffect(() => flag ? { name: "plain" } : stream(), (value) => console.log(value.name));`,
      `async function* stream() { yield state; }
createEffect(() => flag ? stream() : Promise.resolve({ name: "plain" }), (value) => console.log(value.name));`,
      `createEffect(async function* () { yield { name: "plain" }; yield state; }, (value) => console.log(value.name));`,
      `async function* stream() { yield state; }
createEffect(async function* () { yield* stream(); }, (value) => console.log(value.name));`,
      `function* stream() { yield state; }
createEffect(async function* () { yield* stream(); }, (value) => console.log(value.name));`,
      `function* stream() { yield Promise.resolve(state); }
createEffect(async function* () { yield* stream(); }, (value) => console.log(value.name));`,
      `createEffect(async function* () { yield* [state]; }, (value) => console.log(value.name));`,
      `const values = [Promise.resolve(state)];
createEffect(async function* () { yield* values; }, (value) => console.log(value.name));`,
      `const [list] = createStore([{ name: "Ada" }]);
createEffect(async function* () { yield* list; }, (value) => console.log(value.name));`,
      // A delegated final return becomes an emission only when explicitly yielded.
      `async function* stream() { return state; }
createEffect(async function* () { const value = yield* stream(); yield value; },
  (value) => console.log(value.name));`,
      `function* stream() { return state; }
createEffect(async function* () { yield (yield* stream()); }, (value) => console.log(value.name));`,
      `function* stream() { return Promise.resolve(state); }
createEffect(async function* () { const value = yield* stream(); yield { value }; },
  (result) => console.log(result.value.name));`,
      // return yield* still emits the delegated values before completion.
      `async function* stream() { yield state; }
createEffect(async function* () { return yield* stream(); }, (value) => console.log(value.name));`,
    ].map((code) => ({ code: prelude + code, settings, errors })),
    ...["proxyStream", "delegatedStream", "arrayStream", "promiseStream", "delegatedReturn"].map(
      (name) => ({
        code: `import { createEffect, createMemo } from "solid-js";
import { ${name} } from "@fixtures/generators";
const data = createMemo(${name});
createEffect(data, (value) => console.log(value.name));`,
        settings,
        filename,
        errors,
      })
    ),
    {
      code:
        prelude +
        `import { identityStream } from "@fixtures/generators";
createEffect(() => identityStream(state), (value) => console.log(value.name));`,
      settings,
      filename,
      errors,
    },
  ],
});
