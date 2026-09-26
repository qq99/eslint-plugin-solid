import { run, tsOnly } from "../ruleTester";
import rule from "../../src/rules/require-match-narrowing";

const settings = { solid: { version: 2 } };

export const cases = run("require-match-narrowing", rule, {
  valid: [
    // A normal boolean Match is safe when the branch does not reread its
    // condition source.
    {
      code: `import { Match } from "solid-js";
        const open = true;
        const el = <Match when={open}><span>open</span></Match>;`,
      settings,
    },
    {
      code: `import { Match } from "solid-js";
        const open = true;
        const el = <Match when={!open}><span>{"closed"}</span></Match>;`,
      settings,
    },
    // The value-returning form is the intended Solid 2 narrowing pattern.
    {
      code: `import { Match } from "solid-js";
        function View(props: { detail?: { locked: boolean; title: string } }) {
          return <Match when={props.detail?.locked === false ? props.detail : undefined}>
            {(detail) => <h1>{detail()?.title}</h1>}
          </Match>;
        }`,
      settings,
      [tsOnly]: true,
    },
    {
      code: `import { Match } from "solid-js";
        const user = { name: "Ada" };
        const el = <Match when={user}><span>{user.name}</span></Match>;`,
      settings,
    },
    {
      code: `import { Match } from "solid-js";
        const user = { name: "Ada" };
        const el = <Match when={user} keyed>{(value) => <span>{value.name}</span>}</Match>;`,
      settings,
    },
    {
      code: `import { Match } from "solid-js";
        const selected = () => ({ name: "Ada" });
        const el = <Match when={selected()}>{(value) => <span>{value().name}</span>}</Match>;`,
      settings,
    },
    // Reads in event handlers and deferred callbacks are not branch-render
    // reads and cannot cause the Match branch to select one value and render
    // another.
    {
      code: `import { Match } from "solid-js";
        const state = { ready: true, name: "Ada" };
        const el = <Match when={state.ready === true}>
          <button onClick={() => state.name}>read later</button>
        </Match>;`,
      settings,
    },
    {
      code: `import { Match } from "solid-js";
        const state = { ready: true, name: "Ada" };
        const el = <Match when={state.ready === true}>
          {() => <button onClick={() => state.name}>read later</button>}
        </Match>;`,
      settings,
    },
    {
      code: `import { Match } from "solid-js";
        const state = { ready: true, name: "Ada" };
        const el = <Match when={state.ready === true} children={() => <button onClick={() => state.name} />} />;`,
      settings,
    },
    // The condition can be a boolean expression unrelated to the rendered
    // value, including nested Match/Switch conditions.
    {
      code: `import { Match, Switch } from "solid-js";
        const outer = { ready: true };
        const state = { name: "Ada" };
        const el = <Match when={outer.ready === true}>
          <Switch>
            <Match when={true}><span>{state.name}</span></Match>
          </Switch>
        </Match>;`,
      settings,
    },
    {
      code: `import { Match } from "solid-js";
        const enabled = () => true;
        const state = { name: "Ada" };
        const el = <Match when={enabled()}><span>{state.name}</span></Match>;`,
      settings,
    },
    {
      code: `import { Match } from "solid-js";
        const ready = true;
        const el = <Match when={ready}>{(isReady) => <span>{isReady ? "yes" : "no"}</span>}</Match>;`,
      settings,
    },
    {
      code: `import { Match } from "solid-js";
        const ready = true;
        const el = <Match when={ready === true}>{(value) => <span>{value().toString()}</span>}</Match>;`,
      settings,
    },
    {
      code: `import { Match } from "solid-js";
        const el = <Match when={true} keyed>{(value) => <span>{value.toString()}</span>}</Match>;`,
      settings,
    },
    // Non-Match components and foreign Match components are outside the rule.
    {
      code: `import { Match } from "some-other-library";
        const state = { ready: true, name: "Ada" };
        const el = <Match when={state.ready === true}><span>{state.name}</span></Match>;`,
      settings,
    },
    {
      code: `const Match = (props: { when: boolean; children: unknown }) => props.children;
        const state = { ready: true, name: "Ada" };
        const el = <Match when={state.ready === true}><span>{state.name}</span></Match>;`,
      settings,
      [tsOnly]: true,
    },
    {
      code: `import { Match } from "solid-js";
        function Component() {
          const Match = (props: { when: boolean; children: unknown }) => props.children;
          const state = { ready: true, name: "Ada" };
          return <Match when={state.ready === true}><span>{state.name}</span></Match>;
        }`,
      settings,
      [tsOnly]: true,
    },
    {
      code: `import * as Other from "some-other-library";
        const state = { ready: true, name: "Ada" };
        const el = <Other.Match when={state.ready === true}><span>{state.name}</span></Other.Match>;`,
      settings,
    },
    // Unspecified and Solid 1 settings are intentionally inert.
    `import { Match } from "solid-js";
      const state = { ready: true, name: "Ada" };
      const el = <Match when={state.ready === true}><span>{state.name}</span></Match>;`,
    {
      code: `import { Match } from "solid-js";
        const state = { ready: true, name: "Ada" };
        const el = <Match when={state.ready === true}><span>{state.name}</span></Match>;`,
      settings: { solid: { version: 1 } },
    },
  ],
  invalid: [
    {
      code: `import { createStore } from "solid-js";
        import { Match } from "solid-js";
        function View(props: { detail?: { locked: boolean; title: string } }) {
          return <Match when={props.detail?.locked === false}>
            <h1>{props.detail?.title}</h1>
            <p>{props.detail?.locked ? "locked" : "public"}</p>
          </Match>;
        }`,
      settings,
      [tsOnly]: true,
      errors: [{ messageId: "matchNarrowing" }],
    },
    {
      code: `import { createStore } from "solid-js";
        import { Match } from "solid-js";
        const [state] = createStore({ ready: true, name: "Ada" });
        const el = <Match when={state.ready === true} children={() => <span>{state.name}</span>} />;`,
      settings,
      errors: [{ messageId: "matchNarrowing" }],
    },
    {
      code: `import { createStore } from "solid-js";
        import { Match } from "solid-js";
        const [state] = createStore({ ready: true, name: "Ada" });
        const el = <Match when={state.ready === true}><span>{state.name}</span></Match>;`,
      settings,
      errors: [{ messageId: "matchNarrowing" }],
    },
    {
      code: `import { createStore } from "solid-js";
        import { Match } from "solid-js";
        const [state] = createStore({ ready: true, name: "Ada" });
        const el = <Match when={!state.ready}><span>{state.name}</span></Match>;`,
      settings,
      errors: [{ messageId: "matchNarrowing" }],
    },
    {
      code: `import { createStore } from "solid-js";
        import { Match } from "solid-js";
        const [state] = createStore({ ready: true, name: "Ada" });
        const el = <Match when={Boolean(state.ready)}><span>{state.name}</span></Match>;`,
      settings,
      errors: [{ messageId: "matchNarrowing" }],
    },
    {
      code: `import { createStore } from "solid-js";
        import { Match } from "solid-js";
        const [state] = createStore({ ready: true, name: "Ada" });
        const el = <Match when={state && state.ready === true}><span>{state.name}</span></Match>;`,
      settings,
      errors: [{ messageId: "matchNarrowing" }],
    },
    {
      code: `import { createStore } from "solid-js";
        import { Match } from "solid-js";
        const [state] = createStore({ ready: true, name: "Ada" });
        const el = <Match when={state["ready"] === true}><span>{state.name}</span></Match>;`,
      settings,
      errors: [{ messageId: "matchNarrowing" }],
    },
    {
      code: `import { createStore } from "solid-js";
        import { Match } from "solid-js";
        function View(props: { detail?: { locked: boolean; title: string } }) {
          const { detail } = props;
          return <Match when={detail?.locked === false}>
            <h1>{detail?.title}</h1>
          </Match>;
        }`,
      settings,
      [tsOnly]: true,
      errors: [{ messageId: "matchNarrowing" }],
    },
    {
      code: `import { createStore } from "solid-js";
        import { Match } from "solid-js";
        function View(props: { detail?: { locked: boolean; title: string } }) {
          const detail = props.detail;
          return <Match when={detail?.locked === false}>
            <h1>{detail?.title}</h1>
          </Match>;
        }`,
      settings,
      [tsOnly]: true,
      errors: [{ messageId: "matchNarrowing" }],
    },
    {
      code: `import { createStore } from "solid-js";
        import { Match } from "solid-js";
        function View(props: { detail?: { locked: boolean; title: string } }) {
          const { detail = undefined } = props;
          return <Match when={detail?.locked === false} children={<h1>{detail?.title}</h1>} />;
        }`,
      settings,
      [tsOnly]: true,
      errors: [{ messageId: "matchNarrowing" }],
    },
    {
      code: `import { createStore } from "solid-js";
        import { Match } from "solid-js";
        const [state] = createStore({ ready: true, name: "Ada" });
        const el = <Match when={state.ready === true}>
          {(value) => <span>{state.name}</span>}
        </Match>;`,
      settings,
      errors: [{ messageId: "matchNarrowing" }],
    },
    {
      code: `import { createStore } from "solid-js";
        import { Match } from "solid-js";
        const [state] = createStore({ ready: true, name: "Ada" });
        const el = <Match when={state.ready === true}>
          <Widget when={state.name} />
        </Match>;`,
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
    {
      code: `import { createStore } from "solid-js";
        const [state] = createStore({ ready: true, name: "Ada" });
        const el = <Match when={state.ready === true}><span>{state.name}</span></Match>;`,
      settings,
      errors: [{ messageId: "matchNarrowing" }],
    },
  ],
});
