// The panel <-> worker contract, declared once: src/panel.tsx and src/worker.ts both read it.
import type { AuditResult } from './audit.ts'
import type { ProjectSummary } from './store.ts'

export {}

declare module 'orca' {
  interface PluginRequests {
    /** Claude Code projects that have at least one memory, most memories first. */
    'memory.projects': { output: { root: string; projects: ProjectSummary[] } }
    /** The audit of one project's memory folder. */
    'memory.audit': { input: { slug: string }; output: AuditResult }
    /** The project of the focused workspace, when one of its candidate slugs has memories. */
    'memory.detect': { output: { slug: string | null; workspace: string | null } }
    /**
     * Hands the project's problems to a Claude agent of the focused workspace: an idle one gets
     * the request typed in, else a new one is launched with it.
     */
    'memory.fix': { input: { slug: string }; output: { via: 'terminal' | 'launch'; count: number } }
  }
}
