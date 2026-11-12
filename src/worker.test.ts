// Runs src/worker.ts's activate(orca) over a mock host, against the folders in fixtures/.
import { assert, mockHost, mountWorker, test } from 'orca/testing'
import * as main from './worker'

const root = new URL('../fixtures/projects', import.meta.url).pathname
/** Workspaces whose paths Claude Code names `-demo-broken` and `-demo-ok` (not git checkouts). */
const ws = (name: string) => ({ id: `w-${name}`, kind: 'worktree', name, path: `/demo/${name}`, branch: 'refs/heads/main', hostId: null })
const focusOn = (name: string | null) => ({
  'workspace.readContext': name ? { branch: 'main', displayName: name, terminals: [] } : null,
  'workspace.list': { workspaces: [ws('broken'), ws('ok'), ws('other')], truncated: false }
})
const host = (focus: string | null, results: Record<string, unknown> = {}) =>
  mockHost({ settings: { projectsRoot: root }, results: { 'statusBar.update': { ok: true }, ...focusOn(focus), ...results } })

/**
 * Work the worker starts on its own (activation, an after-hook nobody waits for) only moves while
 * the test kit serves a call: keep one going until its effect shows.
 */
async function until(worker: { request(name: 'memory.projects'): Promise<unknown> }, done: () => boolean): Promise<void> {
  for (let i = 0; i < 100 && !done(); i++) await worker.request('memory.projects')
  assert.ok(done(), 'the background work never finished')
}

test('lists the projects that have memories, most first', async () => {
  const worker = await mountWorker(main, { host: host(null) })
  const { projects } = await worker.request('memory.projects')
  assert.deepEqual(projects.map((p) => [p.slug, p.count]), [['-demo-broken', 3], ['-demo-ok', 1]])
  await worker.deactivate()
})

test('follows the focused workspace, and only it', async () => {
  const broken = await mountWorker(main, { host: host('broken') })
  const view = await broken.request('memory.view')
  assert.equal(view.workspace, 'broken')
  assert.equal(view.project?.slug, '-demo-broken')
  assert.equal(view.project?.detectedFrom, 'broken')
  assert.equal(view.project?.checked, null)
  assert.deepEqual(view.project?.indexProblems, ["MEMORY.md renvoie vers ancien.md, qui n'existe plus."])
  await broken.deactivate()

  const ok = await mountWorker(main, { host: host('ok') })
  assert.equal((await ok.request('memory.view')).project?.slug, '-demo-ok')
  await ok.deactivate()
})

test('a workspace without memory, or no workspace, shows no other project', async () => {
  const other = await mountWorker(main, { host: host('other') })
  assert.deepEqual(await other.request('memory.view'), { project: null, workspace: 'other' })
  await other.deactivate()
  const none = await mountWorker(main, { host: host(null) })
  assert.deepEqual(await none.request('memory.view'), { project: null, workspace: null })
  await none.deactivate()
})

test('reads one memory without its header, and refuses a path out of the folder', async () => {
  const worker = await mountWorker(main, { host: host('ok') })
  assert.deepEqual(await worker.request('memory.read', { slug: '-demo-ok', file: 'stack.md' }), { body: "Le front est Nuxt, l'API est Hono." })
  await assert.rejects(worker.request('memory.read', { slug: '-demo-ok', file: '../../x.md' }))
  await worker.deactivate()
})

test('keeps the status bar on the health of the focused memory, hidden without one', async () => {
  const h = host('broken')
  const worker = await mountWorker(main, { host: h })
  await until(worker, () => h.calls.some((c) => c.method === 'statusBar.update'))
  const last = h.calls.filter((c) => c.method === 'statusBar.update').pop()?.params as { text: string; tone: string; visible: boolean }
  assert.deepEqual([last.visible, last.tone, last.text], [true, 'warning', '4'])
  await worker.deactivate()

  const h2 = host('other')
  const w2 = await mountWorker(main, { host: h2 })
  await until(w2, () => h2.calls.some((c) => c.method === 'statusBar.update'))
  assert.equal((h2.callsOf('statusBar.update').pop() as { visible: boolean }).visible, false)
  await w2.deactivate()
})

