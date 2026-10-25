// Builds FlintNotes for Windows and Linux from WSL (no Windows tools, no Wine), ready to publish:
//   publish/FlintNotes-Setup-<version>.exe         the Windows installer (NSIS): for the current user, no administrator
//   publish/FlintNotes-<version>-x86_64.AppImage   the Linux app in one file
//   publish/latest.json                            the version, and each system's file with its checksum
// Both go to a release of the project on GitHub (tag v<version>); installed apps look for the newest
// release's latest.json and update themselves from it (desktop/main.ts). A new release needs a new
// `version` in package.json. Run it as `npm run installer`, which builds from the last commit (scripts/publish-build.mjs).
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
// Where the apps' folders are put together; only material for the packages, removed after.
const STAGES = path.join(RELEASE, 'packages')
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

const [major, minor, patch] = pkg.version.split('.').map(Number)
fs.rmSync(STAGES, { recursive: true, force: true })
fs.rmSync(PUBLISH, { recursive: true, force: true })
fs.mkdirSync(PUBLISH, { recursive: true })

/** Electron for one system (checked against its published checksums), unpacked into `dir`. */
async function electronFor(platform, dir) {
  console.log(`Electron ${ELECTRON} для ${platform === 'win32' ? 'Windows' : 'Linux'}…`)
  const zip = await downloadArtifact({ version: ELECTRON, platform, arch: 'x64', artifactName: 'electron' })
  fs.mkdirSync(dir, { recursive: true })
  sevenZip('x', '-y', `-o${dir}`, zip)
  fs.rmSync(path.join(dir, 'resources', 'default_app.asar'), { force: true })
}

// Nothing of this computer may go out with the app: its folders, the name and address its git signs with.
const gitConfig = (key) => {
  try {
    return execFileSync('git', ['config', key], { cwd: ROOT, encoding: 'utf8' }).trim()
  } catch {
    return ''
  }
}
// Built from a copy of the commit (scripts/publish-build.mjs), the project's own folder is looked for too.
const personal = [ROOT, process.env.FLINT_PROJECT ?? '', os.homedir(), gitConfig('user.name'), gitConfig('user.email')].filter((mark) => mark.length > 3)
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? walk(path.join(dir, entry.name)) : [path.join(dir, entry.name)]))

/** What the app runs (resources/app): the stub and its own copy of the build, checked to carry nothing personal. */
function appFolder(resources) {
  const app = path.join(resources, 'app')
  fs.mkdirSync(app, { recursive: true })
  fs.copyFileSync(path.join(ROOT, 'desktop', 'stub.cjs'), path.join(app, 'main.cjs'))
  fs.writeFileSync(path.join(app, 'package.json'), JSON.stringify({ name: 'flintnotes', productName: 'FlintNotes', version: pkg.version, main: 'main.cjs', private: true }, null, 2))
  for (const name of ['desktop.mjs', 'preload.cjs', 'server.mjs', 'build.json', 'icons', 'public', 'sandbox']) fs.cpSync(path.join(RELEASE, name), path.join(app, 'release', name), { recursive: true })
  // Which version this is: the app compares it with the newest release.
  fs.writeFileSync(path.join(app, 'shell.json'), JSON.stringify({ version: pkg.version, electron: ELECTRON, build }, null, 2))
  for (const file of walk(app).filter((one) => /\.(mjs|cjs|js|json|html|css|txt|map|md)$/.test(one))) {
    const text = fs.readFileSync(file, 'utf8')
    const found = personal.find((mark) => text.includes(mark))
    if (found) throw new Error(`В сборку попало бы личное («${found}») в ${path.relative(app, file)}: сборка остановлена`)
  }
}

const published = (file) => ({ file: path.basename(file), sha256: createHash('sha256').update(fs.readFileSync(file)).digest('hex') })

// ---- Windows: FlintNotes.exe (Electron renamed, with our icon and name) and its installer
async function windows() {
  const stage = path.join(STAGES, 'windows')
  await electronFor('win32', stage)
  const exePath = path.join(stage, 'FlintNotes.exe')
  fs.renameSync(path.join(stage, 'electron.exe'), exePath)
  // Electron's signature no longer holds for a changed program, so it goes.
  const exe = ResEdit.NtExecutable.from(fs.readFileSync(exePath), { ignoreCert: true })
  const resources = ResEdit.NtExecutableResource.from(exe)
  const group = ResEdit.Resource.IconGroupEntry.fromEntries(resources.entries)[0]
  ResEdit.Resource.IconGroupEntry.replaceIconsForResource(resources.entries, group.id, group.lang, ResEdit.Data.IconFile.from(fs.readFileSync(ICON)).icons.map((icon) => icon.data))
  const info = ResEdit.Resource.VersionInfo.fromEntries(resources.entries)[0]
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
  appFolder(path.join(stage, 'resources'))

  console.log('Собираю установщик для Windows…')
  const setup = path.join(PUBLISH, `FlintNotes-Setup-${pkg.version}.exe`)
  execFileSync(
    path.join(NSIS, 'linux', 'makensis'),
    ['-V2', '-INPUTCHARSET', 'UTF8', `-DVERSION=${pkg.version}`, `-DVERSION4=${major}.${minor}.${patch}.0`, `-DSOURCE=${stage}`, `-DOUTFILE=${setup}`, `-DICON=${ICON}`, path.join(ROOT, 'desktop', 'installer.nsi')],
    { stdio: 'inherit', env: { ...process.env, NSISDIR: NSIS } },
  )
  return setup
}

