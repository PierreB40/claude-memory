import { assert, test } from 'orca/testing'
import {
  atMerge,
  audit,
  bodyOf,
  citedPaths,
  DEFAULT_OPTIONS,
  extractLinks,
  indexEntries,
  indexPaths,
  parseFrontmatter,
  readableBody,
  splitDescription,
  toVerify,
  verifyCount,
  verifyPrompt,
  writeVerdict,
  type MemoryFile
} from './audit.ts'

const md = (name: string, type: string, body = '', description = 'd'): string => `---\nname: ${name}\ndescription: ${description}\nmetadata:\n  type: ${type}\n---\n\n${body}\n`
const file = (f: string, content: string): MemoryFile => ({ file: f, content, mtimeMs: 0 })
const kinds = (files: MemoryFile[]): string[] => audit(files).memories.flatMap((m) => m.problems.map((p) => `${p.kind}:${m.file}`))
const repo = (files: string[], removedByBranch: string[] = []) => ({ ...DEFAULT_OPTIONS, repo: { files, removedByBranch } })

test('frontmatter: top-level and metadata keys, quotes, and a folded value', () => {
  const fm = parseFrontmatter('---\nname: a\ndescription: >-\n  sur deux\n  lignes\nmetadata: \n  node_type: memory\n  type: feedback\n---\nbody')
  assert.deepEqual(fm, { name: 'a', description: 'sur deux lignes', metadata: '', 'metadata.node_type': 'memory', 'metadata.type': 'feedback' })
  assert.equal(parseFrontmatter('no header'), null)
})

test('the body loses its header, an empty one included, and nothing after it', () => {
  assert.equal(bodyOf(md('a', 'user', 'Le texte.')), 'Le texte.')
  assert.equal(bodyOf('---\n---\nAvant\n\n---\n\nAprès'), 'Avant\n\n---\n\nAprès')
})

test('links: plain and aliased, never inside code', () => {
  assert.deepEqual(extractLinks('[[a]] [[b|le b]] `[[c]]` ```\n[[d]]\n``` [[a]]'), ['a', 'b'])
})

test('index entries are file names, `./x.md` included', () => {
  assert.deepEqual([...indexEntries('- [A](a.md)\n- [B](./b.md)').entries()], [['a.md', 'A'], ['b.md', 'B']])
})

test('a healthy folder has nothing to verify', () => {
  const r = audit([file('MEMORY.md', '- [A](a.md) — x\n'), file('a.md', md('a', 'user', 'voir [[a]]'))])
  assert.equal(verifyCount(r), 0)
  assert.deepEqual(r.memories[0]?.related, [], 'a memory linking to itself relates to nothing')
})

test('titles come from the index text, else the description, else the name', () => {
  const r = audit([
    file('MEMORY.md', '- [Le tri des tickets](t.md)\n- [s](s.md)\n- [x](x.md)'),
    file('t.md', md('t', 'user')),
    file('s.md', md('regle-de-merge', 'user')),
    file('x.md', md('x', 'user', '', 'Copie de la base : --clean échoue'))
  ])
  assert.deepEqual(r.memories.map((m) => [m.title, m.rest]), [
    ['Copie de la base', '--clean échoue'],
    ['Le tri des tickets', 'd'],
    ['Regle de merge', 'd']
  ])
})

test('defects: dead link, link by file name, unindexed, dangling index entry', () => {
  const files = [file('MEMORY.md', '- [A](a.md)\n- [Gone](gone.md)'), file('a.md', md('a', 'user', '[[nowhere]] [[b_file]]')), file('b_file.md', md('b-name', 'user'))]
  assert.deepEqual(kinds(files).sort(), ['dead-link:a.md', 'link-by-file:a.md', 'unindexed:b_file.md'])
  assert.deepEqual(audit(files).indexProblems, ["MEMORY.md renvoie vers gone.md, qui n'existe plus."])
  assert.deepEqual(audit(files).memories.find((m) => m.file === 'a.md')?.related, ['b_file.md'])
})

test('defects: duplicate names and missing headers', () => {
  assert.deepEqual(kinds([file('x.md', md('same', 'user')), file('y.md', md('same', 'user')), file('z.md', 'plain')]).sort(), [
    'duplicate-name:x.md',
    'duplicate-name:y.md',
    'no-header:z.md'
  ])
})

test('cited paths: backticked repository paths, not URLs, homes or build output', () => {
  const text = 'Voir `apps/api/src/x.ts`, `./docs/a.md`, `~/.claude/x.md`, `https://a.b/c.js`, `node_modules/z/y.js`, `apps/x/dist/y.js`, `pnpm test`, `orders/[id].vue`'
  assert.deepEqual(citedPaths(text), ['apps/api/src/x.ts', 'docs/a.md', 'orders/[id].vue'])
})

