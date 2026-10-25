// Before anything reads the time: dates in the app are Moscow time, not the computer's zone.
import './core/timezone'
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

// A phone opens FlintNotes over plain http from the computer (Настройки → Программа → Телефон), and a page that is
// not secure gets no clipboard: copying goes the old way there, and reading it finds nothing.
if (!navigator.clipboard)
  Object.defineProperty(navigator, 'clipboard', {
    value: {
      writeText: async (text: string) => {
        const area = document.body.appendChild(document.createElement('textarea'))
        area.value = text
        area.style.cssText = 'position:fixed;opacity:0'
        area.select()
        const done = document.execCommand('copy')
        area.remove()
        if (!done) throw new Error('Не удалось скопировать')
      },
      readText: async () => '',
    },
  })

const target = document.getElementById('app')!

// The stages of starting up, for the timing that `core:startup-timing` shows.
const stage = (name: string) => performance.mark(`flint:${name}`)
try {
  stage('code')
  // Pictures of the web go through the server's way to it, a proxy if one is set (see public/web-sw.js).
  void navigator.serviceWorker?.register('/web-sw.js').catch(() => {})
  await app.init()
  stage('init')
  mount(AppView, { target })
  // The shell registers its own parts (file list, core commands) when mounted.
  // Plugins load after that, so what they add comes second.
  flushSync()
  document.getElementById('splash')?.remove()
  stage('shell')
  await app.plugins.init()
  stage('plugins')
  // Tabs come back last: opened earlier, they would show raw Markdown until the
  // plugins that draw links, tables and properties had loaded.
  app.workspace.restore()
  // The address decides which note is on screen: a link to a note opens that note.
  app.router.start()
  stage('tabs')
  // Reading every note for the index is the heaviest part of starting up. It
  // begins only now, so it cannot delay the notes the user is waiting to see.
  app.metadata.load()
} catch (err) {
  document.getElementById('splash')?.remove()
  target.innerHTML = '<div class="fatal"></div>'
  target.firstElementChild!.textContent = `Не удалось подключиться к серверу FlintNotes: ${errorMessage(err)}`
}
