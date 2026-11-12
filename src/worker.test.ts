// Runs src/worker.ts's activate(orca) over a mock host, against the folders in fixtures/.
import { assert, mockHost, mountWorker, test } from 'orca/testing'
import * as main from './worker'

const root = new URL('../fixtures/projects', import.meta.url).pathname
/** Workspaces whose paths Claude Code names `-demo-broken` and `-demo-ok` (not git checkouts). */
const ws = (name: string, id = `w-${name}`) => ({ id, kind: 'worktree', name, path: `/demo/${name}`, branch: 'refs/heads/main', hostId: null })
const host = (focus: string | null, results: Record<string, unknown> = {}, workspaces = [ws('broken'), ws('ok'), ws('other')]) =>
  mockHost({
    settings: { projectsRoot: root },
    results: {
      'statusBar.update': { ok: true },
      'notifications.show': { delivered: true },
      'workspace.readContext': focus ? { branch: 'main', displayName: focus, terminals: [] } : null,
      'workspace.list': { workspaces, truncated: false },
      ...results
    }
  })

type Worker = Awaited<ReturnType<typeof mountWorker>>
/**
 * Work the worker starts on its own (activation, an after-hook nobody waits for) only moves while
 * the test kit serves a call: keep one going until its effect shows.
 */
async function until(worker: Worker, done: () => boolean): Promise<void> {
  for (let i = 0; i < 100 && !done(); i++) await worker.request('memory.view')
  assert.ok(done(), 'the background work never finished')
}
const settle = async (worker: Worker): Promise<void> => {
  for (let i = 0; i < 10; i++) await worker.request('memory.view')
}
const fire = (worker: Worker, tool: string, path: string, workspaceId: string | null = null) =>
  worker.hooks.fire('agent.tool.after', { agent: 'claude', workspaceId, tool, input: { file_path: path } })

test('follows the focused workspace, and only it', async () => {
  const broken = await mountWorker(main, { host: host('broken') })
  const view = await broken.request('memory.view')
  assert.equal(view.workspace, 'broken')
  assert.equal(view.project?.slug, '-demo-broken')
  assert.equal(view.project?.label, 'broken')
  assert.equal(view.project?.branch, null, 'not a git checkout: code unchecked')
  assert.deepEqual(view.project?.indexProblems, ["MEMORY.md renvoie vers ancien.md, qui n'existe plus."])
  await broken.deactivate()

  const ok = await mountWorker(main, { host: host('ok') })
  assert.equal((await ok.request('memory.view')).project?.slug, '-demo-ok')
  await ok.deactivate()
})

test('no memory, no workspace, or an ambiguous one: says which, never shows another project', async () => {
  const other = await mountWorker(main, { host: host('other') })
  assert.deepEqual(await other.request('memory.view'), { project: null, workspace: 'other' })
  await other.deactivate()
  const none = await mountWorker(main, { host: host(null) })
  assert.deepEqual(await none.request('memory.view'), { project: null, workspace: null })
  await none.deactivate()
  const twins = await mountWorker(main, { host: host('ok', {}, [ws('ok', 'a'), ws('ok', 'b')]) })
  assert.deepEqual(await twins.request('memory.view'), { project: null, workspace: 'ok', unmatched: true })
  await twins.deactivate()
})

test('reads one memory without its header, and refuses a path out of the folder', async () => {
  const worker = await mountWorker(main, { host: host('ok') })
  assert.deepEqual(await worker.request('memory.read', { slug: '-demo-ok', file: 'stack.md' }), { body: "Le front est Nuxt, l'API est Hono." })
  await assert.rejects(worker.request('memory.read', { slug: '-demo-ok', file: '../../x.md' }))
  await worker.deactivate()
})

test('the status bar: the count to verify, hidden without a memory', async () => {
  const h = host('broken')
  const worker = await mountWorker(main, { host: h })
  await until(worker, () => h.calls.some((c) => c.method === 'statusBar.update'))
  const last = h.callsOf('statusBar.update').pop() as { text: string; tone: string; visible: boolean }
  assert.deepEqual([last.visible, last.tone, last.text], [true, 'warning', '4'])
  await worker.deactivate()

  const h2 = host('other')
  const w2 = await mountWorker(main, { host: h2 })
  await until(w2, () => h2.calls.some((c) => c.method === 'statusBar.update'))
  assert.equal((h2.callsOf('statusBar.update').pop() as { visible: boolean }).visible, false)
  await w2.deactivate()
})

