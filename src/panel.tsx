// What Claude Code believes about the focused workspace's project, and what no longer holds.
// Like Orca's own sidebar tabs it follows the focused workspace. A fixed header (project, actions,
// tabs, search, sort and filter) over one scrolling list; a memory opens in place, with what it
// points to and what points to it. No build step: Orca compiles this file when the panel loads.
import {
  atom,
  Badge,
  Box,
  Button,
  Callout,
  Code,
  EmptyState,
  IconButton,
  Input,
  List,
  ListItem,
  Markdown,
  on,
  plugin,
  read,
  Row,
  Select,
  set,
  Skeleton,
  Stack,
  Tab,
  Tabs,
  Text,
  type IconName,
  type PanelContext
} from 'orca'
import { toVerify, type Memory, type MemoryType } from './audit.ts'
import type { ProjectView, VerifyScope } from './protocol.ts'

type State = { status: 'loading' } | { status: 'failed'; error: string } | { status: 'ready'; project: ProjectView | null; workspace: string | null }
type TabId = 'verify' | 'recent' | 'all'
type Sort = 'severity' | 'recent' | 'title'

const state = atom<State>({ status: 'loading' })
/** The tab and the list settings are the person's habits: kept across runs of the plugin. */
const tab = atom<TabId | null>('tab', null, { persist: 'plugin' })
const sortBy = atom<Sort | null>('sort', null, { persist: 'plugin' })
const typeFilter = atom<MemoryType | 'any'>('type', 'any', { persist: 'plugin' })
const query = atom('')
const opened = atom<{ file: string; body: string | null } | null>(null)
const busy = atom(false)
const said = atom<{ ok: boolean; text: string } | null>(null)

const RECENT_DAYS = 7
const DAY = 86_400_000

const TYPE_LABEL: Record<MemoryType, { one: string; many: string }> = {
  feedback: { one: 'Règle de travail', many: 'Règles de travail' },
  project: { one: 'Projet', many: 'Projet' },
  reference: { one: 'Référence', many: 'Références' },
  user: { one: 'Profil', many: 'Profil' },
  unknown: { one: 'Sans type', many: 'Sans type' }
}
const TYPE_ORDER: MemoryType[] = ['feedback', 'project', 'reference', 'user', 'unknown']
const SORTS: { value: Sort; label: string }[] = [
  { value: 'severity', label: 'Les plus fausses' },
  { value: 'recent', label: 'Les plus récentes' },
  { value: 'title', label: 'Titre A → Z' }
]
const DEFAULT_SORT: Record<TabId, Sort> = { verify: 'severity', recent: 'recent', all: 'title' }
const DEFECT: Record<string, string> = {
  'Lien mort': 'lien cassé',
  'Lien à rediriger': 'lien à rediriger',
  'Hors index': 'hors index',
  'Nom en double': 'nom en double',
  'Sans en-tête': 'sans en-tête'
}

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e))
const rtf = new Intl.RelativeTimeFormat('fr', { numeric: 'auto' })
function ago(ms: number): string {
  const minutes = Math.round((ms - Date.now()) / 60_000)
  if (minutes > -60) return rtf.format(minutes, 'minute')
  const hours = Math.round(minutes / 60)
  if (hours > -24) return rtf.format(hours, 'hour')
  return rtf.format(Math.round(hours / 24), 'day')
}

/** Why a memory is to verify, in a few words: « 10/11 fichiers introuvables · lien cassé ». */
function reason(m: Memory): string {
  const parts: string[] = []
  if (m.brokenHere.length) parts.push(`ta branche retire ${m.brokenHere.length} fichier${m.brokenHere.length > 1 ? 's' : ''} cité${m.brokenHere.length > 1 ? 's' : ''}`)
  const gone = m.missingPaths.length - m.brokenHere.length
  if (gone > 0) parts.push(`${gone}/${m.cited} fichier${m.cited > 1 ? 's' : ''} introuvable${gone > 1 ? 's' : ''}`)
  for (const p of m.problems) {
    const label = DEFECT[p.short] ?? p.short.toLowerCase()
    if (!parts.includes(label)) parts.push(label)
  }
  const text = parts.join(' · ')
  return text.charAt(0).toUpperCase() + text.slice(1)
}

