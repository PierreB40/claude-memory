// `orca plugin test .` runs this in Node with the same runtime and checks Orca uses.
import { assert, mockHost, mount, test } from 'orca/testing'
import type { Memory } from './audit.ts'
import * as panel from './panel'
import type { PanelView, ProjectView } from './protocol.ts'

/** What the panel drew: props (titles, labels) and the summary, where split JSX text is joined. */
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
  removedByBranch: [],
  problems: [],
  indexed: true,
  ...over
})

const project = (memories: Memory[], over: Partial<ProjectView> = {}): ProjectView => ({
  slug: '-p',
  label: 'shop',
  branch: 'feat/x',
  base: 'main',
  unseen: [],
  reads: {},
  trackingSince: Date.UTC(2026, 10, 12),
  memories,
  indexProblems: [],
  index: { present: true, lines: 3 },
  ...over
})

function mountWith(answers: PanelView[], body = 'Le texte de la mémoire.', locale = 'fr-FR') {
  let i = 0
  const seen: unknown[] = []
  const view = mount(panel, {
    locale,
    host: mockHost({
      requests: {
        'memory.view': () => answers[Math.min(i++, answers.length - 1)] as PanelView,
        'memory.read': () => ({ body }),
        'memory.seen': (input) => {
          seen.push(input)
          return { ok: true as const }
        }
      }
    })
  })
  return { view, seen }
}
const titles = (v: { findAll(q: { type: string }): readonly unknown[] }): string[] => v.findAll({ type: 'ListItem' }).map((e) => (e as { props: { title: string } }).props.title)

test('a fixed header, tabs, search and type, then what to verify with why', async () => {
  const stale = memory({ file: 'old.md', title: 'Ancien module de paiement', cited: 11, missingPaths: Array.from({ length: 10 }, (_, i) => `x/${i}.vue`) })
  const v = await mountWith([{ project: project([stale, memory({ file: 'ok.md', title: 'Saine', type: 'feedback' })]), workspace: 'analyze' }]).view
  const tree = drawn(v)
  assert.ok(tree.includes('2 mémoires · feat/x'))
  assert.ok(tree.includes('"À vérifier 1" selected'))
  assert.ok(tree.includes('10/11 fichiers introuvables'))
  assert.ok(tree.includes('Tous les types'))
  assert.ok(tree.includes('Vérifier'))
  assert.deepEqual(titles(v), ['Ancien module de paiement'], 'a sound memory is not in the list to verify')
  assert.deepEqual(v.errors, [])
  await v.unmount()
})

test('what the branch removes waits for the merge: its own group, no action, not counted', async () => {
  const merge = memory({ file: 'b.md', title: 'Le module ops', cited: 3, removedByBranch: ['src/a.ts'] })
  const v = await mountWith([{ project: project([merge]), workspace: 'analyze' }]).view
  await v.select({ label: 'Vue' }, 'verify')
  const tree = drawn(v)
  assert.ok(tree.includes('À mettre à jour quand ta branche rejoindra main · 1'))
  assert.ok(tree.includes('Ta branche retire 1 fichier cité'))
  assert.ok(tree.includes('1 mémoire à mettre à jour à la fusion'))
  assert.ok(tree.includes('À vérifier 0'))
  assert.ok(!tree.includes('"Vérifier"'))
  await v.unmount()
})

test('search and type filter shape the list, grouped by type', async () => {
  const a = memory({ file: 'a.md', title: 'Bêta', type: 'feedback' })
  const b = memory({ file: 'b.md', title: 'Alpha', type: 'project' })
  const v = await mountWith([{ project: project([a, b]), workspace: 'analyze' }]).view
  await v.select({ label: 'Vue' }, 'all')
  assert.deepEqual(titles(v), ['Bêta', 'Alpha'], 'rules of work come before project memories')
  await v.select({ label: 'Type' }, 'project')
  assert.deepEqual(titles(v), ['Alpha'])
  await v.select({ label: 'Type' }, 'any')
  await v.type({ label: 'Rechercher' }, 'bê')
  assert.deepEqual(titles(v), ['Bêta'])
  await v.type({ label: 'Rechercher' }, 'zzz', { replace: true })
  assert.ok(drawn(v).includes('Aucune mémoire ne correspond'))
  await v.unmount()
})

test('a sound memory opens on Recent; leaving it, as the default tab, marks the new ones seen', async () => {
  const fresh = memory({ file: 'n.md', title: 'Règle neuve', type: 'feedback', mtimeMs: Date.now() - 60_000 })
  const { view: pending, seen } = mountWith([{ project: project([fresh], { unseen: ['n.md'] }), workspace: 'analyze' }])
  const v = await pending
  assert.ok(drawn(v).includes('"Récentes 1" selected'))
  assert.ok(drawn(v).includes('Nouvelles depuis ta dernière visite · 1'))
  await v.select({ label: 'Vue' }, 'all')
  assert.deepEqual(seen, [{ slug: '-p' }])
  await v.unmount()
})

