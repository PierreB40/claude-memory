// `node src/cli.ts [slug] [checkout]` — the audit in a terminal, without Orca.
// Without a slug: lists the projects that have memories. With a checkout, cited paths are checked
// on its branch and compared with the default branch, as the panel does.
import { atMerge, audit, citedPaths, DEFAULT_OPTIONS, toVerify } from './audit.ts'
import { listProjects, presentOnDisk, readCheckout, readMemoryFolder } from './store.ts'

const [slug, checkout] = process.argv.slice(2)
const out = (s = ''): boolean => process.stdout.write(`${s}\n`)

if (!slug) {
  for (const p of await listProjects()) out(`${String(p.count).padStart(4)}  ${p.slug}`)
} else {
  const files = await readMemoryFolder(slug)
  const facts = checkout ? await readCheckout(checkout) : null
  let repo = null
  if (facts && checkout) {
    const all = new Set([...facts.files, ...facts.baseFiles])
    const unknown = [...new Set(files.flatMap((f) => citedPaths(f.content)))].filter((p) => !all.has(p))
    for (const p of await presentOnDisk(checkout, unknown)) all.add(p)
    repo = { files: [...all], removedByBranch: facts.removed }
  }
  const result = audit(files, { ...DEFAULT_OPTIONS, repo })
  const items = toVerify(result)
  out(`${result.memories.length} mémoire${result.memories.length > 1 ? 's' : ''} · MEMORY.md ${result.index.lines} lignes · ${facts ? `code vérifié sur ${facts.branch ?? '?'}` : 'code non vérifié (passer le dépôt)'}`)
  out(`${items.length + result.indexProblems.length} à vérifier`)
  for (const text of result.indexProblems) out(`  ✖ ${text}`)
  for (const m of items) {
    out(`  • ${m.file}`)
    if (m.missingPaths.length) out(`      ${m.missingPaths.length}/${m.cited} introuvable(s) : ${m.missingPaths.join(', ')}`)
    for (const p of m.problems) out(`      ${p.detail}`)
  }
  const merge = atMerge(result)
  if (merge.length) out(`${merge.length} à mettre à jour à la fusion : ${merge.map((m) => m.file).join(', ')}`)
  if (items.length || result.indexProblems.length) process.exitCode = 1
}
