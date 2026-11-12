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

/**
 * The files of a checkout as they are NOW: tracked and new (not ignored) files, minus those
 * deleted from the working tree. Null when the folder is not a git checkout.
 */
export async function trackedFiles(checkout: string): Promise<string[] | null> {
  const [present, deleted] = await Promise.all([
    git(checkout, ['ls-files', '-z', '--cached', '--others', '--exclude-standard']),
    git(checkout, ['ls-files', '-z', '--deleted'])
  ])
  if (present === null) return null
  const gone = new Set(nulSplit(deleted ?? ''))
  return [...new Set(nulSplit(present))].filter((f) => !gone.has(f))
}

export async function currentBranch(checkout: string): Promise<string | null> {
  return (await git(checkout, ['rev-parse', '--abbrev-ref', 'HEAD']))?.trim() || null
}

/** The default branch to compare against: origin/HEAD, else origin/main, else main. */
export async function baseRef(checkout: string): Promise<string | null> {
  const head = (await git(checkout, ['rev-parse', '--abbrev-ref', 'origin/HEAD']))?.trim()
  if (head && head !== 'origin/HEAD') return head
  for (const ref of ['origin/main', 'main', 'origin/master', 'master']) {
    if ((await git(checkout, ['rev-parse', '--verify', '--quiet', ref])) !== null) return ref
  }
  return null
}

export async function filesAt(checkout: string, ref: string): Promise<string[] | null> {
  const out = await git(checkout, ['ls-tree', '-r', '-z', '--name-only', ref])
  return out === null ? null : nulSplit(out)
}

export async function readMemory(slug: string, file: string, root = projectsRoot()): Promise<string> {
  if (/[/\\]|\.\./.test(slug) || /[/\\]|\.\./.test(file) || !file.endsWith('.md')) throw new Error('Mémoire invalide.')
  return readFile(join(root, slug, 'memory', file), 'utf8')
}
