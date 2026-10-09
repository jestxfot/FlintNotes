/** Thrown for a mistake in a template; the message is shown to the user. */
export class TemplateError extends Error {}

const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor as new (...args: string[]) => (...args: unknown[]) => Promise<unknown>

/** What a value looks like when a template prints it. */
const print = (value: unknown): string => (value === null || value === undefined ? '' : String(value))

const COMMAND = /<%([-_]?)([*+]?)([\s\S]*?)([-_]?)%>/g

/**
 * Turns a template into the body of an async function, as Templater does:
 * text and `<% value %>` are appended to `tR`, `<%* code %>` runs as written
 * and may itself read or change `tR`.
 *
 * Whitespace control: `<%-` / `-%>` drop one line break on that side of the
 * command, `<%_` / `_%>` drop all whitespace there.
 */
export function compile(template: string): string {
  let body = "let tR = '';\n"
  let last = 0
  let trimNext = ''
  const text = (chunk: string, trimEnd: string) => {
    if (trimNext === '_') chunk = chunk.replace(/^\s+/, '')
    else if (trimNext === '-') chunk = chunk.replace(/^\r?\n/, '')
    if (trimEnd === '_') chunk = chunk.replace(/\s+$/, '')
    else if (trimEnd === '-') chunk = chunk.replace(/\r?\n$/, '')
    if (chunk) body += `tR += ${JSON.stringify(chunk)};\n`
  }
  for (const m of template.matchAll(COMMAND)) {
    const [, trimBefore, kind, code, trimAfter] = m
    text(template.slice(last, m.index), trimBefore)
    last = m.index + m[0].length
    trimNext = trimAfter
    if (kind === '*') body += `${code}\n`
    else if (code.trim()) body += `tR += __print(await (${code.trim().replace(/;+$/, '')}\n));\n`
  }
  text(template.slice(last), '')
  return `${body}return tR;`
}

/** Runs a compiled template. `scope` holds what the code sees: `tp`, `app`, `moment`. */
export async function execute(template: string, scope: Record<string, unknown>): Promise<string> {
  const names = Object.keys(scope)
  let run: (...args: unknown[]) => Promise<unknown>
  try {
    run = new AsyncFunction(...names, '__print', compile(template))
  } catch (err) {
    throw new TemplateError(`ошибка в коде шаблона: ${err instanceof Error ? err.message : String(err)}`)
  }
  return print(await run(...names.map((name) => scope[name]), print))
}
