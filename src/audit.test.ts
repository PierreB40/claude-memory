import { assert, test } from 'orca/testing'
import { audit, bodyOf, citedPaths, DEFAULT_OPTIONS, missingFrom, parseFrontmatter, toVerify, verifyPrompt, type MemoryFile } from './audit.ts'

const md = (name: string, type: string, body = ''): string => `---\nname: ${name}\ndescription: d\nmetadata:\n  type: ${type}\n---\n\n${body}\n`
const file = (f: string, content: string): MemoryFile => ({ file: f, content, mtimeMs: 0 })
const shorts = (files: MemoryFile[]): string[] =>
  audit(files).memories.flatMap((m) => m.problems.map((p) => `${p.short}:${m.file}`))

test('reads top-level and metadata keys, quoted or not', () => {
  const fm = parseFrontmatter('---\nname: a\ndescription: "x: y"\nmetadata: \n  node_type: memory\n  type: feedback\n---\nbody')
  assert.deepEqual(fm, { name: 'a', description: 'x: y', metadata: '', 'metadata.node_type': 'memory', 'metadata.type': 'feedback' })
  assert.equal(parseFrontmatter('no header'), null)
  assert.equal(bodyOf(md('a', 'user', 'Le texte.')), 'Le texte.')
})

test('a healthy folder has nothing to verify', () => {
  const r = audit([file('MEMORY.md', '- [A](a.md) — x'), file('a.md', md('a', 'user', 'voir [[a]]'))])
  assert.deepEqual(toVerify(r), [])
  assert.deepEqual(r.indexProblems, [])
})

test('titles come from the index text, else the name made readable', () => {
  const r = audit([file('MEMORY.md', '- [Le tri des tickets](t.md)\n- [s](s.md)'), file('t.md', md('t', 'user')), file('s.md', md('regle-de-merge', 'user'))])
  assert.deepEqual(r.memories.map((m) => m.title), ['Le tri des tickets', 'Regle de merge'])
})

test('flags dead links, links by file name, unindexed memories and dangling index entries', () => {
  const files = [
    file('MEMORY.md', '- [A](a.md)\n- [Gone](gone.md)'),
    file('a.md', md('a', 'user', '[[nowhere]] [[b_file]]')),
    file('b_file.md', md('b-name', 'user'))
  ]
  assert.deepEqual(shorts(files).sort(), ['Hors index:b_file.md', 'Lien mort:a.md', 'Lien à rediriger:a.md'])
  assert.deepEqual(audit(files).indexProblems, ["MEMORY.md renvoie vers gone.md, qui n'existe plus."])
  assert.deepEqual(audit(files).memories.find((m) => m.file === 'a.md')?.related, ['b_file.md'])
})

test('flags duplicate names and missing headers', () => {
  assert.deepEqual(shorts([file('x.md', md('same', 'user')), file('y.md', md('same', 'user')), file('z.md', 'plain')]).sort(), [
    'Nom en double:x.md',
    'Nom en double:y.md',
    'Sans en-tête:z.md'
  ])
})

test('finds repository paths quoted in backticks, not URLs, homes or build output', () => {
  const text = 'Voir `apps/api/src/x.ts`, `./docs/a.md`, `~/.claude/x.md`, `https://a.b/c.js`, `node_modules/z/y.js`, `pnpm test`, `orders/[id].vue`'
  assert.deepEqual(citedPaths(text), ['apps/api/src/x.ts', 'docs/a.md', 'orders/[id].vue'])
})

test('a cited path holds as a suffix; one outside every repository folder is not judged', () => {
  const repo = ['apps/web/app/pages/orders/index.vue', 'docs/a.md']
  assert.deepEqual(missingFrom(['orders/index.vue', 'docs/a.md', 'docs/gone.md', 'maplibre-gl/dist/x.css', 'staging.example.com/c.json'], repo), ['docs/gone.md'])
})

test('memories citing vanished code are verified first, by the share that vanished', () => {
  const repo = ['src/keep.ts', 'src/other.ts']
  const r = audit(
    [
      file('MEMORY.md', '- [a](a.md)\n- [b](b.md)\n- [c](c.md)'),
      file('a.md', md('a', 'project', '`src/keep.ts` `src/gone.ts`')),
      file('b.md', md('b', 'project', '`src/gone.ts` `src/also-gone.ts`')),
      file('c.md', md('c', 'project', '`src/keep.ts`'))
    ],
    { ...DEFAULT_OPTIONS, repoFiles: repo }
  )
  assert.equal(r.repoChecked, true)
  assert.deepEqual(toVerify(r).map((m) => [m.file, m.missingPaths.length, m.cited]), [
    ['b.md', 2, 2],
    ['a.md', 1, 2]
  ])
})

test('an index past the line budget is reported', () => {
  const index = Array.from({ length: 201 }, (_, i) => `- [M${i}](m.md)`).join('\n')
  assert.deepEqual(audit([file('MEMORY.md', index), file('m.md', md('m', 'user'))]).indexProblems, ["MEMORY.md fait 201 lignes : Claude n'en lit que 200."])
})

test('the verify prompt is one line, and asks to propose deletions rather than make them', () => {
  const r = audit([file('a.md', md('a', 'project', '[[x]] `src/gone.ts`'))], { ...DEFAULT_OPTIONS, repoFiles: ['src/keep.ts'] })
  const prompt = verifyPrompt('/m', toVerify(r), ['Index trop long.'])
  assert.ok(!prompt.includes('\n'))
  assert.ok(prompt.includes('a.md (Le lien [[x]] ne mène à aucune mémoire. ; cite `src/gone.ts`, introuvable(s) dans le dépôt)'))
  assert.ok(prompt.includes('Index : Index trop long.'))
  assert.ok(prompt.includes('propose-moi la liste de celles à supprimer'))
})
