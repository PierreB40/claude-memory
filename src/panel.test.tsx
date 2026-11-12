// `orca plugin test .` runs this in Node with the same runtime and checks Orca uses.
import { assert, mockHost, mount, test } from 'orca/testing'
import type { Memory } from './audit.ts'
import * as panel from './panel'
import type { ProjectView } from './protocol.ts'

/** What the panel drew: props (titles, descriptions) and the summary, where split JSX text is joined. */
const drawn = (view: { tree(): unknown; summary(): readonly string[] }): string => JSON.stringify(view.tree()) + view.summary().join('\n')

const memory = (over: Partial<Memory>): Memory => ({
  file: 'a.md',
  title: 'A',
  name: 'a',
  description: 'desc',
  type: 'project',
  mtimeMs: Date.now() - 400 * 86_400_000,
  related: [],
  cited: 0,
  missingPaths: [],
  problems: [],
  indexed: true,
  ...over
})

const view = (memories: Memory[]): ProjectView => ({
  slug: '-p',
  label: 'shop',
  repo: '/r',
  detectedFrom: 'analyze',
  memories,
  indexProblems: [],
  index: { present: true, lines: 3, bytes: 4000 },
  repoChecked: true
})

const mountWith = (v: ProjectView | null) =>
  mount(panel, {
    host: mockHost({
      requests: {
        'memory.view': () => v,
        'memory.projects': () => ({ projects: [{ slug: '-p', label: '/p', count: 1 }] }),
        'memory.read': () => ({ body: '# Corps\n\nLe texte de la mémoire.' })
      }
    })
  })

test('puts memories citing vanished code first, with why, and offers to have Claude verify', async () => {
  const stale = memory({ file: 'old.md', title: 'Ancien module de paiement', cited: 11, missingPaths: Array.from({ length: 10 }, (_, i) => `x/${i}.vue`) })
  const v = await mountWith(view([stale, memory({ file: 'ok.md', title: 'Saine' })]))
  const tree = drawn(v)
  assert.ok(tree.includes('À vérifier · 1'))
  assert.ok(tree.includes('10 fichiers cités sur 11 introuvables'))
  assert.ok(tree.includes('Faire vérifier par Claude'))
  assert.ok(tree.includes('Workspace « analyze »'))
  assert.deepEqual(v.errors, [])
  await v.unmount()
})

test('says all is well when nothing is to verify, and lists what Claude learned this week', async () => {
  const v = await mountWith(view([memory({ file: 'new.md', title: 'Nouvelle règle', mtimeMs: Date.now() - 3_600_000 })]))
  const tree = drawn(v)
  assert.ok(tree.includes('Rien à vérifier'))
  assert.ok(tree.includes('Appris cette semaine · 1'))
  assert.ok(!tree.includes('Faire vérifier par Claude'))
  await v.unmount()
})

test('opens a memory in place and comes back', async () => {
  const v = await mountWith(view([memory({ file: 'a.md', title: 'Une mémoire', mtimeMs: Date.now() })]))
  const row = v.find({ type: 'ListItem' })
  assert.ok(row)
  await v.press(row)
  assert.ok(drawn(v).includes('Le texte de la mémoire.'))
  await v.press({ type: 'Button', text: /←/ })
  assert.ok(drawn(v).includes('Toutes les mémoires'))
  await v.unmount()
})

test('says so when Claude has remembered nothing yet', async () => {
  const v = await mountWith(null)
  assert.ok(drawn(v).includes("Claude n'a encore rien retenu"))
  await v.unmount()
})