test('switches by itself when another workspace comes to the front', async () => {
  const shop = { project: project([memory({ title: 'De shop' })]), workspace: 'analyze' }
  const v = await mountWith([shop, shop, { project: null, workspace: 'infra' }]).view
  await v.emit('workspace.changed', { context: { displayName: 'analyze', branch: 'x', terminals: [] } })
  assert.ok(drawn(v).includes('shop'))
  await v.emit('workspace.changed', { context: { displayName: 'analyze', branch: 'x', terminals: [{ id: 't' }] } })
  assert.ok(drawn(v).includes('shop'), 'a terminal opening is asked again, and stays the same workspace')
  await v.emit('workspace.changed', { context: { displayName: 'infra', branch: 'main', terminals: [] } })
  assert.ok(drawn(v).includes('Claude n’a rien retenu sur « infra »'))
  await v.unmount()
})

test('a memory opens in place: links both ways, file facts, read count; opening it marks it seen', async () => {
  const a = memory({ file: 'a.md', title: 'Une mémoire', type: 'feedback', related: ['b.md'], rest: 'ce qu’elle ajoute', mtimeMs: Date.now() - 60_000 })
  const b = memory({ file: 'b.md', title: 'La cible' })
  const c = memory({ file: 'c.md', title: 'Une source', related: ['a.md'] })
  const { view: pending, seen } = mountWith([{ project: project([a, b, c], { unseen: ['a.md'], reads: { 'a.md': { count: 3, last: Date.now() } } }), workspace: 'analyze' }])
  const v = await pending
  await v.press({ type: 'ListItem', text: /Une mémoire/ })
  const tree = drawn(v)
  assert.ok(tree.includes('Le texte de la mémoire.') && tree.includes('Ce qu’elle ajoute'))
  assert.ok(tree.includes('Renvoie à · 1') && tree.includes('La cible'))
  assert.ok(tree.includes('Citée par · 1') && tree.includes('Une source'))
  assert.ok(tree.includes('3 fois'))
  assert.deepEqual(seen, [{ slug: '-p', files: ['a.md'] }])
  await v.press({ type: 'Button', text: /Mémoires/ })
  assert.ok(drawn(v).includes('Rechercher dans les mémoires'))
  await v.unmount()
})

test('an open memory that disappears brings back the list', async () => {
  const a = memory({ file: 'a.md', title: 'Éphémère', type: 'feedback' })
  const v = await mountWith([
    { project: project([a]), workspace: 'analyze' },
    { project: project([memory({ file: 'z.md', title: 'Autre' })]), workspace: 'analyze' }
  ]).view
  await v.select({ label: 'Vue' }, 'all')
  await v.press({ type: 'ListItem', text: /Éphémère/ })
  await v.post('memory.changed', { slug: '-p', file: 'a.md' })
  assert.ok(drawn(v).includes('Autre') && !drawn(v).includes('Éphémère'))
  await v.unmount()
})

test('no workspace, or an ambiguous one, says which', async () => {
  assert.ok(drawn(await mountWith([{ project: null, workspace: null }]).view).includes('Aucun workspace ouvert'))
  assert.ok(drawn(await mountWith([{ project: null, workspace: 'main', unmatched: true }]).view).includes('Workspace « main » ambigu'))
  assert.ok(drawn(await mountWith([{ project: null, workspace: 'api', remote: true }]).view).includes('« api » est sur un autre hôte'))
  const twins = drawn(
    await mountWith([{ project: null, workspace: 'v8', unmatched: true, twins: [{ id: 'a', label: 'akolade-ui', detail: '~/Dev/akolade/akolade-ui' }, { id: 'b', label: 'akolade-db', detail: '~/Dev/akolade/akolade-db' }] }]).view
  )
  assert.ok(twins.includes('Quel « v8 » ?') && twins.includes('akolade-db') && twins.includes('~/Dev/akolade/akolade-ui'))
})

test('in English when Orca is', async () => {
  const stale = memory({ file: 'old.md', title: 'Old audit', cited: 2, missingPaths: ['x/a.vue'], problems: [{ kind: 'dead-link', link: 'gone' }] })
  const v = await mountWith([{ project: project([stale]), workspace: 'analyze' }], 'Text.', 'en-US').view
  const tree = drawn(v)
  assert.ok(tree.includes('1 memory · feat/x'))
  assert.ok(tree.includes('"To verify 1" selected'))
  assert.ok(tree.includes('1/2 files not found · broken link'))
  assert.ok(tree.includes('All types') && tree.includes('Verify'))
  assert.deepEqual(v.errors, [])
  await v.unmount()
})
