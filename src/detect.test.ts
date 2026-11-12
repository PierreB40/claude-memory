import { assert, test } from 'orca/testing'
import { candidateSlugs, fixPrompt, mainCheckoutOf, matchWorkspace, slugOf } from './detect.ts'

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

test('the fix prompt is one line and leaves out what is only to reread', () => {
  const prompt = fixPrompt('/m', [
    { kind: 'broken-link', severity: 'danger', file: 'a.md', message: '[[x]] ne correspond à aucune mémoire.' },
    { kind: 'stale', severity: 'info', file: 'b.md', message: 'vieux' }
  ])
  assert.ok(!prompt.includes('\n'))
  assert.ok(prompt.includes('1 problème(s)'))
  assert.ok(prompt.includes('a.md : [[x]]'))
  assert.ok(!prompt.includes('b.md'))
})
