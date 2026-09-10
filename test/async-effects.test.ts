import { test, expect } from "vitest";
import { ESLint } from "eslint";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import path from "node:path";
import plugin from "eslint-plugin-solid";

test("built plugin checks async effects in ESLint and Oxlint", async () => {
  const eslint = new ESLint({
    cwd: __dirname,
    overrideConfigFile: true,
    overrideConfig: {
      // typescript-eslint's rule types still include the legacy context API.
      plugins: { solid: plugin as unknown as ESLint.Plugin },
      settings: { solid: { version: 2 } },
      rules: {
        "solid/reactivity": "error",
        "solid/no-reactive-read-in-effect-callback": "error",
      },
    },
  });
  const files = ["async-effects/valid.js", "async-effects/invalid.js"];
  const results = await eslint.lintFiles(files);
  expect(results.find((r) => path.basename(r.filePath) === "valid.js")?.messages).toEqual([]);
  expect(results.flatMap((r) => r.messages.map((m) => m.messageId))).toEqual([
    "untrackedRead",
    "untrackedRead",
    "readAfterAwait",
  ]);

  const require = createRequire(import.meta.url);
  const oxlint = path.join(path.dirname(require.resolve("oxlint/package.json")), "bin/oxlint");
  const result = spawnSync(
    process.execPath,
    [
      oxlint,
      "--config",
      "async-effects/oxlint.json",
      "--disable-nested-config",
      "--format",
      "json",
      ...files,
    ],
    { cwd: __dirname, encoding: "utf8", timeout: 20_000 }
  );
  expect(result.error).toBeUndefined();
  expect(result.status).toBe(1);
  expect(result.stderr).toBe("");
  const { diagnostics } = JSON.parse(result.stdout);
  expect(diagnostics).toHaveLength(3);
  expect(diagnostics.every((d: any) => path.basename(d.filename) === "invalid.js")).toBe(true);
  expect(diagnostics.map((d: any) => d.message).sort()).toEqual(
    results.flatMap((r) => r.messages.map((m) => m.message)).sort()
  );
});
