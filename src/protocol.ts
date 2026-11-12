// The panel <-> worker contract, declared once: src/panel.tsx and src/worker.ts both read it.
import type { Audit } from './audit.ts'
import type { ProjectSummary } from './store.ts'

export {}

export interface ProjectView extends Audit {
  slug: string
  /** Short name: the repository folder when known, else the slug's last segment. */
  label: string
  /** The checkout cited paths were checked against; null when no Orca workspace matches. */
  repo: string | null
  /** The focused workspace this project was detected from; null when chosen by hand. */
  detectedFrom: string | null
}

declare module 'orca' {
  interface PluginRequests {
    /** Claude Code projects that have at least one memory, most memories first. */
    'memory.projects': { output: { projects: ProjectSummary[] } }
    /** The focused workspace's project (or `slug` when given), audited. Null: no memory anywhere. */
    'memory.view': { input: { slug?: string }; output: ProjectView | null }
    /** One memory's text, without its header. */
    'memory.read': { input: { slug: string; file: string }; output: { body: string } }
    /** Hands the memories to verify to a Claude agent of the focused workspace. */
    'memory.verify': { input: { slug: string }; output: { via: 'terminal' | 'launch'; count: number } }
  }
}
