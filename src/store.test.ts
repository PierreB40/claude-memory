// The git side, against real throwaway repositories: what a branch removed since it left the
// default branch, and what the default branch gained since (which the branch must not be blamed for).
import { assert, test } from 'orca/testing'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { audit, DEFAULT_OPTIONS, toVerify, atMerge } from './audit.ts'
import { presentOnDisk, readCheckout } from './store.ts'

async function repo(): Promise<{ dir: string; git: (...args: string[]) => string }> {
  const dir = await mkdtemp(join(tmpdir(), 'claude-memory-'))
  const git = (...args: string[]): string => execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd: dir, encoding: 'utf8' })
  git('init', '-q', '-b', 'main')
  await mkdir(join(dir, 'src'), { recursive: true })
  for (const f of ['keep', 'gone', 'moved']) await writeFile(join(dir, `src/${f}.ts`), f)
  await writeFile(join(dir, '.gitignore'), '.env\n')
  git('add', '.')
  git('commit', '-q', '-m', 'init')
  return { dir, git }
}

test('a branch: what it removed since it left main, and what main gained since', async () => {
  const { dir, git } = await repo()
  try {
    git('checkout', '-q', '-b', 'feat/retrait')
    git('rm', '-q', 'src/gone.ts')
    git('mv', 'src/moved.ts', 'src/renamed.ts')
    git('commit', '-q', '-m', 'retrait')
    // main moves on after the branch left: a file the branch never had.
    git('checkout', '-q', 'main')
    await writeFile(join(dir, 'src/later.ts'), 'x')
    git('add', '.')
    git('commit', '-q', '-m', 'later')
    git('checkout', '-q', 'feat/retrait')
    await writeFile(join(dir, 'src/new.ts'), 'x')

    const facts = await readCheckout(dir)
    assert.equal(facts?.branch, 'feat/retrait')
    assert.equal(facts?.base, 'main')
    assert.deepEqual(facts?.files.sort(), ['.gitignore', 'src/keep.ts', 'src/new.ts', 'src/renamed.ts'])
    assert.deepEqual(facts?.removed.sort(), ['src/gone.ts', 'src/moved.ts'])

    const memory = { file: 'm.md', content: '---\nname: m\n---\n`src/gone.ts` `src/moved.ts` `src/later.ts` `src/never.ts`', mtimeMs: 0 }
    const repoFacts = { files: [...(facts?.files ?? []), ...(facts?.baseFiles ?? [])], removedByBranch: facts?.removed ?? [] }
    const r = audit([memory], { ...DEFAULT_OPTIONS, repo: repoFacts })
    assert.deepEqual(toVerify(r)[0]?.missingPaths, ['src/never.ts'], 'later.ts is on main: true there, not missing')
    assert.deepEqual(atMerge(r)[0]?.removedByBranch.sort(), ['src/gone.ts', 'src/moved.ts'])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('on the default branch itself: nothing to compare, working tree deletions only', async () => {
  const { dir } = await repo()
  try {
    await rm(join(dir, 'src/gone.ts'))
    const facts = await readCheckout(dir)
    assert.equal(facts?.base, null)
    assert.deepEqual(facts?.removed, ['src/gone.ts'])
    assert.ok(!facts?.files.includes('src/gone.ts'))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('a detached HEAD is named with its commit', async () => {
  const { dir, git } = await repo()
  try {
    git('checkout', '-q', '--detach')
    const sha = git('rev-parse', '--short', 'HEAD').trim()
    assert.equal((await readCheckout(dir))?.branch, `HEAD détachée @ ${sha}`)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('a file git ignores but that is there is found on disk', async () => {
  const { dir } = await repo()
  try {
    await writeFile(join(dir, '.env'), 'X=1')
    assert.deepEqual(await presentOnDisk(dir, ['.env', 'nope.ts']), ['.env'])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('a folder outside git is no checkout', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'claude-memory-'))
  try {
    assert.equal(await readCheckout(dir), null)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
