// `node src/cli.ts [slug] [repo]` — the audit in a terminal, without Orca.
// Without a slug: lists the projects that have memories. With `repo`, cited paths are checked.
import { audit, DEFAULT_OPTIONS, toVerify } from './audit.ts'
import { listProjects, readMemoryFolder, trackedFiles } from './store.ts'

const [slug, repo] = process.argv.slice(2)
const out = (s = ''): boolean => process.stdout.write(`${s}\n`)

if (!slug) {
  for (const p of await listProjects()) out(`${String(p.count).padStart(4)}  ${p.slug}`)
} else {
  const repoFiles = repo ? await trackedFiles(repo) : null
  const result = audit(await readMemoryFolder(slug), { ...DEFAULT_OPTIONS, repoFiles })
  const items = toVerify(result)
  out(`${result.memories.length} mémoires · MEMORY.md ${result.index.lines} lignes · ${repoFiles ? 'code vérifié' : 'code non vérifié (passer le dépôt)'}`)
  out(`${items.length + result.indexProblems.length} à vérifier`)
  for (const text of result.indexProblems) out(`  ✖ ${text}`)
  for (const m of items) {
    out(`  • ${m.file}`)
    if (m.missingPaths.length) out(`      ${m.missingPaths.length}/${m.cited} introuvable(s) : ${m.missingPaths.join(', ')}`)
    for (const p of m.problems) out(`      ${p.detail}`)
  }
  if (items.length || result.indexProblems.length) process.exitCode = 1
}