const iconOf = (m: Memory, fresh: boolean): IconName =>
  fresh ? 'star' : m.brokenHere.length ? 'branch' : m.missingPaths.length ? 'warning' : m.problems.length ? 'link' : 'file-text'

/** How wrong a memory is, for the « most wrong first » sort: what the branch broke weighs most. */
const severity = (m: Memory): number =>
  m.brokenHere.length * 100 + (m.cited ? (m.missingPaths.length * m.missingPaths.length) / m.cited : 0) + m.problems.length

async function load(): Promise<void> {
  try {
    set(state, { status: 'ready', ...(await plugin.request('memory.view')) })
  } catch (e) {
    set(state, { status: 'failed', error: message(e) })
  }
}

async function open(file: string): Promise<void> {
  const s = read(state)
  if (s.status !== 'ready' || !s.project) return
  set(opened, { file, body: null })
  try {
    const { body } = await plugin.request('memory.read', { slug: s.project.slug, file })
    set(opened, { file, body })
  } catch (e) {
    set(opened, { file, body: `_Lecture impossible : ${message(e)}_` })
  }
}

async function verify(scope: VerifyScope): Promise<void> {
  set(busy, true)
  set(said, null)
  try {
    const { workspace } = await plugin.request('memory.verify', { scope }, { timeoutMs: 60_000 })
    set(said, { ok: true, text: `Claude vérifie dans un nouveau terminal de « ${workspace} ».` })
  } catch (e) {
    set(said, { ok: false, text: message(e) })
  } finally {
    set(busy, false)
  }
}

/** Opening the recent tab is seeing what Claude learned: the « new » marks and the count go. */
function showTab(next: string): void {
  set(tab, next as TabId)
  const s = read(state)
  if (next === 'recent' && s.status === 'ready' && s.project?.unseen.length) void plugin.request('memory.seen', { slug: s.project.slug })
}

export function setup(ctx: PanelContext): void {
  void load()
  // Like Orca's own tabs, the panel is about the focused workspace: a new one reloads it at once.
  // Terminal opens and closes fire the same event with the same workspace: those are ignored.
  let last: string | undefined
  ctx.subscriptions.push(
    on('workspace.changed', ({ context }) => {
      const key = context ? `${context.displayName}\u0000${context.branch}` : ''
      const first = last === undefined
      if (key === last) return
      last = key
      if (first) return
      set(opened, null)
      set(said, null)
      set(query, '')
      set(state, { status: 'loading' })
      void load()
    }),
    plugin.on('memory.changed', ({ slug }) => {
      const s = read(state)
      if (s.status === 'ready' && s.project?.slug === slug) void load()
    })
  )
}

/** The memories of a tab, searched, filtered by type and sorted, as one list. */
function rows(p: ProjectView, which: TabId): Memory[] {
  const q = read(query).trim().toLowerCase()
  const type = read(typeFilter)
  const since = Date.now() - RECENT_DAYS * DAY
  const base = which === 'verify' ? toVerify(p) : which === 'recent' ? p.memories.filter((m) => m.mtimeMs >= since) : p.memories
  const sort = read(sortBy) ?? DEFAULT_SORT[which]
  return base
    .filter((m) => type === 'any' || m.type === type)
    .filter((m) => !q || `${m.title} ${m.name ?? ''} ${m.description ?? ''} ${m.file}`.toLowerCase().includes(q))
    .sort((a, b) => (sort === 'severity' ? severity(b) - severity(a) : sort === 'recent' ? b.mtimeMs - a.mtimeMs : a.title.localeCompare(b.title, 'fr')))
}

function MemoryList({ p, which, items }: { p: ProjectView; which: TabId; items: Memory[] }) {
  const fresh = new Set(p.unseen)
  const filtered = read(query).trim() !== '' || read(typeFilter) !== 'any'
  if (items.length === 0) {
    if (filtered) return <EmptyState icon="search" title="Aucune mémoire ne correspond" description="Change la recherche ou le type." />
    if (which === 'verify') return <EmptyState icon="check" title="Rien à vérifier" description="Chaque fichier cité existe, chaque lien mène quelque part." />
    if (which === 'recent') return <EmptyState icon="calendar" title={`Rien appris ces ${RECENT_DAYS} derniers jours`} />
    return <EmptyState icon="book" title="Aucune mémoire" />
  }
  return (
    <List label="Mémoires">
      {which === 'verify' && read(query).trim() === '' && read(typeFilter) === 'any'
        ? p.indexProblems.map((text) => <ListItem icon="error" title="MEMORY.md" description={text} />)
        : null}
      {items.map((m) => (
        <ListItem
          icon={iconOf(m, fresh.has(m.file))}
          title={m.title}
          description={
            which === 'verify'
              ? reason(m)
              : which === 'recent'
                ? `${fresh.has(m.file) ? 'Nouveau · ' : ''}${ago(m.mtimeMs)} · ${TYPE_LABEL[m.type].one.toLowerCase()}`
                : (m.description ?? m.file)
          }
          onPress={() => void open(m.file)}
        />
      ))}
    </List>
  )
}

