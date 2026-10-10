import type { BuiltinManifest } from '../../api'

export default {
  name: 'План дня',
  description: 'Шкала времени дня: строки заметки дня со временем («- [ ] 17:00 - 17:10 …») показаны блоками, их можно двигать, растягивать и отмечать. Формат и настройки — как у плагина Day Planner для Obsidian; напоминает о блоках плагин «Задачи»',
} satisfies BuiltinManifest
