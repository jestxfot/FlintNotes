// Builds FlintNotes for Windows from WSL (no Windows tools needed) and publishes it for the app's updates:
//   updates/FlintNotes-Setup-<version>.exe   the installer (NSIS): for the current user, no administrator
//   updates/latest.json                      which installer is the newest; the installed app looks here
// Run `npm run release` before (`npm run installer` does both).
//
// The installed app runs the build of this project's `release/` (npm run release keeps it new, as for the
// browser), and falls back to a copy of it inside the app where the project's folder cannot be reached.
// The installer itself is only needed again for a new Electron, a new icon or a new desktop/stub.cjs:
// the running app sees a new latest.json and offers to restart into it (desktop/main.ts).
import { downloadArtifact } from '@electron/get'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import * as ResEdit from 'resedit'

const ROOT = path.resolve(import.meta.dirname, '..')
// Elsewhere for a try that must not touch the project's own (FLINT_RELEASE_OUT as for release.mjs, FLINT_UPDATES_OUT).
const RELEASE = path.resolve(process.env.FLINT_RELEASE_OUT ?? path.join(ROOT, 'release'))
const UPDATES = path.resolve(process.env.FLINT_UPDATES_OUT ?? path.join(ROOT, 'updates'))
const STAGE = path.join(RELEASE, 'windows', 'FlintNotes')
const CACHE = path.join(os.homedir(), '.cache', 'flintnotes')
const ICON = path.join(ROOT, 'desktop', 'icons', 'flintnotes.ico')
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
const ELECTRON = JSON.parse(fs.readFileSync(path.join(ROOT, 'node_modules', 'electron', 'package.json'), 'utf8')).version
const build = JSON.parse(fs.readFileSync(path.join(RELEASE, 'build.json'), 'utf8')).id
if (!fs.existsSync(path.join(RELEASE, 'desktop.mjs'))) throw new Error('Нет release/desktop.mjs: сначала npm run release')

