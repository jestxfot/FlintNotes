import { flushSync, mount } from 'svelte'
import * as api from './api'
import { moment } from './core/moment'
import { errorMessage } from './core/notice'
import { app } from './instance'
import './ui/app.css'
import AppView from './ui/App.svelte'

// `flint` is the API for plugins loaded from the vault; `app` is handy in the console.
// `moment` is global as in Obsidian: templates and task queries written for it call it directly.
Object.assign(globalThis, { flint: api, app, moment })

const target = document.getElementById('app')!

try {
  await app.init()
  mount(AppView, { target })
  // The shell registers its own parts (file list, core commands) when mounted.
  // Plugins load after that, so what they add comes second.
  flushSync()
  await app.plugins.init()
  // Tabs come back last: opened earlier, they would show raw Markdown until the
  // plugins that draw links, tables and properties had loaded.
  app.workspace.restore()
  // The address decides which note is on screen: a link to a note opens that note.
  app.router.start()
  // Reading every note for the index is the heaviest part of starting up. It
  // begins only now, so it cannot delay the notes the user is waiting to see.
  app.metadata.load()
} catch (err) {
  target.innerHTML = '<div class="fatal"></div>'
  target.firstElementChild!.textContent = `Не удалось подключиться к серверу FlintNotes: ${errorMessage(err)}`
}
