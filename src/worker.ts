// Reads ~/.claude/projects and the matching repository on the Orca host, and answers the panel.
// It never writes a memory: verification is handed to a Claude agent. A save restarts it.
import type { OrcaWorkerApi } from 'orca/worker'
import { audit, bodyOf, DEFAULT_OPTIONS, toVerify, verifyPrompt } from './audit.ts'
import { candidateSlugs, matchWorkspace, repoOfSlug, type WorkspaceInfo } from './detect.ts'
import type { ProjectView } from './protocol.ts'
import { listProjects, memoryDir, projectsRoot, readGitFile, readMemory, readMemoryFolder, trackedFiles } from './store.ts'

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

const lastSegment = (path: string): string => path.split('/').filter(Boolean).pop() ?? path

async function view(orca: OrcaWorkerApi, wanted?: string): Promise<ProjectView | null> {
  const root = await rootOf(orca)
  const projects = await listProjects(root)
  if (projects.length === 0) return null
  const known = new Set(projects.map((p) => p.slug))
  const { all, focused } = await workspaces(orca)
  const detected = focused ? (candidateSlugs(focused.path, focused.gitFile).find((s) => known.has(s)) ?? null) : null
  const slug = wanted && known.has(wanted) ? wanted : (detected ?? projects[0]?.slug ?? '')
  const repo = repoOfSlug(slug, all)
  const repoFiles = repo ? await trackedFiles(repo) : null
  const result = audit(await readMemoryFolder(slug, root), { ...DEFAULT_OPTIONS, repoFiles })
  return {
    ...result,
    slug,
    label: repo ? lastSegment(repo) : lastSegment(slug.replace(/-/g, '/')),
    repo: repoFiles ? repo : null,
    detectedFrom: slug === detected && focused ? focused.name : null
  }
}

/** Agents whose turn is over: typing into a working one would interleave with its output. */
const IDLE = new Set(['waiting', 'done'])

export default function activate(orca: OrcaWorkerApi): void {
  orca.panels.handle('memory.projects', async () => ({ projects: await listProjects(await rootOf(orca)) }))

  orca.panels.handle('memory.view', async ({ slug }) => view(orca, slug))

  orca.panels.handle('memory.read', async ({ slug, file }) => ({ body: bodyOf(await readMemory(slug, file, await rootOf(orca))) }))

  orca.panels.handle('memory.verify', async ({ slug }) => {
    const current = await view(orca, slug)
    if (!current) throw new Error('Aucune mémoire.')
    const memories = toVerify(current)
    if (memories.length === 0 && current.indexProblems.length === 0) throw new Error('Rien à vérifier.')
    const prompt = verifyPrompt(memoryDir(current.slug, await rootOf(orca)), memories, current.indexProblems)
    const count = memories.length + (current.indexProblems.length ? 1 : 0)

    const { agents } = await orca.host.call('agents.list')
    const idle = agents.find((a) => a.terminalId && a.agent === 'claude' && IDLE.has(a.state))
    if (idle?.terminalId) {
      const { accepted } = await orca.host.call('terminal.sendText', { terminalId: idle.terminalId, text: prompt, enter: true })
      if (accepted) return { via: 'terminal' as const, count }
    }
    const { focused } = await workspaces(orca)
    if (!focused) throw new Error('Aucun workspace Orca au premier plan pour lancer Claude.')
    await orca.host.call('agent.launch', { workspaceId: focused.id, agent: 'claude', prompt })
    return { via: 'launch' as const, count }
  })
}
