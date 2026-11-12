# Contributing

Thanks for helping. Issues and pull requests are welcome, in English or French.

## Before you start

For anything larger than a fix, open an issue first, so we agree on the change before you write
it. The plugin stays small on purpose: each feature has to be useful every day, not just possible.

## Develop

You need [Orca](https://github.com/stablyai/orca) 1.4.248 or newer and Node 24.

```bash
npm run setup      # Orca's plugin typings, into .orca/types
npm run dev        # load the folder into Orca, reload on save
npm test           # the tests, with Orca's test kit
npm run check      # validate, and render every scenario of src/panel.check.ts
npm run typecheck
```

## Pull requests

- `main` is protected: every change goes through a pull request, and CI must pass.
- Run `npm test` locally: CI cannot run Orca's test kit.
- One subject per pull request. It is squash-merged, so its title becomes the commit message.
- Every word the panel, the worker or the CLI shows lives in `src/i18n.ts`, in English and French.
- Never put real memories, paths or project names in fixtures, tests or screenshots.
- A change the user can see goes in `CHANGELOG.md`.

## Release

Bump `version` in `orca-plugin.json` and `package.json`, add the `CHANGELOG.md` entry, merge, then
tag the merge commit `vX.Y.Z` and push the tag. CI checks that the tag matches the manifest. The
Orca plugin directory picks up the new tag on its own. Then publish a GitHub release for the tag,
with its `CHANGELOG.md` entry as notes.
