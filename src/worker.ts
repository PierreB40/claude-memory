// Reads ~/.claude/projects and the focused workspace's checkout on the Orca host. It answers the
// panel, keeps the status bar item current, hears agents read and write memories, and runs the
// palette commands. It never writes a memory: fixing is handed to a new Claude.
import type { OrcaWorkerApi } from 'orca/worker'
import { audit, bodyOf, citedPaths, DEFAULT_OPTIONS, readableBody, toVerify, verifyCount, writeDefects, type MemoryFile } from './audit.ts'
import { candidateSlugs, claudeCommand, mainCheckoutOf, matchWorkspace, memoryOfPath, readPath, writtenPath, type WorkspaceInfo } from './detect.ts'
import { langOf, systemLang, words, type Lang, type Words } from './i18n.ts'
import type { PanelView, ProjectView } from './protocol.ts'
import { memoryDir, presentOnDisk, projectsRoot, readCheckout, readGitFile, readMemory, readMemoryFolder, type CheckoutFacts } from './store.ts'

const STATUS = 'health'
const unseenKey = (slug: string): string => `unseen:${slug}`
const readsKey = (slug: string): string => `reads:${slug}`
const sinceKey = (slug: string): string => `tracking:${slug}`
const LANG_KEY = 'lang'
/** Reads of one memory this close together are one reading (Claude reads long files in parts). */
const SAME_READING_MS = 10 * 60_000
/** Git answers are reused this long: one focus change fires several requests at once. */
const GIT_TTL_MS = 5_000

type Reads = ProjectView['reads']

/**
 * The language the worker speaks: Orca's, as the panel last told it (kept for the next run, so a
 * notification before the panel opens speaks it too); the system's until then.
 */
let lang: Lang = systemLang()
const t = (): Words => words(lang)
async function heard(orca: OrcaWorkerApi, locale: string | undefined): Promise<void> {
  if (!locale || langOf(locale) === lang) return
  lang = langOf(locale)
  await orca.storage.set(LANG_KEY, lang)
  void (async () => {
    const saved = await orca.storage.get(LANG_KEY)
    if (saved === 'en' || saved === 'fr') lang = saved
    await refreshStatus(orca)
  })().catch(() => undefined)
}

/** Storage writes one after the other: hooks are not awaited, two may read-modify-write at once. */
let queue: Promise<unknown> = Promise.resolve()
function serial<T>(work: () => Promise<T>): Promise<T> {
  const run = queue.then(work, work)
  queue = run.catch(() => undefined)
  return run
}

async function rootOf(orca: OrcaWorkerApi): Promise<string> {
  const setting = await orca.settings.get('projectsRoot')
  const value = typeof setting === 'string' ? setting.trim() : ''
  if (!value) return projectsRoot()
  return value.startsWith('~/') ? `${projectsRoot().replace(/\/\.claude\/projects$/, '')}/${value.slice(2)}` : value
}

interface Known extends WorkspaceInfo {
  gitFile: string | null
}

/** The focused workspace, matched among every workspace Orca knows; and its name, matched or not. */
async function focusedWorkspace(orca: OrcaWorkerApi): Promise<{ focused: Known | null; name: string | null; all: WorkspaceInfo[] }> {
  const [ctx, { workspaces: all }] = await Promise.all([
    orca.host.call('workspace.readContext').catch(() => null),
    orca.host.call('workspace.list').catch(() => ({ workspaces: [] }))
  ])
  if (!ctx) return { focused: null, name: null, all }
  const match = matchWorkspace(ctx, all)
  return { focused: match ? { ...match, gitFile: await readGitFile(match.path) } : null, name: ctx.displayName, all }
}

const gitCache = new Map<string, { at: number; facts: Promise<CheckoutFacts | null> }>()
function checkoutFacts(path: string): Promise<CheckoutFacts | null> {
  const hit = gitCache.get(path)
  if (hit && Date.now() - hit.at < GIT_TTL_MS) return hit.facts
  const facts = readCheckout(path).catch(() => null)
  gitCache.set(path, { at: Date.now(), facts })
  return facts
}

/** What the repository says of the memories' cited paths, from one checkout. */
async function repoFacts(checkout: string, files: readonly MemoryFile[]) {
  const facts = await checkoutFacts(checkout)
  if (!facts) return { facts: null, repo: null }
  const all = new Set([...facts.files, ...facts.baseFiles])
  // Cited files git ignores but that are there (`.env`, build output) are not missing.
  const unknown = [...new Set(files.flatMap((f) => citedPaths(f.content)))].filter((p) => !all.has(p))
  for (const p of await presentOnDisk(checkout, unknown)) all.add(p)
  return { facts, repo: { files: [...all], removedByBranch: facts.removed } }
}