test('a path holds as a suffix; one outside every repository folder is not judged', () => {
  const index = indexPaths(['apps/web/app/pages/orders/index.vue', 'docs/a.md'])
  assert.ok(index.has('orders/index.vue') && index.has('docs/a.md') && !index.has('docs/gone.md'))
  assert.ok(index.judges('docs/gone.md') && !index.judges('maplibre-gl/dist/x.css') && !index.judges('staging.example.com/c.json'))
})

test('missing everywhere is to verify; removed by the branch only is for the merge', () => {
  const r = audit(
    [
      file('MEMORY.md', '- [a](a.md)\n- [b](b.md)\n- [c](c.md)'),
      file('a.md', md('a', 'project', '`src/keep.ts` `src/gone.ts`')),
      file('b.md', md('b', 'project', '`src/gone.ts` `src/also-gone.ts`')),
      file('c.md', md('c', 'project', '`src/keep.ts` `src/old.ts`'))
    ],
    // src/old.ts: deleted by the branch, still on the default branch (so in `files`).
    repo(['src/keep.ts', 'src/old.ts'], ['src/old.ts'])
  )
  assert.deepEqual(toVerify(r).map((m) => [m.file, m.missingPaths.length, m.cited]), [['b.md', 2, 2], ['a.md', 1, 2]])
  assert.deepEqual(atMerge(r).map((m) => [m.file, m.removedByBranch]), [['c.md', ['src/old.ts']]])
  assert.deepEqual(r.memories.find((m) => m.file === 'c.md')?.missingPaths, [], 'true on the default branch: not missing')
})

test('the index line count ignores the final newline, and its budget is checked', () => {
  const lines = (n: number): string => `${Array.from({ length: n }, (_, i) => `- [M${i}](m.md)`).join('\n')}\n`
  assert.equal(audit([file('MEMORY.md', lines(200)), file('m.md', md('m', 'user'))]).index.lines, 200)
  assert.deepEqual(audit([file('MEMORY.md', lines(200)), file('m.md', md('m', 'user'))]).indexProblems, [])
  assert.deepEqual(audit([file('MEMORY.md', lines(201)), file('m.md', md('m', 'user'))]).indexProblems, ["MEMORY.md fait 201 lignes : Claude n'en lit que 200."])
})

test('a description splits into a title and what is left, never mid-emoji', () => {
  assert.deepEqual(splitDescription('⚠️ copie de la base : --clean échoue si la cible est en avance'), { lead: 'Copie de la base', rest: '--clean échoue si la cible est en avance' })
  assert.deepEqual(splitDescription('Version 2.0 = nettoyage (12/11, une PR par sujet)'), { lead: 'Version 2.0 = nettoyage', rest: '(12/11, une PR par sujet)' })
  assert.deepEqual(splitDescription('Une seule phrase'), { lead: 'Une seule phrase', rest: '' })
  const long = `${'é'.repeat(60)} 🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀 fin`
  const { lead, rest } = splitDescription(long)
  assert.ok(lead.endsWith('…') && !lead.includes('�') && Array.from(lead).length <= 70)
  assert.ok(rest.startsWith('…') && rest.endsWith('fin'))
})

test('the verify prompt is one line, bounded, and asks to propose deletions', () => {
  const memories = Array.from({ length: 45 }, (_, i) => file(`m${i}.md`, md(`m${i}`, 'project', '[[x]]')))
  const r = audit(memories)
  const prompt = verifyPrompt('/m', toVerify(r), ['Index trop long.'])
  assert.ok(!prompt.includes('\n'))
  assert.ok(prompt.includes('et 5 autres'))
  assert.ok(prompt.includes('Index : Index trop long.'))
  assert.ok(prompt.includes('propose-moi la liste de celles à supprimer'))
})

test('links in a memory read as titles; a dead one says so; code is left alone', () => {
  const memories = [{ file: 'a_file.md', name: 'a', title: 'La règle A' }]
  assert.equal(readableBody('Voir [[a]], [[a_file|ici]], [[mort]] et `[[a]]`.', memories), 'Voir *« La règle A »*, *« La règle A »*, *mort (introuvable)* et `[[a]]`.')
})

test('a memory just written: missing files and dead links, never « not in the index » yet', () => {
  const [m] = audit([file('MEMORY.md', ''), file('a.md', md('a', 'user', '[[x]] `src/gone.ts`'))], repo(['src/keep.ts'])).memories
  assert.equal(m && writeVerdict(m), 'cite un fichier introuvable, un lien vers rien')
  const [ok] = audit([file('MEMORY.md', ''), file('b.md', md('b', 'user'))]).memories
  assert.equal(ok && writeVerdict(ok), null)
})
