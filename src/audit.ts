// What Claude Code believes about a project (its auto-memory folder) and what no longer holds.
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
  /** What a person reads: the index text when it is a title, else the description's opening clause. */
  title: string
  /** The description without what the title already says; empty when nothing is left. */
  rest: string
  name: string | null
  description: string | null
  type: MemoryType
  mtimeMs: number
  /** `[[slug]]` targets that resolve, as file names. */
  related: string[]
  /** Repository paths the memory cites in backticks. */
  cited: number
  /** Cited paths no longer in the repository; empty when the repository was not checked. */
  missingPaths: string[]
  /** Of those, the ones the default branch still has: the checked branch removed them. */
  brokenHere: string[]
  /** Consistency defects: `short` for a list row, `detail` for the memory itself. */
  problems: Problem[]
  indexed: boolean
}

export interface Problem {
  short: string
  detail: string
}

export interface Audit {
  memories: Memory[]
  /** Defects of MEMORY.md itself (dangling entries, too long). */
  indexProblems: string[]
  index: { present: boolean; lines: number; bytes: number }
  /** Whether cited paths were checked against a repository. */
  repoChecked: boolean
}

export interface AuditOptions {
  /** Claude Code loads only the first lines of MEMORY.md; past this many, the rest is unseen. */
  indexMaxLines: number
  /** Every file of the checked checkout, relative; null when unknown. */
  repoFiles: readonly string[] | null
  /** Every file of the default branch, to tell what the checked branch broke; null to skip. */
  baseFiles: readonly string[] | null
}

export const DEFAULT_OPTIONS: AuditOptions = { indexMaxLines: 200, repoFiles: null, baseFiles: null }

const INDEX = 'MEMORY.md'
const encoder = new TextEncoder()
const byteLength = (s: string): number => encoder.encode(s).length
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

/** The memory without its frontmatter. */
export function bodyOf(content: string): string {
  const m = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/.exec(content)
  return (m ? content.slice(m[0].length) : content).trim()
}

function memoryType(fm: Record<string, string> | null): MemoryType {
  const t = fm?.['metadata.type'] ?? fm?.type
  return TYPES.includes(t as MemoryType) ? (t as MemoryType) : 'unknown'
}

/** `[[slug]]` references, deduplicated, in order of appearance. */
export function extractLinks(content: string): string[] {
  return [...new Set([...content.matchAll(/\[\[([^\]\s|]+)\]\]/g)].map((m) => m[1] as string))]
}

/** `[text](file.md)` entries of the index: file -> text. */
export function indexEntries(index: string): Map<string, string> {
  return new Map([...index.matchAll(/\[([^\]]+)\]\(([^)\s]+\.md)\)/g)].map((m) => [m[2] as string, m[1] as string]))
}

const PATH = /`([A-Za-z0-9_.@-]*\/[A-Za-z0-9_./@[\]-]*\.[A-Za-z]{1,5})`/g
const IGNORED = /^(node_modules|\.nuxt|dist|\.output|\.git)\//

/** Repository-looking paths quoted in backticks: a slash and an extension, no URL, no home. */
export function citedPaths(content: string): string[] {
  const out = new Set<string>()
  for (const m of content.matchAll(PATH)) {
    const p = (m[1] as string).replace(/^\.?\//, '')
    if (p.includes('://') || p.startsWith('~') || IGNORED.test(p)) continue
    out.add(p)
  }
  return [...out]
}

/**
 * A cited path holds when a tracked file is it, or ends with it (memories often abbreviate).
 * A path whose first folder is no folder of the repository is about something else (an npm
 * package, a domain): it is not this repository's to confirm, so it is never reported missing.
 */
export function missingFrom(paths: readonly string[], repoFiles: readonly string[]): string[] {
  const folders = new Set(repoFiles.flatMap((f) => f.split('/').slice(0, -1)))
  return paths.filter((p) => folders.has(p.split('/')[0] ?? '') && !repoFiles.some((f) => f === p || f.endsWith(`/${p}`)))
}

const capitalize = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1)

/** A slug with its type prefix dropped, as words: the last resort for a title. */
const readable = (slug: string): string =>
  capitalize(slug.replace(/\.md$/, '').replace(/^(project|feedback|reference|user)[-_]/, '').replace(/[-_]+/g, ' ').trim())

/**
 * A description cut in two: its opening clause (cut at the first dash, colon, parenthesis or
 * semicolon, without a leading status emoji), which Claude writes for a person, and the rest.
 */
