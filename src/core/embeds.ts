import type { App } from './app'
import { Events, type Off } from './events'
import { extname } from './path'

export interface EmbedContext {
  app: App
  /** The embedded file. */
  path: string
  /** `#heading` or `#page=3` from the link, or `''`. */
  subpath: string
  /** Text after `|` in the link; viewers read a height in pixels from it. */
  alias: string
  /** The note containing the embed. */
  sourcePath: string
  /** How many embeds deep the containing note already is. */
  depth: number
}

/** Draws an embedded file inside `el`; the returned function tears it down. */
export type EmbedRenderer = (el: HTMLElement, ctx: EmbedContext) => Off | void

/** Which plugin draws `![[file]]` for which kind of file. */
export class Embeds extends Events<{ change: [] }> {
  private byExtension = new Map<string, EmbedRenderer>()

  register(extensions: string[], renderer: EmbedRenderer): Off {
    for (const ext of extensions) this.byExtension.set(ext, renderer)
    this.trigger('change')
    return () => {
      for (const ext of extensions) if (this.byExtension.get(ext) === renderer) this.byExtension.delete(ext)
      this.trigger('change')
    }
  }

  get(path: string): EmbedRenderer | undefined {
    return this.byExtension.get(extname(path))
  }
}
