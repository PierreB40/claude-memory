// Every word the plugin shows or sends, in English and French. The panel reads Orca's language
// (`env.locale`) and passes it to the worker; the CLI reads the system's. Anything but French is
// English. The manifest's titles cannot be translated by Orca, so they are in English.
import type { IndexProblem, Memory, MemoryType, Problem } from './audit.ts'

export type Lang = 'en' | 'fr'

export const langOf = (locale: string | null | undefined): Lang => (locale?.toLowerCase().startsWith('fr') ? 'fr' : 'en')

/** The language the operating system speaks, when Orca has not said yet. */
export const systemLang = (): Lang => langOf(Intl.DateTimeFormat().resolvedOptions().locale)

const count = (n: number, one: string, many: string): string => `${n} ${n > 1 ? many : one}`

export interface Words {
  lang: Lang
  type: Record<MemoryType, { one: string; many: string }>
  ago(ms: number): string
  /** « 12 nov. », « Nov 12 ». */
  day(ms: number): string
  quote(text: string): string
  problemShort(p: Problem): string
  problemDetail(p: Problem): string
  index(p: IndexProblem): string
  /** « 10/11 fichiers introuvables ». */
  missingShare(missing: number, cited: number): string
  notFound: string
  // The panel.
  loading: string
  readFailed: string
  readFailedBody(error: string): string
  noWorkspace: { title: string; description: string }
  ambiguous(workspace: string): { title: string; description: string }
  /** The look-alikes to pick from, and a pick that no longer applies. */
  whichOne(workspace: string): { title: string; description: string }
  pickGone: string
  nothingLearned(workspace: string): { title: string; description: string }
  remote(workspace: string): { title: string; description: string }
  summary(memories: number, branch: string | null): string
  verify: string
  verifyStarting: string
  verifyTooltip: string
  verifyStarted(workspace: string): string
  reload: string
  reloadTooltip: string
  atMergeBadge(n: number): string
  view: string
  tabVerify: string
  tabRecent: string
  tabAll: string
  search: string
  searchPlaceholder: string
  typeLabel: string
  anyType: string
  maybeFalse: string
  toUpdateAtMerge(base: string | null): string
  branchRemoves(n: number): string
  newSinceVisit: string
  earlierThisWeek: string
  edited(ms: number): string
  noMatch: { title: string; description: string }
  nothingToVerify: { title: string; checked: string; unchecked: string }
  nothingRecent(days: number): string
  noMemory: string
  indexSection: string
  back: string
  toCheck: string
  notInCode: string
  defects: string
  removedByBranch: string
  readingMemory: string
  linksTo: string
  linkedFrom: string
  file: string
  name: string
  inIndex: string
  yes: string
  notIndexed: string
  readByClaude: string
  reads(count: number, last: number, since: number): string
  citedPaths: string
  cited(cited: number, missing: number): string
  none: string
  // The worker.
  statusTooltip(label: string, toVerify: number, fresh: number): string
  learned: string
  learnedToReview: string
  writeVerdict(title: string, defects: { missing: number; dead: number }): string
  noMemoryHere: string
  nothingToDo: string
  terminalTitle: string
  commandStarted(workspace: string, n: number): string
  prompt(dir: string, memories: readonly Memory[], index: readonly IndexProblem[]): string
  // The CLI.
  cliSummary(memories: number, lines: number, branch: string | null | undefined): string
  cliToVerify(n: number): string
  cliMissing(missing: string[], cited: number): string
  cliAtMerge(files: string[]): string
}

/** At most this many memories go in the request: a terminal line has its limits. */
const PROMPT_MAX = 40

function relative(locale: string): (ms: number) => string {
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
  return (ms) => {
    const minutes = Math.round((ms - Date.now()) / 60_000)
    if (minutes > -60) return rtf.format(minutes, 'minute')
    const hours = Math.round(minutes / 60)
    if (hours > -24) return rtf.format(hours, 'hour')
    return rtf.format(Math.round(hours / 24), 'day')
  }
}

