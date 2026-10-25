// FlintNotes.exe starts here (resources/app/main.cjs of the installed app, see scripts/installer.mjs).
// The installed app runs the copy of the build that came with its installer, and nothing else: a new
// version comes as a new installer (desktop/main.ts fetches it from the project's releases).
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const release = path.join(__dirname, 'release')
process.env.FLINT_BUNDLED = '1'
// Which version this is, to compare with the newest release.
process.env.FLINT_SHELL = path.join(__dirname, 'shell.json')

import(pathToFileURL(path.join(release, 'desktop.mjs')).href).catch((err) => {
  require('electron').dialog.showErrorBox('FlintNotes', `Не удалось запустить ${release}\\desktop.mjs:\n\n${err && err.stack ? err.stack : err}`)
  process.exit(1)
})
