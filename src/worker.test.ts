// Runs src/worker.ts's activate(orca) over a mock host, against the folders in fixtures/.
import { assert, mockHost, mountWorker, test } from 'orca/testing'
import * as main from './worker'

const root = new URL('../fixtures/projects', import.meta.url).pathname
const noWorkspace = { 'workspace.readContext': null, 'workspace.list': { workspaces: [], truncated: false }, 'statusBar.update': { ok: true } }
const host = (results: Record<string, unknown> = {}) => mockHost({ settings: { projectsRoot: root }, results: { ...noWorkspace, ...results } })
/**
 * Work the worker starts on its own (activation, an after-hook nobody waits for) only moves while
 * the test kit serves a call: keep one going until its effect shows.
 */
async function until(worker: { request(name: 'memory.projects'): Promise<unknown> }, done: () => boolean): Promise<void> {
  for (let i = 0; i < 100 && !done(); i++) await worker.request('memory.projects')
  assert.ok(done(), 'the background work never finished')
}

const focused = { branch: 'demo', displayName: 'demo', terminals: [] }

test('lists the projects that have memories, most first', async () => {
  const worker = await mountWorker(main, { host: host() })
  const { projects } = await worker.request('memory.projects')
  assert.deepEqual(projects.map((p) => [p.slug, p.count]), [['-demo-broken', 3], ['-demo-ok', 1]])
  await worker.deactivate()
})

test('without a matching workspace, views the largest project, code unchecked', async () => {
  const worker = await mountWorker(main, { host: host() })
  const view = await worker.request('memory.view', {})
  assert.equal(view?.slug, '-demo-broken')
  assert.equal(view?.detectedFrom, null)
  assert.equal(view?.checked, null)
  assert.equal(view?.repoChecked, false)
  assert.deepEqual(view?.unseen, [])
  assert.deepEqual(view?.indexProblems, ["MEMORY.md renvoie vers ancien.md, qui n'existe plus."])
  await worker.deactivate()
})

test('views the project asked for, and reads one memory without its header', async () => {
  const worker = await mountWorker(main, { host: host() })
  assert.equal((await worker.request('memory.view', { slug: '-demo-ok' }))?.memories.length, 1)
  assert.deepEqual(await worker.request('memory.read', { slug: '-demo-ok', file: 'stack.md' }), { body: "Le front est Nuxt, l'API est Hono." })
  await assert.rejects(worker.request('memory.read', { slug: '-demo-ok', file: '../../x.md' }))
  await worker.deactivate()
})

test('keeps the status bar on the health of the memory', async () => {
  const h = host()
  const worker = await mountWorker(main, { host: h })
  await until(worker, () => h.calls.some((c) => c.method === 'statusBar.update'))
  const last = h.calls.filter((c) => c.method === 'statusBar.update').pop()?.params as { text: string; tone: string; visible: boolean }
  assert.equal(last.visible, true)
  assert.equal(last.tone, 'warning')
  assert.equal(last.text, '4')
  await worker.deactivate()
})

test('types the verification into an idle Claude agent, on one line', async () => {
  const h = host({
    'agents.list': { agents: [{ terminalId: 't1', title: 'Claude', agent: 'claude', state: 'waiting', stateStartedAt: 0 }] },
    'terminal.sendText': { accepted: true }
  })
  const worker = await mountWorker(main, { host: h })
  assert.deepEqual(await worker.request('memory.verify', { slug: '-demo-broken', scope: 'all' }), { via: 'terminal', count: 4 })
  const sent = h.calls.find((c) => c.method === 'terminal.sendText')?.params as { terminalId: string; text: string }
  assert.equal(sent.terminalId, 't1')
  assert.ok(!sent.text.includes('\n'))
  await assert.rejects(worker.request('memory.verify', { slug: '-demo-broken', scope: 'branch' }))
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
  assert.deepEqual(await worker.request('memory.verify', { slug: '-demo-broken', scope: 'all' }), { via: 'launch', count: 4 })
  assert.ok(!h.calls.some((c) => c.method === 'terminal.sendText'))
  await worker.deactivate()
})

test('hears Claude write a memory: notifies once, marks it new, tells the panels', async () => {
  const h = host({ 'notifications.show': { delivered: true } })
  const worker = await mountWorker(main, { host: h })
  await worker.hooks.fire('agent.tool.after', { agent: 'claude', workspaceId: null, tool: 'Write', input: { file_path: `${root}/-demo-ok/memory/stack.md`, content: 'x' } })
  await until(worker, () => worker.posts.length > 0)
  assert.deepEqual(h.callsOf('notifications.show'), [{ title: 'Claude a retenu quelque chose', body: 'Nuxt + Hono' }])
  assert.deepEqual(worker.posts, [{ event: 'memory.changed', payload: { slug: '-demo-ok', file: 'stack.md' } }])
  assert.deepEqual((await worker.request('memory.view', { slug: '-demo-ok' }))?.unseen, ['stack.md'])
  await worker.request('memory.seen', { slug: '-demo-ok' })
  assert.deepEqual((await worker.request('memory.view', { slug: '-demo-ok' }))?.unseen, [])
  await worker.deactivate()
})

test('ignores tool calls that write no memory', async () => {
  const h = host({ 'notifications.show': { delivered: true } })
  const worker = await mountWorker(main, { host: h })
  await worker.hooks.fire('agent.tool.after', { agent: 'claude', workspaceId: null, tool: 'Write', input: { file_path: '/repo/src/a.ts' } })
  await worker.hooks.fire('agent.tool.after', { agent: 'claude', workspaceId: null, tool: 'Edit', input: { file_path: `${root}/-demo-ok/memory/MEMORY.md` } })
  await worker.hooks.fire('agent.tool.after', { agent: 'claude', workspaceId: null, tool: 'Read', input: { file_path: `${root}/-demo-ok/memory/stack.md` } })
  for (let i = 0; i < 5; i++) await worker.request('memory.projects')
  assert.deepEqual(h.callsOf('notifications.show'), [])
  assert.deepEqual(worker.posts, [])
  await worker.deactivate()
})