/** A path of WSL on a Windows drive (/mnt/j/...) as Windows writes it (J:\...); a folder Windows cannot see has none. */
const windowsPath = (posix) => (/^\/mnt\/[a-z]\//.test(posix) ? posix.replace(/^\/mnt\/([a-z])\//, (_, drive) => `${drive.toUpperCase()}:\\`).replace(/\//g, '\\') : undefined)

const sevenZip = (() => {
  const bin = path.join(ROOT, 'node_modules', '7zip-bin', 'linux', 'x64', '7za')
  fs.chmodSync(bin, 0o755)
  return (...args) => execFileSync(bin, args, { stdio: 'ignore' })
})()

// ---- NSIS: the same build of it electron-builder uses, which has a makensis for Linux
const NSIS = path.join(CACHE, 'nsis-3.0.4.1')
if (!fs.existsSync(path.join(NSIS, 'linux', 'makensis'))) {
  console.log('Загружаю NSIS…')
  fs.mkdirSync(CACHE, { recursive: true })
  const archive = path.join(CACHE, 'nsis-3.0.4.1.7z')
  const res = await fetch('https://github.com/electron-userland/electron-builder-binaries/releases/download/nsis-3.0.4.1/nsis-3.0.4.1.7z')
  if (!res.ok) throw new Error(`NSIS не загрузился: ${res.status}`)
  fs.writeFileSync(archive, Buffer.from(await res.arrayBuffer()))
  sevenZip('x', '-y', `-o${NSIS}`, archive)
  fs.rmSync(archive)
  fs.chmodSync(path.join(NSIS, 'linux', 'makensis'), 0o755)
}

// ---- the app's folder: Electron for Windows (checked against its published checksums), renamed and with our icon
console.log(`Electron ${ELECTRON} для Windows…`)
const zip = await downloadArtifact({ version: ELECTRON, platform: 'win32', arch: 'x64', artifactName: 'electron' })
fs.rmSync(path.dirname(STAGE), { recursive: true, force: true })
fs.mkdirSync(STAGE, { recursive: true })
sevenZip('x', '-y', `-o${STAGE}`, zip)
fs.rmSync(path.join(STAGE, 'resources', 'default_app.asar'), { force: true })
fs.renameSync(path.join(STAGE, 'electron.exe'), path.join(STAGE, 'FlintNotes.exe'))

const exePath = path.join(STAGE, 'FlintNotes.exe')
// Electron's signature no longer holds for a changed program, so it goes.
const exe = ResEdit.NtExecutable.from(fs.readFileSync(exePath), { ignoreCert: true })
const resources = ResEdit.NtExecutableResource.from(exe)
const group = ResEdit.Resource.IconGroupEntry.fromEntries(resources.entries)[0]
ResEdit.Resource.IconGroupEntry.replaceIconsForResource(resources.entries, group.id, group.lang, ResEdit.Data.IconFile.from(fs.readFileSync(ICON)).icons.map((icon) => icon.data))
const info = ResEdit.Resource.VersionInfo.fromEntries(resources.entries)[0]
const [major, minor, patch] = pkg.version.split('.').map(Number)
const language = info.getAllLanguagesForStringValues()[0]
info.removeStringValue(language, 'SquirrelAwareVersion')
info.setStringValues(language, {
  CompanyName: 'FlintNotes',
  FileDescription: 'FlintNotes',
  ProductName: 'FlintNotes',
  InternalName: 'FlintNotes',
  OriginalFilename: 'FlintNotes.exe',
  LegalCopyright: `Electron ${ELECTRON}`,
})
info.setFileVersion(major, minor, patch, 0, language.lang)
info.setProductVersion(major, minor, patch, 0, language.lang)
info.outputToResourceEntries(resources.entries)
resources.outputResource(exe)
fs.writeFileSync(exePath, Buffer.from(exe.generate()))

// ---- what the app runs: the stub, where the project is, and a copy of the build for when it is not there
const app = path.join(STAGE, 'resources', 'app')
fs.mkdirSync(app, { recursive: true })
fs.copyFileSync(path.join(ROOT, 'desktop', 'stub.cjs'), path.join(app, 'main.cjs'))
fs.writeFileSync(path.join(app, 'package.json'), JSON.stringify({ name: 'flintnotes', productName: 'FlintNotes', version: pkg.version, main: 'main.cjs', private: true }, null, 2))
fs.writeFileSync(path.join(app, 'project.json'), JSON.stringify({ release: windowsPath(RELEASE), updates: windowsPath(UPDATES) }, null, 2))
for (const name of ['desktop.mjs', 'preload.cjs', 'server.mjs', 'build.json', 'icons', 'public']) fs.cpSync(path.join(RELEASE, name), path.join(app, 'release', name), { recursive: true })

// Which shell this is: the app offers the installer's update only when it brings a shell of another make.
const shellHash = createHash('sha256')
for (const file of ['desktop/stub.cjs', 'desktop/installer.nsi', 'desktop/icons/flintnotes.ico']) shellHash.update(fs.readFileSync(path.join(ROOT, file)))
const shell = `${pkg.version}+electron-${ELECTRON}+${shellHash.digest('hex').slice(0, 12)}`
fs.writeFileSync(path.join(app, 'shell.json'), JSON.stringify({ shell, version: pkg.version, electron: ELECTRON, build }, null, 2))

// ---- the installer, published with the newest-version note the installed app reads
console.log('Собираю установщик…')
fs.mkdirSync(UPDATES, { recursive: true })
const setupName = `FlintNotes-Setup-${pkg.version}-${build.replace(/[:.]/g, '-')}.exe`
const setup = path.join(UPDATES, setupName)
execFileSync(
  path.join(NSIS, 'linux', 'makensis'),
  ['-V2', '-INPUTCHARSET', 'UTF8', `-DVERSION=${pkg.version}`, `-DVERSION4=${major}.${minor}.${patch}.0`, `-DSOURCE=${STAGE}`, `-DOUTFILE=${setup}`, `-DICON=${ICON}`, path.join(ROOT, 'desktop', 'installer.nsi')],
  { stdio: 'inherit', env: { ...process.env, NSISDIR: NSIS } },
)
const sha256 = createHash('sha256').update(fs.readFileSync(setup)).digest('hex')
// The same installer under a plain name, for installing by hand.
fs.copyFileSync(setup, path.join(path.dirname(UPDATES), 'FlintNotes-Setup.exe'))
// Older installers go; the newest-but-one stays, should the newest have to be taken back.
const older = fs.readdirSync(UPDATES).filter((name) => /^FlintNotes-Setup-.*\.exe$/.test(name) && name !== setupName).sort()
for (const name of older.slice(0, -1)) fs.rmSync(path.join(UPDATES, name), { force: true })
// Written last: an app that reads it finds the installer complete.
fs.writeFileSync(path.join(UPDATES, 'latest.json'), JSON.stringify({ shell, version: pkg.version, electron: ELECTRON, build, file: setupName, sha256 }, null, 2))

const size = (fs.statSync(setup).size / 1024 / 1024).toFixed(0)
console.log(`Готово: FlintNotes-Setup.exe (${size} МБ) — установка двойным щелчком; updates/${setupName} и latest.json — для обновления уже установленного приложения`)
