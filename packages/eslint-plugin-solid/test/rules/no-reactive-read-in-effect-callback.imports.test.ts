import path from "path";
import { run } from "../ruleTester";
import rule from "../../src/rules/no-reactive-read-in-effect-callback";

const settings = { solid: { version: 2 } };
const filename = path.join(__dirname, "../fixtures/reactive-imports/consumer.ts");
const errors = [{ messageId: "untrackedRead" }];

run("no-reactive-read-in-effect-callback imports", rule, {
  valid: [
    {
      code: `import { createEffect } from "solid-js";
import { useQuery } from "other-library";
const query = useQuery();
createEffect(() => query.data, (value) => console.log(value.name));`,
      settings,
    },
    {
      code: `import { createEffect } from "solid-js";
import { useQuery } from "@tanstack/solid-query";
function run(useQuery) {
  const query = useQuery();
  createEffect(() => query.data, (value) => console.log(value.name));
}`,
      settings,
    },
    ...["createOptions", "getSnapshot", "shadowed", "circularA"].map((name) => ({
      code: `import { createEffect } from "solid-js";
import { ${name} } from "@fixtures/barrel";
const options = ${name}();
createEffect(() => options, (value) => console.log(value.theme));`,
      settings,
      filename,
    })),
    {
      code: `import { createEffect } from "solid-js";
import { getStore } from "@fixtures/barrel";
const state = getStore({ theme: "light" });
createEffect(() => state.theme, (value) => console.log(value.toUpperCase()));`,
      settings,
      filename,
    },
    {
      // A missing/cyclic export stays unknown and must not crash linting.
      code: `import { createEffect } from "solid-js";
import { missing } from "@fixtures/loop";
const state = missing();
createEffect(() => state, (value) => console.log(value.name));`,
      settings,
      filename,
    },
    {
      code: `import { createEffect } from "solid-js";
import { unknown } from "./missing-file";
const state = unknown();
createEffect(() => state, (value) => console.log(value.name));`,
      settings,
      filename,
    },
  ],
  invalid: [
    ...["useQuery", "useInfiniteQuery"].map((name) => ({
      code: `import { createEffect } from "solid-js";
import { ${name} as query } from "@tanstack/solid-query";
const result = query(() => ({ queryKey: ["users"], queryFn: fetchUsers }));
createEffect(() => result.data, (value) => console.log(value.users));`,
      settings,
      errors,
    })),
    {
      code: `import { createEffect } from "solid-js";
import * as Query from "@tanstack/solid-query";
const result = Query.useQuery(() => ({ queryKey: ["users"], queryFn: fetchUsers }));
createEffect(() => result.data, (value) => console.log(value.users));`,
      settings,
      errors,
    },
    {
      code: `import { createEffect } from "solid-js";
import { useQuery } from "@tanstack/solid-query";
function getQuery() { return useQuery(() => ({ queryKey: ["users"], queryFn: fetchUsers })); }
const query = getQuery();
createEffect(() => query.data, (value) => console.log(value.users));`,
      settings,
      errors,
    },
    ...["./factories", "./factories.js", "./star"].map((source) => ({
      code: `import { createEffect } from "solid-js";
import { getQuery } from "${source}";
const query = getQuery();
createEffect(() => query.data, (value) => console.log(value.users));`,
      settings,
      filename,
      errors,
    })),
    {
      code: `import { createEffect } from "solid-js";
import { queryFactory as getQuery } from "@fixtures/barrel";
const query = getQuery();
createEffect(() => query.data, (value) => console.log(value.users));`,
      settings,
      filename,
      errors,
    },
    {
      code: `import { createEffect } from "solid-js";
import * as Factories from "@fixtures/barrel";
const query = Factories.queryFactory();
createEffect(() => query.data, (value) => console.log(value.users));`,
      settings,
      filename,
      errors,
    },
    {
      code: `import { createEffect } from "solid-js";
import getQuery from "@fixtures/barrel";
const query = getQuery();
createEffect(() => query.data, (value) => console.log(value.users));`,
      settings,
      filename,
      errors,
    },
    {
      code: `import { createEffect } from "solid-js";
import { getStore } from "@fixtures/barrel";
const state = getStore({ name: "Ada" });
createEffect(() => state, (value) => console.log(value.name));`,
      settings,
      filename,
      errors,
    },
    {
      code: `import { createEffect } from "solid-js";
import { getAccessor } from "@fixtures/barrel";
const count = getAccessor();
createEffect(() => 1, () => count());`,
      settings,
      filename,
      errors,
    },
    {
      code: `import { createEffect } from "solid-js";
import { getSignal } from "@fixtures/barrel";
const [count] = getSignal();
createEffect(() => 1, () => count());`,
      settings,
      filename,
      errors,
    },
    {
      code: `import { createEffect } from "solid-js";
import { store } from "@fixtures/barrel";
createEffect(() => store, (value) => console.log(value.theme));`,
      settings,
      filename,
      errors,
    },
    {
      code: `import { createEffect } from "solid-js";
import { getContainer } from "@fixtures/barrel";
createEffect(() => getContainer(), (value) => console.log(value.store.theme));`,
      settings,
      filename,
      errors,
    },
  ],
});
