# Feature prerelease .2

Package: `@qq99/eslint-plugin-solid@0.18.0-no-reactive-read-in-effect-callback.2`

Changes since `.1`:

- Add `solid/require-match-narrowing`, enabled as an error in `v2` and `v2-strict`.
  It requires Match branches to consume data selected by `when` through the narrowing
  callback instead of independently rereading the source. Includes import and regression tests.
- Clarify that effect-callback diagnostics identify potentially missing dependencies,
  including component props, rather than proving a runtime warning or observable bug.

From the repository root, validate and prepare the tarball:

```sh
pnpm run ci
node scripts/prepare-feature-release.mjs
```

Preparation builds in a temporary directory with the scoped name and `.2` version,
including the plugin's bundled metadata. Workspace package versions stay at `0.18.0`.
The tarball is written to the repository root and ignored by Git. Nothing is published.

When ready, publish that artifact explicitly to the `feature` tag:

```sh
npm publish ./qq99-eslint-plugin-solid-0.18.0-no-reactive-read-in-effect-callback.2.tgz --access public --tag feature
```

Consumers can install the scoped package using its existing plugin name:

```sh
npm install -D eslint-plugin-solid@npm:@qq99/eslint-plugin-solid@0.18.0-no-reactive-read-in-effect-callback.2
```
