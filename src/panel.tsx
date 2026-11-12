// What Claude Code believes about the focused project, and what no longer holds.
// Two levels: a health block that answers "is my memory sound?" and carries the one action,
// then tabs to explore. A memory opens in place. No build step: Orca compiles this file.
import {
  atom,
  Button,
  Callout,
  Code,
  derived,
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
  Progress,
  read,
  Row,
  Select,
  set,
  Skeleton,
  Stack,
  Tab,
  Tabs,
  Text,
  update,
  type PanelContext
} from 'orca'
import { toVerify, type Memory, type MemoryType } from './audit.ts'
import type { ProjectView } from './protocol.ts'
import type { ProjectSummary } from './store.ts'

const project = atom<ProjectView | null | undefined>(undefined)
const projects = atom<ProjectSummary[]>([])
const failure = atom<string | null>(null)
/** The project chosen by hand, kept per Orca workspace; '' follows the focused workspace. */
const chosen = atom('chosen', '', { persist: 'workspace' })
const picking = atom(false)
const query = atom('')
/** The open tab, kept so that coming back from a memory lands where the person was. */
const tab = atom<string | null>(null)
const opened = atom<{ file: string; body: string | null } | null>(null)
const verifying = atom(false)
const sent = atom<{ ok: boolean; text: string } | null>(null)

const RECENT_DAYS = 7
const DAY = 86_400_000

const TYPE: Record<MemoryType, { one: string; many: string }> = {
  feedback: { one: 'Règle de travail', many: 'Règles de travail' },
  project: { one: 'Projet', many: 'Projet' },
  reference: { one: 'Référence', many: 'Références' },
  user: { one: 'Profil', many: 'Profil' },
  unknown: { one: 'Sans type', many: 'Sans type' }
}
const TYPE_ORDER: MemoryType[] = ['feedback', 'project', 'reference', 'user', 'unknown']
/** A defect's short label, as it reads after a count on a list row. */
const DEFECT: Record<string, string> = {
  'Lien mort': 'lien cassé',
  'Lien à rediriger': 'lien à rediriger',
  'Hors index': 'absente de l’index',
  'Nom en double': 'nom en double',
  'Sans en-tête': 'sans en-tête'
}

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e))
const capitalize = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1)
const plural = (n: number, one: string, many: string): string => `${n} ${n > 1 ? many : one}`
const rtf = new Intl.RelativeTimeFormat('fr', { numeric: 'auto' })
function ago(ms: number): string {
  const minutes = Math.round((ms - Date.now()) / 60_000)
  if (minutes > -60) return rtf.format(minutes, 'minute')
  const hours = Math.round(minutes / 60)
  if (hours > -24) return rtf.format(hours, 'hour')
  return rtf.format(Math.round(hours / 24), 'day')
}
const tokens = (bytes: number): string => `≈ ${(bytes / 4 / 1000).toFixed(1).replace('.', ',')} k tokens/session`

/** Why a memory is to verify, short enough for one row: « 10 fichiers sur 11 introuvables ». */
function reason(m: Memory): string {
  const parts: string[] = []
  if (m.missingPaths.length) parts.push(`${plural(m.missingPaths.length, 'fichier', 'fichiers')} sur ${m.cited} introuvable${m.missingPaths.length > 1 ? 's' : ''}`)
  for (const p of m.problems) {
    const label = DEFECT[p.short] ?? p.short.toLowerCase()
    if (!parts.some((x) => x.endsWith(label))) parts.push(`1 ${label}`)
  }
  return capitalize(parts.join(' · '))
}

const verifyList = derived(() => {
  const p = read(project)
  return p ? toVerify(p) : []
})
const suspect = derived(() => new Set(read(verifyList).map((m) => m.file)))

async function load(): Promise<void> {
  set(failure, null)
  try {
    // An `undefined` field is not JSON: the host refuses it, so an absent slug is no key at all.
    const slug = read(chosen)
    const [view, list] = await Promise.all([plugin.request('memory.view', slug ? { slug } : {}), plugin.request('memory.projects')])
    set(project, view)
    set(projects, list.projects)
  } catch (e) {
    set(failure, message(e))
  }
}

function reset(): void {
  set(opened, null)
  set(sent, null)
  set(tab, null)
  set(query, '')
}

function choose(slug: string): void {
  set(chosen, slug)
  set(picking, false)
  reset()
  set(project, undefined)
  void load()
}

async function open(file: string): Promise<void> {
  const p = read(project)
  if (!p) return
  set(opened, { file, body: null })
  try {
    const { body } = await plugin.request('memory.read', { slug: p.slug, file })
    set(opened, { file, body })
  } catch (e) {
    set(opened, { file, body: `_Lecture impossible : ${message(e)}_` })
  }
}

