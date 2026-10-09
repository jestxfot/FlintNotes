import type { BuiltinManifest } from '../../api'

export default {
  name: 'Dataview',
  description:
    'Запросы к заметкам на языке Dataview: блоки ```dataview (TABLE, LIST, TASK, CALENDAR), поля «ключ:: значение» в тексте, вычисления `= выражение` и скрипты ```dataviewjs',
} satisfies BuiltinManifest
