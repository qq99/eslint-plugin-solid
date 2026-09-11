import path from "path";
import { run, tsOnly } from "../ruleTester";
import rule from "../../src/rules/no-reactive-read-in-effect-callback";

const settings = { solid: { version: 2 } };
const filename = path.join(__dirname, "../fixtures/reactive-imports/consumer.ts");
const errors = [{ messageId: "untrackedRead" }];
const typed = { settings, [tsOnly]: true };

run("no-reactive-read-in-effect-callback types", rule, {
  valid: [
    ...["string", "string | undefined", "string | null", '"light" | "dark"'].map((type) => ({
      ...typed,
      code: `import { createEffect } from "solid-js";
function Component(props: { text: ${type} }) {
  createEffect(() => ({ text: props.text }), ({ text }) => { console.log(text?.trim()); });
}`,
    })),
    ...["number", "bigint", "boolean", "symbol", "number | string | null"].map((type) => ({
      ...typed,
      code: `import { createEffect } from "solid-js";
function Component(props: { value: ${type} }) {
  createEffect(() => props.value, (value) => { console.log(value?.toString()); });
}`,
    })),
    {
      ...typed,
      code: `import { createEffect } from "solid-js";
interface Base { text: string; }
interface Props extends Base { other: unknown; }
function Component(props: Props) {
  createEffect(() => props.text, (text) => { console.log(text.trim()); });
}`,
    },
    {
      ...typed,
      code: `import { createEffect } from "solid-js";
type Box<T> = { value: T };
function Component(props: Readonly<Box<string>>) {
  const read = () => props.value;
  createEffect(read, (text) => { console.log(text.trim()); });
}`,
    },
    {
      ...typed,
      code: `import { createEffect, type ParentProps as WithChildren } from "solid-js";
function Component(props: WithChildren<{ text: string }>) {
  createEffect(() => props["text"], (text) => { console.log(text.trim()); });
}`,
    },
    {
      ...typed,
      filename,
      // Imported aliases must use the active buffer, not consumer.ts on disk.
      code: `import { createEffect } from "solid-js";
import type { Chunk } from "@fixtures/type-barrel";
function Component(props: { chunk: Chunk }) {
  createEffect(() => {
    const chunk = props.chunk;
    return { userTranslation: chunk.user_translation };
  }, ({ userTranslation }) => {
    const nextValue = userTranslation ?? "";
    console.log(nextValue.trim());
  });
}`,
    },
    {
      ...typed,
      filename,
      code: `import { createEffect } from "solid-js";
import type * as Types from "./types";
function Component(props: Types.Props<string>) {
  createEffect(() => props.value, (value) => { console.log(value.trim()); });
}`,
    },
    ...[
      "{ onChange?: (value: string) => void }",
      "{ onChange(value: string): void }",
      "{ onChange: ((value: string) => void) | null }",
      "ParentProps<{ onChange?: (value: string) => void }>",
    ].map((type) => ({
      ...typed,
      code: `import { createEffect, type ParentProps } from "solid-js";
function Component(props: ${type}) {
  createEffect(() => "value", (value) => { props.onChange?.(value); });
}`,
    })),
    {
      ...typed,
      filename,
      code: `import { createEffect } from "solid-js";
import type { Props } from "@fixtures/type-barrel";
function Component(props: Props<string>) {
  const alias = props;
  createEffect(() => props.value, (value) => { alias.onChange?.(value); });
}`,
    },
  ],
  invalid: [
    ...["{ offset: number }", "Readonly<{ offset: number }>", "{ offset: 8 | 16 }"].map((type) => ({
      ...typed,
      // Scalar/literal types and readonly describe values, not reactive getters.
      code: `import { createEffect } from "solid-js";
function Dropdown(props: ${type}) {
  createEffect(() => 1, () => console.log(props.offset));
}`,
      errors: [{ messageId: "untrackedRead", data: { name: "props.offset" } }],
    })),
    {
      ...typed,
      // A scalar result does not make the original property read safe.
      code: `import { createEffect } from "solid-js";
function Component(props: { text: string }) {
  createEffect(() => 1, () => { console.log(props.text.trim()); });
}`,
      errors,
    },
    ...["any", "unknown", "string | { trim(): string }", "{ name: string }"].map((type) => ({
      ...typed,
      code: `import { createEffect } from "solid-js";
function Component(props: { value: ${type} }) {
  createEffect(() => props.value, (value) => { console.log(value.name); });
}`,
      errors,
    })),
    {
      ...typed,
      code: `import { createEffect } from "solid-js";
type Readonly<T> = { value: { name: T } };
function Component(props: Readonly<string>) {
  createEffect(() => props.value, (value) => { console.log(value.name); });
}`,
      errors,
    },
    {
      ...typed,
      filename,
      code: `import { createEffect } from "solid-js";
import type { Chunk } from "@fixtures/type-barrel";
function Component(props: { chunk: Chunk }) {
  createEffect(() => props.chunk.author, (author) => { console.log(author.name); });
}`,
      errors,
    },
    ...["Recursive", "Missing"].map((type) => ({
      ...typed,
      filename,
      code: `import { createEffect } from "solid-js";
import type { ${type} } from "@fixtures/type-barrel";
function Component(props: { value: ${type} }) {
  createEffect(() => props.value, (value) => { console.log(value.name); });
}`,
      errors,
    })),
    {
      ...typed,
      code: `import { createEffect } from "solid-js";
function Component(props: { onChange: (value: string) => void; value: string }) {
  createEffect(() => 1, () => { props.onChange(props.value); });
}`,
      errors: [{ messageId: "untrackedRead", data: { name: "props.value" } }],
    },
    ...["{ onValue: () => number }", "{ onValue: unknown }", "{ onValue: any }"].map((type) => ({
      ...typed,
      code: `import { createEffect } from "solid-js";
function Component(props: ${type}) {
  createEffect(() => 1, () => { props.onValue(); });
}`,
      errors,
    })),
    {
      ...typed,
      // A name/signature is not an exemption for functions inside a store.
      code: `import { createEffect, createStore } from "solid-js";
const [props] = createStore({ onChange: (value: string): void => {} });
createEffect(() => 1, () => { props.onChange("value"); });`,
      errors,
    },
    {
      ...typed,
      // Reading a callback without invoking it can itself be a dependency.
      code: `import { createEffect } from "solid-js";
function Component(props: { onChange: (value: string) => void }) {
  createEffect(() => 1, () => { register(props.onChange); });
}`,
      errors,
    },
    {
      ...typed,
      code: `import { createEffect } from "solid-js";
function Component(props: { getValue: () => void }) {
  createEffect(() => 1, () => { props.getValue(); });
}`,
      errors,
    },
    {
      settings,
      code: `import { createEffect } from "solid-js";
function Component(props) {
  createEffect(() => 1, () => { props.onChange(); });
}`,
      errors,
    },
  ],
});
