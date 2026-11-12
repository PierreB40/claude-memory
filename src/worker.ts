// Reads ~/.claude/projects and the focused workspace's checkout on the Orca host. It answers the
// panel, keeps the status bar item current, hears agents read and write memories, and runs the
// palette commands. It never writes a memory: fixing is handed to a new Claude.
import type { OrcaWorkerApi } from 'orca/worker'
import { audit, bodyOf, citedPaths, DEFAULT_OPTIONS, readableBody, toVerify, verifyCount, writeDefects, type MemoryFile } from './audit.ts'
import { homedir, platform } from 'node:os'
import { join } from 'node:path'
import { candidateSlugs, launchOf, mainCheckoutOf, matchWorkspace, pathForms, twinsOf, memoryOfPath, readPath, writtenPath, type WorkspaceInfo } from './detect.ts'
import { langOf, systemLang, words, type Lang, type Words } from './i18n.ts'
import type { PanelView, ProjectView } from './protocol.ts'
import { isRemote, linuxHomeOf, uncOf, wslOf } from './place.ts'
import { memoryDir, presentOnDisk, projectsRoot, readCheckout, readGitFile, readMemory, readMemoryFolder, wslHome, type CheckoutFacts } from './store.ts'

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
  return /^~[/\\]/.test(value) ? join(homedir(), value.slice(2)) : value
}

/**
 * Which workspace each terminal belongs to, as agent events tell it: what tells two workspaces of
 * the same name on the same branch apart. Kept for the next run, the newest ones only.
 */
const OWNERS_KEY = 'terminals'
const MAX_OWNERS = 500
const owners = new Map<string, string>()
async function loadOwners(orca: OrcaWorkerApi): Promise<void> {
  const saved = await orca.storage.get(OWNERS_KEY)
  if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return
  for (const [terminal, workspace] of Object.entries(saved)) {
    if (typeof workspace === 'string' && !owners.has(terminal)) owners.set(terminal, workspace)
  }
}
/** True when this is news: the terminal was unknown, or moved. */
function learnOwner(orca: OrcaWorkerApi, terminalId: string | undefined, workspaceId: string | null): boolean {
  if (!terminalId || !workspaceId || owners.get(terminalId) === workspaceId) return false
  owners.delete(terminalId)
  owners.set(terminalId, workspaceId)
  while (owners.size > MAX_OWNERS) owners.delete(owners.keys().next().value as string)
  void serial(() => orca.storage.set(OWNERS_KEY, Object.fromEntries(owners))).catch(() => undefined)
  return true
}

/**
 * Where a workspace is, seen two ways: by the worker, which reads the files, and by the Claude
 * working there, which names paths in its tool calls and needs them in its prompt. The same here;
 * on WSL, the worker reads through the `\\wsl.localhost` share what Claude sees as Linux paths.
 */
interface Place {
  /** The checkout, as the worker reads it. */
  checkout: string
  /** The checkout, as Claude there names it: what its project folder is named after. */
  path: string
  /** Claude Code's projects folder, as the worker reads it. */
  root: string
  /** The same folder, as Claude there names it. */
  agentRoot: string
}

/** Null on SSH, or on a WSL distribution whose home cannot be found. */
async function placeOf(orca: OrcaWorkerApi, w: WorkspaceInfo): Promise<Place | null> {
  if (isRemote(w.hostId)) return null
  const wsl = wslOf(w.path, w.hostId ?? null)
  if (!wsl) {
    const root = await rootOf(orca)
    return { checkout: w.path, path: w.path, root, agentRoot: root }
  }
  const home = linuxHomeOf(wsl.linux) ?? (await wslHome(wsl))
  if (!home) return null
  const agentRoot = `${home === '/' ? '' : home}/.claude/projects`
  return { checkout: uncOf(wsl), path: wsl.linux, root: uncOf({ distro: wsl.distro, linux: agentRoot }), agentRoot }
}

/** The projects folder each project slug was found in: the panel names a project by slug only. */
const roots = new Map<string, Pick<Place, 'root' | 'agentRoot'>>()
async function rootOfSlug(orca: OrcaWorkerApi, slug: string): Promise<string> {
  return roots.get(slug)?.root ?? (await rootOf(orca))
}

/** A memory folder as Claude there names it: Linux paths stay Linux on WSL. */
const agentMemoryDir = (slug: string, place: Pick<Place, 'root' | 'agentRoot'>): string =>
  place.agentRoot === place.root ? memoryDir(slug, place.root) : `${place.agentRoot}/${slug}/memory`

interface Known extends WorkspaceInfo {
  gitFile: string | null
  /** Null: on another host, out of reach. */
  place: Place | null
}

