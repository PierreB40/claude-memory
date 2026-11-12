// The panel <-> worker contract, declared once: src/panel.tsx and src/worker.ts both read it.
import type { Audit } from './audit.ts'
import type { ProjectSummary } from './store.ts'

export {}

export interface ProjectView extends Audit {
  slug: string
  /** Short name: the repository folder when known, else the slug's last segment. */
  label: string
  /** The focused workspace this project was detected from. */
  detectedFrom: string
  /** What cited paths were checked against: a checkout on a branch; null when none matched. */
  checked: { path: string; branch: string | null } | null
  /** The default branch the checked one is compared with, when they differ. */
  base: string | null
  /** Memories Claude wrote since the person last opened the panel (files). */
  unseen: string[]
  /** How often Claude read each memory (file -> count, last time), since `trackingSince`. */
  reads: Record<string, { count: number; last: number }>
  /** When the plugin started counting reads for this project. */
  trackingSince: number
}

export type VerifyScope = 'all' | 'branch'

declare module 'orca' {
  interface PluginRequests {
    /** Claude Code projects that have at least one memory, most memories first. */
    'memory.projects': { output: { projects: ProjectSummary[] } }
    /** The focused workspace and its project, audited; project null when it has no memory. */
    'memory.view': { output: { project: ProjectView | null; workspace: string | null } }
    /** One memory's text, without its header. */
    'memory.read': { input: { slug: string; file: string }; output: { body: string } }
    /** Starts a new Claude in a terminal of the project's workspace, the memories to verify (or those the branch broke) as its first message. */
    'memory.verify': { input: { scope: VerifyScope }; output: { count: number; workspace: string } }
    /** The person saw what Claude learned: clears the « new » marks and the status bar count. */
    'memory.seen': { input: { slug: string }; output: { ok: true } }
  }
  interface PluginPanelEvents {
    /** Claude wrote a memory of this project: open panels reload it. */
    'memory.changed': { slug: string; file: string }
  }
}
