// The git side, against a real throwaway repository: what is true on a branch, and its base.
import { assert, test } from 'orca/testing'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { audit, DEFAULT_OPTIONS } from './audit.ts'
import { baseRef, currentBranch, filesAt, trackedFiles } from './store.ts'

async function repo(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'claude-memory-'))
  const git = (...args: string[]): string => execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd: dir, encoding: 'utf8' })
  git('init', '-q', '-b', 'main')
  await mkdir(join(dir, 'src'), { recursive: true })
  await writeFile(join(dir, 'src/keep.ts'), 'x')
  await writeFile(join(dir, 'src/gone.ts'), 'x')
  git('add', '.')
  git('commit', '-q', '-m', 'init')
  git('checkout', '-q', '-b', 'feat/retrait')
  git('rm', '-q', 'src/gone.ts')
  await writeFile(join(dir, 'src/new.ts'), 'x')
  return dir
}

test('a branch is read as it is now, and compared with its base', async () => {
  const dir = await repo()
  try {
    const files = await trackedFiles(dir)
    assert.deepEqual(files?.sort(), ['src/keep.ts', 'src/new.ts'])
    assert.equal(await currentBranch(dir), 'feat/retrait')
    const base = await baseRef(dir)
    assert.equal(base, 'main')
    assert.deepEqual((await filesAt(dir, 'main'))?.sort(), ['src/gone.ts', 'src/keep.ts'])

    const memory = { file: 'm.md', content: '---\nname: m\n---\nVoir `src/gone.ts` et `src/old.ts`.', mtimeMs: 0 }
    const [m] = audit([memory], { ...DEFAULT_OPTIONS, repoFiles: files, baseFiles: await filesAt(dir, 'main') }).memories
    assert.deepEqual(m?.missingPaths, ['src/gone.ts', 'src/old.ts'])
    assert.deepEqual(m?.brokenHere, ['src/gone.ts'])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('a folder outside git is no checkout', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'claude-memory-'))
  try {
    assert.equal(await trackedFiles(dir), null)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
