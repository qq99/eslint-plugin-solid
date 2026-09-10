import { createEffect, createMemo, createSignal, createStore } from "solid-js";

const [state] = createStore({ name: "Ada" });
const [id] = createSignal(1);
const data = createMemo(async () => await Promise.resolve(state));

createEffect(data, (value) => console.log(value.name));
createEffect(
  async () => await state,
  (value) => console.log(value.name)
);
createEffect(
  async () => {
    await Promise.resolve();
    return id();
  },
  (value) => console.log(value)
);

const streamed = createMemo(async function* () {
  yield state;
});
createEffect(streamed, (value) => console.log(value.name));

function* child() {
  yield state;
}
const delegated = createMemo(async function* () {
  yield* child();
});
createEffect(delegated, (value) => console.log(value.name));

const stale = createMemo(async function* () {
  yield 0;
  yield id();
});
createEffect(stale, (value) => console.log(value));