test('verify starts a NEW Claude in the focused workspace, the request as its first message', async () => {
  const h = host('broken', { 'terminal.create': { terminalId: 't9' } })
  const worker = await mountWorker(main, { host: h })
  assert.deepEqual(await worker.request('memory.verify'), { count: 4, workspace: 'broken' })
  const created = h.callsOf('terminal.create')[0] as { workspaceId: string; command: string }
  assert.equal(created.workspaceId, 'w-broken')
  assert.ok(created.command.startsWith("claude '") && !created.command.includes('\n'))
  assert.ok(!h.calls.some((c) => c.method === 'terminal.sendText'))
  await worker.deactivate()
})

test('verify refuses when the workspace has no memory, or nothing is wrong', async () => {
  const other = await mountWorker(main, { host: host('other') })
  await assert.rejects(other.request('memory.verify'), /aucune mémoire/)
  await other.deactivate()
  const ok = await mountWorker(main, { host: host('ok') })
  await assert.rejects(ok.request('memory.verify'), /Rien à vérifier/)
  await ok.deactivate()
})

test('a memory written: announced once, marked new until seen, panels told', async () => {
  const h = host('ok')
  const worker = await mountWorker(main, { host: h })
  await fire(worker, 'Write', `${root}/-demo-ok/memory/stack.md`, 'w-ok')
  await until(worker, () => worker.posts.length > 0)
  assert.deepEqual(h.callsOf('notifications.show'), [{ title: 'Claude a retenu quelque chose', body: 'Nuxt + Hono' }])
  assert.deepEqual(worker.posts, [{ event: 'memory.changed', payload: { slug: '-demo-ok', file: 'stack.md' } }])
  assert.deepEqual((await worker.request('memory.view')).project?.unseen, ['stack.md'])
  await worker.request('memory.seen', { slug: '-demo-ok', files: ['stack.md'] })
  assert.deepEqual((await worker.request('memory.view')).project?.unseen, [])
  await worker.deactivate()
})

test('a memory written with a dead link is announced as one to review', async () => {
  const h = host('broken')
  const worker = await mountWorker(main, { host: h })
  await fire(worker, 'Write', `${root}/-demo-broken/memory/release.md`, 'w-broken')
  await until(worker, () => worker.posts.length > 0)
  const [shown] = h.callsOf('notifications.show') as { title: string; body: string }[]
  assert.equal(shown?.title, 'Claude a retenu quelque chose, à revoir')
  assert.ok(shown?.body.includes('un lien vers rien'))
  await worker.deactivate()
})

test('the index written: panels told, no notification; a failed write: nothing', async () => {
  const h = host('ok')
  const worker = await mountWorker(main, { host: h })
  await fire(worker, 'Edit', `${root}/-demo-ok/memory/MEMORY.md`)
  await until(worker, () => worker.posts.length > 0)
  await fire(worker, 'Write', `${root}/-demo-ok/memory/never-written.md`)
  await settle(worker)
  assert.deepEqual(h.callsOf('notifications.show'), [])
  assert.deepEqual(worker.posts, [{ event: 'memory.changed', payload: { slug: '-demo-ok', file: 'MEMORY.md' } }])
  await worker.deactivate()
})

test('reads: counted per memory, at once without loss, a reading in parts counted once', async () => {
  const worker = await mountWorker(main, { host: host('broken') })
  const since = (await worker.request('memory.view')).project?.trackingSince ?? 0
  assert.ok(since > 0)
  await Promise.all([
    fire(worker, 'Read', `${root}/-demo-broken/memory/release.md`),
    fire(worker, 'Read', `${root}/-demo-broken/memory/oubli.md`),
    fire(worker, 'Read', `${root}/-demo-broken/memory/release.md`)
  ])
  await until(worker, () => true)
  await settle(worker)
  const reads = (await worker.request('memory.view')).project?.reads ?? {}
  assert.deepEqual([reads['release.md']?.count, reads['oubli.md']?.count], [1, 1])
  await worker.deactivate()
})

test('tool calls that touch no memory are ignored', async () => {
  const h = host('ok')
  const worker = await mountWorker(main, { host: h })
  await fire(worker, 'Write', '/repo/src/a.ts')
  await fire(worker, 'Bash', `${root}/-demo-ok/memory/stack.md`)
  await settle(worker)
  assert.deepEqual(h.callsOf('notifications.show'), [])
  assert.deepEqual(worker.posts, [])
  await worker.deactivate()
})
