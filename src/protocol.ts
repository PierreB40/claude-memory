// The panel <-> worker contract, declared once: src/panel.tsx and src/worker.ts both read it.
import type { Audit } from './audit.ts'

export interface ProjectView extends Audit {
  slug: string
  /** Short name: the repository's main checkout folder. */
  label: string
  /** The branch cited paths were checked on; null when the workspace is no git checkout. */
  branch: string | null
  /** The default branch, short (`main`), when the checked branch is another one. */
  base: string | null
  /** Memories Claude wrote since the person last looked at them (files). */
  unseen: string[]
  /** How often Claude read each memory (file -> count, last time), since `trackingSince`. */
  reads: Record<string, { count: number; last: number }>
  /** When the plugin started counting reads for this project. */
  trackingSince: number
}

/**
 * What the panel shows. `workspace` is the focused workspace's name (null: none); `unmatched`
 * when Orca's context fits no single workspace (two of the same name on the same branch).
 */
export interface PanelView {
  project: ProjectView | null
  workspace: string | null
  unmatched?: boolean
}

declare module 'orca' {
  interface PluginRequests {
    /** The focused workspace and its project, audited. */
    'memory.view': { output: PanelView }
    /** One memory's text, without its header, its `[[links]]` read as titles. */
    'memory.read': { input: { slug: string; file: string }; output: { body: string } }
    /** Starts a new Claude in a terminal of the focused workspace, what to verify as its first message. */
    'memory.verify': { output: { count: number; workspace: string } }
    /** The person saw these memories (all new ones when `files` is left out). */
    'memory.seen': { input: { slug: string; files?: string[] }; output: { ok: true } }
  }
  interface PluginPanelEvents {
    /** Claude wrote a memory (or the index) of this project: open panels reload it. */
    'memory.changed': { slug: string; file: string }
  }
}
