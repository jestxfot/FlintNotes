const rules = new Intl.PluralRules('ru')

/** `plural(3, ['задача', 'задачи', 'задач'])` -> `3 задачи`. */
export function plural(n: number, forms: [one: string, few: string, many: string]): string {
  const rule = rules.select(n)
  return `${n} ${rule === 'one' ? forms[0] : rule === 'few' ? forms[1] : forms[2]}`
}
