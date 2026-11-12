// What Claude Code believes about the focused workspace's project, and what no longer holds.
// Like Orca's own sidebar tabs it follows the focused workspace. A fixed header (project, action,
// tabs, search, type) over grouped lists that scroll; a memory opens in place: its defects, its
// text, its links, then its file facts. No build step: Orca compiles this file when it loads.
// Words come from src/i18n.ts, in Orca's language.
import {
  atom,
  Badge,
  Box,
  Button,
  Callout,
  Code,
  EmptyState,
  env,
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
import { atMerge, capitalize, toVerify, verifyCount, type Memory, type MemoryType } from './audit.ts'
import { langOf, words, type Words } from './i18n.ts'
import type { PanelView, ProjectView } from './protocol.ts'

type State = { status: 'loading' } | { status: 'failed'; error: string } | ({ status: 'ready' } & PanelView)
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
const TYPE_ORDER: MemoryType[] = ['feedback', 'project', 'reference', 'user', 'unknown']

/** Orca's language: the panel's words, and the worker's, which it is told with every request. */
const t = (): Words => words(langOf(env.locale))
const locale = (): { locale: string } => ({ locale: env.locale })
const message = (e: unknown): string => (e instanceof Error ? e.message : String(e))

/** Why a memory is to verify, in a few words: « 10/11 fichiers introuvables · lien cassé ». */
function reason(m: Memory): string {
  const w = t()
  const parts: string[] = []
  if (m.missingPaths.length) parts.push(w.missingShare(m.missingPaths.length, m.cited))
  for (const p of m.problems) {
    const short = w.problemShort(p)
    if (!parts.includes(short)) parts.push(short)
  }
  return capitalize(parts.join(' · '))
}

/** On the list to verify, the icon says the cause; elsewhere the section already says it. */
const causeIcon = (m: Memory): IconName => (m.missingPaths.length ? 'warning' : 'link')

const recentOf = (p: ProjectView): Memory[] => {
  const since = Date.now() - RECENT_DAYS * DAY
  return p.memories.filter((m) => m.mtimeMs >= since)
}
const defaultTab = (p: ProjectView): TabId => (verifyCount(p) ? 'verify' : 'recent')

/** Only the latest answer counts: a slower, older one must not overwrite it. */
let loading = 0
let reading = 0

async function load(): Promise<void> {
  const ticket = ++loading
  try {
    const view = await plugin.request('memory.view', locale())
    if (ticket !== loading) return
    set(state, { status: 'ready', ...view })
    // The open memory may have changed, or gone: reread it, or come back to the list.
    const o = read(opened)
    if (o && !view.project?.memories.some((m) => m.file === o.file)) set(opened, null)
    else if (o) void open(o.file)
  } catch (e) {
    if (ticket === loading) set(state, { status: 'failed', error: message(e) })
  }
}

function seen(files?: string[]): void {
  const s = read(state)
  if (s.status !== 'ready' || !s.project?.unseen.length) return
  const left = files ? s.project.unseen.filter((f) => !files.includes(f)) : []
  if (left.length === s.project.unseen.length) return
  set(state, { ...s, project: { ...s.project, unseen: left } })
  void plugin.request('memory.seen', files ? { slug: s.project.slug, files } : { slug: s.project.slug })
}

async function open(file: string): Promise<void> {
  const s = read(state)
  if (s.status !== 'ready' || !s.project) return
  const ticket = ++reading
  const same = read(opened)?.file === file
  if (!same) set(opened, { file, body: null })
  seen([file])
  try {
    const { body } = await plugin.request('memory.read', { slug: s.project.slug, file, ...locale() })
    if (ticket === reading) set(opened, { file, body })
  } catch (e) {
    if (ticket === reading) set(opened, { file, body: t().readFailedBody(message(e)) })
  }
}

async function verify(): Promise<void> {
  set(busy, true)
  set(said, null)
  try {
    const { workspace } = await plugin.request('memory.verify', locale(), { timeoutMs: 60_000 })
    set(said, { ok: true, text: t().verifyStarted(workspace) })
  } catch (e) {
    set(said, { ok: false, text: message(e) })
  } finally {
    set(busy, false)
  }
}

/** Leaving the recent tab is having seen what Claude learned there. */
function showTab(next: string): void {
  const s = read(state)
  const current = read(tab) ?? (s.status === 'ready' && s.project ? defaultTab(s.project) : null)
  if (current === 'recent' && next !== 'recent') seen()
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
  icon?: (m: Memory) => IconName
  memories: Memory[]
  subtitle: (m: Memory) => string
}

/** A tab's memories, searched and filtered, in the groups the tab reads best in. */
function groups(p: ProjectView, which: TabId): Group[] {
  const w = t()
  const q = read(query).trim().toLowerCase()
  const type = read(typeFilter)
  const keep = (m: Memory): boolean =>
    (type === 'any' || m.type === type) && (!q || `${m.title} ${m.name ?? ''} ${m.description ?? ''} ${m.file}`.toLowerCase().includes(q))
  const age = (m: Memory): string => `${capitalize(w.ago(m.mtimeMs))} · ${w.type[m.type].one.toLowerCase()}`

  if (which === 'verify') {
    return [
      { key: 'doubt', label: w.maybeFalse, icon: causeIcon, memories: toVerify(p).filter(keep), subtitle: reason },
      {
        key: 'merge',
        label: w.toUpdateAtMerge(p.base),
        icon: () => 'branch',
        memories: atMerge(p).filter(keep),
        subtitle: (m) => w.branchRemoves(m.removedByBranch.length)
      }
    ]
  }
  if (which === 'recent') {
    const fresh = new Set(p.unseen)
    const recent = recentOf(p).filter(keep).sort((a, b) => b.mtimeMs - a.mtimeMs)
    return [
      { key: 'new', label: w.newSinceVisit, memories: recent.filter((m) => fresh.has(m.file)), subtitle: age },
      { key: 'week', label: w.earlierThisWeek, memories: recent.filter((m) => !fresh.has(m.file)), subtitle: age }
    ]
  }
  return TYPE_ORDER.map((type) => ({
    key: type,
    label: w.type[type].many,
    memories: p.memories.filter((m) => m.type === type && keep(m)),
    subtitle: (m: Memory) => capitalize(m.rest) || w.edited(m.mtimeMs)
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
  const w = t()
  const visible = groups(p, which).filter((g) => g.memories.length)
  const filtered = read(query).trim() !== '' || read(typeFilter) !== 'any'
  const index = which === 'verify' && !filtered ? p.indexProblems : []
  if (visible.length === 0 && index.length === 0) {
    if (filtered) return <EmptyState icon="search" title={w.noMatch.title} description={w.noMatch.description} />
    if (which === 'verify') {
      return <EmptyState icon="check" title={w.nothingToVerify.title} description={p.branch ? w.nothingToVerify.checked : w.nothingToVerify.unchecked} />
    }
    if (which === 'recent') return <EmptyState icon="calendar" title={w.nothingRecent(RECENT_DAYS)} />
    return <EmptyState icon="book" title={w.noMemory} />
  }
  return (
    <Stack gap="md">
      {index.length ? (
        <Section label={w.indexSection}>
          <List label={w.indexSection}>
            {index.map((problem) => (
              <ListItem icon="error" title="MEMORY.md" description={w.index(problem)} />
            ))}
          </List>
        </Section>
      ) : null}
      {visible.map((g) => (
        <Section label={`${g.label} · ${g.memories.length}`}>
          <List label={g.label}>
            {g.memories.map((m) => (
              <ListItem icon={g.icon?.(m)} title={m.title} description={g.subtitle(m)} onPress={() => void open(m.file)} />
            ))}
          </List>
        </Section>
      ))}
    </Stack>
  )
}

function Header({ p }: { p: ProjectView }) {
  const w = t()
  const count = verifyCount(p)
  const merge = atMerge(p).length
  const feedback = read(said)
  return (
    <Stack gap="xs">
      <Row justify="between" align="center">
        <Stack gap="none">
          <Text weight="semibold" truncate>
            {p.label}
          </Text>
          <Text size="xs" muted truncate>
            {w.summary(p.memories.length, p.branch)}
          </Text>
        </Stack>
        <Row gap="none" align="center">
          {count ? (
            <Button variant="ghost" size="sm" icon="agent" disabled={read(busy)} tooltip={w.verifyTooltip} onPress={verify}>
              {read(busy) ? w.verifyStarting : w.verify}
            </Button>
          ) : null}
          <IconButton icon="refresh" label={w.reload} tooltip={w.reloadTooltip} variant="ghost" size="sm" onPress={load} />
        </Row>
      </Row>
      {merge ? (
        <Text size="xs">
          <Badge tone="neutral">{w.atMergeBadge(merge)}</Badge>
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
  const w = t()
  const which: TabId = read(tab) ?? defaultTab(p)
  return (
    <Box direction="column" height="100%">
      <Box direction="column" gap="sm" paddingY="xs" shrink={false}>
        <Header p={p} />
        <Tabs label={w.view} value={which} onChange={showTab}>
          <Tab value="verify" label={`${w.tabVerify} ${verifyCount(p)}`} />
          <Tab value="recent" label={`${w.tabRecent} ${recentOf(p).length}`} />
          <Tab value="all" label={`${w.tabAll} ${p.memories.length}`} />
        </Tabs>
        <Row gap="xs" align="center">
          <Box grow>
            <Input label={w.search} labelHidden type="search" placeholder={w.searchPlaceholder} value={read(query)} onChange={(v) => set(query, v)} />
          </Box>
          <Box width="40%" shrink={false}>
            <Select
              label={w.typeLabel}
              labelHidden
              value={read(typeFilter)}
              options={[{ value: 'any', label: w.anyType }, ...TYPE_ORDER.map((type) => ({ value: type, label: w.type[type].many }))]}
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
  const w = t()
  if (items.length === 0) return null
  return (
    <Section label={`${label} · ${items.length}`}>
      <List label={label}>
        {items.map((r) => (
          <ListItem title={r.title} description={`${w.type[r.type].one} · ${w.ago(r.mtimeMs)}`} onPress={() => void open(r.file)} />
        ))}
      </List>
    </Section>
  )
}

function Detail({ p, m, body }: { p: ProjectView; m: Memory; body: string | null }) {
  const w = t()
  const byFile = new Map(p.memories.map((x) => [x.file, x]))
  const outgoing = m.related.map((f) => byFile.get(f)).filter((x): x is Memory => x !== undefined)
  const incoming = p.memories.filter((x) => x.file !== m.file && x.related.includes(m.file))
  // The lead is what the description adds to the title; a bare « (…) » reads better whole.
  const lead = capitalize(m.rest.startsWith('(') ? (m.description ?? '') : m.rest)
  const reads = p.reads[m.file]
  return (
    <Box direction="column" height="100%">
      <Box direction="column" gap="xs" paddingY="xs" shrink={false}>
        <Row>
          <Button variant="ghost" size="sm" onPress={() => set(opened, null)}>
            {w.back}
          </Button>
        </Row>
        <Heading level={2}>{m.title}</Heading>
        <Text size="xs" muted>
          {`${w.type[m.type].one} · ${w.edited(m.mtimeMs).toLowerCase()}`}
        </Text>
        <Separator />
      </Box>
      <Box direction="column" grow scroll="y" minHeight={0} gap="md" paddingY="sm">
        {m.missingPaths.length || m.problems.length ? (
          <Callout tone="warning" icon="warning" title={w.toCheck}>
            <Stack gap="sm">
              <Paths label={w.notInCode} paths={m.missingPaths} />
              {m.problems.length ? (
                <Stack gap="xs">
                  <Text size="xs" weight="medium">
                    {w.defects}
                  </Text>
                  {m.problems.map((x) => (
                    <Text size="xs">{w.problemDetail(x)}</Text>
                  ))}
                </Stack>
              ) : null}
            </Stack>
          </Callout>
        ) : null}
        {m.removedByBranch.length ? (
          <Callout tone="neutral" icon="branch" title={w.toUpdateAtMerge(p.base)}>
            <Paths label={w.removedByBranch} paths={m.removedByBranch} />
          </Callout>
        ) : null}
        {lead ? <Text size="sm">{lead}</Text> : null}
        {body === null ? <Skeleton lines={8} label={w.readingMemory} /> : <Markdown content={body} />}
        {outgoing.length || incoming.length ? (
          <Box direction="column" background="muted" radius="md" padding="sm" gap="sm">
            <Links label={w.linksTo} items={outgoing} />
            <Links label={w.linkedFrom} items={incoming} />
          </Box>
        ) : null}
        <Separator />
        <KeyValue
          items={[
            { label: w.file, value: m.file, code: true },
            ...(m.name && m.name !== m.file.replace(/\.md$/, '') ? [{ label: w.name, value: m.name, code: true }] : []),
            { label: w.inIndex, value: m.indexed ? w.yes : w.notIndexed, tone: m.indexed ? 'neutral' : 'warning' },
            { label: w.readByClaude, value: w.reads(reads?.count ?? 0, reads?.last ?? 0, p.trackingSince) },
            { label: w.citedPaths, value: m.cited ? w.cited(m.cited, m.missingPaths.length) : w.none }
          ]}
        />
      </Box>
    </Box>
  )
}

export default function Panel() {
  const w = t()
  const s = read(state)
  if (s.status === 'loading') return <Skeleton lines={8} label={w.loading} />
  if (s.status === 'failed') {
    return (
      <Callout tone="danger" icon="error" title={w.readFailed}>
        <Text size="sm">{s.error}</Text>
      </Callout>
    )
  }
  if (!s.workspace) return <EmptyState icon="folder" title={w.noWorkspace.title} description={w.noWorkspace.description} />
  if (s.unmatched) {
    const a = w.ambiguous(s.workspace)
    return <EmptyState icon="folder" title={a.title} description={a.description} />
  }
  if (!s.project) {
    const n = w.nothingLearned(s.workspace)
    return <EmptyState icon="book" title={n.title} description={n.description} />
  }
  const o = read(opened)
  const m = o ? s.project.memories.find((x) => x.file === o.file) : undefined
  return o && m ? <Detail p={s.project} m={m} body={o.body} /> : <Main p={s.project} />
}
