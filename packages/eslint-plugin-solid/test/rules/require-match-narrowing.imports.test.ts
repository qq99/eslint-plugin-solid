import { vi } from "vitest";
import { run } from "../ruleTester";
import rule from "../../src/rules/require-match-narrowing";

// Keep these cases independent from the normal test setup's import helper.
vi.unmock("../../src/utils");

const settings = { solid: { version: 2 } };

run("require-match-narrowing imports", rule, {
  valid: [
    {
      code: `import { Match } from "some-other-library";
        const state = getState();
        const el = <Match when={state.ready === true}><span>{state.name}</span></Match>;`,
      settings,
    },
    {
      code: `import { Match as OtherMatch } from "some-other-library";
        const state = getState();
        const el = <OtherMatch when={state.ready === true}><span>{state.name}</span></OtherMatch>;`,
      settings,
    },
    {
      code: `import * as Other from "some-other-library";
        const state = getState();
        const el = <Other.Match when={state.ready === true}><span>{state.name}</span></Other.Match>;`,
      settings,
    },
    {
      code: `import * as Solid from "solid-js";
        const state = getState();
        const el = <Solid.Show when={state.ready === true}><span>{state.name}</span></Solid.Show>;`,
      settings,
    },
    {
      code: `import { Match as Branch } from "solid-js";
        function View() {
          const Branch = (props) => props.children;
          const state = getState();
          return <Branch when={state.ready === true}><span>{state.name}</span></Branch>;
        }`,
      settings,
    },
  ],
  invalid: [
    ...[
      ["Match", 'import { Match } from "@solidjs/web";'],
      ["Branch", 'import { Match as Branch } from "@solidjs/web";'],
      ["Web.Match", 'import * as Web from "@solidjs/web";'],
      ["Branch", 'import { Match as Branch } from "my-renderer";'],
    ].map(([tag, imports]) => ({
      code: `${imports} function View(props) {
        return <${tag} when={props.detail.locked === false}><span>{props.detail.title}</span></${tag}>;
      }`,
      settings: { solid: { version: 2, moduleSources: ["my-renderer"] } },
      errors: [{ messageId: "matchNarrowing" }],
    })),
    {
      code: `import { createStore } from "solid-js";
        import { Match as Branch } from "solid-js";
        const [state] = createStore({ ready: true, name: "Ada" });
        const el = <Branch when={state.ready === true}><span>{state.name}</span></Branch>;`,
      settings,
      errors: [{ messageId: "matchNarrowing" }],
    },
    {
      code: `import { createStore } from "solid-js";
        import * as Solid from "solid-js";
        const [state] = createStore({ ready: true, name: "Ada" });
        const el = <Solid.Match when={state.ready === true}><span>{state.name}</span></Solid.Match>;`,
      settings,
      errors: [{ messageId: "matchNarrowing" }],
    },
  ],
});
