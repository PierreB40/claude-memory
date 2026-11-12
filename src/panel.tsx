// What Claude Code believes about the focused project, and what no longer holds.
// One column, most useful first: to verify, learned recently, everything (searchable).
// A memory opens in place. No build step: Orca compiles this file when the panel loads.
import {
  atom,
  Button,
  Callout,
  Code,
  Collapsible,
  derived,
  EmptyState,
  Heading,
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
  Separator,
  set,
  Skeleton,
  Stack,
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
const showAllToVerify = atom(false)
const opened = atom<{ file: string; body: string | null } | null>(null)
const verifying = atom(false)
const verdict = atom<{ tone: 'success' | 'danger'; text: string } | null>(null)

const RECENT_DAYS = 7
const DAY = 86_400_000
const TO_VERIFY_SHOWN = 5

const TYPE_LABEL: Record<MemoryType, string> = {
  feedback: 'Règles de travail',
  project: 'Projet',
  reference: 'Références',
  user: 'Profil',
  unknown: 'Sans type'
}
const TYPE_SINGULAR: Record<MemoryType, string> = {
  feedback: 'règle de travail',
  project: 'projet',
  reference: 'référence',
  user: 'profil',
  unknown: 'sans type'
}
const capitalize = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1)
const TYPE_ORDER: MemoryType[] =['feedback', 'project', 'reference', 'user', 'unknown']

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e))
const rtf = new Intl.RelativeTimeFormat('fr', { numeric: 'auto' })
function ago(ms: number): string {
  const minutes = Math.round((ms - Date.now()) / 60_000)
  if (minutes > -60) return rtf.format(minutes, 'minute')
  const hours = Math.round(minutes / 60)
  if (hours > -24) return rtf.format(hours, 'hour')
  return rtf.format(Math.round(hours / 24), 'day')
}
const tokens = (bytes: number): string => `≈ ${(bytes / 4 / 1000).toFixed(1).replace('.', ',')} k tokens`

/** Why a memory is to verify, short enough for one list row. */
function reason(m: Memory): string {
  const parts: string[] = []
  if (m.missingPaths.length) parts.push(`${m.missingPaths.length} fichier${m.missingPaths.length > 1 ? 's' : ''} cité${m.missingPaths.length > 1 ? 's' : ''} sur ${m.cited} introuvable${m.missingPaths.length > 1 ? 's' : ''}`)
  for (const p of m.problems) if (!parts.includes(p.short)) parts.push(p.short)
  return parts.join(' · ')
}

const verifyList = derived(() => {
  const p = read(project)
  return p ? toVerify(p) : []
})

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

function choose(slug: string): void {
  set(chosen, slug)
  set(picking, false)
  set(opened, null)
  set(verdict, null)
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
  set(verdict, null)
  try {
    const answer = await plugin.request('memory.verify', { slug: p.slug }, { timeoutMs: 60_000 })
    set(verdict, {
      tone: 'success',
      text:
        answer.via === 'terminal'
          ? `Demande envoyée à Claude (${answer.count} à vérifier). Il proposera les suppressions sans les faire.`
          : `Claude lancé dans un nouveau terminal (${answer.count} à vérifier).`
    })
  } catch (e) {
    set(verdict, { tone: 'danger', text: message(e) })
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
        set(opened, null)
        set(verdict, null)
        void load()
      }
    })
  )
}

function MemoryRow({ m, description }: { m: Memory; description?: string }) {
  return <ListItem title={m.title} description={description ?? m.description ?? m.file} onPress={() => void open(m.file)} />
}

