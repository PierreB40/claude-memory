# Changelog

## Unreleased

- WSL on Windows: a workspace in a WSL distribution finds its Claude's memory in the Linux home,
  read through the `\\wsl.localhost` share, with its folder named after the Linux path as Claude
  in WSL names it. `git` runs inside the distribution, where Git for Windows would refuse the
  repository; *Verify* gives Claude the Linux path of its memory. Only SSH workspaces are still out
  of reach.
- Look-alike workspaces (`main` on `main` in several repositories, one `v8` per sub-project) are
  told apart by the folder their terminals' titles show, the deepest when nested. When no title
  tells, the panel asks which one it is, one row per workspace with its project and path, and
  remembers the answer through its terminals.
- In a narrow panel, *Verify* and *Reload* drop under the project's name instead of being cut off.
- When nothing is found, `orca plugin logs` says which folders were tried, and where.

## 0.4.0

- Two workspaces of the same name on the same branch (every repository's main checkout is
  `main` on `main`) are told apart by their terminals: once an agent runs in one, the panel and
  the status bar know which workspace is in front. Switching between two of them reloads the panel.
- A workspace on WSL or over SSH says it is on another host, instead of « Claude remembers nothing ».
- Windows: memories written with `\` paths are heard, worktrees with a `C:/…` gitdir find their
  main checkout's memory, `~\` works in the projects folder setting, and *Verify* has Orca launch
  Claude rather than typing a POSIX-quoted command into PowerShell or cmd.
- The README's limits spell out what WSL and SSH workspaces lack.
- New permissions: `agent:read` (agent statuses tie terminals to workspaces) and `agent:launch`
  (*Verify* on Windows).

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
