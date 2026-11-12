// `orca plugin check` renders the panel once per scenario, with the real worker on a stand-in
// host: the fixtures folders, and a focused workspace whose path Claude Code names after them.
import { defineCheck } from 'orca/testing'

const root = new URL('../fixtures/projects', import.meta.url).pathname
const workspaces = {
  workspaces: ['broken', 'ok', 'other', 'shop'].map((name) => ({ id: `w-${name}`, kind: 'worktree', name, path: `/demo/${name}`, branch: 'refs/heads/main', hostId: null })),
  truncated: false
}
const focus = (name: string | null) => ({
  settings: { projectsRoot: root },
  results: {
    'workspace.readContext': name ? { branch: 'main', displayName: name, terminals: [] } : null,
    'workspace.list': workspaces,
    'statusBar.update': { ok: true }
  }
})

export default defineCheck({
  toVerify: focus('broken'),
  sound: focus('ok'),
  noMemory: focus('other'),
  noWorkspace: focus(null),
  demo: focus('shop')
})
