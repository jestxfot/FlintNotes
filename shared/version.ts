/** Version numbers as the project writes them: `major.minor.patch`. */

/** Whether `version` is newer than `than`; a part that is missing counts as 0, anything after the third part is ignored. */
export function isNewer(version: string, than: string): boolean {
  const [a, b] = [version, than].map((one) => one.split('.').map((part) => parseInt(part, 10) || 0))
  for (let i = 0; i < 3; i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0)
  return false
}

/** `1.2.3` and nothing else: what a feed may name as a version, since it becomes the name of a folder. */
export const isVersion = (value: unknown): value is string => typeof value === 'string' && /^\d{1,4}\.\d{1,4}\.\d{1,4}$/.test(value)
