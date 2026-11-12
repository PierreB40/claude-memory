// What Claude Code believes about a project (its auto-memory folder) and what no longer holds.
// Pure: it receives the files already read, so the worker, the CLI and the tests share it.

export type MemoryType = 'user' | 'feedback' | 'project' | 'reference' | 'unknown'

export interface MemoryFile {
  /** File name inside the memory folder, e.g. `pricing-in-cents.md`. */
  file: string
  content: string
  mtimeMs: number
}

export type ProblemKind = 'dead-link' | 'link-by-file' | 'unindexed' | 'duplicate-name' | 'no-header'

export interface Problem {
  kind: ProblemKind
  /** A few words for a list row. */
  short: string
  /** One sentence for the memory itself. */
  detail: string
}

/** The words of each defect, in one place: the panel and the notifications read them here. */
export const PROBLEM_SHORT: Record<ProblemKind, string> = {
  'dead-link': 'lien cassé',
  'link-by-file': 'lien à rediriger',
  unindexed: 'hors index',
  'duplicate-name': 'nom en double',
  'no-header': 'sans en-tête'
}

export interface Memory {
  file: string
  /** What a person reads: the index text when it is a title, else the description's opening. */
  title: string
  /** The description without what the title already says; empty when nothing is left. */
  rest: string
  name: string | null
  description: string | null
  type: MemoryType
  mtimeMs: number
  /** `[[slug]]` targets that resolve, as file names. */
  related: string[]
  /** How many repository paths the memory cites in backticks. */
  cited: number
  /** Cited paths in neither the checked checkout nor the default branch: false everywhere. */
  missingPaths: string[]
  /**
   * Cited paths the checked branch removes since it left the default branch. Still true on the
   * default branch, so nothing to fix now: the memory will need updating when the branch merges.
   */
  removedByBranch: string[]
  problems: Problem[]
  indexed: boolean
}

export interface Audit {
  memories: Memory[]
  /** Defects of MEMORY.md itself (dangling entries, too long). */
  indexProblems: string[]
  index: { present: boolean; lines: number }
}

/** What the repository says about cited paths; null when no checkout could be read. */
export interface RepoFacts {
  /** Every path that exists somewhere it counts: the checkout (working tree) and the default branch. */
  files: readonly string[]
  /** Paths the checked branch deleted or renamed since it left the default branch. */
  removedByBranch: readonly string[]
}

export interface AuditOptions {
  /** Claude Code loads only the first lines of MEMORY.md; past this many, the rest is unseen. */
  indexMaxLines: number
  repo: RepoFacts | null
}

export const DEFAULT_OPTIONS: AuditOptions = { indexMaxLines: 200, repo: null }

const INDEX = 'MEMORY.md'
const TYPES: readonly MemoryType[] = ['user', 'feedback', 'project', 'reference']
/** `[[slug]]` or `[[slug|shown text]]`. */
const LINK = /\[\[([^\]|\s]+)(?:\|[^\]]*)?\]\]/g

export const capitalize = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1)

/**
 * Reads the leading `---` block: top-level keys and the keys nested under `metadata:`.
 * A folded or literal value (`>-`, `|`) is joined from the indented lines below it.
 */
