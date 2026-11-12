// What Claude Code believes about the focused workspace's project, and what no longer holds.
// Like Orca's own sidebar tabs it follows the focused workspace. A fixed header (project, action,
// tabs, search, type) over grouped lists that scroll; a memory opens in place: its defects, its
// text, its links, then its file facts. No build step: Orca compiles this file when it loads.
import {
  atom,
  Badge,
  Box,
  Button,
  Callout,
  Code,
  EmptyState,
  Heading,
  IconButton,
  Input,
  KeyValue,
  List,
  ListItem,
  Markdown,
  on,
  plugin,
  read,
  Row,
  Select,
  Separator,
  set,
  Skeleton,
  Stack,
  Tab,
  Tabs,
  Text,
  type IconName,
  type OrcaNode,
  type PanelContext
} from 'orca'
import { readableBody, toVerify, type Memory, type MemoryType } from './audit.ts'
import type { ProjectView, VerifyScope } from './protocol.ts'

type State = { status: 'loading' } | { status: 'failed'; error: string } | { status: 'ready'; project: ProjectView | null; workspace: string | null }
type TabId = 'verify' | 'recent' | 'all'

const state = atom<State>({ status: 'loading' })
/** The tab and the type are the person's habits: kept across runs of the plugin. */
const tab = atom<TabId | null>('tab', null, { persist: 'plugin' })
const typeFilter = atom<MemoryType | 'any'>('type', 'any', { persist: 'plugin' })
/** Kept while a memory is open, so coming back finds the list as it was left. */
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
const DEFECT: Record<string, string> = {
  'Lien mort': 'lien cassé',
  'Lien à rediriger': 'lien à rediriger',
  'Hors index': 'hors index',
  'Nom en double': 'nom en double',
  'Sans en-tête': 'sans en-tête'
}

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e))
const capitalize = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1)
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
  return capitalize(parts.join(' · '))
}

/** On the list to verify only, the icon says the cause; elsewhere the section already says it. */
const causeIcon = (m: Memory): IconName => (m.brokenHere.length ? 'branch' : m.missingPaths.length ? 'warning' : 'link')

/** How wrong a memory is: what the branch broke weighs most, then the share of vanished code. */
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

