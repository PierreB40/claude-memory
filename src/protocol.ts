// The panel <-> worker contract, declared once: src/panel.tsx and src/worker.ts both read it.
import type { Audit } from './audit.ts'
import type { ProjectSummary } from './store.ts'

export {}

export interface ProjectView extends Audit {
  slug: string
  /** Short name: the repository folder when known, else the slug's last segment. */
  label: string
  /** The focused workspace this project was detected from; null when chosen by hand. */
  detectedFrom: string | null
  /** What cited paths were checked against: a checkout on a branch; null when none matched. */
  checked: { path: string; branch: string | null } | null
  /** The default branch the checked one is compared with, when they differ. */
  base: string | null
  /** Memories Claude wrote since the person last opened the panel (files). */
  unseen: string[]
}

export type VerifyScope = 'all' | 'branch'

declare module 'orca' {
  interface PluginRequests {
    /** Claude Code projects that have at least one memory, most memories first. */
    'memory.projects': { output: { projects: ProjectSummary[] } }
    /** The focused workspace's project (or `slug` when given), audited. Null: no memory anywhere. */
    'memory.view': { input: { slug?: string }; output: ProjectView | null }
    /** One memory's text, without its header. */
    'memory.read': { input: { slug: string; file: string }; output: { body: string } }
    /** Hands memories to a Claude agent: every one to verify, or those the branch broke. */
    'memory.verify': { input: { slug: string; scope: VerifyScope }; output: { via: 'terminal' | 'launch'; count: number } }
    /** The person saw what Claude learned: clears the « new » marks and the status bar count. */
    'memory.seen': { input: { slug: string }; output: { ok: true } }
  }
  interface PluginPanelEvents {
    /** Claude wrote a memory of this project: open panels reload it. */
    'memory.changed': { slug: string; file: string }
  }
}
