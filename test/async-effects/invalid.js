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
