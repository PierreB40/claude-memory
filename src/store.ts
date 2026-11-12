// Reads Claude Code memory folders from disk. Worker and CLI only: a panel has no file system.
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
