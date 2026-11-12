// Audit of a Claude Code auto-memory folder (~/.claude/projects/<slug>/memory).
// Pure: it receives the files already read, so the worker, the CLI and the tests share it.

export type MemoryType = 'user' | 'feedback' | 'project' | 'reference' | 'unknown'

export interface MemoryFile {
  /** File name inside the memory folder, e.g. `pricing-in-cents.md`. */
  file: string
  content: string
  mtimeMs: number
}

export interface Memory {
  file: string
  name: string | null
  description: string | null
  type: MemoryType
  mtimeMs: number
  bytes: number
  links: string[]
  indexed: boolean
}

export type IssueKind =
  | 'broken-link'
  | 'link-by-filename'
  | 'not-indexed'
  | 'index-dangling'
  | 'no-frontmatter'
  | 'duplicate-name'
  | 'stale'
  | 'index-too-long'

export interface Issue {
  kind: IssueKind
  /** `info` is a nudge (to reread), not a defect: it is listed apart and never fails the CLI. */
  severity: 'info' | 'warning' | 'danger'
  /** The memory file concerned; null for MEMORY.md as a whole. */
  file: string | null
  message: string
}

export interface AuditOptions {
  now: number
  /** A `project` memory untouched for longer than this is flagged as stale. */
  staleDays: number
  /** Claude Code loads only the first lines of MEMORY.md; past this many, the rest is unseen. */
  indexMaxLines: number
}

export const DEFAULT_OPTIONS: Omit<AuditOptions, 'now'> = { staleDays: 60, indexMaxLines: 200 }

export interface AuditResult {
  memories: Memory[]
  issues: Issue[]
  index: { present: boolean; lines: number; bytes: number }
}

const INDEX = 'MEMORY.md'
const encoder = new TextEncoder()
const byteLength = (s: string): number => encoder.encode(s).length
const DAY = 86_400_000
const RANK: Record<Issue['severity'], number> = { danger: 0, warning: 1, info: 2 }
const TYPES: readonly MemoryType[] = ['user', 'feedback', 'project', 'reference']

/** Reads the leading `---` block: top-level keys and the keys nested under `metadata:`. */
export function parseFrontmatter(content: string): Record<string, string> | null {
  const lines = content.split(/\r?\n/)
  if (lines[0]?.trim() !== '---') return null
  const end = lines.indexOf('---', 1)
  if (end === -1) return null
  const out: Record<string, string> = {}
  let parent: string | null = null
  for (const line of lines.slice(1, end)) {
    const m = /^(\s*)([A-Za-z_][\w-]*):\s*(.*)$/.exec(line)
    if (!m) continue
    const [, indent, key, raw] = m as unknown as [string, string, string, string]
    const value = raw.trim().replace(/^(["'])(.*)\1$/, '$2')
    if (indent.length === 0) {
      parent = value === '' ? key : null
      out[key] = value
    } else if (parent) {
      out[`${parent}.${key}`] = value
    }
  }
  return out
}

function memoryType(fm: Record<string, string> | null): MemoryType {
  const t = fm?.['metadata.type'] ?? fm?.type
  return TYPES.includes(t as MemoryType) ? (t as MemoryType) : 'unknown'
}

/** `[[slug]]` references in the body, deduplicated, in order of appearance. */
export function extractLinks(content: string): string[] {
  return [...new Set([...content.matchAll(/\[\[([^\]\s|]+)\]\]/g)].map((m) => m[1] as string))]
}

/** File names the index points to with a Markdown link `(file.md)`. */
export function indexTargets(index: string): Set<string> {
  return new Set([...index.matchAll(/\]\(([^)\s]+\.md)\)/g)].map((m) => m[1] as string))
}

export function audit(files: readonly MemoryFile[], options: AuditOptions): AuditResult {
  const indexFile = files.find((f) => f.file === INDEX)
  const targets = indexFile ? indexTargets(indexFile.content) : new Set<string>()
  const issues: Issue[] = []

  const memories: Memory[] = files
    .filter((f) => f.file !== INDEX && f.file.endsWith('.md'))
    .map((f) => {
      const fm = parseFrontmatter(f.content)
      if (!fm) {
        issues.push({ kind: 'no-frontmatter', severity: 'warning', file: f.file, message: 'Pas de frontmatter (name, description, type).' })
      }
      return {
        file: f.file,
        name: fm?.name || null,
        description: fm?.description || null,
        type: memoryType(fm),
        mtimeMs: f.mtimeMs,
        bytes: byteLength(f.content),
        links: extractLinks(f.content),
        indexed: targets.has(f.file)
      }
    })
    .sort((a, b) => a.file.localeCompare(b.file))

  const byName = new Map<string, Memory[]>()
  for (const m of memories) {
    const key = m.name ?? m.file.replace(/\.md$/, '')
    byName.set(key, [...(byName.get(key) ?? []), m])
  }
  // A link targets a memory's `name:`. One that only matches a file name still reads for a
  // human, but it is a different slug: flagged apart, as the cheap fix it is.
  const byFile = new Map(memories.map((m) => [m.file.replace(/\.md$/, ''), m]))

  for (const [name, group] of byName) {
    if (group.length > 1) {
      for (const m of group) {
        issues.push({ kind: 'duplicate-name', severity: 'danger', file: m.file, message: `Le nom « ${name} » est porté par ${group.length} fichiers.` })
      }
    }
  }

  const linkSources = [...memories.map((m) => ({ file: m.file, links: m.links })), ...(indexFile ? [{ file: INDEX, links: extractLinks(indexFile.content) }] : [])]
  for (const { file, links } of linkSources) {
    for (const link of links) {
      if (byName.has(link)) continue
      const target = byFile.get(link)
      if (target?.name) {
        issues.push({ kind: 'link-by-filename', severity: 'warning', file, message: `[[${link}]] vise le fichier ${target.file}, dont le name est « ${target.name} ».` })
      } else if (!target) {
        issues.push({ kind: 'broken-link', severity: 'danger', file, message: `[[${link}]] ne correspond à aucune mémoire.` })
      }
    }
  }

  if (indexFile) {
    for (const m of memories) {
      if (!m.indexed) issues.push({ kind: 'not-indexed', severity: 'warning', file: m.file, message: 'Absente de MEMORY.md : Claude ne la retrouvera pas.' })
    }
    const present = new Set(files.map((f) => f.file))
    for (const t of targets) {
      if (!present.has(t)) issues.push({ kind: 'index-dangling', severity: 'danger', file: INDEX, message: `MEMORY.md pointe vers ${t}, qui n'existe pas.` })
    }
  }

  for (const m of memories) {
    const days = Math.floor((options.now - m.mtimeMs) / DAY)
    if (m.type === 'project' && days > options.staleDays) {
      issues.push({ kind: 'stale', severity: 'info', file: m.file, message: `Mémoire « project » inchangée depuis ${days} jours : encore vraie ?` })
    }
  }

  const indexLines = indexFile ? indexFile.content.split(/\r?\n/).length : 0
  if (indexLines > options.indexMaxLines) {
    issues.push({ kind: 'index-too-long', severity: 'danger', file: INDEX, message: `MEMORY.md fait ${indexLines} lignes ; au-delà de ${options.indexMaxLines}, la fin n'est pas chargée.` })
  }

  return {
    memories,
    issues: issues.sort((a, b) => RANK[a.severity] - RANK[b.severity]),
    index: { present: Boolean(indexFile), lines: indexLines, bytes: indexFile ? byteLength(indexFile.content) : 0 }
  }
}
