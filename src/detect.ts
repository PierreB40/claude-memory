// Which Claude Code project belongs to the focused Orca workspace. Pure: the worker feeds it.
export interface WorkspaceInfo {
  id: string
  name: string
  path: string
  branch: string | null
}

export interface FocusedContext {
  branch: string
  displayName: string
}

/** Claude Code names a project folder after its path, every non-alphanumeric char turned to `-`. */
export function slugOf(path: string): string {
  return path.replace(/[^A-Za-z0-9]/g, '-')
}

const shortBranch = (b: string | null): string => (b ?? '').replace(/^refs\/heads\//, '')

/** The focused workspace: name and branch both match, else the only one matching either. */
export function matchWorkspace(ctx: FocusedContext, workspaces: readonly WorkspaceInfo[]): WorkspaceInfo | null {
  const branch = shortBranch(ctx.branch)
  const byBranch = branch ? workspaces.filter((w) => shortBranch(w.branch) === branch) : []
  const both = byBranch.filter((w) => w.name === ctx.displayName)
  if (both.length === 1) return both[0] ?? null
  if (byBranch.length === 1) return byBranch[0] ?? null
  const byName = workspaces.filter((w) => w.name === ctx.displayName)
  return byName.length === 1 ? (byName[0] ?? null) : null
}

/**
 * A linked worktree's `.git` is a file `gitdir: <main>/.git/worktrees/<name>`; Claude Code files
 * its memory under the main checkout. Returns that main path, or null when `.git` is no such file.
 */
export function mainCheckoutOf(gitFile: string): string | null {
  const m = /^gitdir:\s*(.+?)\/\.git\/worktrees\/[^/]+\s*$/m.exec(gitFile)
  return m?.[1] ?? null
}

/** The slugs to try for a workspace, most likely first. */
export function candidateSlugs(path: string, gitFile: string | null): string[] {
  const main = gitFile ? mainCheckoutOf(gitFile) : null
  return [...new Set([main, path].filter((p): p is string => Boolean(p)).map(slugOf))]
}

/** The checkout a Claude project slug was made from, across every workspace Orca knows. */
export function repoOfSlug(slug: string, workspaces: readonly { path: string; gitFile: string | null }[]): string | null {
  for (const w of workspaces) {
    const main = w.gitFile ? mainCheckoutOf(w.gitFile) : null
    if (main && slugOf(main) === slug) return main
    if (slugOf(w.path) === slug) return w.path
  }
  return null
}

/** The memory a written file is, when it lies in `<root>/<slug>/memory/` (the index excluded). */
export function memoryOfPath(path: string, root: string): { slug: string; file: string } | null {
  const prefix = root.replace(/[/\\]+$/, '')
  if (!path.startsWith(`${prefix}/`)) return null
  const m = /^([^/\\]+)[/\\]memory[/\\]([^/\\]+\.md)$/.exec(path.slice(prefix.length + 1))
  if (!m || m[2] === 'MEMORY.md') return null
  return { slug: m[1] as string, file: m[2] as string }
}

/** The file path of a tool call that writes one: Write, Edit, MultiEdit (`file_path`). */
export function writtenPath(tool: string, input: unknown): string | null {
  if (!/^(Write|Edit|MultiEdit)$/.test(tool) || typeof input !== 'object' || input === null) return null
  const path = (input as { file_path?: unknown }).file_path
  return typeof path === 'string' ? path : null
}
