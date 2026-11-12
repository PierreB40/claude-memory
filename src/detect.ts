// Which Claude Code project belongs to the focused Orca workspace. Pure: the worker feeds it.
import type { Issue } from './audit.ts'

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

/**
 * One line: an agent's TUI submits on newline, so the request must not contain any.
 * Lists only real problems; what to reread is a judgement the agent should not make alone.
 */
export function fixPrompt(dir: string, issues: readonly Issue[]): string {
  const items = issues.filter((i) => i.severity !== 'info').map((i) => `${i.file ?? 'MEMORY.md'} : ${i.message}`)
  return [
    `Ta mémoire automatique Claude Code (${dir}) a ${items.length} problème(s) de cohérence.`,
    `Corrige-les sans toucher au reste : ${items.join(' ; ')}.`,
    "Pour un lien, vise le name: de la mémoire cible ; pour une mémoire hors index, ajoute sa ligne à MEMORY.md ; ne supprime aucune mémoire sans me le demander."
  ].join(' ')
}
