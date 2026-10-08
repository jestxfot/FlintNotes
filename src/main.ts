import { flushSync, mount } from 'svelte'
import * as api from './api'
import { errorMessage } from './core/notice'
import { app } from './instance'
import './ui/app.css'
import AppView from './ui/App.svelte'

// `flint` is the API for plugins loaded from the vault; `app` is handy in the console.
Object.assign(globalThis, { flint: api, app })

const target = document.getElementById('app')!

try {
  await app.init()
  mount(AppView, { target })
  // The shell registers its own parts (file list, core commands) when mounted.
  // Plugins load after that, so what they add comes second.
  flushSync()
  await app.plugins.init()
} catch (err) {
  target.innerHTML = '<div class="fatal"></div>'
  target.firstElementChild!.textContent = `Не удалось подключиться к серверу FlintNotes: ${errorMessage(err)}`
}