const shortDay = (locale: string) => (ms: number) => new Date(ms).toLocaleDateString(locale, { day: 'numeric', month: 'short' })

const fr: Words = {
  lang: 'fr',
  type: {
    feedback: { one: 'Règle de travail', many: 'Règles de travail' },
    project: { one: 'Projet', many: 'Projet' },
    reference: { one: 'Référence', many: 'Références' },
    user: { one: 'Profil', many: 'Profil' },
    unknown: { one: 'Sans type', many: 'Sans type' }
  },
  ago: relative('fr'),
  day: shortDay('fr-FR'),
  quote: (t) => `« ${t} »`,
  problemShort: (p) => ({ 'dead-link': 'lien cassé', unindexed: 'hors index', 'duplicate-name': 'nom en double', 'no-header': 'sans en-tête' })[p.kind],
  problemDetail: (p) => {
    switch (p.kind) {
      case 'dead-link':
        return `Le lien [[${p.link}]] ne mène à aucune mémoire.`
      case 'unindexed':
        return 'Absente de MEMORY.md : Claude ne la voit pas.'
      case 'duplicate-name':
        return `Même nom que ${p.twins.join(', ')}.`
      case 'no-header':
        return 'Pas d’en-tête complet (name, description, type) : Claude la retrouve mal.'
    }
  },
  index: (p) => (p.kind === 'dangling' ? `MEMORY.md renvoie vers ${p.file}, qui n’existe plus.` : `MEMORY.md fait ${p.lines} lignes : Claude n’en lit que ${p.max}.`),
  missingShare: (missing, cited) => `${missing}/${cited} fichier${cited > 1 ? 's' : ''} introuvable${missing > 1 ? 's' : ''}`,
  notFound: 'introuvable',
  loading: 'Lecture de la mémoire de Claude',
  readFailed: 'Lecture impossible',
  readFailedBody: (e) => `_Lecture impossible : ${e}_`,
  noWorkspace: { title: 'Aucun workspace ouvert', description: 'La mémoire suit le workspace au premier plan.' },
  ambiguous: (w) => ({ title: `Workspace « ${w} » ambigu`, description: 'Plusieurs workspaces portent ce nom sur la même branche, et Orca ne dit pas lequel est au premier plan.' }),
  whichOne: (w) => ({ title: `Quel « ${w} » ?`, description: 'Plusieurs workspaces portent ce nom. Choisis le bon, le panneau s’en souviendra.' }),
  pickGone: 'Ce workspace n’est plus au premier plan.',
  nothingLearned: (w) => ({ title: `Claude n’a rien retenu sur « ${w} »`, description: 'Ses mémoires apparaîtront ici dès qu’il en écrira une.' }),
  remote: (w) => ({ title: `« ${w} » est sur un autre hôte`, description: 'En SSH, le code et la mémoire de Claude restent sur cette machine : le plugin ne les lit pas encore.' }),
  summary: (n, branch) => `${count(n, 'mémoire', 'mémoires')} · ${branch ?? 'code non vérifié'}`,
  verify: 'Vérifier',
  verifyStarting: 'Lancement…',
  verifyTooltip: 'Un nouveau Claude vérifie ces mémoires dans le code, corrige ce qui reste utile et te propose les suppressions',
  verifyStarted: (w) => `Claude vérifie dans un nouveau terminal de « ${w} ».`,
  reload: 'Relire',
  reloadTooltip: 'Relire la mémoire et le code',
  atMergeBadge: (n) => `${count(n, 'mémoire', 'mémoires')} à mettre à jour à la fusion`,
  view: 'Vue',
  tabVerify: 'À vérifier',
  tabRecent: 'Récentes',
  tabAll: 'Toutes',
  search: 'Rechercher',
  searchPlaceholder: 'Rechercher dans les mémoires…',
  typeLabel: 'Type',
  anyType: 'Tous les types',
  maybeFalse: 'Peut-être plus vraies',
  toUpdateAtMerge: (base) => (base ? `À mettre à jour quand ta branche rejoindra ${base}` : 'À mettre à jour à la fusion'),
  branchRemoves: (n) => `Ta branche retire ${count(n, 'fichier cité', 'fichiers cités')}`,
  newSinceVisit: 'Nouvelles depuis ta dernière visite',
  earlierThisWeek: 'Plus tôt cette semaine',
  edited: (ms) => `Modifiée ${fr.ago(ms)}`,
  noMatch: { title: 'Aucune mémoire ne correspond', description: 'Modifie la recherche ou le type.' },
  nothingToVerify: {
    title: 'Rien à vérifier',
    checked: 'Chaque fichier cité existe, chaque lien mène quelque part.',
    unchecked: 'Chaque lien mène quelque part. Code non vérifié : ce workspace n’est pas un dépôt git.'
  },
  nothingRecent: (days) => `Rien appris ces ${days} derniers jours`,
  noMemory: 'Aucune mémoire',
  indexSection: 'Index',
  back: '← Mémoires',
  toCheck: 'À vérifier',
  notInCode: 'Introuvable dans le code',
  defects: 'Défauts',
  removedByBranch: 'Retiré par ta branche, encore là ailleurs',
  readingMemory: 'Lecture de la mémoire',
  linksTo: 'Renvoie à',
  linkedFrom: 'Citée par',
  file: 'Fichier',
  name: 'Nom',
  inIndex: 'Dans l’index',
  yes: 'Oui',
  notIndexed: 'Non — Claude ne la voit pas',
  readByClaude: 'Relue par Claude',
  reads: (n, last, since) => (n ? `${n} fois, la dernière ${fr.ago(last)}` : `Jamais depuis le ${fr.day(since)}`),
  citedPaths: 'Chemins cités',
  cited: (n, missing) => (missing ? `${n}, dont ${missing} introuvable${missing > 1 ? 's' : ''}` : `${n}`),
  none: 'Aucun',
  statusTooltip: (label, n, fresh) =>
    `Mémoire de Claude (${label}) : ${n ? `${n} à vérifier.` : 'saine.'}${fresh ? ` ${count(fresh, 'nouvelle', 'nouvelles')} depuis ta dernière visite.` : ''} Cliquer : afficher ou masquer la barre latérale.`,
  learned: 'Claude a retenu quelque chose',
  learnedToReview: 'Claude a retenu quelque chose, à revoir',
  writeVerdict: (title, { missing, dead }) => {
    const parts: string[] = []
    if (missing) parts.push(`cite ${missing > 1 ? `${missing} fichiers introuvables` : 'un fichier introuvable'}`)
    if (dead) parts.push(dead > 1 ? `${dead} liens vers rien` : 'un lien vers rien')
    return `${title} : ${parts.join(', ')}.`
  },
  noMemoryHere: 'Ce workspace n’a aucune mémoire Claude.',
  nothingToDo: 'Rien à vérifier.',
  terminalTitle: 'Claude · mémoire',
  commandStarted: (w, n) => `Claude lancé dans « ${w} » avec ${count(n, 'élément', 'éléments')} à vérifier.`,
  prompt: (dir, memories, index) => {
    const items = memories.slice(0, PROMPT_MAX).map((m) => {
      const why = [...m.problems.map(fr.problemDetail), ...(m.missingPaths.length ? [`cite ${m.missingPaths.map((p) => `\`${p}\``).join(', ')}, introuvable(s) dans le code`] : [])]
      return `${m.file} (${why.join(' ; ')})`
    })
    const more = memories.length > PROMPT_MAX ? ` (et ${memories.length - PROMPT_MAX} autres : traite d’abord celles-ci)` : ''
    return [
      `Revois ta mémoire automatique de ce projet (${dir}).`,
      ...(items.length ? [`Ces mémoires sont peut-être fausses ou mal reliées${more} : ${items.join(' · ')}.`] : []),
      ...(index.length ? [`Index : ${index.map(fr.index).join(' ; ')}`] : []),
      'Pour chacune, vérifie dans le code actuel : corrige-la si elle reste utile (chemins, liens, ligne dans MEMORY.md), et propose-moi la liste de celles à supprimer plutôt que de les supprimer toi-même.'
    ].join(' ')
  },
  cliSummary: (n, lines, branch) => `${count(n, 'mémoire', 'mémoires')} · MEMORY.md ${lines} lignes · ${branch !== undefined ? `code vérifié sur ${branch ?? '?'}` : 'code non vérifié (passer le dépôt)'}`,
  cliToVerify: (n) => `${n} à vérifier`,
  cliMissing: (missing, cited) => `${missing.length}/${cited} introuvable(s) : ${missing.join(', ')}`,
  cliAtMerge: (files) => `${files.length} à mettre à jour à la fusion : ${files.join(', ')}`
}

const en: Words = {
  lang: 'en',
  type: {
    feedback: { one: 'Rule of work', many: 'Rules of work' },
    project: { one: 'Project', many: 'Project' },
    reference: { one: 'Reference', many: 'References' },
    user: { one: 'Profile', many: 'Profile' },
    unknown: { one: 'No type', many: 'No type' }
  },
  ago: relative('en'),
  day: shortDay('en-US'),
  quote: (t) => `“${t}”`,
  problemShort: (p) => ({ 'dead-link': 'broken link', unindexed: 'not in the index', 'duplicate-name': 'duplicate name', 'no-header': 'no header' })[p.kind],
  problemDetail: (p) => {
    switch (p.kind) {
      case 'dead-link':
        return `The link [[${p.link}]] leads to no memory.`
      case 'unindexed':
        return 'Missing from MEMORY.md: Claude does not see it.'
      case 'duplicate-name':
        return `Same name as ${p.twins.join(', ')}.`
      case 'no-header':
        return 'No complete header (name, description, type): Claude finds it poorly.'
    }
  },
  index: (p) => (p.kind === 'dangling' ? `MEMORY.md points to ${p.file}, which no longer exists.` : `MEMORY.md has ${p.lines} lines: Claude reads only the first ${p.max}.`),
  missingShare: (missing, cited) => `${missing}/${cited} file${cited > 1 ? 's' : ''} not found`,
  notFound: 'not found',
  loading: 'Reading Claude’s memory',
  readFailed: 'Could not read',
  readFailedBody: (e) => `_Could not read: ${e}_`,
  noWorkspace: { title: 'No workspace open', description: 'The memory follows the focused workspace.' },
  ambiguous: (w) => ({ title: `Workspace “${w}” is ambiguous`, description: 'Several workspaces have this name on the same branch, and Orca does not say which one is focused.' }),
  whichOne: (w) => ({ title: `Which “${w}”?`, description: 'Several workspaces have this name. Pick the right one: the panel will remember.' }),
  pickGone: 'That workspace is no longer in front.',
  nothingLearned: (w) => ({ title: `Claude remembers nothing about “${w}”`, description: 'Its memories will show here as soon as it writes one.' }),
  remote: (w) => ({ title: `“${w}” is on another host`, description: 'Over SSH, the code and Claude’s memory stay on that machine: the plugin does not read them yet.' }),
  summary: (n, branch) => `${count(n, 'memory', 'memories')} · ${branch ?? 'code not checked'}`,
  verify: 'Verify',
  verifyStarting: 'Starting…',
  verifyTooltip: 'A new Claude checks these memories against the code, fixes what is still useful and proposes deletions to you',
  verifyStarted: (w) => `Claude is verifying in a new terminal of “${w}”.`,
  reload: 'Reload',
  reloadTooltip: 'Reread the memory and the code',
  atMergeBadge: (n) => `${count(n, 'memory', 'memories')} to update at merge`,
  view: 'View',
  tabVerify: 'To verify',
  tabRecent: 'Recent',
  tabAll: 'All',
  search: 'Search',
  searchPlaceholder: 'Search the memories…',
  typeLabel: 'Type',
  anyType: 'All types',
  maybeFalse: 'Maybe no longer true',
  toUpdateAtMerge: (base) => (base ? `To update when your branch merges into ${base}` : 'To update at merge'),
  branchRemoves: (n) => `Your branch removes ${count(n, 'cited file', 'cited files')}`,
  newSinceVisit: 'New since your last visit',
  earlierThisWeek: 'Earlier this week',
  edited: (ms) => `Edited ${en.ago(ms)}`,
  noMatch: { title: 'No memory matches', description: 'Change the search or the type.' },
  nothingToVerify: {
    title: 'Nothing to verify',
    checked: 'Every cited file exists, every link leads somewhere.',
    unchecked: 'Every link leads somewhere. Code not checked: this workspace is not a git repository.'
  },
  nothingRecent: (days) => `Nothing learned in the last ${days} days`,
  noMemory: 'No memory',
  indexSection: 'Index',
  back: '← Memories',
  toCheck: 'To verify',
  notInCode: 'Not found in the code',
  defects: 'Defects',
  removedByBranch: 'Removed by your branch, still there elsewhere',
  readingMemory: 'Reading the memory',
  linksTo: 'Links to',
  linkedFrom: 'Linked from',
  file: 'File',
  name: 'Name',
  inIndex: 'In the index',
  yes: 'Yes',
  notIndexed: 'No — Claude does not see it',
  readByClaude: 'Read by Claude',
  reads: (n, last, since) => (n ? `${count(n, 'time', 'times')}, last ${en.ago(last)}` : `Never since ${en.day(since)}`),
  citedPaths: 'Cited paths',
  cited: (n, missing) => (missing ? `${n}, ${missing} not found` : `${n}`),
  none: 'None',
  statusTooltip: (label, n, fresh) =>
    `Claude’s memory (${label}): ${n ? `${n} to verify.` : 'sound.'}${fresh ? ` ${fresh} new since your last visit.` : ''} Click: show or hide the sidebar.`,
  learned: 'Claude remembered something',
  learnedToReview: 'Claude remembered something, to review',
  writeVerdict: (title, { missing, dead }) => {
    const parts: string[] = []
    if (missing) parts.push(`cites ${missing > 1 ? `${missing} missing files` : 'a missing file'}`)
    if (dead) parts.push(dead > 1 ? `${dead} links to nothing` : 'a link to nothing')
    return `${title}: ${parts.join(', ')}.`
  },
  noMemoryHere: 'This workspace has no Claude memory.',
  nothingToDo: 'Nothing to verify.',
  terminalTitle: 'Claude · memory',
  commandStarted: (w, n) => `Claude started in “${w}” with ${count(n, 'item', 'items')} to verify.`,
  prompt: (dir, memories, index) => {
    const items = memories.slice(0, PROMPT_MAX).map((m) => {
      const why = [...m.problems.map(en.problemDetail), ...(m.missingPaths.length ? [`cites ${m.missingPaths.map((p) => `\`${p}\``).join(', ')}, not found in the code`] : [])]
      return `${m.file} (${why.join('; ')})`
    })
    const more = memories.length > PROMPT_MAX ? ` (and ${memories.length - PROMPT_MAX} more: handle these first)` : ''
    return [
      `Review your auto memory for this project (${dir}).`,
      ...(items.length ? [`These memories may be wrong or badly linked${more}: ${items.join(' · ')}.`] : []),
      ...(index.length ? [`Index: ${index.map(en.index).join('; ')}`] : []),
      'For each one, check against the current code: fix it if it is still useful (paths, links, its line in MEMORY.md), and give me the list of those to delete rather than deleting them yourself.'
    ].join(' ')
  },
  cliSummary: (n, lines, branch) => `${count(n, 'memory', 'memories')} · MEMORY.md ${lines} lines · ${branch !== undefined ? `code checked on ${branch ?? '?'}` : 'code not checked (pass the repository)'}`,
  cliToVerify: (n) => `${n} to verify`,
  cliMissing: (missing, cited) => `${missing.length}/${cited} not found: ${missing.join(', ')}`,
  cliAtMerge: (files) => `${files.length} to update at merge: ${files.join(', ')}`
}

export const words = (lang: Lang): Words => (lang === 'fr' ? fr : en)