export function splitDescription(description: string): { lead: string; rest: string } {
  const text = description.replace(/^[\p{Extended_Pictographic}\uFE0F\s]+/u, '').trim()
  const cut = /\s[—–-]\s|\s?:\s|\s\(|;\s/.exec(text)
  const clause = (cut ? text.slice(0, cut.index) : text).trim()
  // Too long for a title: cut it, and let the rest pick up where the title stopped.
  if (clause.length > 70) return { lead: `${clause.slice(0, 69).trimEnd()}…`, rest: `…${text.slice(69).trimStart()}` }
  const after = cut ? text.slice(cut.index + cut[0].length).trim() : ''
  // A cut on « ( » keeps its parenthesis: « (12/11) » reads, « 12/11) » does not.
  return { lead: capitalize(clause), rest: cut?.[0].trim() === '(' ? `(${after}` : after }
}

export const headline = (description: string): string => splitDescription(description).lead

/** An index text with no space is a slug someone pasted, not a title. */
const isTitle = (text: string | undefined): text is string => Boolean(text && /\s/.test(text))

/** The title a person reads, and what of the description is left to say under it. */
function titleOf(linkText: string | undefined, description: string | null, name: string | null, slug: string): { title: string; rest: string } {
  if (isTitle(linkText)) return { title: linkText, rest: description ?? '' }
  const split = description ? splitDescription(description) : { lead: '', rest: '' }
  return split.lead.length >= 8 ? { title: split.lead, rest: split.rest } : { title: readable(name ?? slug), rest: description ?? '' }
}

export function audit(files: readonly MemoryFile[], options: AuditOptions = DEFAULT_OPTIONS): Audit {
  const indexFile = files.find((f) => f.file === INDEX)
  const entries = indexFile ? indexEntries(indexFile.content) : new Map<string, string>()
  const sources = files.filter((f) => f.file !== INDEX && f.file.endsWith('.md'))

  const parsed = sources.map((f) => ({ f, fm: parseFrontmatter(f.content) }))
  const byName = new Map<string, string[]>()
  for (const { f, fm } of parsed) {
    const key = fm?.name || f.file.replace(/\.md$/, '')
    byName.set(key, [...(byName.get(key) ?? []), f.file])
  }
  const byFile = new Map(parsed.map(({ f, fm }) => [f.file.replace(/\.md$/, ''), { file: f.file, name: fm?.name ?? null }]))

  const memories: Memory[] = parsed
    .map(({ f, fm }) => {
      const problems: Problem[] = []
      const related: string[] = []
      if (!fm) problems.push({ short: 'Sans en-tête', detail: "Pas d'en-tête (name, description, type)." })
      const name = fm?.name || null
      const twins = byName.get(name ?? f.file.replace(/\.md$/, '')) ?? []
      if (twins.length > 1) problems.push({ short: 'Nom en double', detail: `Même nom que ${twins.filter((t) => t !== f.file).join(', ')}.` })
      for (const link of extractLinks(f.content)) {
        const target = byName.get(link)?.[0]
        if (target) {
          related.push(target)
          continue
        }
        const byFileName = byFile.get(link)
        if (byFileName) {
          related.push(byFileName.file)
          problems.push({ short: 'Lien à rediriger', detail: `Le lien [[${link}]] vise un nom de fichier ; le nom de la mémoire est « ${byFileName.name} ».` })
        } else {
          problems.push({ short: 'Lien mort', detail: `Le lien [[${link}]] ne mène à aucune mémoire.` })
        }
      }
      if (indexFile && !entries.has(f.file)) problems.push({ short: 'Hors index', detail: 'Absente de MEMORY.md : Claude ne la voit pas.' })
      const cited = citedPaths(f.content)
      const missing = options.repoFiles ? missingFrom(cited, options.repoFiles) : []
      const baseFiles = options.baseFiles
      const linkText = entries.get(f.file)
      const slug = f.file.replace(/\.md$/, '')
      return {
        file: f.file,
        ...titleOf(linkText, fm?.description || null, name, slug),
        name,
        description: fm?.description || null,
        type: memoryType(fm),
        mtimeMs: f.mtimeMs,
        related: [...new Set(related)],
        cited: cited.length,
        missingPaths: missing,
        brokenHere: baseFiles ? missing.filter((m) => missingFrom([m], baseFiles).length === 0) : [],
        problems,
        indexed: entries.has(f.file)
      }
    })
    .sort((a, b) => a.title.localeCompare(b.title, 'fr'))

  const indexProblems: string[] = []
  const present = new Set(files.map((f) => f.file))
  for (const target of entries.keys()) {
    if (!present.has(target)) indexProblems.push(`MEMORY.md renvoie vers ${target}, qui n'existe plus.`)
  }
  const lines = indexFile ? indexFile.content.split(/\r?\n/).length : 0
  if (lines > options.indexMaxLines) {
    indexProblems.push(`MEMORY.md fait ${lines} lignes : Claude n'en lit que ${options.indexMaxLines}.`)
  }

  return {
    memories,
    indexProblems,
    index: { present: Boolean(indexFile), lines, bytes: indexFile ? byteLength(indexFile.content) : 0 },
    repoChecked: options.repoFiles !== null
  }
}

/** Memories that mislead Claude or that it cannot reach, the most broken first. */
export function toVerify(result: Audit): Memory[] {
  // How much vanished code a memory leans on (count weighted by share): one path in a long
  // memory matters less than ten in a short one. A link or index defect weighs one path.
  const weight = (m: Memory): number => (m.cited ? (m.missingPaths.length * m.missingPaths.length) / m.cited : 0) + m.problems.length
  return result.memories.filter((m) => m.problems.length > 0 || m.missingPaths.length > 0).sort((a, b) => weight(b) - weight(a))
}

/** One line, as an agent's TUI submits on newline. Asks to check, never to delete silently. */
export function verifyPrompt(dir: string, memories: readonly Memory[], indexProblems: readonly string[]): string {
  const items = memories.map((m) => {
    const why = [...m.problems.map((p) => p.detail), ...(m.missingPaths.length ? [`cite ${m.missingPaths.map((p) => `\`${p}\``).join(', ')}, introuvable(s) dans le dépôt`] : [])]
    return `${m.file} (${why.join(' ; ')})`
  })
  return [
    `Revois ta mémoire automatique de ce projet (${dir}).`,
    `Ces mémoires sont peut-être fausses ou mal reliées : ${items.join(' · ')}.`,
    ...(indexProblems.length ? [`Index : ${indexProblems.join(' ; ')}.`] : []),
    "Pour chacune, vérifie dans le code actuel : corrige-la si elle reste utile (chemins, liens vers le name: de la cible, ligne dans MEMORY.md), et propose-moi la liste de celles à supprimer plutôt que de les supprimer toi-même."
  ].join(' ')
}

/** One line. The branch is the cause, so the fix is to follow it, not to doubt the memory. */
export function branchPrompt(dir: string, branch: string, memories: readonly Memory[]): string {
  const items = memories.map((m) => `${m.file} (cite ${m.brokenHere.map((p) => `\`${p}\``).join(', ')})`)
  return [
    `La branche ${branch} supprime ou déplace des fichiers que ta mémoire automatique cite (${dir}) : ${items.join(' · ')}.`,
    "Mets ces mémoires à jour pour qu'elles décrivent l'état de la branche (nouveau chemin si le fichier a été déplacé, ce qui le remplace s'il a été retiré) ; si l'une n'a plus de raison d'être, propose-moi de la supprimer plutôt que de le faire."
  ].join(' ')
}

/**
 * A memory's text as a person reads it: each `[[slug]]` becomes the title of the memory it
* names, in « » and italics; a slug that names none says so (it is a defect to see).
 */
export function readableBody(body: string, memories: readonly Pick<Memory, 'file' | 'name' | 'title'>[]): string {
  const byKey = new Map<string, string>()
  for (const m of memories) {
    byKey.set(m.file.replace(/\.md$/, ''), m.title)
    if (m.name) byKey.set(m.name, m.title)
  }
  return body.replace(/\[\[([^\]\s|]+)\]\]/g, (whole, slug: string) => {
    const title = byKey.get(slug)
    return title ? `*« ${title} »*` : `*${slug} (introuvable)*`
  })
}

/** What is wrong with a memory just written, in a few words for a notification; null if nothing. */
export function writeVerdict(m: Memory): string | null {
  const parts: string[] = []
  if (m.missingPaths.length) parts.push(`cite ${m.missingPaths.length > 1 ? `${m.missingPaths.length} fichiers introuvables` : 'un fichier introuvable'}`)
  const dead = m.problems.filter((p) => p.short === 'Lien mort').length
  if (dead) parts.push(dead > 1 ? `${dead} liens vers rien` : 'un lien vers rien')
  if (m.problems.some((p) => p.short === 'Hors index')) parts.push('absente de MEMORY.md')
  return parts.length ? parts.join(', ') : null
}
