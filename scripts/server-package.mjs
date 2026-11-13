// `npm run server-package`: what is published for the Debian service, from a build made by scripts/release.mjs:
//   flintnotes_<version>_all.deb              installs the service (systemd unit, `flintnotes` command, the program)
//   flintnotes-server-<version>.tar.gz        only the program (server.mjs, public/, build.json), for the service's self-update
//   server-latest.json                        the version, the tarball and its checksum: what the service's updater reads
// The program is the same file in both; the .deb also carries the launcher and the command, which a self-update does
// not change. The three go to the project's release tagged `server` (a rolling release of its own, so that a new server
// does not become «the latest release» the Windows app looks at). FLINT_RELEASE_OUT and FLINT_SERVER_OUT as elsewhere.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { assertNothingPersonal } from './personal.mjs'

const ROOT = path.resolve(import.meta.dirname, '..')
const RELEASE = path.resolve(process.env.FLINT_RELEASE_OUT ?? path.join(ROOT, 'release'))
const OUT = path.resolve(process.env.FLINT_SERVER_OUT ?? path.join(ROOT, 'publish', 'server'))
const DEBIAN = path.join(ROOT, 'packaging', 'debian')

const build = JSON.parse(fs.readFileSync(path.join(RELEASE, 'build.json'), 'utf8'))
const version = build.version
if (!/^\d+\.\d+\.\d+$/.test(version ?? '')) throw new Error(`В build.json нет версии (${version}): соберите заново (npm run release)`)

/** Copies the program's files: server.mjs, build.json, and of public/ only what this build made (old files are kept there on purpose). */
function copyProgram(to) {
  fs.mkdirSync(to, { recursive: true })
  for (const name of ['server.mjs', 'build.json']) fs.copyFileSync(path.join(RELEASE, name), path.join(to, name))
  for (const file of build.files) {
    fs.mkdirSync(path.dirname(path.join(to, 'public', file)), { recursive: true })
    fs.copyFileSync(path.join(RELEASE, 'public', file), path.join(to, 'public', file))
  }
  // Pages the build does not list (the service worker, the manifest and so on) come from public/ of the project.
  for (const name of fs.readdirSync(path.join(RELEASE, 'public'), { withFileTypes: true })) {
    if (name.isFile() && !fs.existsSync(path.join(to, 'public', name.name))) fs.copyFileSync(path.join(RELEASE, 'public', name.name), path.join(to, 'public', name.name))
  }
}

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'flint-server-'))
try {
  fs.mkdirSync(OUT, { recursive: true })
  for (const old of fs.readdirSync(OUT)) if (/^flintnotes[-_].*\.(deb|tar\.gz)$|^server-latest\.json$/.test(old)) fs.rmSync(path.join(OUT, old))

  // ---- the program alone
  const payload = path.join(work, 'payload')
  copyProgram(payload)
  assertNothingPersonal(payload)
  const tarball = `flintnotes-server-${version}.tar.gz`
  execFileSync('tar', ['--sort=name', '--owner=0', '--group=0', '--numeric-owner', '--mtime=@0', '-czf', path.join(OUT, tarball), '-C', payload, '.'])
  const sha256 = createHash('sha256').update(fs.readFileSync(path.join(OUT, tarball))).digest('hex')
  fs.writeFileSync(path.join(OUT, 'server-latest.json'), JSON.stringify({ version, file: tarball, sha256, size: fs.statSync(path.join(OUT, tarball)).size }, null, 2))

  // ---- the package
  const stage = path.join(work, 'deb')
  const lib = path.join(stage, 'usr', 'lib', 'flintnotes')
  copyProgram(lib)
  for (const name of ['launcher.mjs', 'cli.mjs']) fs.copyFileSync(path.join(RELEASE, name), path.join(lib, name))
  const put = (from, to, mode) => {
    fs.mkdirSync(path.dirname(path.join(stage, to)), { recursive: true })
    fs.copyFileSync(path.join(DEBIAN, from), path.join(stage, to))
    fs.chmodSync(path.join(stage, to), mode)
  }
  put('flintnotes', 'usr/bin/flintnotes', 0o755)
  put('flintnotes.service', 'usr/lib/systemd/system/flintnotes.service', 0o644)
  put('flintnotes.default', 'etc/default/flintnotes', 0o644)
  put('README.Debian', 'usr/share/doc/flintnotes/README.Debian', 0o644)
  const control = path.join(stage, 'DEBIAN')
  fs.mkdirSync(control)
  for (const script of ['postinst', 'prerm', 'postrm']) {
    fs.copyFileSync(path.join(DEBIAN, script), path.join(control, script))
    fs.chmodSync(path.join(control, script), 0o755)
  }
  fs.writeFileSync(path.join(control, 'conffiles'), '/etc/default/flintnotes\n')
  const size = Math.ceil(
    fs
      .readdirSync(stage, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile())
      .reduce((sum, entry) => sum + fs.statSync(path.join(entry.parentPath, entry.name)).size, 0) / 1024,
  )
  fs.writeFileSync(
    path.join(control, 'control'),
    [
      'Package: flintnotes',
      `Version: ${version}`,
      'Architecture: all',
      'Section: web',
      'Priority: optional',
      'Maintainer: FlintNotes <noreply@github.com>',
      'Depends: nodejs (>= 20), tar, adduser',
      `Installed-Size: ${size}`,
      'Homepage: https://github.com/jestxfot/FlintNotes',
      'Description: FlintNotes server: markdown notes served to the Windows app and phones',
      ' The notes and everything that works on them run here, as a systemd service; the',
      ' Windows app is only the window. `flintnotes pair` shows the address and key to',
      ' connect with. The service updates itself from the project\'s releases.',
      '',
    ].join('\n'),
  )
  assertNothingPersonal(stage)
  const deb = `flintnotes_${version}_all.deb`
  execFileSync('dpkg-deb', ['--root-owner-group', '-Zxz', '--build', stage, path.join(OUT, deb)], { stdio: 'pipe' })

  const mb = (file) => (fs.statSync(path.join(OUT, file)).size / 1024 / 1024).toFixed(1)
  console.log(`Готово: ${path.relative(ROOT, OUT)}/${deb} (${mb(deb)} МБ), ${tarball} (${mb(tarball)} МБ) и server-latest.json — их выкладывают в релиз «server» на GitHub`)
} finally {
  fs.rmSync(work, { recursive: true, force: true })
}
