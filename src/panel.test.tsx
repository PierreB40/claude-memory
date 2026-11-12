// `orca plugin test .` runs this in Node with the same runtime and checks Orca uses.
import { assert, mockHost, mount, test } from 'orca/testing'
import type { AuditResult } from './audit.ts'
import * as panel from './panel'

/** Everything the panel drew, props included: titles and descriptions are not text nodes. */
const drawn = (view: { tree(): unknown }): string => JSON.stringify(view.tree())

const broken: AuditResult = {
  memories: [{ file: 'a.md', name: 'a', description: 'd', type: 'project', mtimeMs: 0, bytes: 10, links: [], indexed: true }],
  issues: [
    { kind: 'broken-link', severity: 'danger', file: 'a.md', message: '[[x]] ne correspond à aucune mémoire.' },
    { kind: 'stale', severity: 'info', file: 'a.md', message: 'Mémoire « project » inchangée depuis 90 jours : encore vraie ?' }
  ],
  index: { present: true, lines: 3, bytes: 120 }
}

test('audits the first project and lists its problems apart from what to reread', async () => {
  const asked: string[] = []
  const host = mockHost({
    requests: {
      'memory.projects': () => ({ root: '/r', projects: [{ slug: '-p', label: '/p', count: 1 }] }),
      'memory.detect': () => ({ slug: null, workspace: null }),
      'memory.audit': ({ slug }) => {
        asked.push(slug)
        return broken
      }
    }
  })
  const view = await mount(panel, { host })
  assert.deepEqual(asked, ['-p'])
  assert.ok(drawn(view).includes('Problèmes (1)'))
  assert.ok(drawn(view).includes('À relire (1)'))
  assert.ok(drawn(view).includes('[[x]] ne correspond à aucune mémoire.'))
  assert.deepEqual(view.errors, [])
  await view.unmount()
})

test('says so when there is no memory at all', async () => {
  const host = mockHost({ requests: { 'memory.projects': () => ({ root: '/r', projects: [] }) } })
  const view = await mount(panel, { host })
  assert.ok(drawn(view).includes('Aucune mémoire Claude Code'))
  await view.unmount()
})
