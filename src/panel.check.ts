// `orca plugin check` renders the panel once per scenario, with the real worker on the host.
import { defineCheck } from 'orca/testing'

const root = new URL('../fixtures/projects', import.meta.url).pathname

export default defineCheck({
  fixtures: { settings: { projectsRoot: root } },
  empty: { settings: { projectsRoot: new URL('../fixtures/none', import.meta.url).pathname } }
})
