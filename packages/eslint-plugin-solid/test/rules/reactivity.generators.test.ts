import { run } from "../ruleTester";
import rule from "../../src/rules/reactivity";

const settings = { solid: { version: 2 } };
const primitives = ["createMemo", "createEffect", "createRenderEffect"];
const apply = (primitive: string) =>
  primitive === "createMemo" ? "" : ", value => console.log(value)";

run("reactivity generators", rule, {
  valid: [
    ...primitives.map((primitive) => ({
      settings,
      code: `import { ${primitive}, createSignal } from "solid-js";
const [count] = createSignal(1);
${primitive === "createMemo" ? "const data = " : ""}${primitive}(async function* () {
  const value = count();
  yield value;
  await tick();
  yield value + 1;
}${apply(primitive)});`,
    })),
    {
      settings,
      code: `import { createMemo, createSignal } from "solid-js";
const [count] = createSignal(1);
const data = createMemo(async function* () { yield count(); });`,
    },
    ...["function*", "async function*"].map((fn) => ({
      settings,
      code: `import { action, createSignal } from "solid-js";
const [count] = createSignal(1);
const save = action(${fn} () { yield tick(); console.log(count()); });`,
    })),
    {
      settings,
      code: `import { action } from "solid-js";
function Component(props) {
  const save = action(async function* () { await tick(); yield; console.log(props.name); });
  return <button onClick={save}>Save</button>;
}`,
    },
  ],
  invalid: [
    ...primitives.map((primitive) => ({
      settings,
      code: `import { ${primitive}, createSignal } from "solid-js";
const [count] = createSignal(1);
${primitive === "createMemo" ? "const data = " : ""}${primitive}(async function* () {
  yield 0;
  yield count();
}${apply(primitive)});`,
      errors: [{ messageId: "readAfterAwait", line: 5 }],
    })),
    {
      settings,
      code: `import { createMemo } from "solid-js";
function Component(props) {
  const data = createMemo(async function* () {
    yield "initial";
    yield props.name;
  });
  return <div>{data()}</div>;
}`,
      errors: [{ messageId: "readAfterAwait", line: 5 }],
    },
    {
      settings,
      code: `import { createMemo, createSignal } from "solid-js";
const [count] = createSignal(1);
const data = createMemo(async function* () {
  yield* [1, 2];
  yield count();
});`,
      errors: [{ messageId: "readAfterAwait", line: 5 }],
    },
  ],
});
