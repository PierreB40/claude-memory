// Which Claude Code project the focused Orca workspace is, and what an agent's tool call touched.
// Pure: the worker feeds it.
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

/**
 * The focused workspace: name and branch both match, else the only one matching either. Orca
 * tells a panel only the focused workspace's name and branch, so two workspaces with the same
 * name on the same branch cannot be told apart: that gives null, said as such to the person.
 */
export function matchWorkspace(ctx: FocusedContext, workspaces: readonly WorkspaceInfo[]): WorkspaceInfo | null {
  const branch = shortBranch(ctx.branch)
  const byBranch = branch ? workspaces.filter((w) => shortBranch(w.branch) === branch) : []
  const both = byBranch.filter((w) => w.name === ctx.displayName)
  if (both.length === 1) return both[0] ?? null
  if (both.length > 1) return null
  if (byBranch.length === 1) return byBranch[0] ?? null
  const byName = workspaces.filter((w) => w.name === ctx.displayName)
  return byName.length === 1 ? (byName[0] ?? null) : null
}

/** `rel` from `base`, both POSIX: enough for the `gitdir:` of a worktree. */
export function resolvePath(base: string, rel: string): string {
  const parts = rel.startsWith('/') ? [] : base.split('/')
  for (const part of rel.split('/')) {
    if (part === '..') parts.pop()
    else if (part && part !== '.') parts.push(part)
  }
  return `/${parts.filter(Boolean).join('/')}`
}

/**
 * A linked worktree's `.git` is a file `gitdir: <main>/.git/worktrees/<name>` (absolute, or
 * relative to the worktree with `worktree.useRelativePaths`); Claude Code files its memory under
 * the main checkout. Returns that main path, or null when `.git` is no such file.
 */
export function mainCheckoutOf(gitFile: string, worktree: string): string | null {
  const dir = /^gitdir:\s*(.+?)\s*$/m.exec(gitFile)?.[1]
  if (!dir) return null
  const m = /^(.*)\/\.git\/worktrees\/[^/]+$/.exec(resolvePath(worktree, dir))
  return m?.[1] || null
}

/** The slugs to try for a workspace, most likely first: its main checkout, then itself. */
export function candidateSlugs(path: string, gitFile: string | null): string[] {
  const main = gitFile ? mainCheckoutOf(gitFile, path) : null
  return [...new Set([main, path].filter((p): p is string => Boolean(p)).map(slugOf))]
}

/** Where a file lies in `<root>/<slug>/memory/`: a memory, or the index (`MEMORY.md`). */
export function memoryOfPath(path: string, root: string): { slug: string; file: string; index: boolean } | null {
  const prefix = root.replace(/[/\\]+$/, '')
  if (!path.startsWith(`${prefix}/`)) return null
  const m = /^([^/\\]+)[/\\]memory[/\\]([^/\\]+\.md)$/.exec(path.slice(prefix.length + 1))
  if (!m) return null
  return { slug: m[1] as string, file: m[2] as string, index: m[2] === 'MEMORY.md' }
}

const filePath = (input: unknown): string | null => {
  const path = typeof input === 'object' && input !== null ? (input as { file_path?: unknown }).file_path : null
  return typeof path === 'string' ? path : null
}

/** The file a tool call writes: Write, Edit, MultiEdit (`file_path`). */
export const writtenPath = (tool: string, input: unknown): string | null => (/^(Write|Edit|MultiEdit)$/.test(tool) ? filePath(input) : null)

/** The file a Read opens, the way Claude Code reads a memory it needs. */
export const readPath = (tool: string, input: unknown): string | null => (tool === 'Read' ? filePath(input) : null)

/**
 * The shell line that starts Claude Code with its first message: single-quoted, so nothing in the
 * prompt (backticks, `$`, quotes) is read by a POSIX shell. Passing the prompt on the command line
 * does not depend on the agent being ready, unlike typing it in afterwards.
 */
export function claudeCommand(prompt: string): string {
  return `claude '${prompt.replace(/'/g, `'\\''`)}'`
}
