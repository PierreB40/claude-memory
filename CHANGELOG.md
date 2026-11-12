# Changelog

## 0.3.0

The first public release.

- A panel that follows the focused workspace, with three tabs (*À vérifier*, *Récentes*,
  *Toutes*), search and a type filter.
- Cited paths checked against the workspace, the default branch and ignored files on disk. What
  the branch removed is grouped apart, as memories to update when it merges.
- Dead `[[links]]`, links aimed at a file name, memories missing from `MEMORY.md`, and index lines
  pointing to nothing.
- A memory opens in place, with its links both ways and how often Claude read it.
- *Vérifier* starts a new Claude in a terminal of the workspace, with the request as its first
  message.
- Notifications when Claude writes a memory, and the memory's health in the status bar.
- `node src/cli.ts`, the same audit without Orca.
