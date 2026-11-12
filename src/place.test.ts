import { assert, test } from 'orca/testing'
import { candidateSlugs } from './detect.ts'
import { isRemote, linuxHomeOf, uncOf, wslCommand, wslOf } from './place.ts'

test('a WSL workspace: its share, either spelling, or a Linux path on a wsl: host', () => {
  assert.deepEqual(wslOf('\\\\wsl.localhost\\Ubuntu\\home\\me\\shop'), { distro: 'Ubuntu', linux: '/home/me/shop' })
  assert.deepEqual(wslOf('\\\\wsl$\\Debian\\home\\me\\shop\\'), { distro: 'Debian', linux: '/home/me/shop' })
  assert.deepEqual(wslOf('//wsl.localhost/Ubuntu/home/me/shop'), { distro: 'Ubuntu', linux: '/home/me/shop' })
  assert.deepEqual(wslOf('\\\\wsl.localhost\\Ubuntu'), { distro: 'Ubuntu', linux: '/' })
  assert.deepEqual(wslOf('/home/me/shop', 'wsl:ubuntu'), { distro: 'ubuntu', linux: '/home/me/shop' })
  assert.equal(wslOf('C:\\Users\\me\\shop'), null)
  assert.equal(wslOf('/Users/me/shop', 'local'), null)
  assert.equal(wslOf('\\\\server\\share\\shop'), null)
})

test('read through its share, named after its Linux path, as Claude in WSL names it', () => {
  const w = { distro: 'Ubuntu', linux: '/home/me/.claude/projects' }
  assert.equal(uncOf(w), '\\\\wsl.localhost\\Ubuntu\\home\\me\\.claude\\projects')
  assert.deepEqual(candidateSlugs('/home/me/orca/shop/feature', 'gitdir: /home/me/dev/shop/.git/worktrees/feature'), ['-home-me-dev-shop', '-home-me-orca-shop-feature'])
  assert.equal(linuxHomeOf('/home/me/dev/shop'), '/home/me')
  assert.equal(linuxHomeOf('/root/shop'), '/root')
  assert.equal(linuxHomeOf('/srv/shop'), null)
  assert.equal(linuxHomeOf('/homely/x'), null)
})

test('git runs inside the distribution, in the Linux checkout', () => {
  assert.deepEqual(wslCommand({ distro: 'Ubuntu', linux: '/home/me/shop' }, 'git', ['ls-files', '-z']), ['-d', 'Ubuntu', '--cd', '/home/me/shop', '-e', 'git', 'ls-files', '-z'])
})

test('only SSH is out of reach: this machine and WSL are not', () => {
  assert.equal(isRemote(null), false)
  assert.equal(isRemote('local'), false)
  assert.equal(isRemote('wsl:ubuntu'), false)
  assert.equal(isRemote('ssh-box'), true)
})
