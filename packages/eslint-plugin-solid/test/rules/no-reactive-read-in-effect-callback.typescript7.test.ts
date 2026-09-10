import { describe, vi } from "vitest";
import { RuleTester } from "eslint";

// The standalone/browser build has no legacy compiler API. The rule's optional
// cross-file/type analysis must degrade to its AST-only behavior there.
vi.mock("@typescript/typescript6", () => ({
  default: {},
}));

import rule from "../../src/rules/no-reactive-read-in-effect-callback";

describe("no-reactive-read-in-effect-callback without compiler API", () => {
  const tester = new RuleTester({
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
    },
  });

  tester.run("does not crash when TypeScript has no legacy compiler API", rule as any, {
    valid: [
      {
        settings: { solid: { version: 2 } },
        code: `import { createEffect, createStore } from "solid-js";
const [state] = createStore({ name: "Ada" });
createEffect(() => ({ name: state.name }), value => console.log(value.name));`,
      },
    ],
    invalid: [
      {
        settings: { solid: { version: 2 } },
        code: `import { createEffect, createStore } from "solid-js";
const [state] = createStore({ name: "Ada" });
createEffect(() => state, value => console.log(value.name));`,
        errors: [{ messageId: "untrackedRead" }],
      },
    ],
  });
});
