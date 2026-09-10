import { createEffect, createMemo, createSignal, createStore } from "solid-js";

const [state] = createStore({ name: "Ada" });
const [id] = createSignal(1);

const data = createMemo(async () => {
  const name = state.name;
  await Promise.resolve();
  return { name };
});
createEffect(data, (value) => console.log(value.name));

const streamed = createMemo(async function* () {
  yield { name: state.name };
  return state;
});
createEffect(streamed, (value) => console.log(value.name));

createEffect(
  async () => await Promise.resolve(id()),
  (value) => console.log(value)
);
createEffect(
  () => ({ pending: Promise.resolve(state) }),
  (value) => {
    value.pending.then(consume);
  }
);
