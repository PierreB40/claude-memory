// Reads ~/.claude/projects and the matching checkout on the Orca host. It answers the panel,
// keeps the status bar item current, hears Claude write a memory (agent.tool.after) and runs the
// palette commands. It never writes a memory: fixing is handed to a Claude agent.
import type { OrcaWorkerApi } from 'orca/worker'
import { audit, bodyOf, branchPrompt, DEFAULT_OPTIONS, readableBody, toVerify, verifyPrompt, writeVerdict } from './audit.ts'
import { candidateSlugs, claudeCommand, matchWorkspace, memoryOfPath, readPath, repoOfSlug, workspaceFor, writtenPath, type WorkspaceInfo } from './detect.ts'
import type { ProjectView, VerifyScope } from './protocol.ts'
import { baseRef, currentBranch, filesAt, listProjects, memoryDir, projectsRoot, readGitFile, readMemory, readMemoryFolder, trackedFiles } from './store.ts'

const STATUS = 'health'
const unseenKey = (slug: string): string => `unseen:${slug}`
const readsKey = (slug: string): string => `reads:${slug}`
const sinceKey = (slug: string): string => `tracking:${slug}`

export type Reads = Record<string, { count: number; last: number }>

async function readsOf(orca: OrcaWorkerApi, slug: string): Promise<Reads> {
  const value = await orca.storage.get(readsKey(slug))
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as unknown as Reads) : {}
}

/** When counting began for a project: « never read » means nothing before that date. */
async function trackingSince(orca: OrcaWorkerApi, slug: string): Promise<number> {
  const value = await orca.storage.get(sinceKey(slug))
  if (typeof value === 'number') return value
  const now = Date.now()
  await orca.storage.set(sinceKey(slug), now)
  return now
}

async function recordRead(orca: OrcaWorkerApi, slug: string, file: string): Promise<void> {
  await trackingSince(orca, slug)
  const reads = await readsOf(orca, slug)
  const now = Date.now()
  reads[file] = { count: (reads[file]?.count ?? 0) + 1, last: now }
  await orca.storage.set(readsKey(slug), reads)
}

async function rootOf(orca: OrcaWorkerApi): Promise<string> {
  const root = await orca.settings.get('projectsRoot')
  return typeof root === 'string' && root.trim() !== '' ? root.trim() : projectsRoot()
}

interface Known extends WorkspaceInfo {
  gitFile: string | null
}

/** Every workspace Orca knows, with its `.git` file; and the focused one, when it matches one. */
async function workspaces(orca: OrcaWorkerApi): Promise<{ all: Known[]; focused: Known | null }> {
  const [ctx, { workspaces: list }] = await Promise.all([
    orca.host.call('workspace.readContext').catch(() => null),
    orca.host.call('workspace.list').catch(() => ({ workspaces: [] }))
  ])
  const all = await Promise.all(list.map(async (w) => ({ ...w, gitFile: await readGitFile(w.path) })))
  const match = ctx ? matchWorkspace(ctx, all) : null
  return { all, focused: match ? (all.find((w) => w.id === match.id) ?? null) : null }
}

async function unseenOf(orca: OrcaWorkerApi, slug: string): Promise<string[]> {
  const value = await orca.storage.get(unseenKey(slug))
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []
}

