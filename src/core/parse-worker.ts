/// <reference lib="webworker" />
// Parses notes for the index on a thread of its own: a first start reads thousands of notes,
// and parsing them on the page's thread would hold the page up for seconds.
import { parseMarkdown, type CachedMetadata } from './metadata'

export interface ParseRequest {
  id: number
  notes: [path: string, text: string][]
}

export interface ParseReply {
  id: number
  parsed: [path: string, meta: CachedMetadata][]
}

onmessage = (event: MessageEvent<ParseRequest>) => {
  const { id, notes } = event.data
  const parsed: ParseReply['parsed'] = notes.map(([path, text]) => [path, parseMarkdown(text)])
  postMessage({ id, parsed } satisfies ParseReply)
}
