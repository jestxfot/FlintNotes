import type { BuiltinManifest } from '../../api'

export default {
  name: 'Ежедневные заметки',
  description: 'Заметка на каждый день: где она лежит, как называется и из какого шаблона создаётся. Alt+D открывает заметку на сегодня; по желанию она создаётся и открывается сама при запуске и после полуночи. Настройки берутся из Obsidian',
} satisfies BuiltinManifest
