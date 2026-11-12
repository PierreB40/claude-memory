// No build step: Orca strips the types and compiles the JSX when the panel loads.
import {
  atom,
  Badge,
  Box,
  Button,
  Callout,
  EmptyState,
  IconButton,
  KeyValue,
  on,
  plugin,
  read,
  Row,
  Select,
  set,
  Skeleton,
  Stack,
  Tab,
  Table,
  Tabs,
  Text,
  type PanelContext
} from 'orca'
import type { AuditResult, Issue } from './audit.ts'
import type { ProjectSummary } from './store.ts'
import './protocol.ts'

const projects = atom<ProjectSummary[] | null>(null)
/** Remembered per Orca workspace, for when detection finds nothing (or the person overrides it). */
const slug = atom('slug', '', { persist: 'workspace' })
/** The Orca workspace whose Claude project was detected; null when the choice is manual. */
const detectedFor = atom<string | null>(null)
const result = atom<AuditResult | null>(null)
const error = atom<string | null>(null)
const fixing = atom(false)
const fixed = atom<string | null>(null)

const TONE: Record<Issue['severity'], 'danger' | 'warning' | 'neutral'> = { danger: 'danger', warning: 'warning', info: 'neutral' }
const message = (e: unknown): string => (e instanceof Error ? e.message : String(e))

async function load(next: string): Promise<void> {
  set(slug, next)
  set(result, null)
  set(error, null)
  set(fixed, null)
  if (!next) return
  try {
    set(result, await plugin.request('memory.audit', { slug: next }))
  } catch (e) {
    set(error, message(e))
  }
}

/** Lists the projects, then opens the focused workspace's one, else the remembered or largest. */
async function refresh(): Promise<void> {
  try {
    const answer = await plugin.request('memory.projects')
    set(projects, answer.projects)
    const detected = await plugin.request('memory.detect').catch(() => ({ slug: null, workspace: null }))
    set(detectedFor, detected.slug ? detected.workspace : null)
    const remembered = read(slug)
    const next =
      detected.slug ?? (answer.projects.some((p) => p.slug === remembered) ? remembered : (answer.projects[0]?.slug ?? ''))
    await load(next)
  } catch (e) {
    set(error, message(e))
  }
}

function choose(next: string): void {
  set(detectedFor, null)
  void load(next)
}

async function fix(): Promise<void> {
  set(fixing, true)
  set(fixed, null)
  try {
    const answer = await plugin.request('memory.fix', { slug: read(slug) }, { timeoutMs: 60_000 })
    set(
      fixed,
      answer.via === 'terminal'
        ? `${answer.count} problème(s) envoyé(s) à l'agent Claude du workspace.`
        : `Claude lancé dans un nouveau terminal avec ${answer.count} problème(s).`
    )
  } catch (e) {
    set(fixed, `Échec : ${message(e)}`)
  } finally {
    set(fixing, false)
  }
}

export function setup(ctx: PanelContext): void {
  void refresh()
  // Fires on subscribe, then on focus changes AND terminal opens/closes. The first only records
  // the workspace refresh() already read; after that, only a NEW workspace re-detects, so
  // launching Claude (a terminal opening) does not wipe the outcome just shown.
  let last: string | undefined
  ctx.subscriptions.push(
    on('workspace.changed', ({ context }) => {
      const key = context ? `${context.displayName}\u0000${context.branch}` : ''
      const first = last === undefined
      if (key === last) return
      last = key
      if (!first) void refresh()
    })
  )
}

function IssueRows({ issues, empty }: { issues: Issue[]; empty: string }) {
  if (issues.length === 0) return <EmptyState icon="check" title={empty} />
  return (
    <Stack gap="xs">
      {issues.map((i) => (
        <Box direction="column" padding="xs" radius="sm" border>
          <Text size="sm" weight="medium" tone={TONE[i.severity]}>
            {i.file ?? 'MEMORY.md'}
          </Text>
          <Text size="xs" muted>
            {i.message}
          </Text>
        </Box>
      ))}
    </Stack>
  )
}

