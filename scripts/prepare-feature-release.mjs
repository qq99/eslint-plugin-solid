import { cpSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

// Build with the release manifest so bundled plugin.meta matches the npm package.
// Keep the upstream workspace package identity intact. This script never publishes.
const root = fileURLToPath(new URL("../", import.meta.url));
const source = path.join(root, "packages/eslint-plugin-solid");
const stage = mkdtempSync(path.join(tmpdir(), "eslint-solid-feature-"));
const name = "@qq99/eslint-plugin-solid";
const version = "0.18.0-no-reactive-read-in-effect-callback.2";

try {
  for (const file of ["src", "README.md", "tsup.config.ts"]) {
    cpSync(path.join(source, file), path.join(stage, file), { recursive: true });
  }
  cpSync(path.join(root, "LICENSE"), path.join(stage, "LICENSE"));
  const manifest = JSON.parse(readFileSync(path.join(source, "package.json"), "utf8"));
  manifest.name = name;
  manifest.version = version;
  manifest.publishConfig = { access: "public", tag: "feature" };
  writeFileSync(path.join(stage, "package.json"), JSON.stringify(manifest, null, 2) + "\n");
  symlinkSync(path.join(source, "node_modules"), path.join(stage, "node_modules"), "dir");
  execFileSync(
    path.join(source, "node_modules/.bin/tsup"),
    ["--tsconfig", path.join(root, "tsconfig.json")],
    { cwd: stage, stdio: "inherit" }
  );
  execFileSync("npm", ["pack", "--offline", "--ignore-scripts", "--pack-destination", root], {
    cwd: stage,
    stdio: "inherit",
    env: { ...process.env, npm_config_cache: path.join(stage, ".npm-cache") },
  });
} finally {
  rmSync(stage, { recursive: true, force: true });
}