async function verify(): Promise<void> {
  const p = read(project)
  if (!p) return
  set(verifying, true)
  set(sent, null)
  try {
    const answer = await plugin.request('memory.verify', { slug: p.slug }, { timeoutMs: 60_000 })
    set(sent, {
      ok: true,
      text:
        answer.via === 'terminal'
          ? 'Envoyé à Claude. Il corrigera et proposera les suppressions sans les faire.'
          : 'Claude lancé dans un nouveau terminal. Il corrigera et proposera les suppressions sans les faire.'
    })
  } catch (e) {
    set(sent, { ok: false, text: message(e) })
  } finally {
    set(verifying, false)
  }
}

export function setup(ctx: PanelContext): void {
  void load()
  // Fires on subscribe, then on focus changes AND terminal opens/closes: only a new workspace
  // reloads, so launching Claude does not wipe what the panel just said.
  let last: string | undefined
  ctx.subscriptions.push(
    on('workspace.changed', ({ context }) => {
      const key = context ? `${context.displayName}\u0000${context.branch}` : ''
      const first = last === undefined
      if (key === last) return
      last = key
      if (!first && !read(chosen)) {
        reset()
        void load()
      }
    })
  )
}

function Header({ p }: { p: ProjectView }) {
  const list = read(projects)
  const source = p.detectedFrom ? `Suit le workspace « ${p.detectedFrom} »` : 'Projet choisi à la main'
  return (
    <Stack gap="xs">
      <Row justify="between" align="center">
        <Heading level={2}>{p.label}</Heading>
        <Row gap="none">
          {list.length > 1 ? (
            <IconButton icon="folder" label="Changer de projet" tooltip={source} variant="ghost" size="sm" onPress={() => update(picking, (v) => !v)} />
          ) : null}
          <IconButton icon="refresh" label="Relire" variant="ghost" size="sm" onPress={load} />
        </Row>
      </Row>
      <Text muted size="xs">
        {`${p.memories.length} mémoires · ${tokens(p.index.bytes)}`}
      </Text>
      {read(picking) ? (
        <Stack gap="xs">
          <Select
            label="Projet Claude Code"
            value={p.slug}
            options={list.map((x) => ({ value: x.slug, label: `${x.label.split('/').filter(Boolean).pop() ?? x.slug} — ${x.count}` }))}
            onChange={choose}
          />
          {read(chosen) ? (
            <Button variant="ghost" size="sm" icon="branch" onPress={() => choose('')}>
              Suivre le workspace au premier plan
            </Button>
          ) : null}
        </Stack>
      ) : null}
    </Stack>
  )
}

function Health({ p }: { p: ProjectView }) {
  const unsafe = read(verifyList).length
  const total = p.memories.length
  const busy = read(verifying)
  const said = read(sent)
  if (unsafe === 0 && p.indexProblems.length === 0) {
    return (
      <Callout tone="success" icon="check" title="Mémoire saine">
        <Text size="sm">
          {p.repo ? 'Chaque fichier cité existe, chaque lien mène quelque part.' : 'Liens vérifiés, code non vérifié : aucun workspace ne correspond à ce projet.'}
        </Text>
      </Callout>
    )
  }
  const title = unsafe > 0 ? `${plural(unsafe, 'mémoire n’est', 'mémoires ne sont')} plus sûre${unsafe > 1 ? 's' : ''}` : 'L’index de la mémoire est à corriger'
  return (
    <Callout tone={said?.ok ? 'accent' : 'warning'} icon={said?.ok ? 'agent' : 'warning'} title={title}>
      <Stack gap="sm">
        <Text size="sm" tone={said && !said.ok ? 'danger' : undefined}>
          {said ? said.text : p.repo ? 'Elles citent du code supprimé ou des liens cassés.' : 'Liens cassés ou index incomplet. Code non vérifié : aucun workspace ne correspond.'}
        </Text>
        {total > 0 ? <Progress label={`Saines : ${total - unsafe} sur ${total}`} value={Math.round(((total - unsafe) / total) * 100)} /> : null}
        {said?.ok ? null : (
          <Button variant="solid" tone="accent" icon="agent" disabled={busy} onPress={verify}>
            {busy ? 'Envoi à Claude…' : 'Faire vérifier par Claude'}
          </Button>
        )}
      </Stack>
    </Callout>
  )
}

function ToVerifyTab({ p }: { p: ProjectView }) {
  const items = read(verifyList)
  if (items.length === 0 && p.indexProblems.length === 0) return <EmptyState icon="check" title="Rien à vérifier" />
  return (
    <List label="Mémoires à vérifier">
      {p.indexProblems.map((text) => (
        <ListItem icon="error" title="Index MEMORY.md" description={text} />
      ))}
      {items.map((m) => (
        <ListItem icon={m.missingPaths.length ? 'warning' : 'link'} title={m.title} description={reason(m)} onPress={() => void open(m.file)} />
      ))}
    </List>
  )
}

function RecentTab({ recent }: { recent: Memory[] }) {
  const flagged = read(suspect)
  if (recent.length === 0) return <EmptyState icon="calendar" title={`Rien appris ces ${RECENT_DAYS} derniers jours`} />
  return (
    <List label="Mémoires récentes">
      {recent.map((m) => (
        <ListItem
          icon={flagged.has(m.file) ? 'warning' : undefined}
          title={m.title}
          description={`${capitalize(ago(m.mtimeMs))} · ${TYPE[m.type].one}`}
          onPress={() => void open(m.file)}
        />
      ))}
    </List>
  )
}