export default function Panel() {
  const list = read(projects)
  const current = read(slug)
  const audit = read(result)
  const failure = read(error)
  const workspace = read(detectedFor)
  const busy = read(fixing)
  const outcome = read(fixed)

  if (failure) {
    return (
      <Callout tone="danger" title="Lecture impossible" icon="error">
        <Text size="sm">{failure}</Text>
      </Callout>
    )
  }
  if (list === null) return <Skeleton lines={4} label="Lecture des projets" />
  if (list.length === 0) {
    return <EmptyState icon="book" title="Aucune mémoire Claude Code" description="~/.claude/projects ne contient aucun dossier memory/." />
  }

  const problems = audit?.issues.filter((i) => i.severity !== 'info') ?? []
  const reread = audit?.issues.filter((i) => i.severity === 'info') ?? []
  const dangers = problems.filter((i) => i.severity === 'danger').length

  return (
    <Stack gap="md">
      <Row gap="xs" align="end">
        <Select
          label="Projet Claude Code"
          value={current}
          options={list.map((p) => ({ value: p.slug, label: `${p.label} (${p.count})` }))}
          onChange={choose}
        />
        <IconButton icon="refresh" label="Relire" onPress={refresh} />
      </Row>
      <Text muted size="xs">
        {workspace ? `Détecté depuis le workspace « ${workspace} ».` : 'Choisi à la main.'}
      </Text>

      {audit === null ? (
        <Skeleton lines={6} label="Audit en cours" />
      ) : (
        <Stack gap="md">
          <KeyValue
            items={[
              { label: 'Mémoires', value: audit.memories.length },
              {
                label: 'MEMORY.md',
                value: audit.index.present ? `${audit.index.lines} lignes · ${(audit.index.bytes / 1024).toFixed(1)} Ko` : 'absent',
                tone: audit.index.present ? 'neutral' : 'warning'
              },
              { label: 'Problèmes', value: problems.length, tone: dangers > 0 ? 'danger' : problems.length > 0 ? 'warning' : 'success' }
            ]}
          />
          {problems.length > 0 ? (
            <Stack gap="xs">
              <Button icon="agent" tone="accent" disabled={busy} onPress={fix}>
                {busy ? 'Envoi…' : 'Demander à Claude de corriger'}
              </Button>
              {outcome ? (
                <Text size="xs" tone={outcome.startsWith('Échec') ? 'danger' : 'success'}>
                  {outcome}
                </Text>
              ) : null}
            </Stack>
          ) : null}
          <Tabs label="Vue" defaultValue="problemes">
            <Tab value="problemes" label={`Problèmes (${problems.length})`} icon="warning">
              <IssueRows issues={problems} empty="Mémoire cohérente" />
            </Tab>
            <Tab value="relire" label={`À relire (${reread.length})`} icon="calendar">
              <IssueRows issues={reread} empty="Rien à relire" />
            </Tab>
            <Tab value="memoires" label="Mémoires" icon="book">
              <Table
                label="Mémoires"
                maxHeight="lg"
                columns={[
                  { key: 'name', label: 'Nom' },
                  { key: 'type', label: 'Type', width: 'sm' },
                  { key: 'age', label: 'Modifiée', width: 'sm', align: 'end' }
                ]}
                rows={audit.memories.map((m) => ({
                  key: m.file,
                  cells: {
                    name: m.indexed ? (m.name ?? m.file) : `${m.name ?? m.file} — hors index`,
                    type: m.type,
                    age: { type: 'relative', at: m.mtimeMs }
                  }
                }))}
              />
            </Tab>
          </Tabs>
          <Row gap="xs">
            <Badge tone="neutral">lecture seule</Badge>
            <Text muted size="xs">
              Le panneau ne modifie rien : la correction passe par l'agent.
            </Text>
          </Row>
        </Stack>
      )}
    </Stack>
  )
}