function Header({ p }: { p: ProjectView }) {
  const list = read(projects)
  const source = p.detectedFrom ? `Workspace « ${p.detectedFrom} »` : 'Choisi à la main'
  return (
    <Stack gap="xs">
      <Row justify="between" align="center">
        <Heading level={2}>{p.label}</Heading>
        <Row gap="none">
          {list.length > 1 ? (
            <IconButton icon="folder" label="Changer de projet" variant="ghost" size="sm" onPress={() => update(picking, (v) => !v)} />
          ) : null}
          <IconButton icon="refresh" label="Relire" variant="ghost" size="sm" onPress={load} />
        </Row>
      </Row>
      <Text muted size="xs">
        {source} · {p.memories.length} mémoires · index {tokens(p.index.bytes)} à chaque session
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

function ToVerify({ p }: { p: ProjectView }) {
  const items = read(verifyList)
  const busy = read(verifying)
  const said = read(verdict)
  if (items.length === 0 && p.indexProblems.length === 0) {
    return (
      <Callout tone="success" icon="check" title="Rien à vérifier">
        <Text size="sm">{p.repo ? 'Chaque fichier cité existe et chaque lien mène quelque part.' : 'Chaque lien mène quelque part. Code non vérifié : aucun workspace Orca ne correspond à ce projet.'}</Text>
      </Callout>
    )
  }
  const shown = read(showAllToVerify) ? items : items.slice(0, TO_VERIFY_SHOWN)
  return (
    <Stack gap="sm">
      <Stack gap="xs">
        <Heading level={3}>À vérifier · {items.length + (p.indexProblems.length ? 1 : 0)}</Heading>
        <Text muted size="xs">
          Ces mémoires citent du code disparu ou sont mal reliées : Claude peut s'y fier à tort.
        </Text>
      </Stack>
      {p.indexProblems.map((text) => (
        <Callout tone="danger" icon="error">
          <Text size="sm">{text}</Text>
        </Callout>
      ))}
      {items.length ? (
        <List label="Mémoires à vérifier">
          {shown.map((m) => (
            <MemoryRow m={m} description={reason(m)} />
          ))}
        </List>
      ) : null}
      {items.length > TO_VERIFY_SHOWN ? (
        <Button variant="ghost" size="sm" icon={read(showAllToVerify) ? 'collapse' : 'expand'} onPress={() => update(showAllToVerify, (v) => !v)}>
          {read(showAllToVerify) ? 'Réduire' : `Voir les ${items.length - TO_VERIFY_SHOWN} autres`}
        </Button>
      ) : null}
      <Button variant="solid" tone="accent" icon="agent" disabled={busy} onPress={verify}>
        {busy ? 'Envoi à Claude…' : 'Faire vérifier par Claude'}
      </Button>
      {said ? (
        <Text size="xs" tone={said.tone}>
          {said.text}
        </Text>
      ) : null}
    </Stack>
  )
}

function Recent({ p }: { p: ProjectView }) {
  const since = Date.now() - RECENT_DAYS * DAY
  const recent = p.memories.filter((m) => m.mtimeMs >= since).sort((a, b) => b.mtimeMs - a.mtimeMs)
  if (recent.length === 0) return null
  return (
    <Stack gap="sm">
      <Stack gap="xs">
        <Heading level={3}>Appris cette semaine · {recent.length}</Heading>
        <Text muted size="xs">
          Ce que Claude a retenu ou modifié de lui-même ces {RECENT_DAYS} derniers jours.
        </Text>
      </Stack>
      <List label="Mémoires récentes">
        {recent.map((m) => (
          <MemoryRow m={m} description={`${capitalize(ago(m.mtimeMs))} · ${TYPE_SINGULAR[m.type]}`} />
        ))}
      </List>
    </Stack>
  )
}

function Everything({ p }: { p: ProjectView }) {
  const q = read(query).trim().toLowerCase()
  const match = (m: Memory): boolean => !q || `${m.title} ${m.name ?? ''} ${m.description ?? ''} ${m.file}`.toLowerCase().includes(q)
  const groups = TYPE_ORDER.map((type) => ({ type, items: p.memories.filter((m) => m.type === type && match(m)) })).filter((g) => g.items.length)
  return (
    <Stack gap="sm">
      <Heading level={3}>Toutes les mémoires</Heading>
      <Input label="Rechercher" labelHidden type="search" placeholder="Rechercher un titre, un sujet…" value={read(query)} onChange={(v) => set(query, v)} />
      {groups.length === 0 ? (
        <Text muted size="sm">
          Aucune mémoire ne correspond.
        </Text>
      ) : (
        groups.map((g) => (
          <Collapsible title={`${TYPE_LABEL[g.type]} · ${g.items.length}`} open={q ? true : undefined}>
            <List label={TYPE_LABEL[g.type]}>
              {g.items.map((m) => (
                <MemoryRow m={m} />
              ))}
            </List>
          </Collapsible>
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
          ← {p.label}
        </Button>
      </Row>
      <Stack gap="xs">
        <Heading level={2}>{m.title}</Heading>
        <Text muted size="xs">
          {TYPE_LABEL[m.type]} · modifiée {ago(m.mtimeMs)} · <Code>{m.file}</Code>
        </Text>
      </Stack>
      {m.missingPaths.length || m.problems.length ? (
        <Callout tone="warning" icon="warning" title="Peut-être plus vraie">
          <Stack gap="xs">
            {m.missingPaths.length ? (
              <Text size="sm">
                Introuvable{m.missingPaths.length > 1 ? 's' : ''} dans le dépôt : {m.missingPaths.join(', ')}
              </Text>
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
          <Separator />
          <List label="Reliée à">
            {related.map((r) => (
              <MemoryRow m={r} />
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
    return <EmptyState icon="book" title="Claude n'a encore rien retenu" description="Aucun projet de ~/.claude/projects n'a de mémoire." />
  }
  const o = read(opened)
  if (o) return <Detail p={p} file={o.file} body={o.body} />
  return (
    <Stack gap="lg">
      <Header p={p} />
      <ToVerify p={p} />
      <Recent p={p} />
      <Everything p={p} />
    </Stack>
  )
}
