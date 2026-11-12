// Runs src/worker.ts's activate(orca) over a mock host, against the folders in fixtures/.
import { assert, mockHost, mountWorker, test } from 'orca/testing'
import * as main from './worker'

const root = new URL('../fixtures/projects', import.meta.url).pathname
const host = (results: Record<string, unknown> = {}) => mockHost({ settings: { projectsRoot: root }, results })
const focused = { branch: 'demo', displayName: 'demo', terminals: [] }
const noWorkspace = { 'workspace.readContext': null, 'workspace.list': { workspaces: [], truncated: false } }

test('lists the projects that have memories, most first', async () => {
  const worker = await mountWorker(main, { host: host(noWorkspace) })
  const { projects } = await worker.request('memory.projects')
  assert.deepEqual(projects.map((p) => [p.slug, p.count]), [['-demo-broken', 3], ['-demo-ok', 1]])
  await worker.deactivate()
})

test('without a matching workspace, views the largest project, code unchecked', async () => {
  const worker = await mountWorker(main, { host: host(noWorkspace) })
  const view = await worker.request('memory.view', {})
  assert.equal(view?.slug, '-demo-broken')
  assert.equal(view?.detectedFrom, null)
  assert.equal(view?.repo, null)
  assert.equal(view?.repoChecked, false)
  assert.deepEqual(view?.indexProblems, ["MEMORY.md renvoie vers ancien.md, qui n'existe plus."])
  await worker.deactivate()
})

test('views the project asked for, and reads one memory without its header', async () => {
  const worker = await mountWorker(main, { host: host(noWorkspace) })
  assert.equal((await worker.request('memory.view', { slug: '-demo-ok' }))?.memories.length, 1)
  assert.deepEqual(await worker.request('memory.read', { slug: '-demo-ok', file: 'stack.md' }), { body: "Le front est Nuxt, l'API est Hono." })
  await assert.rejects(worker.request('memory.read', { slug: '-demo-ok', file: '../../x.md' }))
  await worker.deactivate()
})

test('types the verification into an idle Claude agent', async () => {
  const h = host({
    ...noWorkspace,
    'agents.list': { agents: [{ terminalId: 't1', title: 'Claude', agent: 'claude', state: 'waiting', stateStartedAt: 0 }] },
    'terminal.sendText': { accepted: true }
  })
  const worker = await mountWorker(main, { host: h })
  assert.deepEqual(await worker.request('memory.verify', { slug: '-demo-broken' }), { via: 'terminal', count: 4 })
  const sent = h.calls.find((c) => c.method === 'terminal.sendText')?.params as { terminalId: string; text: string }
  assert.equal(sent.terminalId, 't1')
  assert.ok(!sent.text.includes('\n'))
  assert.deepEqual(worker.refusals, [])
  await worker.deactivate()
})

test('launches Claude in the focused workspace when every agent is busy', async () => {
  const h = host({
    'workspace.readContext': focused,
    'workspace.list': { workspaces: [{ id: 'w1', kind: 'worktree', name: 'demo', path: '/nowhere/demo', branch: 'refs/heads/demo', hostId: null }], truncated: false },
    'agents.list': { agents: [{ terminalId: 't1', title: 'Claude', agent: 'claude', state: 'working', stateStartedAt: 0 }] },
    'agent.launch': { terminalId: 't2' }
  })
  const worker = await mountWorker(main, { host: h })
  assert.deepEqual(await worker.request('memory.verify', { slug: '-demo-broken' }), { via: 'launch', count: 4 })
  assert.ok(!h.calls.some((c) => c.method === 'terminal.sendText'))
  await worker.deactivate()
})

test('refuses to verify a folder with nothing to verify', async () => {
  const worker = await mountWorker(main, { host: host(noWorkspace) })
  await assert.rejects(worker.request('memory.verify', { slug: '-demo-ok' }))
  await worker.deactivate()
})
