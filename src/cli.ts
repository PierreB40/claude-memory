// `node src/cli.ts [slug] [checkout]` — the audit in a terminal, without Orca.
// Without a slug: lists the projects that have memories. With a checkout, cited paths are checked
// on its branch and compared with the default branch, as the panel does.
import { atMerge, audit, citedPaths, DEFAULT_OPTIONS, toVerify, verifyCount } from './audit.ts'
import { langOf, systemLang, words } from './i18n.ts'
import { listProjects, presentOnDisk, readCheckout, readMemoryFolder } from './store.ts'

const [slug, checkout] = process.argv.slice(2)
const out = (s = ''): boolean => process.stdout.write(`${s}\n`)
const env = process.env.LC_ALL || process.env.LC_MESSAGES || process.env.LANG
const w = words(env && env !== 'C' && env !== 'POSIX' ? langOf(env) : systemLang())

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
  out(w.cliSummary(result.memories.length, result.index.lines, facts ? facts.branch : undefined))
  out(w.cliToVerify(verifyCount(result)))
  for (const problem of result.indexProblems) out(`  ✖ ${w.index(problem)}`)
  for (const m of items) {
    out(`  • ${m.file}`)
    if (m.missingPaths.length) out(`      ${w.cliMissing(m.missingPaths, m.cited)}`)
    for (const p of m.problems) out(`      ${w.problemDetail(p)}`)
  }
  const merge = atMerge(result)
  if (merge.length) out(w.cliAtMerge(merge.map((m) => m.file)))
  if (items.length || result.indexProblems.length) process.exitCode = 1
}
