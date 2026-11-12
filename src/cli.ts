// `node src/cli.ts [slug] [--all]` — the same audit as the panel, in a terminal.
// Without a slug: lists the projects that have memories. `--all` also prints the memories to reread.
import { audit, DEFAULT_OPTIONS } from './audit.ts'
import { listProjects, readMemoryFolder } from './store.ts'

const args = process.argv.slice(2)
const slug = args.find((a) => !a.startsWith('--'))
const all = args.includes('--all')
const out = (s = ''): boolean => process.stdout.write(`${s}\n`)
const ICON = { danger: '✖', warning: '⚠', info: '·' } as const

if (!slug) {
  for (const p of await listProjects()) out(`${String(p.count).padStart(4)}  ${p.slug}`)
} else {
  const result = audit(await readMemoryFolder(slug), { ...DEFAULT_OPTIONS, now: Date.now() })
  const problems = result.issues.filter((i) => i.severity !== 'info')
  const reread = result.issues.filter((i) => i.severity === 'info')
  out(`${result.memories.length} mémoires · MEMORY.md ${result.index.lines} lignes, ${(result.index.bytes / 1024).toFixed(1)} Ko`)
  out(`${problems.length} problème(s) · ${reread.length} à relire${all ? '' : ' (--all pour la liste)'}`)
  out()
  for (const i of all ? result.issues : problems) out(`${ICON[i.severity]} ${i.kind.padEnd(16)} ${i.file ?? ''}  ${i.message}`)
  if (problems.some((i) => i.severity === 'danger')) process.exitCode = 1
}
