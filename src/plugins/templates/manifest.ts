import type { BuiltinManifest } from '../../api'

export default {
  name: 'Шаблоны',
  description:
    'Шаблоны заметок с кодом в стиле Templater (<% tp.date.now() %>, <%* ... %>) и подстановками {{date}}. Свой шаблон для папки или один общий для всех новых заметок',
} satisfies BuiltinManifest