async function listOf(orca: OrcaWorkerApi, key: string): Promise<string[]> {
  const value = await orca.storage.get(key)
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []
}

async function readsOf(orca: OrcaWorkerApi, slug: string): Promise<Reads> {
  const value = await orca.storage.get(readsKey(slug))
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as unknown as Reads) : {}
}

/** When counting began for a project: « never read » means nothing before that date. */
function trackingSince(orca: OrcaWorkerApi, slug: string): Promise<number> {
  return serial(async () => {
    const value = await orca.storage.get(sinceKey(slug))
    if (typeof value === 'number') return value
    const now = Date.now()
    await orca.storage.set(sinceKey(slug), now)
    return now
  })
}

const lastSegment = (path: string): string => path.split('/').filter(Boolean).pop() ?? path

/** The focused workspace's project, if it has one: like every Orca sidebar tab, never another. */
async function view(orca: OrcaWorkerApi): Promise<PanelView & { focused: Known | null }> {
  const { focused, name } = await focusedWorkspace(orca)
  if (!focused) return { project: null, workspace: name, unmatched: name !== null, focused: null }
  const root = await rootOf(orca)
  let slug: string | null = null
  let files: MemoryFile[] = []
  for (const candidate of candidateSlugs(focused.path, focused.gitFile)) {
    files = await readMemoryFolder(candidate, root).catch(() => [])
    if (files.some((f) => f.file !== 'MEMORY.md')) {
      slug = candidate
      break
    }
  }
  if (!slug) return { project: null, workspace: focused.name, focused }
  const { facts, repo } = await repoFacts(focused.path, files)
  const result = audit(files, { ...DEFAULT_OPTIONS, repo })
  const present = new Set(result.memories.map((m) => m.file))
  const main = focused.gitFile ? mainCheckoutOf(focused.gitFile, focused.path) : null
  return {
    workspace: focused.name,
    focused,
    project: {
      ...result,
      slug,
      label: lastSegment(main ?? focused.path),
      branch: facts?.branch ?? null,
      base: facts?.base?.replace(/^origin\//, '') ?? null,
      unseen: (await listOf(orca, unseenKey(slug))).filter((f) => present.has(f)),
      reads: await readsOf(orca, slug),
      trackingSince: await trackingSince(orca, slug)
    }
  }
}

/** The status bar answers « is the memory of what I work on sound? » without opening anything. */
async function refreshStatus(orca: OrcaWorkerApi): Promise<void> {
  try {
    const { project: p } = await view(orca)
    if (!p) {
      await orca.host.call('statusBar.update', { id: STATUS, visible: false })
      return
    }
    const count = verifyCount(p)
    const fresh = p.unseen.length
    const parts = [count ? `${count}` : '', fresh ? `+${fresh}` : ''].filter(Boolean)
    await orca.host.call('statusBar.update', {
      id: STATUS,
      visible: true,
      icon: 'book',
      text: parts.join(' · ') || ' ',
      tone: count ? 'warning' : fresh ? 'accent' : 'success',
      tooltip: t().statusTooltip(p.label, count, fresh)
    })
  } catch {
    // The status bar is the desktop app's: elsewhere it is simply not there.
  }
}

/** Always a NEW Claude in its own terminal: an idle-looking agent may be a conversation in progress. */
async function handOver(orca: OrcaWorkerApi): Promise<{ count: number; workspace: string }> {
  const { project: p, focused } = await view(orca)
  if (!p || !focused) throw new Error(t().noMemoryHere)
  const count = verifyCount(p)
  if (count === 0) throw new Error(t().nothingToDo)
  const prompt = t().prompt(memoryDir(p.slug, await rootOf(orca)), toVerify(p), p.indexProblems)
  await orca.host.call('terminal.create', { workspaceId: focused.id, title: t().terminalTitle, command: claudeCommand(prompt) })
  return { count, workspace: focused.name }
}

async function recordRead(orca: OrcaWorkerApi, slug: string, file: string): Promise<void> {
  await trackingSince(orca, slug)
  await serial(async () => {
    const reads = await readsOf(orca, slug)
    const now = Date.now()
    const before = reads[file]
    if (before && now - before.last < SAME_READING_MS) return
    reads[file] = { count: (before?.count ?? 0) + 1, last: now }
    await orca.storage.set(readsKey(slug), reads)
  })
}

async function recordWrite(orca: OrcaWorkerApi, memory: { slug: string; file: string; index: boolean }, workspaceId: string | null): Promise<void> {
  if (memory.index) {
    // The index line that follows a new memory: no news, but the panel and the bar move on.
    orca.panels.post('memory.changed', { slug: memory.slug, file: memory.file })
    await refreshStatus(orca)
    return
  }
  const root = await rootOf(orca)
  const files = await readMemoryFolder(memory.slug, root).catch(() => [])
  // A write that failed leaves no file: nothing was learned.
  if (!files.some((f) => f.file === memory.file)) return
  await serial(async () => {
    const unseen = await listOf(orca, unseenKey(memory.slug))
    if (!unseen.includes(memory.file)) await orca.storage.set(unseenKey(memory.slug), [...unseen, memory.file])
  })
  // The writing agent's own workspace holds the code the memory speaks of.
  const { all } = await focusedWorkspace(orca)
  const checkout = all.find((w) => w.id === workspaceId)?.path ?? null
  const { repo } = checkout ? await repoFacts(checkout, files) : { repo: null }
  const written = audit(files, { ...DEFAULT_OPTIONS, repo }).memories.find((m) => m.file === memory.file)
  const defects = written ? writeDefects(written) : null
  const title = written?.title ?? memory.file
  await orca.host
    .call('notifications.show', defects ? { title: t().learnedToReview, body: t().writeVerdict(title, defects) } : { title: t().learned, body: title })
    .catch(() => undefined)
  orca.panels.post('memory.changed', { slug: memory.slug, file: memory.file })
  await refreshStatus(orca)
}

export default function activate(orca: OrcaWorkerApi): void {
  lang = systemLang()
  orca.panels.handle('memory.view', async (input) => {
    await heard(orca, input?.locale)
    const { project, workspace, unmatched } = await view(orca)
    return unmatched ? { project, workspace, unmatched } : { project, workspace }
  })

  orca.panels.handle('memory.read', async ({ slug, file, locale }) => {
    await heard(orca, locale)
    const root = await rootOf(orca)
    const files = await readMemoryFolder(slug, root)
    return { body: readableBody(bodyOf(await readMemory(slug, file, root)), audit(files).memories, t()) }
  })

  orca.panels.handle('memory.verify', async (input) => {
    await heard(orca, input?.locale)
    return handOver(orca)
  })

  orca.panels.handle('memory.seen', async ({ slug, files }) => {
    await serial(async () => {
      const unseen = files ? (await listOf(orca, unseenKey(slug))).filter((f) => !files.includes(f)) : []
      await orca.storage.set(unseenKey(slug), unseen)
    })
    void refreshStatus(orca)
    return { ok: true as const }
  })

  orca.commands.register('verify', async () => {
    const { count, workspace } = await handOver(orca)
    return t().commandStarted(workspace, count)
  })
  orca.commands.register('show', async () => {
    await orca.host.call('commands.run', { action: 'sidebar.right.toggle' })
  })

  // Every tool call of every agent passes here; only reads and writes of a memory file matter.
  // Orca does not wait for an after-hook: the work runs on its own and never holds Orca up.
  orca.hooks.on('agent.tool.after', (event) => {
    const written = writtenPath(event.tool, event.input)
    const consulted = written ? null : readPath(event.tool, event.input)
    if (!written && !consulted) return
    void (async () => {
      const memory = memoryOfPath((written ?? consulted) as string, await rootOf(orca))
      if (!memory) return
      if (consulted) {
        if (!memory.index) await recordRead(orca, memory.slug, memory.file)
        return
      }
      await recordWrite(orca, memory, event.workspaceId)
    })().catch(() => undefined)
  })

  // A new focused workspace may be another project; terminal opens and closes are not.
  let last: string | undefined
  orca.events.on('workspace.changed', ({ context }) => {
    const key = context ? `${context.displayName}\u0000${context.branch}` : ''
    if (key === last) return
    last = key
    return refreshStatus(orca)
  })

  void (async () => {
    const saved = await orca.storage.get(LANG_KEY)
    if (saved === 'en' || saved === 'fr') lang = saved
    await refreshStatus(orca)
  })().catch(() => undefined)
}
