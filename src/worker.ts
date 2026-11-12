// Reads ~/.claude/projects on the Orca host and answers the panel. It never writes a memory
// itself: fixing is handed to a Claude agent. Orca transpiles this file; a save restarts it.
import type { OrcaWorkerApi } from 'orca/worker'
import { audit, DEFAULT_OPTIONS } from './audit.ts'
import { candidateSlugs, fixPrompt, matchWorkspace, type WorkspaceInfo } from './detect.ts'
import { listProjects, memoryDir, projectsRoot, readGitFile, readMemoryFolder } from './store.ts'

async function settings(orca: OrcaWorkerApi): Promise<{ root: string; staleDays: number }> {
  const root = await orca.settings.get('projectsRoot')
  const staleDays = await orca.settings.get('staleDays')
  return {
    root: typeof root === 'string' && root.trim() !== '' ? root.trim() : projectsRoot(),
    staleDays: typeof staleDays === 'number' && staleDays > 0 ? staleDays : DEFAULT_OPTIONS.staleDays
  }
}

async function focusedWorkspace(orca: OrcaWorkerApi): Promise<WorkspaceInfo | null> {
  const ctx = await orca.host.call('workspace.readContext')
  if (!ctx) return null
  const { workspaces } = await orca.host.call('workspace.list')
  return matchWorkspace(ctx, workspaces)
}

/** Agents whose turn is over: typing into a working one would interleave with its output. */
const IDLE = new Set(['waiting', 'done'])

export default function activate(orca: OrcaWorkerApi): void {
  orca.panels.handle('memory.projects', async () => {
    const { root } = await settings(orca)
    return { root, projects: await listProjects(root) }
  })

  orca.panels.handle('memory.audit', async ({ slug }) => {
    const { root, staleDays } = await settings(orca)
    return audit(await readMemoryFolder(slug, root), { ...DEFAULT_OPTIONS, staleDays, now: Date.now() })
  })

  orca.panels.handle('memory.detect', async () => {
    const workspace = await focusedWorkspace(orca)
    if (!workspace) return { slug: null, workspace: null }
    const { root } = await settings(orca)
    const known = new Set((await listProjects(root)).map((p) => p.slug))
    const slug = candidateSlugs(workspace.path, await readGitFile(workspace.path)).find((s) => known.has(s)) ?? null
    return { slug, workspace: workspace.name }
  })

  orca.panels.handle('memory.fix', async ({ slug }) => {
    const { root, staleDays } = await settings(orca)
    const result = audit(await readMemoryFolder(slug, root), { ...DEFAULT_OPTIONS, staleDays, now: Date.now() })
    const problems = result.issues.filter((i) => i.severity !== 'info')
    if (problems.length === 0) throw new Error('Aucun problème à corriger.')
    const prompt = fixPrompt(memoryDir(slug, root), problems)

    const { agents } = await orca.host.call('agents.list')
    const idle = agents.find((a) => a.terminalId && a.agent === 'claude' && IDLE.has(a.state))
    if (idle?.terminalId) {
      const { accepted } = await orca.host.call('terminal.sendText', { terminalId: idle.terminalId, text: prompt, enter: true })
      if (accepted) return { via: 'terminal' as const, count: problems.length }
    }
    const workspace = await focusedWorkspace(orca)
    if (!workspace) throw new Error('Aucun workspace Orca au premier plan pour lancer Claude.')
    await orca.host.call('agent.launch', { workspaceId: workspace.id, agent: 'claude', prompt })
    return { via: 'launch' as const, count: problems.length }
  })
}