function Header({ p }: { p: ProjectView }) {
  const verifyCount = toVerify(p).length + (p.indexProblems.length ? 1 : 0)
  const broken = p.memories.filter((m) => m.brokenHere.length).length
  const feedback = read(said)
  return (
    <Stack gap="xs">
      <Row justify="between" align="center">
        <Stack gap="none">
          <Text weight="semibold" truncate>
            {p.label}
          </Text>
          <Text size="xs" muted truncate>
            {`${p.memories.length} mémoires · ${p.checked?.branch ?? 'code non vérifié'}`}
          </Text>
        </Stack>
        <Row gap="none" align="center">
          {verifyCount ? (
            <Button
              variant="ghost"
              size="sm"
              icon="agent"
              disabled={read(busy)}
              tooltip={broken ? 'Un nouveau Claude met à jour les mémoires que ta branche rend fausses' : 'Un nouveau Claude vérifie ces mémoires dans le code, corrige et te propose les suppressions'}
              onPress={() => verify(broken ? 'branch' : 'all')}
            >
              {read(busy) ? 'Lancement…' : 'Vérifier'}
            </Button>
          ) : null}
          <IconButton icon="refresh" label="Relire" tooltip="Relire la mémoire et le code" variant="ghost" size="sm" onPress={load} />
        </Row>
      </Row>
      {broken ? (
        <Text size="xs">
          <Badge tone="danger">{`Ta branche rend ${broken} mémoire${broken > 1 ? 's' : ''} fausse${broken > 1 ? 's' : ''}`}</Badge>
        </Text>
      ) : null}
      {feedback ? (
        <Text size="xs" tone={feedback.ok ? 'success' : 'danger'}>
          {feedback.text}
        </Text>
      ) : null}
    </Stack>
  )
}

function Toolbar({ which }: { which: TabId }) {
  return (
    <Stack gap="xs">
      <Input label="Rechercher" labelHidden type="search" placeholder="Rechercher un titre, un sujet…" value={read(query)} onChange={(v) => set(query, v)} />
      <Row gap="xs">
        <Box grow>
          <Select label="Trier" labelHidden value={read(sortBy) ?? DEFAULT_SORT[which]} options={SORTS} onChange={(v) => set(sortBy, v as Sort)} />
        </Box>
        <Box grow>
          <Select
            label="Type"
            labelHidden
            value={read(typeFilter)}
            options={[{ value: 'any', label: 'Tous les types' }, ...TYPE_ORDER.map((t) => ({ value: t, label: TYPE_LABEL[t].many }))]}
            onChange={(v) => set(typeFilter, v as MemoryType | 'any')}
          />
        </Box>
      </Row>
    </Stack>
  )
}

function Main({ p }: { p: ProjectView }) {
  const verifyCount = toVerify(p).length + (p.indexProblems.length ? 1 : 0)
  const since = Date.now() - RECENT_DAYS * DAY
  const recentCount = p.memories.filter((m) => m.mtimeMs >= since).length
  const which: TabId = read(tab) ?? (verifyCount ? 'verify' : 'recent')
  const items = rows(p, which)
  return (
    <Box direction="column" height="100%" gap="sm">
      <Box direction="column" gap="sm" shrink={false}>
        <Header p={p} />
        <Tabs label="Vue" value={which} onChange={showTab}>
          <Tab value="verify" label={`À vérifier ${verifyCount}`} icon="warning" />
          <Tab value="recent" label={p.unseen.length ? `Récentes ${recentCount} · +${p.unseen.length}` : `Récentes ${recentCount}`} icon="calendar" />
          <Tab value="all" label={`Toutes ${p.memories.length}`} icon="book" />
        </Tabs>
        <Toolbar which={which} />
      </Box>
      <Box direction="column" grow scroll="y" minHeight={0}>
        <MemoryList p={p} which={which} items={items} />
      </Box>
    </Box>
  )
}

