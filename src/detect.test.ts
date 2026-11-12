import { assert, test } from 'orca/testing'
import { execFileSync } from 'node:child_process'
import { candidateSlugs, claudeCommand, mainCheckoutOf, matchWorkspace, memoryOfPath, readPath, repoOfSlug, slugOf, writtenPath } from './detect.ts'

const ws = (id: string, name: string, path: string, branch: string | null) => ({ id, name, path, branch })

test('slugs a path the way Claude Code names its project folders', () => {
  assert.equal(slugOf('/Users/me/Dev/shop'), '-Users-me-Dev-shop')
  assert.equal(slugOf('/Users/me/.paperclip/x_y'), '-Users-me--paperclip-x-y')
})

test('matches the focused workspace by name and branch, then by the only one matching either', () => {
  const list = [
    ws('1', 'main', '/a', 'refs/heads/main'),
    ws('2', 'main', '/b', 'refs/heads/main'),
    ws('3', 'analyze', '/c', 'refs/heads/me/analyze'),
    ws('4', 'reprise', '/d', null)
  ]
  assert.equal(matchWorkspace({ displayName: 'analyze', branch: 'me/analyze' }, list)?.id, '3')
  assert.equal(matchWorkspace({ displayName: 'reprise', branch: '' }, list)?.id, '4')
  assert.equal(matchWorkspace({ displayName: 'main', branch: 'main' }, list), null)
})

test('a linked worktree maps to its main checkout first', () => {
  const gitFile = 'gitdir: /Users/me/Dev/shop/.git/worktrees/feature\n'
  assert.equal(mainCheckoutOf(gitFile), '/Users/me/Dev/shop')
  assert.deepEqual(candidateSlugs('/Users/me/orca/shop/feature', gitFile), ['-Users-me-Dev-shop', '-Users-me-orca-shop-feature'])
  assert.deepEqual(candidateSlugs('/Users/me/Dev/shop', null), ['-Users-me-Dev-shop'])
})

test('finds the checkout a project slug came from, through any worktree', () => {
  const known = [
    { path: '/Users/me/orca/shop/feature', gitFile: 'gitdir: /Users/me/Dev/shop/.git/worktrees/feature' },
    { path: '/Users/me/Dev/infra', gitFile: null }
  ]
  assert.equal(repoOfSlug('-Users-me-Dev-shop', known), '/Users/me/Dev/shop')
  assert.equal(repoOfSlug('-Users-me-Dev-infra', known), '/Users/me/Dev/infra')
  assert.equal(repoOfSlug('-Users-me-Dev-other', known), null)
})

test('recognises a memory an agent wrote, never the index nor another file', () => {
  const root = '/Users/me/.claude/projects'
  assert.deepEqual(memoryOfPath(`${root}/-Users-me-app/memory/regle.md`, root), { slug: '-Users-me-app', file: 'regle.md' })
  assert.equal(memoryOfPath(`${root}/-Users-me-app/memory/MEMORY.md`, root), null)
  assert.equal(memoryOfPath(`${root}/-Users-me-app/notes.md`, root), null)
  assert.equal(memoryOfPath('/repo/memory/x.md', root), null)
  assert.equal(writtenPath('Edit', { file_path: '/a.md' }), '/a.md')
  assert.equal(writtenPath('Read', { file_path: '/a.md' }), null)
})

test('the Claude command line keeps the prompt intact through a shell', () => {
  const prompt = "Corrige `src/a.ts` (l'index), \$HOME et \"guillemets\" ; rien d'autre."
  const echoed = execFileSync('sh', ['-c', claudeCommand(prompt).replace(/^claude /, 'printf %s ')], { encoding: 'utf8' })
  assert.equal(echoed, prompt)
})

test('a Read of a file is recognised, nothing else', () => {
  assert.equal(readPath('Read', { file_path: '/m/a.md' }), '/m/a.md')
  assert.equal(readPath('Write', { file_path: '/m/a.md' }), null)
  assert.equal(readPath('Read', 'x'), null)
})
