// `orca plugin check` renders the panel once per scenario, with the real worker on a stand-in
// host: the fixtures folders, and a focused workspace whose path Claude Code names after them.
// The `showcase` scenarios (the README and the listing images) run on a real throwaway git
// repository, so cited paths are really checked: a file moved away, a file the branch removes.
import { defineCheck } from 'orca/testing'
import { execFileSync } from 'node:child_process'
import { mkdir, readdir, readFile, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { slugOf } from './detect.ts'

const root = new URL('../fixtures/projects', import.meta.url).pathname
const ws = (name: string, path = `/demo/${name}`) => ({ id: `w-${name}`, kind: 'worktree', name, path, branch: 'refs/heads/main', hostId: null })
const focus = (name: string | null, settings: Record<string, string> = { projectsRoot: root }, list = ['broken', 'ok', 'other', 'shop'].map((n) => ws(n)), branch = 'main') => ({
  settings,
  results: {
    'workspace.readContext': name ? { branch, displayName: name, terminals: [] } : null,
    'workspace.list': { workspaces: list, truncated: false },
    'statusBar.update': { ok: true }
  }
})

/** A small shop on a branch: the Stripe webhook moved since the memory, the branch drops the cart. */
async function showcase() {
  const base = join(tmpdir(), 'claude-memory-showcase')
  const repo = join(base, 'shop')
  const projects = join(base, 'projects')
  await rm(base, { recursive: true, force: true })
  const git = (...args: string[]): string => execFileSync('git', ['-c', 'user.email=demo@example.com', '-c', 'user.name=demo', ...args], { cwd: repo, encoding: 'utf8' })
  for (const f of ['apps/web/nuxt.config.ts', 'apps/web/pages/cart.vue', 'apps/web/pages/checkout.vue', 'apps/api/src/index.ts', 'apps/api/src/payments/stripe.ts', 'packages/db/schema.ts']) {
    await mkdir(join(repo, f, '..'), { recursive: true })
    await writeFile(join(repo, f), '')
  }
  git('init', '-q', '-b', 'main')
  git('add', '.')
  git('commit', '-q', '-m', 'shop')
  git('checkout', '-q', '-b', 'feat/one-page-checkout')
  git('rm', '-q', 'apps/web/pages/cart.vue')
  git('commit', '-q', '-m', 'checkout replaces the cart')

  // The memory, as Claude Code files it for that checkout, written over the last days.
  const memory = join(projects, slugOf(repo), 'memory')
  await mkdir(memory, { recursive: true })
  const source = join(root, '-demo-shop', 'memory')
  const days = ['profile.md', 'stack.md', 'prices-in-cents.md', 'stripe-payments.md', 'deployment.md', 'cart.md', 'test-before-commit.md']
  for (const f of await readdir(source)) {
    await writeFile(join(memory, f), await readFile(join(source, f), 'utf8'))
    const age = days.indexOf(f)
    const when = (Date.now() - (age === -1 ? 1 : age === days.length - 1 ? 0.05 : days.length - age) * 86_400_000) / 1000
    await utimes(join(memory, f), when, when)
  }
  return { repo, projects, slug: slugOf(repo) }
}

const shop = await showcase()
const showcased = (tab: string | null) => ({
  ...focus('shop', { projectsRoot: shop.projects }, [ws('shop', shop.repo)], 'feat/one-page-checkout'),
  storage: { [`unseen:${shop.slug}`]: ['test-before-commit.md'] },
  ...(tab ? { persisted: { plugin: { tab } } } : {})
})

export default defineCheck({
  toVerify: focus('broken'),
  sound: focus('ok'),
  noMemory: focus('other'),
  noWorkspace: focus(null),
  showcase: showcased(null),
  showcaseRecent: showcased('recent'),
  showcaseAll: showcased('all')
})
