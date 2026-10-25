// Builds the installer of FlintNotes for Windows from WSL (no Windows tools needed), ready to publish:
//   publish/FlintNotes-Setup-<version>.exe   the installer (NSIS): for the current user, no administrator
//   publish/latest.json                      the version, the installer's name and checksum
// Both go to a release of the project on GitHub (tag v<version>); installed apps look for the newest
// release's latest.json and update themselves from it (desktop/main.ts). A new release needs a new
// `version` in package.json. Run `npm run release` before (`npm run installer` does both).
//
// There is only this one, public installer: the app inside it runs its own copy of the build and nothing
// of this computer's. The build fails if anything of this computer (its paths, its user) got into it.
import { downloadArtifact } from '@electron/get'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import * as ResEdit from 'resedit'

const ROOT = path.resolve(import.meta.dirname, '..')
// Elsewhere for a try that must not touch the project's own (FLINT_RELEASE_OUT as for release.mjs, FLINT_PUBLISH_OUT).
const RELEASE = path.resolve(process.env.FLINT_RELEASE_OUT ?? path.join(ROOT, 'release'))
const PUBLISH = path.resolve(process.env.FLINT_PUBLISH_OUT ?? path.join(ROOT, 'publish'))
const STAGE = path.join(RELEASE, 'windows', 'FlintNotes')
const CACHE = path.join(os.homedir(), '.cache', 'flintnotes')
const ICON = path.join(ROOT, 'desktop', 'icons', 'flintnotes.ico')
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
const ELECTRON = JSON.parse(fs.readFileSync(path.join(ROOT, 'node_modules', 'electron', 'package.json'), 'utf8')).version
const build = JSON.parse(fs.readFileSync(path.join(RELEASE, 'build.json'), 'utf8')).id
if (!fs.existsSync(path.join(RELEASE, 'desktop.mjs'))) throw new Error('Нет release/desktop.mjs: сначала npm run release')

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

// ---- what the app runs: the stub and its own copy of the build
const app = path.join(STAGE, 'resources', 'app')
fs.mkdirSync(app, { recursive: true })
fs.copyFileSync(path.join(ROOT, 'desktop', 'stub.cjs'), path.join(app, 'main.cjs'))
fs.writeFileSync(path.join(app, 'package.json'), JSON.stringify({ name: 'flintnotes', productName: 'FlintNotes', version: pkg.version, main: 'main.cjs', private: true }, null, 2))
for (const name of ['desktop.mjs', 'preload.cjs', 'server.mjs', 'build.json', 'icons', 'public']) fs.cpSync(path.join(RELEASE, name), path.join(app, 'release', name), { recursive: true })
// Which version this is: the app compares it with the newest release.
fs.writeFileSync(path.join(app, 'shell.json'), JSON.stringify({ version: pkg.version, electron: ELECTRON, build }, null, 2))

// Nothing of this computer may go out with the installer: its folders, the name and address its git signs with.
const gitConfig = (key) => {
  try {
    return execFileSync('git', ['config', key], { cwd: ROOT, encoding: 'utf8' }).trim()
  } catch {
    return ''
  }
}
const personal = [ROOT, os.homedir(), gitConfig('user.name'), gitConfig('user.email')].filter((mark) => mark.length > 3)
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? walk(path.join(dir, entry.name)) : [path.join(dir, entry.name)]))
for (const file of walk(app).filter((one) => /\.(mjs|cjs|js|json|html|css|txt|map)$/.test(one))) {
  const text = fs.readFileSync(file, 'utf8')
  const found = personal.find((mark) => text.includes(mark))
  if (found) throw new Error(`В установщик попало бы личное («${found}») в ${path.relative(app, file)}: сборка остановлена`)
}

// ---- the installer, and the note of it that installed apps read
console.log('Собираю установщик…')
fs.rmSync(PUBLISH, { recursive: true, force: true })
fs.mkdirSync(PUBLISH, { recursive: true })
const setupName = `FlintNotes-Setup-${pkg.version}.exe`
const setup = path.join(PUBLISH, setupName)
execFileSync(
  path.join(NSIS, 'linux', 'makensis'),
  ['-V2', '-INPUTCHARSET', 'UTF8', `-DVERSION=${pkg.version}`, `-DVERSION4=${major}.${minor}.${patch}.0`, `-DSOURCE=${STAGE}`, `-DOUTFILE=${setup}`, `-DICON=${ICON}`, path.join(ROOT, 'desktop', 'installer.nsi')],
  { stdio: 'inherit', env: { ...process.env, NSISDIR: NSIS } },
)
const sha256 = createHash('sha256').update(fs.readFileSync(setup)).digest('hex')
fs.writeFileSync(path.join(PUBLISH, 'latest.json'), JSON.stringify({ version: pkg.version, electron: ELECTRON, build, file: setupName, sha256 }, null, 2))
// The app's folder was only the installer's material.
fs.rmSync(path.dirname(STAGE), { recursive: true, force: true })

const size = (fs.statSync(setup).size / 1024 / 1024).toFixed(0)
console.log(`Готово: publish/${setupName} (${size} МБ) и publish/latest.json — их выкладывают в релиз v${pkg.version} на GitHub`)
