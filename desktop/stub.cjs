// FlintNotes.exe starts here (resources/app/main.cjs of the installed app, see scripts/installer.mjs).
// The installed app runs the copy of the build that came with its installer, or a newer one that a light
// update put into the user's folder (desktop/main.ts): a release whose Electron is this one brings only the
// app's own files, a few megabytes, instead of a whole installer.
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { app, dialog } = require('electron')

const own = { release: path.join(__dirname, 'release'), shell: path.join(__dirname, 'shell.json') }
const builds = path.join(process.env.FLINT_USER_DATA || path.join(app.getPath('appData'), 'FlintNotes'), 'builds')
const read = (file) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}
const newer = (version, than) => {
  const [a, b] = [version, than].map((one) => String(one).split('.').map((part) => parseInt(part, 10) || 0))
  for (let i = 0; i < 3; i++) if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0)
  return false
}

/** The build a light update left, if it is newer than the installed one and made for this Electron. */
function light() {
  const current = read(path.join(builds, 'current.json'))
  if (!current || typeof current.dir !== 'string') return null
  const dir = path.join(builds, path.basename(current.dir))
  const shell = read(path.join(dir, 'shell.json'))
  const mine = read(own.shell)
  if (!shell || !mine || shell.electron !== process.versions.electron || !newer(shell.version, mine.version)) return null
  if (!fs.existsSync(path.join(dir, 'release', 'desktop.mjs'))) return null
  return { release: path.join(dir, 'release'), shell: path.join(dir, 'shell.json'), version: shell.version }
}

function start(build) {
  process.env.FLINT_BUNDLED = '1'
  // Which version this is, to compare with the newest release; and where light updates go.
  process.env.FLINT_SHELL = build.shell
  process.env.FLINT_BUILDS = builds
  return import(pathToFileURL(path.join(build.release, 'desktop.mjs')).href)
}

const chosen = light()
start(chosen || own).catch((err) => {
  if (chosen) {
    // The new build does not start: the installed one does, and the new one is not tried again by itself.
    try {
      fs.writeFileSync(path.join(builds, 'failed.json'), JSON.stringify({ version: chosen.version, error: String((err && err.stack) || err) }))
      fs.rmSync(path.join(builds, 'current.json'), { force: true })
    } catch {}
    // Started over clean: what the new build set up before it failed must not stay in this process.
    app.relaunch()
    return app.exit(0)
  }
  throw err
}).catch((err) => {
  dialog.showErrorBox('FlintNotes', `Не удалось запустить ${own.release}\\desktop.mjs:\n\n${err && err.stack ? err.stack : err}`)
  process.exit(1)
})
