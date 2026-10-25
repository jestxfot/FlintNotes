// FlintNotes.exe starts here (resources/app/main.cjs of the installed app, see scripts/installer.mjs).
// It runs the build of the project's folder (named in project.json), which `npm run release` keeps new;
// where that folder cannot be reached, the copy of the build that came with the installer.
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

let project = {}
try {
  project = JSON.parse(fs.readFileSync(path.join(__dirname, 'project.json'), 'utf8'))
} catch {}
const bundled = path.join(__dirname, 'release')
const release = project.release && fs.existsSync(path.join(project.release, 'desktop.mjs')) ? project.release : bundled
if (release === bundled) process.env.FLINT_BUNDLED = '1'
// Where the installer puts new versions of the app itself (desktop/main.ts looks there).
if (project.updates) process.env.FLINT_UPDATES_DIR = project.updates
process.env.FLINT_SHELL = path.join(__dirname, 'shell.json')

import(pathToFileURL(path.join(release, 'desktop.mjs')).href).catch((err) => {
  require('electron').dialog.showErrorBox('FlintNotes', `Не удалось запустить ${release}\\desktop.mjs:\n\n${err && err.stack ? err.stack : err}`)
  process.exit(1)
})