function Linked({ label, items }: { label: string; items: Memory[] }) {
  if (items.length === 0) return null
  return (
    <Stack gap="xs">
      <Text size="xs" muted weight="medium">
        {`${label} · ${items.length}`}
      </Text>
      <List label={label}>
        {items.map((r) => (
          <ListItem icon={iconOf(r, false)} title={r.title} description={`${TYPE_LABEL[r.type].one} · ${r.description ?? r.file}`} onPress={() => void open(r.file)} />
        ))}
      </List>
    </Stack>
  )
}

function Detail({ p, file, body }: { p: ProjectView; file: string; body: string | null }) {
  const m = p.memories.find((x) => x.file === file)
  if (!m) return null
  const byFile = new Map(p.memories.map((x) => [x.file, x]))
  const outgoing = m.related.map((f) => byFile.get(f)).filter((x): x is Memory => Boolean(x) && x?.file !== m.file)
  const incoming = p.memories.filter((x) => x.file !== m.file && x.related.includes(m.file))
  const other = m.missingPaths.filter((x) => !m.brokenHere.includes(x))
  return (
    <Box direction="column" height="100%" gap="sm">
      <Box direction="column" gap="xs" shrink={false}>
        <Row gap="xs" align="center">
          <IconButton icon="collapse" label="Retour aux mémoires" tooltip="Retour aux mémoires" variant="ghost" size="sm" onPress={() => set(opened, null)} />
          <Text weight="semibold" truncate>
            {m.title}
          </Text>
        </Row>
        <Text size="xs" muted truncate>
          {`${TYPE_LABEL[m.type].one} · modifiée ${ago(m.mtimeMs)} · ${m.file}`}
        </Text>
      </Box>
      <Box direction="column" grow scroll="y" minHeight={0} gap="md">
        {m.description ? (
          <Text size="sm" muted>
            {m.description}
          </Text>
        ) : null}
        {m.brokenHere.length || other.length || m.problems.length ? (
          <Callout tone={m.brokenHere.length ? 'danger' : 'warning'} icon={m.brokenHere.length ? 'branch' : 'warning'} title={m.brokenHere.length ? 'Ta branche la rend fausse' : 'Peut-être plus vraie'}>
            <Stack gap="xs">
              {m.brokenHere.length ? (
                <Text size="xs" weight="medium">
                  Retiré par ta branche
                </Text>
              ) : null}
              {m.brokenHere.map((x) => (
                <Text size="xs">
                  <Code>{x}</Code>
                </Text>
              ))}
              {other.length ? (
                <Text size="xs" weight="medium">
                  Introuvable dans le code
                </Text>
              ) : null}
              {other.map((x) => (
                <Text size="xs">
                  <Code>{x}</Code>
                </Text>
              ))}
              {m.problems.map((x) => (
                <Text size="xs">{x.detail}</Text>
              ))}
            </Stack>
          </Callout>
        ) : null}
        <Linked label="Elle renvoie à" items={outgoing} />
        <Linked label="Mentionnée par" items={incoming} />
        {body === null ? <Skeleton lines={8} label="Lecture de la mémoire" /> : <Markdown content={body} />}
      </Box>
    </Box>
  )
}

export default function Panel() {
  const s = read(state)
  if (s.status === 'loading') return <Skeleton lines={8} label="Lecture de la mémoire de Claude" />
  if (s.status === 'failed') {
    return (
      <Callout tone="danger" icon="error" title="Lecture impossible">
        <Text size="sm">{s.error}</Text>
      </Callout>
    )
  }
  if (!s.workspace) return <EmptyState icon="folder" title="Aucun workspace ouvert" description="La mémoire suit le workspace au premier plan." />
  if (!s.project) {
    return <EmptyState icon="book" title={`Claude n’a rien retenu sur « ${s.workspace} »`} description="Ses mémoires apparaîtront ici dès qu’il en écrira une." />
  }
  const o = read(opened)
  return o ? <Detail p={s.project} file={o.file} body={o.body} /> : <Main p={s.project} />
}