function AllTab({ p }: { p: ProjectView }) {
  const q = read(query).trim().toLowerCase()
  const flagged = read(suspect)
  const match = (m: Memory): boolean => !q || `${m.title} ${m.name ?? ''} ${m.description ?? ''} ${m.file}`.toLowerCase().includes(q)
  const groups = TYPE_ORDER.map((type) => ({ type, items: p.memories.filter((m) => m.type === type && match(m)) })).filter((g) => g.items.length)
  return (
    <Stack gap="md">
      <Input label="Chercher" labelHidden type="search" placeholder="Chercher un titre, un sujet…" value={read(query)} onChange={(v) => set(query, v)} />
      {groups.length === 0 ? (
        <EmptyState icon="search" title="Aucune mémoire ne correspond" />
      ) : (
        groups.map((g) => (
          <Stack gap="xs">
            <Heading level={3}>{`${TYPE[g.type].many} · ${g.items.length}`}</Heading>
            <List label={TYPE[g.type].many}>
              {g.items.map((m) => (
                <ListItem icon={flagged.has(m.file) ? 'warning' : undefined} title={m.title} description={m.description ?? m.file} onPress={() => void open(m.file)} />
              ))}
            </List>
          </Stack>
        ))
      )}
    </Stack>
  )
}

function Detail({ p, file, body }: { p: ProjectView; file: string; body: string | null }) {
  const m = p.memories.find((x) => x.file === file)
  if (!m) return null
  const related = m.related.map((f) => p.memories.find((x) => x.file === f)).filter((x): x is Memory => Boolean(x))
  return (
    <Stack gap="md">
      <Row>
        <Button variant="ghost" size="sm" onPress={() => set(opened, null)}>
          ← Mémoires
        </Button>
      </Row>
      <Heading level={2}>{m.title}</Heading>
      <KeyValue
        items={[
          { label: 'Type', value: TYPE[m.type].one },
          { label: 'Modifiée', value: ago(m.mtimeMs) },
          { label: 'Fichier', value: m.file, code: true }
        ]}
      />
      {m.missingPaths.length || m.problems.length ? (
        <Callout tone="warning" icon="warning" title="Peut-être plus vraie">
          <Stack gap="xs">
            {m.missingPaths.length ? (
              <Stack gap="xs">
                <Text size="sm">{`${plural(m.missingPaths.length, 'fichier cité introuvable', 'fichiers cités introuvables')} :`}</Text>
                {m.missingPaths.map((path) => (
                  <Text size="xs">
                    <Code>{path}</Code>
                  </Text>
                ))}
              </Stack>
            ) : null}
            {m.problems.map((x) => (
              <Text size="sm">{x.detail}</Text>
            ))}
          </Stack>
        </Callout>
      ) : null}
      {body === null ? <Skeleton lines={8} label="Lecture de la mémoire" /> : <Markdown content={body} />}
      {related.length ? (
        <Stack gap="xs">
          <Heading level={3}>Reliée à</Heading>
          <List label="Reliée à">
            {related.map((r) => (
              <ListItem title={r.title} description={TYPE[r.type].one} onPress={() => void open(r.file)} />
            ))}
          </List>
        </Stack>
      ) : null}
    </Stack>
  )
}

export default function Panel() {
  const p = read(project)
  const error = read(failure)
  if (error) {
    return (
      <Callout tone="danger" icon="error" title="Lecture impossible">
        <Text size="sm">{error}</Text>
      </Callout>
    )
  }
  if (p === undefined) return <Skeleton lines={6} label="Lecture de la mémoire de Claude" />
  if (p === null) {
    return <EmptyState icon="book" title="Claude n’a encore rien retenu" description="Aucun projet de ~/.claude/projects n’a de mémoire." />
  }
  const o = read(opened)
  if (o) return <Detail p={p} file={o.file} body={o.body} />

  const toCheck = read(verifyList).length + (p.indexProblems.length ? 1 : 0)
  const since = Date.now() - RECENT_DAYS * DAY
  const recent = p.memories.filter((m) => m.mtimeMs >= since).sort((a, b) => b.mtimeMs - a.mtimeMs)
  const current = read(tab) ?? (toCheck > 0 ? 'verify' : 'recent')
  return (
    <Stack gap="lg">
      <Header p={p} />
      <Health p={p} />
      <Tabs label="Mémoires" value={current} onChange={(v) => set(tab, v)}>
        <Tab value="verify" label={`À vérifier ${toCheck}`}>
          <ToVerifyTab p={p} />
        </Tab>
        <Tab value="recent" label={`Récentes ${recent.length}`}>
          <RecentTab recent={recent} />
        </Tab>
        <Tab value="all" label={`Toutes ${p.memories.length}`}>
          <AllTab p={p} />
        </Tab>
      </Tabs>
    </Stack>
  )
}
