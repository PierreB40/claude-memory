import { assert, test } from 'orca/testing'
import { execFileSync } from 'node:child_process'
import { candidateSlugs, claudeCommand, isRemote, launchOf, mainCheckoutOf, matchWorkspace, memoryOfPath, readPath, resolvePath, slugOf, writtenPath } from './detect.ts'

const ws = (id: string, name: string, path: string, branch: string | null) => ({ id, name, path, branch })

test('slugs a path the way Claude Code names its project folders', () => {
  assert.equal(slugOf('/Users/me/Dev/shop'), '-Users-me-Dev-shop')
  assert.equal(slugOf('/Users/me/.paperclip/x_y'), '-Users-me--paperclip-x-y')
})

test('matches the focused workspace by name and branch, then the only one matching either', () => {
  const list = [ws('1', 'main', '/a', 'refs/heads/main'), ws('2', 'main', '/b', 'refs/heads/main'), ws('3', 'analyze', '/c', 'refs/heads/me/analyze'), ws('4', 'reprise', '/d', null)]
  assert.equal(matchWorkspace({ displayName: 'analyze', branch: 'me/analyze' }, list)?.id, '3')
  assert.equal(matchWorkspace({ displayName: 'reprise', branch: '' }, list)?.id, '4')
  assert.equal(matchWorkspace({ displayName: 'main', branch: 'main' }, list), null, 'two alike: ambiguous, never a guess')
})

test('two alike are told apart by a terminal an agent event tied to one of them', () => {
  const list = [ws('1', 'main', '/a', 'refs/heads/main'), ws('2', 'main', '/b', 'refs/heads/main')]
  const owners = new Map([['t-b', '2'], ['t-elsewhere', '9']])
  assert.equal(matchWorkspace({ displayName: 'main', branch: 'main', terminals: [{ id: 't-b' }] }, list, owners)?.id, '2')
  assert.equal(matchWorkspace({ displayName: 'main', branch: 'main', terminals: [{ id: 't-elsewhere' }] }, list, owners), null)
  const both = new Map([['t-a', '1'], ['t-b', '2']])
  assert.equal(matchWorkspace({ displayName: 'main', branch: 'main', terminals: [{ id: 't-a' }, { id: 't-b' }] }, list, both), null, 'still two: never a guess')
})

test('a linked worktree maps to its main checkout, absolute or relative gitdir', () => {
  assert.equal(mainCheckoutOf('gitdir: /Users/me/Dev/shop/.git/worktrees/feature\n', '/Users/me/orca/shop/feature'), '/Users/me/Dev/shop')
  assert.equal(mainCheckoutOf('gitdir: ../../../Dev/shop/.git/worktrees/feature\n', '/Users/me/orca/shop/feature'), '/Users/me/Dev/shop')
  assert.equal(mainCheckoutOf('gitdir: /x/.bare\n', '/x/main'), null)
  assert.deepEqual(candidateSlugs('/Users/me/orca/shop/feature', 'gitdir: /Users/me/Dev/shop/.git/worktrees/feature'), ['-Users-me-Dev-shop', '-Users-me-orca-shop-feature'])
  assert.deepEqual(candidateSlugs('/Users/me/Dev/shop', null), ['-Users-me-Dev-shop'])
  assert.equal(resolvePath('/a/b', '../c/./d'), '/a/c/d')
})

test('Windows: a worktree maps to its main checkout, a memory is recognised whatever the slashes', () => {
  assert.equal(mainCheckoutOf('gitdir: C:/Users/me/Dev/shop/.git/worktrees/feature\n', 'C:\\Users\\me\\orca\\shop\\feature'), 'C:/Users/me/Dev/shop')
  assert.equal(mainCheckoutOf('gitdir: ../../../Dev/shop/.git/worktrees/feature', 'C:\\Users\\me\\orca\\shop\\feature'), 'C:/Users/me/Dev/shop')
  assert.deepEqual(candidateSlugs('C:\\Users\\me\\orca\\shop\\feature', 'gitdir: C:/Users/me/Dev/shop/.git/worktrees/feature'), ['C--Users-me-Dev-shop', 'C--Users-me-orca-shop-feature'])
  const root = 'C:\\Users\\me\\.claude\\projects'
  assert.deepEqual(memoryOfPath('C:\\Users\\me\\.claude\\projects\\C--Users-me-app\\memory\\regle.md', root), { slug: 'C--Users-me-app', file: 'regle.md', index: false })
  assert.deepEqual(memoryOfPath('c:/users/me/.claude/projects/C--Users-me-app/memory/MEMORY.md', root), { slug: 'C--Users-me-app', file: 'MEMORY.md', index: true })
  assert.equal(memoryOfPath('C:\\Users\\me\\app\\memory\\regle.md', root), null)
})

test('a workspace on WSL or SSH is remote; this machine is local', () => {
  assert.equal(isRemote({ hostId: null }), false)
  assert.equal(isRemote({ hostId: 'local' }), false)
  assert.equal(isRemote({ hostId: 'wsl:Ubuntu' }), true)
})

test('verify: the prompt on the command line, but Orca launches Claude itself on Windows', () => {
  const posix = launchOf('darwin', 'w1', 'Claude', "it's")
  assert.deepEqual(posix, { method: 'terminal.create', params: { workspaceId: 'w1', title: 'Claude', command: claudeCommand("it's") } })
  assert.deepEqual(launchOf('win32', 'w1', 'Claude', "it's"), { method: 'agent.launch', params: { workspaceId: 'w1', agent: 'claude', prompt: "it's" } })
})

test('recognises a memory or the index an agent touched, nothing else', () => {
  const root = '/Users/me/.claude/projects'
  assert.deepEqual(memoryOfPath(`${root}/-Users-me-app/memory/regle.md`, root), { slug: '-Users-me-app', file: 'regle.md', index: false })
  assert.deepEqual(memoryOfPath(`${root}/-Users-me-app/memory/MEMORY.md`, root), { slug: '-Users-me-app', file: 'MEMORY.md', index: true })
  assert.equal(memoryOfPath(`${root}/-Users-me-app/notes.md`, root), null)
  assert.equal(memoryOfPath('/repo/memory/x.md', root), null)
  assert.equal(writtenPath('Edit', { file_path: '/a.md' }), '/a.md')
  assert.equal(writtenPath('Read', { file_path: '/a.md' }), null)
  assert.equal(readPath('Read', { file_path: '/m/a.md' }), '/m/a.md')
  assert.equal(readPath('Read', 'x'), null)
})

test('the Claude command line keeps the prompt intact through a shell', () => {
  const prompt = "Corrige `src/a.ts` (l'index), $HOME et \"guillemets\" ; rien d'autre."
  const echoed = execFileSync('sh', ['-c', claudeCommand(prompt).replace(/^claude /, 'printf %s ')], { encoding: 'utf8' })
  assert.equal(echoed, prompt)
})
