// `flintnotes vault <folder>`: the service takes over a folder of notes that already belongs to someone.
//
// The package runs the service as its own user, which cannot read a vault in somebody's home (mode 0700, written by Samba as
// that person) and may not see /home at all (ProtectHome). Rather than loosening the user's files, the service is told to run
// as the folder's owner, and to see nothing of the owner's home except that one folder. This is the text of that change (a
// systemd drop-in) and the rules for which folder may be taken. Pure on purpose: what it writes and where is the command's.

import path from 'node:path'

export const DROP_IN_DIR = '/etc/systemd/system/flintnotes.service.d'
export const DROP_IN = `${DROP_IN_DIR}/vault.conf`

/** Folders (and their parents) that are the system's, never a place for notes. */
const SYSTEM = ['/', '/home', '/root', '/etc', '/usr', '/var', '/var/lib', '/bin', '/sbin', '/lib', '/lib64', '/boot', '/dev', '/proc', '/sys', '/run', '/tmp', '/opt', '/srv', '/mnt', '/media']
const OWN = '/var/lib/flintnotes'

/** Why this folder cannot be used, in words; null when it can. */
export function folderProblem(folder: string): string | null {
  if (!path.isAbsolute(folder)) return 'нужен полный путь к папке, например /home/name/obsidian'
  // systemd takes a path apart at spaces, colons and %; a quote or a control character breaks the line it is written on.
  if (/[\s:%"'\\\u0000-\u001f]/.test(folder)) return 'в пути не должно быть пробелов, двоеточий, кавычек и знаков % (systemd разбирает путь по ним)'
  if (folder !== path.posix.normalize(folder) && folder !== `${path.posix.normalize(folder)}/`) return 'путь не должен содержать «..», «.» и двойных косых черт'
  const clean = path.posix.normalize(folder).replace(/\/$/, '') || '/'
  if (SYSTEM.includes(clean)) return `${clean} — системная папка; укажите папку с заметками внутри неё`
  if (clean === OWN || clean.startsWith(`${OWN}/`) || ['/etc', '/usr', '/bin', '/sbin', '/lib', '/boot', '/dev', '/proc', '/sys', '/run'].some((one) => clean.startsWith(`${one}/`))) return 'эта папка принадлежит системе или самой службе: её хранилища служба открывает и так'
  return null
}

/** The text of the drop-in that makes the service run as `user`/`group` on `folder`. */
export function dropIn(folder: string, user: string, group: string): string {
  const clean = path.posix.normalize(folder).replace(/\/$/, '')
  const inHome = clean.startsWith('/home/') || clean.startsWith('/root/')
  return [
    '# Written by `flintnotes vault`; `flintnotes vault --remove` takes it away.',
    `# The service runs as the owner of ${clean}, so it can read and write the notes as the person (or Samba share) that does.`,
    '[Service]',
    `User=${user}`,
    `Group=${group}`,
    ...(inHome
      ? [
          '# The rest of /home is hidden from the service; only this folder is let through, writable.',
          'ProtectHome=tmpfs',
          `BindPaths=${clean}`,
        ]
      : []),
    `ReadWritePaths=${clean}`,
    '# What a service that has not opened any vault yet opens first; one that has is told by `flintnotes vault`.',
    `Environment=FLINT_FIRST_VAULT=${clean}`,
    '',
  ].join('\n')
}