test('starts a NEW Claude in the focused workspace, the request as its first message', async () => {
  const h = host('broken', { 'terminal.create': { terminalId: 't9' } })
  const worker = await mountWorker(main, { host: h })
  assert.deepEqual(await worker.request('memory.verify', { scope: 'all' }), { count: 4, workspace: 'broken' })
  const created = h.callsOf('terminal.create')[0] as { workspaceId: string; command: string }
  assert.equal(created.workspaceId, 'w-broken')
  assert.ok(created.command.startsWith("claude '"))
  assert.ok(!created.command.includes('\n'))
  assert.ok(!h.calls.some((c) => c.method === 'terminal.sendText'))
  await assert.rejects(worker.request('memory.verify', { scope: 'branch' }))
  await worker.deactivate()
})

test('refuses to verify when the focused workspace has no memory, or nothing is wrong', async () => {
  const other = await mountWorker(main, { host: host('other') })
  await assert.rejects(other.request('memory.verify', { scope: 'all' }), /aucune mémoire/)
  await other.deactivate()
  const ok = await mountWorker(main, { host: host('ok') })
  await assert.rejects(ok.request('memory.verify', { scope: 'all' }), /Rien à vérifier/)
  await ok.deactivate()
})

test('hears Claude write a memory: notifies once, marks it new, tells the panels', async () => {
  const h = host('ok', { 'notifications.show': { delivered: true } })
  const worker = await mountWorker(main, { host: h })
  await worker.hooks.fire('agent.tool.after', { agent: 'claude', workspaceId: null, tool: 'Write', input: { file_path: `${root}/-demo-ok/memory/stack.md`, content: 'x' } })
  await until(worker, () => worker.posts.length > 0)
  assert.deepEqual(h.callsOf('notifications.show'), [{ title: 'Claude a retenu quelque chose', body: 'Nuxt + Hono' }])
  assert.deepEqual(worker.posts, [{ event: 'memory.changed', payload: { slug: '-demo-ok', file: 'stack.md' } }])
  assert.deepEqual((await worker.request('memory.view')).project?.unseen, ['stack.md'])
  await worker.request('memory.seen', { slug: '-demo-ok' })
  assert.deepEqual((await worker.request('memory.view')).project?.unseen, [])
  await worker.deactivate()
})

test('ignores tool calls that write no memory', async () => {
  const h = host('ok', { 'notifications.show': { delivered: true } })
  const worker = await mountWorker(main, { host: h })
  await worker.hooks.fire('agent.tool.after', { agent: 'claude', workspaceId: null, tool: 'Write', input: { file_path: '/repo/src/a.ts' } })
  await worker.hooks.fire('agent.tool.after', { agent: 'claude', workspaceId: null, tool: 'Edit', input: { file_path: `${root}/-demo-ok/memory/MEMORY.md` } })
  await worker.hooks.fire('agent.tool.after', { agent: 'claude', workspaceId: null, tool: 'Read', input: { file_path: `${root}/-demo-ok/memory/stack.md` } })
  for (let i = 0; i < 5; i++) await worker.request('memory.projects')
  assert.deepEqual(h.callsOf('notifications.show'), [])
  assert.deepEqual(worker.posts, [])
  await worker.deactivate()
})

test('counts the memories Claude reads, from when counting began', async () => {
  const worker = await mountWorker(main, { host: host('ok') })
  const before = (await worker.request('memory.view')).project
  assert.deepEqual(before?.reads, {})
  assert.ok((before?.trackingSince ?? 0) > 0)
  const read = { agent: 'claude', workspaceId: 'w-ok', tool: 'Read', input: { file_path: `${root}/-demo-ok/memory/stack.md` } }
  await worker.hooks.fire('agent.tool.after', read)
  await worker.hooks.fire('agent.tool.after', read)
  for (let i = 0; i < 10; i++) await worker.request('memory.projects')
  const reads = (await worker.request('memory.view')).project?.reads ?? {}
  assert.equal(reads['stack.md']?.count, 2)
  await worker.deactivate()
})

test('a memory written with a dead link is announced as one to review', async () => {
  const h = host('broken', { 'notifications.show': { delivered: true } })
  const worker = await mountWorker(main, { host: h })
  await worker.hooks.fire('agent.tool.after', { agent: 'claude', workspaceId: 'w-broken', tool: 'Write', input: { file_path: `${root}/-demo-broken/memory/release.md` } })
  await until(worker, () => worker.posts.length > 0)
  const [shown] = h.callsOf('notifications.show') as { title: string; body: string }[]
  assert.equal(shown?.title, 'Claude a retenu quelque chose, à revoir')
  assert.ok(shown?.body.includes('un lien vers rien'))
  await worker.deactivate()
})
