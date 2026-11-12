// `orca plugin test .` runs this in Node with the same runtime and checks Orca uses.
import { assert, mockHost, mount, test } from 'orca/testing'
import type { Memory } from './audit.ts'
import * as panel from './panel'
import type { ProjectView } from './protocol.ts'

/** What the panel drew: props (tree items, titles) and the summary, where split JSX text is joined. */
const drawn = (view: { tree(): unknown; summary(): readonly string[] }): string => JSON.stringify(view.tree()) + view.summary().join('\n')

const memory = (over: Partial<Memory>): Memory => ({
  file: 'a.md',
  title: 'A',
  rest: '',
  name: 'a',
  description: 'desc',
  type: 'project',
  mtimeMs: Date.now() - 400 * 86_400_000,
  related: [],
  cited: 0,
  missingPaths: [],
  brokenHere: [],
  problems: [],
  indexed: true,
  ...over
})

const project = (memories: Memory[], over: Partial<ProjectView> = {}): ProjectView => ({
  slug: '-p',
  label: 'shop',
  detectedFrom: 'analyze',
  checked: { path: '/r', branch: 'feat/x' },
  base: 'origin/main',
  unseen: [],
  memories,
  indexProblems: [],
  index: { present: true, lines: 3, bytes: 4000 },
  repoChecked: true,
  ...over
})

type View = { project: ProjectView | null; workspace: string | null }
function mountWith(answers: View[]) {
  let i = 0
  return mount(panel, {
    host: mockHost({
      requests: {
        'memory.view': () => answers[Math.min(i++, answers.length - 1)] as View,
        'memory.read': () => ({ body: 'Le texte de la mémoire.' }),
        'memory.seen': () => ({ ok: true as const })
      }
    })
  })
}

test('a fixed header with tabs, search, sort and filter, then the list of what to verify', async () => {
  const stale = memory({ file: 'old.md', title: 'Ancien module de paiement', cited: 11, missingPaths: Array.from({ length: 10 }, (_, i) => `x/${i}.vue`) })
  const v = await mountWith([{ project: project([stale, memory({ file: 'ok.md', title: 'Saine', type: 'feedback' })]), workspace: 'analyze' }])
  const tree = drawn(v)
  assert.ok(tree.includes('"À vérifier" selected') || tree.includes('À vérifier 1" selected'))
  assert.ok(tree.includes('2 mémoires · feat/x'))
  assert.ok(tree.includes('10/11 fichiers introuvables'))
  assert.ok(tree.includes('Tous les types'))
  assert.ok(!tree.includes('"title":"Saine"'), 'a sound memory is not in the list to verify')
  assert.deepEqual(v.errors, [])
  await v.unmount()
})

test('search and type filter shape the list, grouped by type', async () => {
  const a = memory({ file: 'a.md', title: 'Bêta', type: 'feedback', mtimeMs: Date.now() - 1000 })
  const b = memory({ file: 'b.md', title: 'Alpha', type: 'project', mtimeMs: Date.now() - 2000 })
  const v = await mountWith([{ project: project([a, b]), workspace: 'analyze' }])
  await v.select({ label: 'Vue' }, 'all')
  const titles = (): string[] => v.findAll({ type: 'ListItem' }).map((e) => (e as unknown as { props: { title: string } }).props.title)
  assert.deepEqual(titles(), ['Bêta', 'Alpha'], 'rules of work come before project memories')
  await v.select({ label: 'Type' }, 'project')
  assert.deepEqual(titles(), ['Alpha'])
  await v.select({ label: 'Type' }, 'any')
  await v.type({ label: 'Rechercher' }, 'bê')
  assert.deepEqual(titles(), ['Bêta'])
  await v.unmount()
})

test('what the branch broke says so, in the header and on the row', async () => {
  const broken = memory({ file: 'b.md', title: 'Le module ops', cited: 3, missingPaths: ['src/a.ts'], brokenHere: ['src/a.ts'] })
  const tree = drawn(await mountWith([{ project: project([broken]), workspace: 'analyze' }]))
  assert.ok(tree.includes('Ta branche rend 1 mémoire fausse'))
  assert.ok(tree.includes('Ta branche retire 1 fichier cité'))
})

test('a sound memory opens on what is recent, marks what is new, and offers no action', async () => {
  const fresh = memory({ file: 'n.md', title: 'Règle neuve', type: 'feedback', mtimeMs: Date.now() - 60_000 })
  const tree = drawn(await mountWith([{ project: project([fresh], { unseen: ['n.md'] }), workspace: 'analyze' }]))
  assert.ok(tree.includes('Nouvelles depuis ta dernière visite · 1'))
  assert.ok(!tree.includes('"Vérifier"'))
})

test('switches by itself when another workspace comes to the front', async () => {
  const v = await mountWith([
    { project: project([memory({ title: 'De shop' })]), workspace: 'analyze' },
    { project: null, workspace: 'infra' }
  ])
  await v.emit('workspace.changed', { context: { displayName: 'analyze', branch: 'x', terminals: [] } })
  assert.ok(drawn(v).includes('shop'))
  await v.emit('workspace.changed', { context: { displayName: 'analyze', branch: 'x', terminals: [{ id: 't' }] } })
  assert.ok(drawn(v).includes('shop'), 'a terminal opening is not a new workspace')
  await v.emit('workspace.changed', { context: { displayName: 'infra', branch: 'main', terminals: [] } })
  assert.ok(drawn(v).includes('Claude n’a rien retenu sur « infra »'))
  await v.unmount()
})

test('a memory opens in place, says what it points to and what points to it, and comes back', async () => {
  const a = memory({ file: 'a.md', title: 'Une mémoire', type: 'feedback', related: ['b.md'] })
  const b = memory({ file: 'b.md', title: 'La cible', description: 'Ce que dit la cible' })
  const c = memory({ file: 'c.md', title: 'Une source', related: ['a.md'] })
  const v = await mountWith([{ project: project([a, b, c]), workspace: 'analyze' }])
  await v.select({ label: 'Vue' }, 'all')
  await v.press({ type: 'ListItem', text: /Une mémoire/ })
  const tree = drawn(v)
  assert.ok(tree.includes('Le texte de la mémoire.'))
  assert.ok(tree.includes('Renvoie à · 1') && tree.includes('La cible'))
  assert.ok(tree.includes('Citée par · 1') && tree.includes('Une source'))
  assert.ok(tree.includes('Dans l’index'))
  await v.press({ type: 'Button', text: /Mémoires/ })
  assert.ok(drawn(v).includes('"label":"Rechercher"') || drawn(v).includes('Rechercher'))
  await v.unmount()
})

test('without a workspace, says what it follows', async () => {
  assert.ok(drawn(await mountWith([{ project: null, workspace: null }])).includes('Aucun workspace ouvert'))
})
