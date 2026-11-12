// Where a workspace's checkout and its Claude's memory are, seen from the worker. On Windows, a
// WSL workspace is Linux behind a `\\wsl.localhost\<distro>` share: Claude runs inside the
// distribution, names its project folder after the Linux path and keeps its memory in the Linux
// home, while the worker reads the same files through the share. Pure: the worker feeds it.

/** A path inside a WSL distribution: which one, and the Linux path there. */
export interface Wsl {
  distro: string
  linux: string
}

const UNC = /^[\\/]{2}(?:\?[\\/]UNC[\\/])?(?:wsl\.localhost|wsl\$)[\\/]([^\\/]+)([\\/].*)?$/i

/**
 * The WSL side of a workspace: its path as a `\\wsl.localhost\<distro>\…` (or `\\wsl$\…`) share,
 * or a Linux path on a `wsl:<distro>` host. Null for anything else.
 */
export function wslOf(path: string, hostId: string | null = null): Wsl | null {
  const m = UNC.exec(path.trim())
  if (m) return { distro: m[1] as string, linux: (m[2] ?? '/').replace(/\\/g, '/').replace(/(.)\/+$/, '$1') }
  if (hostId?.startsWith('wsl:') && path.startsWith('/')) return { distro: hostId.slice(4), linux: path }
  return null
}

/** The share a Linux path of a distribution is read through, from Windows. */
export function uncOf(w: Wsl): string {
  return `\\\\wsl.localhost\\${w.distro}${w.linux === '/' ? '\\' : w.linux.replace(/\//g, '\\')}`
}

/** The home a Linux path lies in (`/home/me`, `/root`), when it says so. */
export function linuxHomeOf(linux: string): string | null {
  return /^\/home\/[^/]+(?=\/|$)|^\/root(?=\/|$)/.exec(linux)?.[0] ?? null
}

/**
 * Git for Windows refuses a repository on a WSL share (« dubious ownership ») and is slow there:
 * git runs inside the distribution instead, in the Linux checkout.
 */
export function wslCommand(w: Wsl, command: string, args: readonly string[]): string[] {
  return ['-d', w.distro, '--cd', w.linux, '-e', command, ...args]
}

/** On SSH, the code and the memory are on that machine: out of the worker's reach. */
export const isRemote = (hostId: string | null | undefined): boolean => Boolean(hostId) && hostId !== 'local' && !hostId?.startsWith('wsl:')
