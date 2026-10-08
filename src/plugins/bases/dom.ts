type Child = Node | string | null | undefined | false

/** Creates an element: `h('button', { class: 'x', onclick }, 'text')`. */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<Omit<HTMLElementTagNameMap[K], 'style'>> & { class?: string; style?: string } = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag)
  const { class: className, style, ...rest } = props
  if (className) el.className = className
  if (style) el.setAttribute('style', style)
  Object.assign(el, rest)
  el.append(...children.filter((child): child is Node | string => child !== null && child !== undefined && child !== false))
  return el
}