// ---- Linux: an AppImage, one file that runs on most systems and replaces itself with a new version
const APPIMAGETOOL = path.join(CACHE, 'appimagetool-1.9.1-x86_64.AppImage')
async function linux() {
  const dir = path.join(STAGES, 'FlintNotes.AppDir')
  const lib = path.join(dir, 'usr', 'lib', 'flintnotes')
  await electronFor('linux', lib)
  fs.renameSync(path.join(lib, 'electron'), path.join(lib, 'flintnotes'))
  // The archive keeps no permissions: the programs and libraries are made runnable again.
  for (const file of walk(lib).filter((one) => /(flintnotes|chrome_crashpad_handler|chrome-sandbox|\.so(\.\d+)*)$/.test(one))) fs.chmodSync(file, 0o755)
  appFolder(path.join(lib, 'resources'))
  fs.writeFileSync(
    path.join(dir, 'AppRun'),
    `#!/bin/sh
# FlintNotes in an AppImage. Chromium's sandbox needs the system to let programs make user namespaces;
# where it does not (some Ubuntu), the app runs without that sandbox rather than not at all.
HERE="$(dirname "$(readlink -f "$0")")"
if unshare -Ur true 2>/dev/null; then exec "$HERE/usr/lib/flintnotes/flintnotes" "$@"; fi
exec "$HERE/usr/lib/flintnotes/flintnotes" --no-sandbox "$@"
`,
    { mode: 0o755 },
  )
  fs.writeFileSync(path.join(dir, 'flintnotes.desktop'), '[Desktop Entry]\nType=Application\nName=FlintNotes\nComment=Заметки в Markdown\nExec=flintnotes %U\nIcon=flintnotes\nCategories=Office;\nTerminal=false\n')
  fs.copyFileSync(path.join(ROOT, 'desktop', 'icons', 'flintnotes.png'), path.join(dir, 'flintnotes.png'))
  fs.copyFileSync(path.join(ROOT, 'desktop', 'icons', 'flintnotes.png'), path.join(dir, '.DirIcon'))

  if (!fs.existsSync(APPIMAGETOOL)) {
    console.log('Загружаю appimagetool…')
    const res = await fetch('https://github.com/AppImage/appimagetool/releases/download/1.9.1/appimagetool-x86_64.AppImage')
    if (!res.ok) throw new Error(`appimagetool не загрузился: ${res.status}`)
    fs.mkdirSync(CACHE, { recursive: true })
    fs.writeFileSync(APPIMAGETOOL, Buffer.from(await res.arrayBuffer()), { mode: 0o755 })
  }
  console.log('Собираю AppImage для Linux…')
  const image = path.join(PUBLISH, `FlintNotes-${pkg.version}-x86_64.AppImage`)
  // appimagetool asks the `file` command what machine the programs are for. Where it is not installed (and cannot be,
  // without root), a stand-in gives the one answer there is: they are all for x86-64.
  const tools = path.join(STAGES, 'tools')
  let PATH = process.env.PATH ?? ''
  try {
    execFileSync('file', ['--version'], { stdio: 'ignore' })
  } catch {
    fs.mkdirSync(tools, { recursive: true })
    fs.writeFileSync(path.join(tools, 'file'), '#!/bin/sh\necho "ELF 64-bit LSB executable, x86-64, dynamically linked"\n', { mode: 0o755 })
    PATH = `${tools}:${PATH}`
  }
  // Unpacked and run in place: WSL has no FUSE to mount it with.
  execFileSync(APPIMAGETOOL, ['--no-appstream', dir, image], { stdio: 'inherit', env: { ...process.env, PATH, ARCH: 'x86_64', APPIMAGE_EXTRACT_AND_RUN: '1' } })
  return image
}

const setup = await windows()
const image = await linux()
// Written last: the note installed apps read, once both files are complete.
fs.writeFileSync(path.join(PUBLISH, 'latest.json'), JSON.stringify({ version: pkg.version, electron: ELECTRON, build, windows: published(setup), linux: published(image) }, null, 2))
// The apps' folders were only the packages' material.
fs.rmSync(STAGES, { recursive: true, force: true })

const size = (file) => `${(fs.statSync(file).size / 1024 / 1024).toFixed(0)} МБ`
console.log(`Готово: publish/${path.basename(setup)} (${size(setup)}), publish/${path.basename(image)} (${size(image)}) и publish/latest.json — их выкладывают в релиз v${pkg.version} на GitHub`)
