import { assert, test } from 'orca/testing'
import { audit, DEFAULT_OPTIONS, extractLinks, parseFrontmatter, type MemoryFile } from './audit.ts'

const NOW = Date.UTC(2026, 10, 12)
const DAY = 86_400_000
const opts = { ...DEFAULT_OPTIONS, now: NOW }
const md = (name: string, type: string, body = ''): string => `---\nname: ${name}\ndescription: d\nmetadata:\n  type: ${type}\n---\n\n${body}\n`
const file = (f: string, content: string, ageDays = 0): MemoryFile => ({ file: f, content, mtimeMs: NOW - ageDays * DAY })
const kinds = (files: MemoryFile[]): string[] => audit(files, opts).issues.map((i) => `${i.kind}:${i.file}`)

test('reads top-level and metadata keys, quoted or not', () => {
  const fm = parseFrontmatter('---\nname: a\ndescription: "x: y"\nmetadata: \n  node_type: memory\n  type: feedback\n---\nbody')
  assert.deepEqual(fm, { name: 'a', description: 'x: y', metadata: '', 'metadata.node_type': 'memory', 'metadata.type': 'feedback' })
  assert.equal(parseFrontmatter('no header'), null)
})

test('extracts each [[link]] once', () => {
  assert.deepEqual(extractLinks('[[a]] puis [[b]] et [[a]]'), ['a', 'b'])
})

test('a healthy folder has no issue', () => {
  assert.deepEqual(kinds([file('MEMORY.md', '- [A](a.md) — x'), file('a.md', md('a', 'user', 'voir [[a]]'))]), [])
})

test('flags broken links, links by file name, unindexed and dangling entries', () => {
  const issues = kinds([
    file('MEMORY.md', '- [A](a.md)\n- [Gone](gone.md)'),
    file('a.md', md('a', 'user', '[[nowhere]] [[b_file]]')),
    file('b_file.md', md('b-name', 'user'))
  ])
  assert.deepEqual(issues.sort(), [
    'broken-link:a.md',
    'index-dangling:MEMORY.md',
    'link-by-filename:a.md',
    'not-indexed:b_file.md'
  ])
})

test('flags duplicate names and missing frontmatter', () => {
  const issues = kinds([file('x.md', md('same', 'user')), file('y.md', md('same', 'user')), file('z.md', 'plain')])
  assert.deepEqual(issues.sort(), ['duplicate-name:x.md', 'duplicate-name:y.md', 'no-frontmatter:z.md'])
})

test('only an old project memory is to reread, as info', () => {
  const r = audit([file('p.md', md('p', 'project'), 61), file('f.md', md('f', 'feedback'), 400), file('q.md', md('q', 'project'), 10)], opts)
  assert.deepEqual(r.issues.map((i) => [i.kind, i.file, i.severity]), [['stale', 'p.md', 'info']])
})

test('an index past the line budget is a danger, listed first', () => {
  const index = Array.from({ length: 201 }, (_, i) => `- [M${i}](m.md)`).join('\n')
  const r = audit([file('MEMORY.md', index), file('m.md', md('m', 'project'), 90)], opts)
  assert.deepEqual(r.issues.map((i) => i.kind), ['index-too-long', 'stale'])
  assert.equal(r.index.lines, 201)
})
