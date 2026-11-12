// Reads Claude Code memory folders from disk. Worker and CLI only: a panel has no file system.
import { execFile } from 'node:child_process'
import { readdir, readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { MemoryFile } from './audit.ts'

export interface ProjectSummary {
  /** Folder name under ~/.claude/projects, e.g. `-Users-me-Dev-app`. */
  slug: string
  /** Best-effort path the slug came from (Claude Code replaces `/` and `.` with `-`). */
  label: string
  count: number
}

export function projectsRoot(): string {
  return join(homedir(), '.claude', 'projects')
}

/** The slug is lossy (`-` may have been `/`, `.` or `-`), so the label is only a hint. */
export function labelOf(slug: string): string {
  return slug.replace(/^-/, '/').replace(/-/g, '/')
}

async function isDir(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory()
  } catch {
    return false
  }
}

export async function listProjects(root = projectsRoot()): Promise<ProjectSummary[]> {
  let slugs: string[]
  try {
    slugs = await readdir(root)
  } catch {
    return []
  }
  const out: ProjectSummary[] = []
  for (const slug of slugs) {
    const dir = join(root, slug, 'memory')
    if (!(await isDir(dir))) continue
    const count = (await readdir(dir)).filter((f) => f.endsWith('.md') && f !== 'MEMORY.md').length
    if (count > 0) out.push({ slug, label: labelOf(slug), count })
  }
  return out.sort((a, b) => b.count - a.count)
}

/** The `.git` FILE of a linked worktree; null for a main checkout (a folder) or no repository. */
export async function readGitFile(workspacePath: string): Promise<string | null> {
  try {
    return await readFile(join(workspacePath, '.git'), 'utf8')
  } catch {
    return null
  }
}

export function memoryDir(slug: string, root = projectsRoot()): string {
  return join(root, slug, 'memory')
}

export async function readMemoryFolder(slug: string, root = projectsRoot()): Promise<MemoryFile[]> {
  if (slug.includes('/') || slug.includes('..')) throw new Error(`Slug invalide : ${slug}`)
  const dir = join(root, slug, 'memory')
  const names = (await readdir(dir)).filter((f) => f.endsWith('.md'))
  return Promise.all(
    names.map(async (file) => {
      const path = join(dir, file)
      const [content, info] = await Promise.all([readFile(path, 'utf8'), stat(path)])
      return { file, content, mtimeMs: info.mtimeMs }
    })
  )
}

function git(cwd: string, args: readonly string[]): Promise<string | null> {
  return new Promise((resolve) => {
    execFile('git', args, { cwd, maxBuffer: 64 * 1024 * 1024, encoding: 'utf8' }, (error, stdout) => resolve(error ? null : stdout))
  })
}
const nulSplit = (out: string): string[] => out.split('\0').filter(Boolean)

/** What git says about a checkout: its branch, its files now, the default branch's, what it removed. */
export interface CheckoutFacts {
  branch: string | null
  /** The default branch compared with; null on it, or when there is none. */
  base: string | null
  /** Tracked and new (not ignored) files of the working tree, deleted ones left out. */
  files: string[]
  /** Files of the default branch's tip: a memory citing one is still true there. */
  baseFiles: string[]
  /** Deleted or renamed since the branch left the default branch, working tree included. */
  removed: string[]
}

/** The default branch: origin/HEAD, else origin/main, main, origin/master, master. */
async function baseRef(checkout: string): Promise<string | null> {
  const head = (await git(checkout, ['rev-parse', '--abbrev-ref', 'origin/HEAD']))?.trim()
  if (head && head !== 'origin/HEAD') return head
  for (const ref of ['origin/main', 'main', 'origin/master', 'master']) {
    if ((await git(checkout, ['rev-parse', '--verify', '--quiet', ref])) !== null) return ref
  }
  return null
}

/** `git diff --name-status -z`: a status, then one path (two for a rename: the old one first). */
function removedIn(out: string): string[] {
  const tokens = nulSplit(out)
  const paths: string[] = []
  for (let i = 0; i < tokens.length; ) {
    const status = tokens[i] ?? ''
    paths.push(tokens[i + 1] ?? '')
    i += status.startsWith('R') || status.startsWith('C') ? 3 : 2
  }
  return paths.filter(Boolean)
}

/** Null when the folder is not a git checkout. */
export async function readCheckout(checkout: string): Promise<CheckoutFacts | null> {
  const [present, deleted, head] = await Promise.all([
    git(checkout, ['ls-files', '-z', '--cached', '--others', '--exclude-standard']),
    git(checkout, ['ls-files', '-z', '--deleted']),
    git(checkout, ['rev-parse', '--abbrev-ref', 'HEAD'])
  ])
  if (present === null) return null
  const deletedNow = nulSplit(deleted ?? '')
  const gone = new Set(deletedNow)
  const files = [...new Set(nulSplit(present))].filter((f) => !gone.has(f))
  // A detached HEAD has no branch name: say so, with its commit, as Orca's sidebar does.
  const name = head?.trim() || null
  const branch = name === 'HEAD' ? `HEAD @ ${(await git(checkout, ['rev-parse', '--short', 'HEAD']))?.trim() ?? '?'}` : name
  const ref = await baseRef(checkout)
  const base = ref && branch !== ref.replace(/^origin\//, '') ? ref : null
  if (!base) return { branch, base: null, files, baseFiles: [], removed: deletedNow }
  const forkPoint = (await git(checkout, ['merge-base', 'HEAD', base]))?.trim()
  const [tip, diff] = await Promise.all([
    git(checkout, ['ls-tree', '-r', '-z', '--name-only', base]),
    forkPoint ? git(checkout, ['diff', '--name-status', '-z', '--diff-filter=DR', forkPoint, 'HEAD']) : Promise.resolve(null)
  ])
  return { branch, base, files, baseFiles: nulSplit(tip ?? ''), removed: [...new Set([...removedIn(diff ?? ''), ...deletedNow])] }
}

/** Of the given paths, those present on disk in the checkout even though git ignores them. */
export async function presentOnDisk(checkout: string, paths: readonly string[]): Promise<string[]> {
  const found = await Promise.all(paths.map(async (p) => ((await stat(join(checkout, p)).catch(() => null)) ? p : null)))
  return found.filter((p): p is string => p !== null)
}

export async function readMemory(slug: string, file: string, root = projectsRoot()): Promise<string> {
  if (/[/\\]|\.\./.test(slug) || /[/\\]|\.\./.test(file) || !file.endsWith('.md')) throw new Error('Not a memory file of this folder.')
  return readFile(join(root, slug, 'memory', file), 'utf8')
}
