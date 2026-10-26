import type { BuiltinManifest } from '../../api'

export default {
  name: 'Анимированные картинки',
  description: 'GIF стоят меньше: большой GIF играет из копии под размер на экране (в несколько раз меньше нагрузки на процессор), а пока окно не в фокусе, анимации стоят на первом кадре',
} satisfies BuiltinManifest
