import { run } from "../ruleTester";
import rule from "../../src/rules/reactivity";

const settings = { solid: { version: 2 } };
const effects = ["createEffect", "createRenderEffect"];

run("reactivity async effects", rule, {
  valid: [
    ...effects.flatMap((effect) => [
      {
        settings,
        code: `import { ${effect}, createSignal } from "solid-js";
const [id] = createSignal(1);
${effect}(async () => {
  const key = id();
  const response = await fetch("/users/" + key);
  return response.json();
}, (user) => console.log(user.name));`,
      },
      {
        settings,
        code: `import { ${effect} as effect, createSignal } from "solid-js";
const [id] = createSignal(1);
effect(async () => await fetch("/users/" + id()), (response) => console.log(response));`,
      },
      {
        settings,
        code: `import { ${effect}, createSignal } from "solid-js";
const [id] = createSignal(1);
${effect}(async () => {
  const key = id();
  const nested = async () => { await tick(); };
  return key;
}, (value) => console.log(value));`,
      },
      {
        settings,
        code: `import { ${effect}, createSignal } from "solid-js";
const [items] = createSignal([]);
${effect}(async () => {
  const values = [];
  for await (const item of items()) values.push(item);
  return values;
}, (value) => console.log(value));`,
      },
    ]),
    {
      settings,
      code: `import { createEffect } from "solid-js";
function Component(props) {
  createEffect(async () => {
    const name = props.name;
    await tick();
    return { name };
  }, (value) => console.log(value.name));
}`,
    },
  ],
  invalid: [
    {
      settings,
      code: `import { createEffect, createSignal } from "solid-js";
const [count] = createSignal(1);
createEffect(async () => {
  for await (const item of stream) {
    console.log(count());
  }
  return count();
}, (value) => console.log(value));`,
      errors: [
        { messageId: "readAfterAwait", line: 5 },
        { messageId: "readAfterAwait", line: 7 },
      ],
    },
    ...effects.flatMap((effect) => [
      {
        settings,
        code: `import { ${effect}, createSignal } from "solid-js";
const [id] = createSignal(1);
${effect}(async () => {
  await tick();
  return id();
}, (value) => console.log(value));`,
        errors: [{ messageId: "readAfterAwait", line: 5 }],
      },
      {
        settings,
        code: `import { ${effect} } from "solid-js";
function Component(props) {
  ${effect}(async () => {
    await tick();
    return props.name;
  }, (value) => console.log(value));
}`,
        errors: [{ messageId: "readAfterAwait", line: 5 }],
      },
      ...[{}, { solid: { version: 1 } }].map((settings) => ({
        settings,
        code: `import { ${effect} } from "solid-js";
${effect}(async () => { await tick(); });`,
        errors: [{ messageId: "noAsyncTrackedScope" }],
      })),
    ]),
    {
      // The one-phase escape hatch is not an async computation.
      settings,
      code: `import { createTrackedEffect } from "solid-js";
createTrackedEffect(async () => { await tick(); });`,
      errors: [{ messageId: "noAsyncTrackedScope" }],
    },
  ],
});
