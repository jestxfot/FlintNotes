/**
 * A piece of a note as it reads, without the marks it is written with: a link
 * is its visible text, bold is just its words, a list item has no dash. This
 * is what is copied from a note being read, e.g. to paste into a voice-over
 * editor that would otherwise read the brackets aloud.
 */
export function plainText(markdown: string): string {
  const eol = markdown.includes('\r\n') ? '\r\n' : '\n'
  const out: string[] = []
  let fence: string | null = null
  // Comments are not part of what the note says, on one line or over several.
  const lines = markdown.replace(/%%[\s\S]*?%%/g, '').split(/\r?\n/)
  for (const raw of lines) {
    const mark = /^\s*(`{3,}|~{3,})/.exec(raw)
    if (fence) {
      // Code is copied as written; only the lines that open and close its block go.
      if (mark && mark[1].startsWith(fence)) fence = null
      else out.push(raw)
      continue
    }
    if (mark) {
      fence = mark[1]
      continue
    }
    // A rule between parts and the row under a table's head say nothing.
    if (/^\s*(?:[-*_]\s*){3,}$/.test(raw) || /^\s*\|?\s*:?-{2,}:?\s*(?:\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(raw)) continue
    let line = raw
      // Quote marks, with the kind of a callout: "> [!note] Title" reads "Title".
      .replace(/^(\s*)(?:>\s?)+(?:\[![^\]]*\][+-]?\s*)?/, '$1')
      .replace(/^(\s*)#{1,6}\s+/, '$1')
      .replace(/^(\s*)(?:[-*+]|\d+[.)])\s+(?:\[.\]\s+)?/, '$1')
    if (/^\s*\|.*\|\s*$/.test(line)) line = line.trim().slice(1, -1).split(/(?<!\\)\|/).map((cell) => cell.trim()).join('\t')
    out.push(inline(line))
  }
  return out.join(eol)
}

function inline(line: string): string {
  // Code keeps its characters: it is set aside while the marks around it are taken off.
  const code: string[] = []
  let text = line.replace(/(`+)(.+?)\1/g, (_, __, body: string) => `\u0000${code.push(body) - 1}\u0000`)
  const escaped: string[] = []
  text = text.replace(/\\([\\`*_{}[\]()#+\-.!|~=<>])/g, (_, char: string) => `\u0001${escaped.push(char) - 1}\u0001`)
  text = text
    // An embedded note or picture is not text of this note.
    .replace(/!\[\[[^\]]*\]\]/g, '')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    // [[note#part|shown]] reads "shown"; without it, the name of the note or of its part.
    .replace(/\[\[([^\]|]*)(?:\|([^\]]*))?\]\]/g, (_, target: string, shown?: string) => {
      if (shown !== undefined) return shown
      const [note, ...parts] = target.split('#')
      return note ? note.replace(/^.*\//, '').replace(/\.md$/, '') : parts.join(' ').replace(/^\^/, '')
    })
    .replace(/\[([^\]]*)\]\((?:[^()]|\([^()]*\))*\)/g, '$1')
    .replace(/\[\^[^\]]+\]/g, '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/?[a-zA-Z][^>]*>/g, '')
    .replace(/(\*\*\*|___)(?=\S)(.+?)(?<=\S)\1/g, '$2')
    .replace(/(\*\*|__)(?=\S)(.+?)(?<=\S)\1/g, '$2')
    .replace(/(?<![\p{L}\p{N}*])\*(?=\S)([^*]+?)(?<=\S)\*(?![\p{L}\p{N}*])/gu, '$1')
    .replace(/(?<![\p{L}\p{N}_])_(?=\S)([^_]+?)(?<=\S)_(?![\p{L}\p{N}_])/gu, '$1')
    .replace(/~~(?=\S)(.+?)(?<=\S)~~/g, '$1')
    .replace(/==(?=\S)(.+?)(?<=\S)==/g, '$1')
    // The id of a block at the end of its line.
    .replace(/\s+\^[A-Za-z0-9-]+\s*$/, '')
  // Where something was taken out between two words, one space is left, not two.
  text = text.replace(/(\S) {2,}(?=\S)/g, '$1 ').replace(/\s+$/, '')
  return text.replace(/\u0001(\d+)\u0001/g, (_, i: string) => escaped[Number(i)]).replace(/\u0000(\d+)\u0000/g, (_, i: string) => code[Number(i)])
}