const lastSegment = (path: string): string => path.split('/').filter(Boolean).pop() ?? path
const shortRef = (ref: string): string => ref.replace(/^origin\//, '')

/**
 * The project of the focused workspace, like every other Orca sidebar tab: no workspace or no
 * memory for it gives null, never another project.
 */
async function view(orca: OrcaWorkerApi): Promise<ProjectView | null> {
  const root = await rootOf(orca)
  const projects = await listProjects(root)
  if (projects.length === 0) return null
  const known = new Set(projects.map((p) => p.slug))
  const { all, focused } = await workspaces(orca)
  const detected = focused ? (candidateSlugs(focused.path, focused.gitFile).find((s) => known.has(s)) ?? null) : null
  if (!detected || !focused) return null
  const slug = detected

  // The focused workspace's own checkout when it is this project: its branch is what is true here.
  const checkout: string | null = focused.path
  const repoFiles = checkout ? await trackedFiles(checkout) : null
  const branch = checkout && repoFiles ? await currentBranch(checkout) : null
  const base = checkout && repoFiles ? await baseRef(checkout) : null
  const compare = base && branch && shortRef(base) !== branch ? base : null
  const baseFiles = checkout && compare ? await filesAt(checkout, compare) : null

  const result = audit(await readMemoryFolder(slug, root), { ...DEFAULT_OPTIONS, repoFiles, baseFiles })
  const present = new Set(result.memories.map((m) => m.file))
  return {
    ...result,
    slug,
    label: checkout ? lastSegment(repoOfSlug(slug, all) ?? checkout) : lastSegment(slug.replace(/-/g, '/')),
    detectedFrom: focused.name,
    checked: checkout && repoFiles ? { path: checkout, branch } : null,
    base: baseFiles ? compare : null,
    unseen: (await unseenOf(orca, slug)).filter((f) => present.has(f)),
    reads: await readsOf(orca, slug),
    trackingSince: await trackingSince(orca, slug)
  }
}

/** The status bar answers « is the memory of what I work on sound? » without opening anything. */
async function refreshStatus(orca: OrcaWorkerApi): Promise<void> {
  const v = await view(orca).catch(() => null)
  if (!v) {
    await orca.host.call('statusBar.update', { id: STATUS, visible: false })
    return
  }
  const broken = v.memories.filter((m) => m.brokenHere.length).length
  const unsafe = toVerify(v).length + (v.indexProblems.length ? 1 : 0)
  const fresh = v.unseen.length ? ` · +${v.unseen.length}` : ''
  const learned = v.unseen.length ? ` ${v.unseen.length} nouvelle${v.unseen.length > 1 ? 's' : ''} depuis ta dernière visite.` : ''
  const [text, tone, tooltip] =
    broken > 0
      ? [`${broken}`, 'danger' as const, `Mémoire de Claude (${v.label}) : ta branche rend ${broken} mémoire${broken > 1 ? 's' : ''} fausse${broken > 1 ? 's' : ''}.`]
      : unsafe > 0
        ? [`${unsafe}`, 'warning' as const, `Mémoire de Claude (${v.label}) : ${unsafe} à vérifier.`]
        : ['', 'success' as const, `Mémoire de Claude (${v.label}) : saine.`]
  await orca.host.call('statusBar.update', {
    id: STATUS,
    visible: true,
    icon: 'book',
    text: `${text}${fresh}`.trim() || ' ',
    tone: v.unseen.length && tone === 'success' ? 'accent' : tone,
    tooltip: `${tooltip}${learned} Cliquer : afficher le panneau.`
  })
}

/**
 * Always a NEW Claude, in its own terminal: typing into an existing one could land in a
 * conversation the person is having, and an idle-looking agent is not a free one.
 */
async function handOver(orca: OrcaWorkerApi, scope: VerifyScope): Promise<{ count: number; workspace: string }> {
  const current = await view(orca)
  if (!current) throw new Error('Ce workspace n’a aucune mémoire Claude.')
  const dir = memoryDir(current.slug, await rootOf(orca))
  let prompt: string
  let count: number
  if (scope === 'branch') {
    const broken = current.memories.filter((m) => m.brokenHere.length)
    if (broken.length === 0) throw new Error('Ta branche ne rend aucune mémoire fausse.')
    prompt = branchPrompt(dir, current.checked?.branch ?? 'courante', broken)
    count = broken.length
  } else {
    const memories = toVerify(current)
    if (memories.length === 0 && current.indexProblems.length === 0) throw new Error('Rien à vérifier.')
    prompt = verifyPrompt(dir, memories, current.indexProblems)
    count = memories.length + (current.indexProblems.length ? 1 : 0)
  }

  const { all, focused } = await workspaces(orca)
  const target = workspaceFor(current.slug, focused, all)
  if (!target) throw new Error('Aucun workspace Orca n’ouvre ce projet : ouvre-le pour que Claude puisse lire son code.')
  await orca.host.call('terminal.create', { workspaceId: target.id, title: 'Claude · mémoire', command: claudeCommand(prompt) })
  return { count, workspace: target.name }
}

export default function activate(orca: OrcaWorkerApi): void {
  orca.panels.handle('memory.projects', async () => ({ projects: await listProjects(await rootOf(orca)) }))
  orca.panels.handle('memory.view', async () => {
    const { focused } = await workspaces(orca)
    return { project: await view(orca), workspace: focused?.name ?? null }
  })
  orca.panels.handle('memory.read', async ({ slug, file }) => {
    const root = await rootOf(orca)
    const { memories } = audit(await readMemoryFolder(slug, root))
    return { body: readableBody(bodyOf(await readMemory(slug, file, root)), memories) }
  })
  orca.panels.handle('memory.verify', async ({ scope }) => handOver(orca, scope))
  orca.panels.handle('memory.seen', async ({ slug }) => {
    await orca.storage.delete(unseenKey(slug))
    void refreshStatus(orca)
    return { ok: true as const }
  })

  orca.commands.register('verify', async () => {
    const v = await view(orca)
    if (!v) return 'Claude n’a encore aucune mémoire.'
    const scope: VerifyScope = v.memories.some((m) => m.brokenHere.length) ? 'branch' : 'all'
    const { count, workspace } = await handOver(orca, scope)
    return `Claude lancé dans « ${workspace} » avec ${count} mémoire(s) à vérifier.`
  })
  orca.commands.register('show', async () => {
    await orca.host.call('commands.run', { action: 'sidebar.right.toggle' })
  })

  // Claude wrote a memory: say so once, mark it new, and let open panels reload.
  // Every tool call of an agent passes here: only reads and writes of a memory file matter.
  // A read is counted (which memories Claude actually uses); a write is announced, with what is
  // wrong with it while Claude still has the context to fix it.
  orca.hooks.on('agent.tool.after', (event) => {
    const written = writtenPath(event.tool, event.input)
    const consulted = written ? null : readPath(event.tool, event.input)
    if (!written && !consulted) return
    // Orca does not wait for an after-hook; returning the work only lets tests await it.
    return (async () => {
      const root = await rootOf(orca)
      const memory = memoryOfPath((written ?? consulted) as string, root)
      if (!memory) return
      if (consulted) {
        await recordRead(orca, memory.slug, memory.file)
        return
      }
      const unseen = await unseenOf(orca, memory.slug)
      if (!unseen.includes(memory.file)) await orca.storage.set(unseenKey(memory.slug), [...unseen, memory.file])
      // The agent's own workspace holds the code the memory speaks of.
      const { all } = await workspaces(orca)
      const checkout = all.find((w) => w.id === event.workspaceId)?.path ?? null
      const repoFiles = checkout ? await trackedFiles(checkout) : null
      const files = await readMemoryFolder(memory.slug, root).catch(() => [])
      const justWritten = audit(files, { ...DEFAULT_OPTIONS, repoFiles }).memories.find((m) => m.file === memory.file)
      const verdict = justWritten ? writeVerdict(justWritten) : null
      const title = justWritten?.title ?? memory.file
      await orca.host
        .call('notifications.show', verdict ? { title: 'Claude a retenu quelque chose, à revoir', body: `${title} : ${verdict}.` } : { title: 'Claude a retenu quelque chose', body: title })
        .catch(() => undefined)
      orca.panels.post('memory.changed', memory)
      await refreshStatus(orca)
    })()
  })


  // A new focused workspace may be another project; terminal opens and closes are not.
  let last: string | undefined
  orca.events.on('workspace.changed', ({ context }) => {
    const key = context ? `${context.displayName}\u0000${context.branch}` : ''
    if (key === last) return
    last = key
    return refreshStatus(orca)
  })

  void refreshStatus(orca)
}
