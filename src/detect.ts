// Which Claude Code project the focused Orca workspace is, and what an agent's tool call touched.
// Pure: the worker feeds it.
export interface WorkspaceInfo {
  id: string
  name: string
  /** Its project's (repository's) name in Orca, when it has one. */
  project?: string | null
  path: string
  branch: string | null
  /** Orca's host for it: null or `local` here, `wsl:<distro>`, or an SSH host's id. */
  hostId?: string | null
}


export interface FocusedContext {
  branch: string
  displayName: string
  /** The focused workspace's terminals, as `workspace.readContext` lists them. */
  terminals?: readonly { id: string }[]
}

/** Claude Code names a project folder after its path, every non-alphanumeric char turned to `-`. */
export function slugOf(path: string): string {
  return path.replace(/[^A-Za-z0-9]/g, '-')
}

const shortBranch = (b: string | null): string => (b ?? '').replace(/^refs\/heads\//, '')

/**
 * The focused workspace: name and branch both match, else the only one matching either. Orca
 * tells a panel only the focused workspace's name, branch and terminal ids, and every main
 * checkout is called after its branch: several `main` on `main` are common. Those are told apart
 * by their terminals, when an agent event already tied one to its workspace (`owners`: terminal
 * id -> workspace id). Still several: null, said as such to the person, never a guess.
 */
export function matchWorkspace(
  ctx: FocusedContext,
  workspaces: readonly WorkspaceInfo[],
  owners: ReadonlyMap<string, string> = new Map()
): WorkspaceInfo | null {
  const pool = poolOf(ctx, workspaces)
  if (pool.length === 1) return pool[0] ?? null
  const mine = new Set((ctx.terminals ?? []).map((t) => owners.get(t.id)).filter(Boolean))
  const owned = pool.filter((w) => mine.has(w.id))
  return owned.length === 1 ? (owned[0] ?? null) : null
}

/** The workspaces Orca's context fits: by name and branch, else the only one matching either. */
function poolOf(ctx: FocusedContext, workspaces: readonly WorkspaceInfo[]): WorkspaceInfo[] {
  const branch = shortBranch(ctx.branch)
  const byBranch = branch ? workspaces.filter((w) => shortBranch(w.branch) === branch) : []
  const both = byBranch.filter((w) => w.name === ctx.displayName)
  if (both.length > 0) return both
  if (byBranch.length === 1) return byBranch
  return workspaces.filter((w) => w.name === ctx.displayName)
}

/** The workspaces the context cannot tell apart, when it fits several: what renaming fixes. */
export function twinsOf(ctx: FocusedContext, workspaces: readonly WorkspaceInfo[], owners?: ReadonlyMap<string, string>): WorkspaceInfo[] {
  return matchWorkspace(ctx, workspaces, owners) ? [] : poolOf(ctx, workspaces).filter((_, _i, all) => all.length > 1)
}

/**
 * A name for each twin that no other workspace has: its project's (`shop`), else its folder's;
 * its parent folder in brackets when that is taken too (`shop (dev)`), then a number.
 */
export function namesForTwins(twins: readonly WorkspaceInfo[], workspaces: readonly WorkspaceInfo[]): Map<string, string> {
  const twinIds = new Set(twins.map((w) => w.id))
  const taken = new Set(workspaces.filter((w) => !twinIds.has(w.id)).map((w) => w.name))
  const names = new Map<string, string>()
  for (const w of twins) {
    const folders = w.path.split(/[\\/]/).filter(Boolean)
    const base = w.project?.trim() || folders.at(-1) || w.name
    const parent = folders.at(-2) ?? w.name
    let name = base
    if (taken.has(name)) name = `${base} (${parent})`
    for (let n = 2; taken.has(name); n++) name = `${base} (${parent} ${n})`
    taken.add(name)
    names.set(w.id, name)
  }
  return names
}

/** Forward slashes only: Windows paths (`C:\Users\me`) compared and resolved like POSIX ones. */
const forward = (path: string): string => path.replace(/\\/g, '/')
const DRIVE = /^[A-Za-z]:(?=\/|$)/

/** `rel` from `base`, both absolute (POSIX, or Windows with a drive): enough for a `gitdir:`. */
export function resolvePath(base: string, rel: string): string {
  const r = forward(rel)
  const b = forward(base)
  const drive = DRIVE.exec(r)?.[0] ?? (r.startsWith('/') ? '' : (DRIVE.exec(b)?.[0] ?? ''))
  const parts = DRIVE.test(r) || r.startsWith('/') ? [] : b.replace(DRIVE, '').split('/')
  for (const part of r.replace(DRIVE, '').split('/')) {
    if (part === '..') parts.pop()
    else if (part && part !== '.') parts.push(part)
  }
  return `${drive}/${parts.filter(Boolean).join('/')}`
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

/**
 * Where a file lies in `<root>/<slug>/memory/`: a memory, or the index (`MEMORY.md`). Either
 * separator, and on Windows (a drive letter) without regard to case, as its file system does.
 */
export function memoryOfPath(path: string, root: string): { slug: string; file: string; index: boolean } | null {
  const prefix = forward(root).replace(/\/+$/, '')
  const p = forward(path)
  const windows = DRIVE.test(prefix)
  if (!(windows ? p.toLowerCase().startsWith(`${prefix.toLowerCase()}/`) : p.startsWith(`${prefix}/`))) return null
  const m = /^([^/]+)\/memory\/([^/]+\.md)$/.exec(p.slice(prefix.length + 1))
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

/**
 * How *Verify* starts its Claude. A POSIX shell gets the prompt on the command line, which does
 * not depend on the agent being ready; Windows terminals are PowerShell or cmd, which quote
 * otherwise, so there Orca launches the agent itself and sends the prompt once it is ready.
 */
export function launchOf(
  platform: string,
  workspaceId: string,
  title: string,
  prompt: string
): { method: 'terminal.create'; params: { workspaceId: string; title: string; command: string } } | { method: 'agent.launch'; params: { workspaceId: string; agent: 'claude'; prompt: string } } {
  return platform === 'win32'
    ? { method: 'agent.launch', params: { workspaceId, agent: 'claude', prompt } }
    : { method: 'terminal.create', params: { workspaceId, title, command: claudeCommand(prompt) } }
}