/** The focused workspace, matched among every workspace Orca knows; and its name, matched or not. */
async function focusedWorkspace(orca: OrcaWorkerApi): Promise<{ focused: Known | null; name: string | null; all: WorkspaceInfo[]; twins: WorkspaceInfo[] }> {
  const [ctx, { workspaces: all }] = await Promise.all([
    orca.host.call('workspace.readContext').catch(() => null),
    orca.host.call('workspace.list').catch(() => ({ workspaces: [] }))
  ])
  if (!ctx) return { focused: null, name: null, all, twins: [] }
  const pinnedOne = pinned && pinned.key === contextKey(ctx) ? all.find((w) => w.id === pinned?.id) : undefined
  const match = matchWorkspace(ctx, all, owners) ?? pinnedOne ?? null
  if (!match) return { focused: null, name: ctx.displayName, all, twins: twinsOf(ctx, all, owners) }
  // Known by one terminal, or by the folder its title shows: its other terminals are its own too.
  for (const { id } of ctx.terminals) learnOwner(orca, id, match.id)
  const place = await placeOf(orca, match)
  const gitFile = place ? await readGitFile(place.checkout) : null
  return { focused: { ...match, gitFile, place }, name: ctx.displayName, all, twins: [] }
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

let lastLog = ''
function logOnce(orca: OrcaWorkerApi, line: string): void {
  if (line === lastLog) return
  lastLog = line
  orca.log(line)
}

const lastSegment = (path: string): string => path.split('/').filter(Boolean).pop() ?? path

/** The focused workspace's project, if it has one: like every Orca sidebar tab, never another. */
async function view(orca: OrcaWorkerApi): Promise<PanelView & { focused: Known | null }> {
  const { focused, name, twins } = await focusedWorkspace(orca)
  if (!focused) {
    if (name === null) return { project: null, workspace: null, focused: null }
    const choices = twins.map((w) => ({ id: w.id, label: w.project?.trim() || lastSegment(pathForms(w.path, w.hostId ?? null)[0] ?? w.path), detail: pathForms(w.path, w.hostId ?? null).at(-1) ?? w.path }))
    return { project: null, workspace: name, unmatched: true, ...(choices.length ? { twins: choices } : {}), focused: null }
  }
  const place = focused.place
  if (!place) return { project: null, workspace: focused.name, remote: true, focused }
  let slug: string | null = null
  let files: MemoryFile[] = []
  for (const candidate of candidateSlugs(place.path, focused.gitFile)) {
    files = await readMemoryFolder(candidate, place.root).catch(() => [])
    if (files.some((f) => f.file !== 'MEMORY.md')) {
      slug = candidate
      break
    }
  }
  if (!slug) {
    // What `orca plugin logs` shows when the panel says Claude remembers nothing: where it looked.
    logOnce(orca, `no memory for ${focused.path} (host ${focused.hostId ?? 'none'}): tried ${candidateSlugs(place.path, focused.gitFile).join(', ')} in ${place.root}`)
    return { project: null, workspace: focused.name, focused }
  }
  roots.set(slug, place)
  const { facts, repo } = await repoFacts(place.checkout, files)
  const result = audit(files, { ...DEFAULT_OPTIONS, repo })
  const present = new Set(result.memories.map((m) => m.file))
  const main = focused.gitFile ? mainCheckoutOf(focused.gitFile, place.path) : null
  return {
    workspace: focused.name,
    focused,
    project: {
      ...result,
      slug,
      label: lastSegment(main ?? place.path),
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

/** The focused workspace's terminals, from the last `workspace.changed`. */
let focusedTerminals = new Set<string>()
/** A terminal of the focused workspace was just tied to it: an ambiguous focus may now be known. */
async function focusMayHaveResolved(orca: OrcaWorkerApi, terminalId: string | undefined): Promise<void> {
  if (!terminalId || !focusedTerminals.has(terminalId)) return
  orca.panels.post('focus.resolved', {})
  await refreshStatus(orca)
}

/**
 * The person said which look-alike is in front. Its terminals now belong to it, for good; with no
 * terminal to tie, the choice holds until the focus moves.
 */
let pinned: { key: string; id: string } | null = null
const contextKey = (ctx: { displayName: string; branch: string; terminals: { id: string }[] }): string =>
  [ctx.displayName, ctx.branch, ...ctx.terminals.map((t) => t.id).sort()].join('\u0000')
async function pick(orca: OrcaWorkerApi, workspaceId: string): Promise<{ ok: true }> {
  const [ctx, { workspaces }] = await Promise.all([orca.host.call('workspace.readContext'), orca.host.call('workspace.list')])
  if (!ctx || !twinsOf(ctx, workspaces, owners).some((w) => w.id === workspaceId)) throw new Error(t().pickGone)
  for (const { id } of ctx.terminals) learnOwner(orca, id, workspaceId)
  pinned = { key: contextKey(ctx), id: workspaceId }
  return { ok: true }
}

/** Always a NEW Claude in its own terminal: an idle-looking agent may be a conversation in progress. */
async function handOver(orca: OrcaWorkerApi): Promise<{ count: number; workspace: string }> {
  const { project: p, focused } = await view(orca)
  if (!p || !focused?.place) throw new Error(t().noMemoryHere)
  const count = verifyCount(p)
  if (count === 0) throw new Error(t().nothingToDo)
  const prompt = t().prompt(agentMemoryDir(p.slug, focused.place), toVerify(p), p.indexProblems)
  const launch = launchOf(platform(), focused.id, t().terminalTitle, prompt)
  const { terminalId } =
    launch.method === 'agent.launch' ? await orca.host.call('agent.launch', launch.params) : await orca.host.call('terminal.create', launch.params)
  learnOwner(orca, terminalId, focused.id)
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

async function recordWrite(orca: OrcaWorkerApi, memory: { slug: string; file: string; index: boolean }, root: string, checkout: string | null): Promise<void> {
  if (memory.index) {
    // The index line that follows a new memory: no news, but the panel and the bar move on.
    orca.panels.post('memory.changed', { slug: memory.slug, file: memory.file })
    await refreshStatus(orca)
    return
  }
  const files = await readMemoryFolder(memory.slug, root).catch(() => [])
  // A write that failed leaves no file: nothing was learned.
  if (!files.some((f) => f.file === memory.file)) return
  await serial(async () => {
    const unseen = await listOf(orca, unseenKey(memory.slug))
    if (!unseen.includes(memory.file)) await orca.storage.set(unseenKey(memory.slug), [...unseen, memory.file])
  })
  // The writing agent's own workspace holds the code the memory speaks of.
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
    const { project, workspace, unmatched, twins, remote } = await view(orca)
    return { project, workspace, ...(unmatched ? { unmatched } : {}), ...(twins ? { twins } : {}), ...(remote ? { remote } : {}) }
  })

  orca.panels.handle('workspace.pick', async ({ workspaceId, locale }) => {
    await heard(orca, locale)
    const done = await pick(orca, workspaceId)
    await refreshStatus(orca)
    return done
  })

  orca.panels.handle('memory.read', async ({ slug, file, locale }) => {
    await heard(orca, locale)
    const root = await rootOfSlug(orca, slug)
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
    if (learnOwner(orca, event.terminalId, event.workspaceId)) void focusMayHaveResolved(orca, event.terminalId)
    const written = writtenPath(event.tool, event.input)
    const consulted = written ? null : readPath(event.tool, event.input)
    if (!written && !consulted) return
    void (async () => {
      const path = (written ?? consulted) as string
      if (!/[/\\]memory[/\\][^/\\]+\.md$/.test(path)) return
      // The agent's workspace says where its Claude keeps memory: on WSL, in the Linux home.
      const { workspaces } = event.workspaceId ? await orca.host.call('workspace.list').catch(() => ({ workspaces: [] })) : { workspaces: [] }
      const own = workspaces.find((w) => w.id === event.workspaceId)
      const place = own ? await placeOf(orca, own) : null
      const local = await rootOf(orca)
      const found = [place, { root: local, agentRoot: local }]
        .filter((r): r is Pick<Place, 'root' | 'agentRoot'> => r !== null)
        .map((r) => ({ r, memory: memoryOfPath(path, r.agentRoot) }))
        .find((x) => x.memory !== null)
      if (!found?.memory) return
      const { memory, r } = found
      roots.set(memory.slug, r)
      if (consulted) {
        if (!memory.index) await recordRead(orca, memory.slug, memory.file)
        return
      }
      await recordWrite(orca, memory, r.root, place?.checkout ?? null)
    })().catch(() => undefined)
  })

  // A new focused workspace may be another project, even under the same name and branch (two
  // `main` checkouts): its terminals tell. Only the same terminals are surely the same workspace.
  let last: string | undefined
  orca.events.on('workspace.changed', ({ context }) => {
    focusedTerminals = new Set(context?.terminals.map((t) => t.id) ?? [])
    const key = context ? contextKey(context) : ''
    // A pick holds while nothing changes; terminals tied by it keep telling afterwards.
    if (pinned && pinned.key !== key) pinned = null
    if (key === last) return
    last = key
    return refreshStatus(orca)
  })
  // Every agent status tells which workspace its terminal is in.
  orca.events.on('agent.status.changed', ({ terminalId, workspaceId }) => {
    if (learnOwner(orca, terminalId, workspaceId)) return focusMayHaveResolved(orca, terminalId)
  })

  void (async () => {
    const saved = await orca.storage.get(LANG_KEY)
    if (saved === 'en' || saved === 'fr') lang = saved
    await loadOwners(orca)
    await refreshStatus(orca)
  })().catch(() => undefined)
}