export function parseFrontmatter(content: string): Record<string, string> | null {
  const lines = content.split(/\r?\n/)
  if (lines[0]?.trim() !== '---') return null
  const end = lines.findIndex((l, i) => i > 0 && l.trim() === '---')
  if (end === -1) return null
  const out: Record<string, string> = {}
  let parent: string | null = null
  let block: { key: string; indent: number; lines: string[] } | null = null
  const flush = (): void => {
    if (block) out[block.key] = block.lines.join(' ').trim()
    block = null
  }
  for (const line of lines.slice(1, end)) {
    const indent = line.length - line.trimStart().length
    if (block && (line.trim() === '' || indent > block.indent)) {
      block.lines.push(line.trim())
      continue
    }
    flush()
    const m = /^(\s*)([A-Za-z_][\w-]*):\s*(.*)$/.exec(line)
    if (!m) continue
    const [, lead, key, raw] = m as unknown as [string, string, string, string]
    const value = raw.trim().replace(/^(["'])(.*)\1$/, '$2')
    const full = lead.length === 0 ? key : parent ? `${parent}.${key}` : null
    if (lead.length === 0) parent = value === '' ? key : null
    if (!full) continue
    if (/^[>|][+-]?$/.test(value)) block = { key: full, indent: lead.length, lines: [] }
    else out[full] = value
  }
  flush()
  return out
}

/** The memory without its frontmatter (an empty `---` / `---` block included). */
export function bodyOf(content: string): string {
  const m = /^---[ \t]*\r?\n(?:[\s\S]*?\r?\n)??---[ \t]*(?:\r?\n|$)/.exec(content)
  return (m ? content.slice(m[0].length) : content).trim()
}

function memoryType(fm: Record<string, string> | null): MemoryType {
  const t = fm?.['metadata.type'] ?? fm?.type
  return TYPES.includes(t as MemoryType) ? (t as MemoryType) : 'unknown'
}

/** Text outside code: `[[…]]` inside a code span or block is an example, not a link. */
function outsideCode(text: string, fn: (prose: string) => string): string {
  return text
    .split(/(```[\s\S]*?```|`[^`\n]*`)/)
    .map((part, i) => (i % 2 ? part : fn(part)))
    .join('')
}

/** `[[slug]]` references outside code, deduplicated, in order of appearance. */
export function extractLinks(content: string): string[] {
  const out: string[] = []
  outsideCode(content, (prose) => {
    for (const m of prose.matchAll(LINK)) out.push(m[1] as string)
    return prose
  })
  return [...new Set(out)]
}

/** `[text](file.md)` entries of the index: file -> text. `./x.md` is `x.md`. */
export function indexEntries(index: string): Map<string, string> {
  return new Map([...index.matchAll(/\[([^\]]+)\]\(([^)\s]+\.md)\)/g)].map((m) => [(m[2] as string).replace(/^\.\//, ''), m[1] as string]))
}

const PATH = /`([A-Za-z0-9_.@-]*\/[A-Za-z0-9_./@[\]-]*\.[A-Za-z]{1,5})`/g
const BUILD = /(^|\/)(node_modules|\.nuxt|dist|\.output|\.git)\//

/** Repository-looking paths quoted in backticks: a slash and an extension, no URL, no home. */
export function citedPaths(content: string): string[] {
  const out = new Set<string>()
  for (const m of content.matchAll(PATH)) {
    const p = (m[1] as string).replace(/^\.?\//, '')
    if (p.includes('://') || p.startsWith('~') || BUILD.test(p)) continue
    out.add(p)
  }
  return [...out]
}

export interface PathIndex {
  /** A file is the path, or ends with it: memories often abbreviate (`orders/index.vue`). */
  has(path: string): boolean
  /**
   * Whether the repository can speak of a path: its first folder is one of the repository's.
   * Otherwise it is about something else (an npm package, a domain) and is never judged.
   */
  judges(path: string): boolean
}

/** Built once per audit: every path suffix and folder name, so each check is a lookup. */
export function indexPaths(files: readonly string[]): PathIndex {
  const suffixes = new Set<string>()
  const folders = new Set<string>()
  for (const f of files) {
    const parts = f.split('/')
    for (let i = 0; i < parts.length; i++) suffixes.add(parts.slice(i).join('/'))
    for (const folder of parts.slice(0, -1)) folders.add(folder)
  }
  return { has: (p) => suffixes.has(p), judges: (p) => folders.has(p.split('/')[0] ?? '') }
}

/** A slug with its type prefix dropped, as words: the last resort for a title. */
const readable = (slug: string): string =>
  capitalize(slug.replace(/\.md$/, '').replace(/^(project|feedback|reference|user)[-_]/, '').replace(/[-_]+/g, ' ').trim())

const TITLE_MAX = 70

/**
 * A description cut in two: its opening clause (cut at the first dash, colon, parenthesis or
 * semicolon, without a leading status emoji), which Claude writes for a person, and the rest.
 * Lengths count characters, not UTF-16 units, so an emoji is never cut in half.
 */
export function splitDescription(description: string): { lead: string; rest: string } {
  const text = description.replace(/^[\p{Extended_Pictographic}️\s]+/u, '').trim()
  const cut = /\s[—–-]\s|\s?:\s|\s\(|;\s/.exec(text)
  const clause = (cut ? text.slice(0, cut.index) : text).trim()
  const chars = Array.from(clause)
  if (chars.length > TITLE_MAX) {
    const head = chars.slice(0, TITLE_MAX - 1).join('').trimEnd()
    // Too long for a title: cut it, and let the rest pick up where the title stopped.
    return { lead: `${capitalize(head)}…`, rest: `…${text.slice(head.length).trimStart()}` }
  }
  const after = cut ? text.slice(cut.index + cut[0].length).trim() : ''
  // A cut on « ( » keeps its parenthesis: « (12/11) » reads, « 12/11) » does not.
  return { lead: capitalize(clause), rest: cut?.[0].trim() === '(' ? `(${after}` : after }
}

/** An index text with no space is a slug someone pasted, not a title. */
const isTitle = (text: string | undefined): text is string => Boolean(text && /\s/.test(text))

/** The title a person reads, and what of the description is left to say under it. */
function titleOf(linkText: string | undefined, description: string | null, name: string | null, slug: string): { title: string; rest: string } {
  if (isTitle(linkText)) return { title: linkText, rest: description ?? '' }
  const split = description ? splitDescription(description) : { lead: '', rest: '' }
  return split.lead.length >= 8 ? { title: split.lead, rest: split.rest } : { title: readable(name ?? slug), rest: description ?? '' }
}

const problem = (kind: ProblemKind, detail: string): Problem => ({ kind, short: PROBLEM_SHORT[kind], detail })

export function audit(files: readonly MemoryFile[], options: AuditOptions = DEFAULT_OPTIONS): Audit {
  const indexFile = files.find((f) => f.file === INDEX)
  const entries = indexFile ? indexEntries(indexFile.content) : new Map<string, string>()
  const sources = files.filter((f) => f.file !== INDEX && f.file.endsWith('.md'))
  const known = options.repo ? indexPaths(options.repo.files) : null
  const removed = options.repo ? indexPaths(options.repo.removedByBranch) : null

  const parsed = sources.map((f) => ({ f, fm: parseFrontmatter(f.content), slug: f.file.replace(/\.md$/, '') }))
  const byName = new Map<string, string[]>()
  for (const { f, fm, slug } of parsed) {
    const key = fm?.name || slug
    byName.set(key, [...(byName.get(key) ?? []), f.file])
  }
  const byFile = new Map(parsed.map(({ f, fm, slug }) => [slug, { file: f.file, name: fm?.name || null }]))

  const memories: Memory[] = parsed
    .map(({ f, fm, slug }) => {
      const problems: Problem[] = []
      const related: string[] = []
      if (!fm || !fm.name) problems.push(problem('no-header', "Pas d'en-tête complet (name, description, type) : Claude la retrouve mal."))
      const name = fm?.name || null
      const twins = byName.get(name ?? slug) ?? []
      if (twins.length > 1) problems.push(problem('duplicate-name', `Même nom que ${twins.filter((t) => t !== f.file).join(', ')}.`))
      for (const link of extractLinks(bodyOf(f.content))) {
        const target = byName.get(link)?.[0]
        if (target) {
          related.push(target)
          continue
        }
        const byFileName = byFile.get(link)
        if (byFileName?.name) {
          related.push(byFileName.file)
          problems.push(problem('link-by-file', `Le lien [[${link}]] vise un nom de fichier ; le nom de la mémoire est « ${byFileName.name} ».`))
        } else if (byFileName) {
          related.push(byFileName.file)
        } else {
          problems.push(problem('dead-link', `Le lien [[${link}]] ne mène à aucune mémoire.`))
        }
      }
      if (indexFile && !entries.has(f.file)) problems.push(problem('unindexed', 'Absente de MEMORY.md : Claude ne la voit pas.'))
      const cited = citedPaths(f.content)
      return {
        file: f.file,
        ...titleOf(entries.get(f.file), fm?.description || null, name, slug),
        name,
        description: fm?.description || null,
        type: memoryType(fm),
        mtimeMs: f.mtimeMs,
        related: [...new Set(related)].filter((r) => r !== f.file),
        cited: cited.length,
        missingPaths: known ? cited.filter((p) => known.judges(p) && !known.has(p)) : [],
        removedByBranch: removed && known ? cited.filter((p) => removed.has(p)) : [],
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
  // A final newline ends the last line; it does not start another.
  const lines = indexFile ? indexFile.content.replace(/\r?\n$/, '').split(/\r?\n/).length : 0
  if (lines > options.indexMaxLines) {
    indexProblems.push(`MEMORY.md fait ${lines} lignes : Claude n'en lit que ${options.indexMaxLines}.`)
  }

  return { memories, indexProblems, index: { present: Boolean(indexFile), lines } }
}

/**
 * How wrong a memory is: how much vanished code it leans on (count weighted by share, so ten
 * missing in a short memory outweigh one in a long one), then each defect.
 */
export const severity = (m: Memory): number => (m.cited ? (m.missingPaths.length * m.missingPaths.length) / m.cited : 0) + m.problems.length

/** Memories that mislead Claude now, or that it cannot reach: the most wrong first. */
export function toVerify(result: Audit): Memory[] {
  return result.memories.filter((m) => m.problems.length > 0 || m.missingPaths.length > 0).sort((a, b) => severity(b) - severity(a))
}

/** What there is to verify, the index counting once: the number every surface shows. */
export const verifyCount = (result: Audit): number => toVerify(result).length + (result.indexProblems.length ? 1 : 0)

/** Memories the checked branch will make false once merged (nothing to do before). */
export const atMerge = (result: Audit): Memory[] => result.memories.filter((m) => m.removedByBranch.length > 0)

const PROMPT_MAX = 40

/** One line, as an agent's TUI submits on newline. Asks to check, never to delete silently. */
export function verifyPrompt(dir: string, memories: readonly Memory[], indexProblems: readonly string[]): string {
  const items = memories.slice(0, PROMPT_MAX).map((m) => {
    const why = [...m.problems.map((p) => p.detail), ...(m.missingPaths.length ? [`cite ${m.missingPaths.map((p) => `\`${p}\``).join(', ')}, introuvable(s) dans le code`] : [])]
    return `${m.file} (${why.join(' ; ')})`
  })
  const more = memories.length > PROMPT_MAX ? ` (et ${memories.length - PROMPT_MAX} autres : traite d'abord celles-ci)` : ''
  return [
    `Revois ta mémoire automatique de ce projet (${dir}).`,
    ...(items.length ? [`Ces mémoires sont peut-être fausses ou mal reliées${more} : ${items.join(' · ')}.`] : []),
    ...(indexProblems.length ? [`Index : ${indexProblems.join(' ; ')}.`] : []),
    "Pour chacune, vérifie dans le code actuel : corrige-la si elle reste utile (chemins, liens vers le name: de la cible, ligne dans MEMORY.md), et propose-moi la liste de celles à supprimer plutôt que de les supprimer toi-même."
  ].join(' ')
}

/**
 * A memory's text as a person reads it: each `[[slug]]` outside code becomes the title of the
 * memory it names, in « » and italics; a slug that names none says so (a defect to see).
 */
export function readableBody(body: string, memories: readonly Pick<Memory, 'file' | 'name' | 'title'>[]): string {
  const byKey = new Map<string, string>()
  for (const m of memories) {
    byKey.set(m.file.replace(/\.md$/, ''), m.title)
    if (m.name) byKey.set(m.name, m.title)
  }
  return outsideCode(body, (prose) =>
    prose.replace(LINK, (_whole, slug: string) => {
      const title = byKey.get(slug)
      return title ? `*« ${title} »*` : `*${slug} (introuvable)*`
    })
  )
}

/**
 * What is wrong with a memory just written, for a notification; null if nothing. « Not in the
 * index » is left out: Claude writes the memory first and its index line right after.
 */
export function writeVerdict(m: Memory): string | null {
  const parts: string[] = []
  if (m.missingPaths.length) parts.push(`cite ${m.missingPaths.length > 1 ? `${m.missingPaths.length} fichiers introuvables` : 'un fichier introuvable'}`)
  const dead = m.problems.filter((p) => p.kind === 'dead-link').length
  if (dead) parts.push(dead > 1 ? `${dead} liens vers rien` : 'un lien vers rien')
  return parts.length ? parts.join(', ') : null
}
