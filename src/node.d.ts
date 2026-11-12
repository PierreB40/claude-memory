// The few Node APIs the worker and the CLI use; the plugin typings ship no @types/node.
declare module 'node:fs/promises' {
  export function readdir(path: string): Promise<string[]>
  export function readFile(path: string, encoding: 'utf8'): Promise<string>
  export function stat(path: string): Promise<{ mtimeMs: number; isDirectory(): boolean }>
  export function mkdtemp(prefix: string): Promise<string>
  export function mkdir(path: string, options?: { recursive?: boolean }): Promise<string | undefined>
  export function writeFile(path: string, data: string): Promise<void>
  export function utimes(path: string, atime: number, mtime: number): Promise<void>
  export function rm(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<void>
}
declare module 'node:os' {
  export function homedir(): string
  export function tmpdir(): string
  export function platform(): string
}
declare module 'node:path' {
  export function join(...parts: string[]): string
}
declare const process: { argv: string[]; env: Record<string, string | undefined>; exitCode?: number; stdout: { write(s: string): boolean } }
declare module 'node:child_process' {
  export function execFileSync(file: string, args: readonly string[], options: { cwd?: string; encoding?: 'utf8' }): string
  export function execFile(
    file: string,
    args: readonly string[],
    options: { cwd?: string; maxBuffer?: number; encoding: 'utf8' },
    callback: (error: Error | null, stdout: string) => void
  ): void
}
