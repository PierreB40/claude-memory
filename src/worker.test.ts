// Runs src/worker.ts's activate(orca) over a mock host, against the folders in fixtures/.
import { assert, mockHost, mountWorker, test } from 'orca/testing'
import * as main from './worker'

const root = new URL('../fixtures/projects', import.meta.url).pathname

test('lists the projects that have memories, most first', async () => {
  const worker = await mountWorker(main, { host: mockHost({ settings: { projectsRoot: root } }) })
  const answer = await worker.request('memory.projects')
  assert.equal(answer.root, root)
  assert.deepEqual(
    answer.projects.map((p) => [p.slug, p.count]),
    [
      ['-demo-broken', 3],
      ['-demo-ok', 1]
    ]
  )
  await worker.deactivate()
})

test('audits one project', async () => {
  const worker = await mountWorker(main, { host: mockHost({ settings: { projectsRoot: root } }) })
  const ok = await worker.request('memory.audit', { slug: '-demo-ok' })
  assert.deepEqual(ok.issues, [])
  const broken = await worker.request('memory.audit', { slug: '-demo-broken' })
  assert.deepEqual(broken.issues.map((i) => i.kind).sort(), [
    'broken-link',
    'index-dangling',
    'link-by-filename',
    'no-frontmatter',
    'not-indexed',
    'not-indexed'
  ])
  assert.deepEqual(worker.refusals, [])
  await worker.deactivate()
})

test('refuses a slug that walks out of the projects folder', async () => {
  const worker = await mountWorker(main, { host: mockHost({ settings: { projectsRoot: root } }) })
  await assert.rejects(worker.request('memory.audit', { slug: '../..' }))
  await worker.deactivate()
})

const focused = { branch: 'demo', displayName: 'demo', terminals: [] }
const workspaces = { workspaces: [{ id: 'w1', kind: 'worktree', name: 'demo', path: '/nowhere/demo', branch: 'refs/heads/demo', hostId: null }], truncated: false }

test('detects nothing when the focused workspace has no Claude memory', async () => {
  const host = mockHost({ settings: { projectsRoot: root }, results: { 'workspace.readContext': focused, 'workspace.list': workspaces } })
  const worker = await mountWorker(main, { host })
  assert.deepEqual(await worker.request('memory.detect'), { slug: null, workspace: 'demo' })
  await worker.deactivate()
})

test('types the fix into an idle Claude agent', async () => {
  const host = mockHost({
    settings: { projectsRoot: root },
    results: {
      'agents.list': { agents: [{ terminalId: 't1', title: 'Claude', agent: 'claude', state: 'waiting', stateStartedAt: 0 }] },
      'terminal.sendText': { accepted: true }
    }
  })
  const worker = await mountWorker(main, { host })
  assert.deepEqual(await worker.request('memory.fix', { slug: '-demo-broken' }), { via: 'terminal', count: 6 })
  const sent = host.calls.find((c) => c.method === 'terminal.sendText')
  assert.equal((sent?.params as { terminalId: string }).terminalId, 't1')
  assert.deepEqual(worker.refusals, [])
  await worker.deactivate()
})

test('launches Claude when every agent is busy', async () => {
  const host = mockHost({
    settings: { projectsRoot: root },
    results: {
      'agents.list': { agents: [{ terminalId: 't1', title: 'Claude', agent: 'claude', state: 'working', stateStartedAt: 0 }] },
      'workspace.readContext': focused,
      'workspace.list': workspaces,
      'agent.launch': { terminalId: 't2' }
    }
  })
  const worker = await mountWorker(main, { host })
  assert.deepEqual(await worker.request('memory.fix', { slug: '-demo-broken' }), { via: 'launch', count: 6 })
  assert.ok(!host.calls.some((c) => c.method === 'terminal.sendText'))
  await worker.deactivate()
})

test('refuses to fix a folder with no problem', async () => {
  const worker = await mountWorker(main, { host: mockHost({ settings: { projectsRoot: root } }) })
  await assert.rejects(worker.request('memory.fix', { slug: '-demo-ok' }))
  await worker.deactivate()
})
