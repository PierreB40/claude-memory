# Changelog

## 0.3.0

The first public release.

- A panel that follows the focused workspace, with three tabs (*To verify*, *Recent*, *All*),
  search and a type filter. In English or French, as Orca is.
- Cited paths checked against the workspace, the default branch and ignored files on disk. What
  the branch removed is grouped apart, as memories to update when it merges.
- `[[links]]` that lead to no memory (by `name:` or by file name), memories missing from
  `MEMORY.md`, and index lines pointing to nothing. Placeholder paths (`[name]`, `<app>`, `*`,
  `NNNN`) hold when a file fits them.
- A memory opens in place, with its links both ways and how often Claude read it.
- *Verify* starts a new Claude in a terminal of the workspace, with the request as its first
  message.
- Notifications when Claude writes a memory, and the memory's health in the status bar.
- `node src/cli.ts`, the same audit without Orca.
- A listing icon, cover and screenshot for Orca's plugin directory.