/** Leaving the recent tab after seeing it is having seen what Claude learned. */
function showTab(next: string): void {
  const s = read(state)
  if (read(tab) === 'recent' && next !== 'recent' && s.status === 'ready' && s.project?.unseen.length) {
    void plugin.request('memory.seen', { slug: s.project.slug })
  }
  set(tab, next as TabId)
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

interface Group {
  key: string
  label: string
  icons: boolean
  memories: Memory[]
  subtitle: (m: Memory) => string
}

/** A tab's memories, searched and filtered, in the groups the tab reads best in. */
function groups(p: ProjectView, which: TabId): Group[] {
  const q = read(query).trim().toLowerCase()
  const type = read(typeFilter)
  const keep = (m: Memory): boolean =>
    (type === 'any' || m.type === type) && (!q || `${m.title} ${m.name ?? ''} ${m.description ?? ''} ${m.file}`.toLowerCase().includes(q))
  const age = (m: Memory): string => `${capitalize(ago(m.mtimeMs))} · ${TYPE_LABEL[m.type].one.toLowerCase()}`
  const byTitle = (a: Memory, b: Memory): number => a.title.localeCompare(b.title, 'fr')

  if (which === 'verify') {
    const all = toVerify(p).filter(keep).sort((a, b) => severity(b) - severity(a))
    return [
      { key: 'branch', label: 'Rendues fausses par ta branche', icons: true, memories: all.filter((m) => m.brokenHere.length), subtitle: reason },
      { key: 'doubt', label: 'Peut-être plus vraies', icons: true, memories: all.filter((m) => !m.brokenHere.length), subtitle: reason }
    ]
  }
  if (which === 'recent') {
    const fresh = new Set(p.unseen)
    const since = Date.now() - RECENT_DAYS * DAY
    const recent = p.memories.filter((m) => m.mtimeMs >= since && keep(m)).sort((a, b) => b.mtimeMs - a.mtimeMs)
    return [
      { key: 'new', label: 'Nouvelles depuis ta dernière visite', icons: false, memories: recent.filter((m) => fresh.has(m.file)), subtitle: age },
      { key: 'week', label: 'Plus tôt cette semaine', icons: false, memories: recent.filter((m) => !fresh.has(m.file)), subtitle: age }
    ]
  }
  return TYPE_ORDER.map((t) => ({
    key: t,
    label: TYPE_LABEL[t].many,
    icons: false,
    memories: p.memories.filter((m) => m.type === t && keep(m)).sort(byTitle),
    subtitle: (m: Memory) => m.rest || `Modifiée ${ago(m.mtimeMs)}`
  }))
}

/** A group of rows under a discreet title, as Orca titles its own sidebar sections. */
function Section({ label, children }: { label: string; children?: OrcaNode }) {
  return (
    <Stack gap="xs">
      <Heading level={3}>{label}</Heading>
      {children}
    </Stack>
  )
}

function Lists({ p, which }: { p: ProjectView; which: TabId }) {
  const visible = groups(p, which).filter((g) => g.memories.length)
  const filtered = read(query).trim() !== '' || read(typeFilter) !== 'any'
  const index = which === 'verify' && !filtered ? p.indexProblems : []
  if (visible.length === 0 && index.length === 0) {
    if (filtered) return <EmptyState icon="search" title="Aucune mémoire ne correspond" description="Modifie la recherche ou le type." />
    if (which === 'verify') return <EmptyState icon="check" title="Rien à vérifier" description="Chaque fichier cité existe, chaque lien mène quelque part." />
    if (which === 'recent') return <EmptyState icon="calendar" title={`Rien appris ces ${RECENT_DAYS} derniers jours`} />
    return <EmptyState icon="book" title="Aucune mémoire" />
  }
  return (
    <Stack gap="md">
      {index.length ? (
        <Section label="Index">
          <List label="Index">
            {index.map((text) => (
              <ListItem icon="error" title="MEMORY.md" description={text} />
            ))}
          </List>
        </Section>
      ) : null}
      {visible.map((g) => (
        <Section label={`${g.label} · ${g.memories.length}`}>
          <List label={g.label}>
            {g.memories.map((m) => (
              <ListItem icon={g.icons ? causeIcon(m) : undefined} title={m.title} description={g.subtitle(m)} onPress={() => void open(m.file)} />
            ))}
          </List>
        </Section>
      ))}
    </Stack>
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

function Main({ p }: { p: ProjectView }) {
  const verifyCount = toVerify(p).length + (p.indexProblems.length ? 1 : 0)
  const since = Date.now() - RECENT_DAYS * DAY
  const recentCount = p.memories.filter((m) => m.mtimeMs >= since).length
  const which: TabId = read(tab) ?? (verifyCount ? 'verify' : 'recent')
  return (
    <Box direction="column" height="100%">
      <Box direction="column" gap="sm" paddingY="xs" shrink={false}>
        <Header p={p} />
        <Tabs label="Vue" value={which} onChange={showTab}>
          <Tab value="verify" label={`À vérifier ${verifyCount}`} />
          <Tab value="recent" label={`Récentes ${recentCount}`} />
          <Tab value="all" label={`Toutes ${p.memories.length}`} />
        </Tabs>
        <Row gap="xs" align="center">
          <Box grow>
            <Input label="Rechercher" labelHidden type="search" placeholder="Rechercher dans les mémoires…" value={read(query)} onChange={(v) => set(query, v)} />
          </Box>
          <Box width="40%" shrink={false}>
            <Select
              label="Type"
              labelHidden
              value={read(typeFilter)}
              options={[{ value: 'any', label: 'Tous les types' }, ...TYPE_ORDER.map((t) => ({ value: t, label: TYPE_LABEL[t].many }))]}
              onChange={(v) => set(typeFilter, v as MemoryType | 'any')}
            />
          </Box>
        </Row>
        <Separator />
      </Box>
      <Box direction="column" grow scroll="y" minHeight={0} paddingY="sm">
        <Lists p={p} which={which} />
      </Box>
    </Box>
  )
}

function Paths({ label, paths }: { label: string; paths: string[] }) {
  if (paths.length === 0) return null
  return (
    <Stack gap="xs">
      <Text size="xs" weight="medium">
        {label}
      </Text>
      {paths.map((x) => (
        <Text size="xs">
          <Code>{x}</Code>
        </Text>
      ))}
    </Stack>
  )
}

function Links({ label, items }: { label: string; items: Memory[] }) {
  if (items.length === 0) return null
  return (
    <Section label={`${label} · ${items.length}`}>
      <List label={label}>
        {items.map((r) => (
          <ListItem title={r.title} description={`${TYPE_LABEL[r.type].one} · ${ago(r.mtimeMs)}`} onPress={() => void open(r.file)} />
        ))}
      </List>
    </Section>
  )
}

function Detail({ p, file, body }: { p: ProjectView; file: string; body: string | null }) {
  const m = p.memories.find((x) => x.file === file)
  if (!m) return null
  const byFile = new Map(p.memories.map((x) => [x.file, x]))
  const outgoing = m.related.map((f) => byFile.get(f)).filter((x): x is Memory => Boolean(x) && x?.file !== m.file)
  const incoming = p.memories.filter((x) => x.file !== m.file && x.related.includes(m.file))
  const gone = m.missingPaths.filter((x) => !m.brokenHere.includes(x))
  const defects = m.brokenHere.length + gone.length + m.problems.length
  return (
    <Box direction="column" height="100%">
      <Box direction="column" gap="xs" paddingY="xs" shrink={false}>
        <Row>
          <Button variant="ghost" size="sm" onPress={() => set(opened, null)}>
            ← Mémoires
          </Button>
        </Row>
        <Heading level={2}>{m.title}</Heading>
        <Text size="xs" muted>
          {`${TYPE_LABEL[m.type].one} · modifiée ${ago(m.mtimeMs)}`}
        </Text>
        <Separator />
      </Box>
      <Box direction="column" grow scroll="y" minHeight={0} gap="md" paddingY="sm">
        {defects ? (
          <Callout tone={m.brokenHere.length ? 'danger' : 'warning'} icon={m.brokenHere.length ? 'branch' : 'warning'} title={m.brokenHere.length ? 'Ta branche la rend fausse' : 'À vérifier'}>
            <Stack gap="sm">
              <Paths label="Retiré par ta branche" paths={m.brokenHere} />
              <Paths label="Introuvable dans le code" paths={gone} />
              {m.problems.length ? (
                <Stack gap="xs">
                  <Text size="xs" weight="medium">
                    Liens
                  </Text>
                  {m.problems.map((x) => (
                    <Text size="xs">{readableBody(x.detail, p.memories).replace(/\*/g, '')}</Text>
                  ))}
                </Stack>
              ) : null}
            </Stack>
          </Callout>
        ) : null}
        {m.rest ? <Text size="sm">{m.rest}</Text> : null}
        {body === null ? <Skeleton lines={8} label="Lecture de la mémoire" /> : <Markdown content={body} />}
        {outgoing.length || incoming.length ? (
          <Box direction="column" background="muted" radius="md" padding="sm" gap="sm">
            <Links label="Renvoie à" items={outgoing} />
            <Links label="Citée par" items={incoming} />
          </Box>
        ) : null}
        <Separator />
        <KeyValue
          items={[
            { label: 'Fichier', value: m.file, code: true },
            ...(m.name && m.name !== m.file.replace(/\.md$/, '') ? [{ label: 'Nom', value: m.name, code: true }] : []),
            { label: 'Dans l’index', value: m.indexed ? 'Oui' : 'Non — Claude ne la voit pas', tone: m.indexed ? 'neutral' : 'warning' },
            { label: 'Chemins cités', value: m.cited ? (m.missingPaths.length ? `${m.cited}, dont ${m.missingPaths.length} introuvable${m.missingPaths.length > 1 ? 's' : ''}` : `${m.cited}`) : 'Aucun' }
          ]}
        />
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
