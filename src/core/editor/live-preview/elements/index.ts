import type { PreviewRenderer } from '..'
import type { App } from '../../../app'
import { code } from './code'
import { frontmatter } from './frontmatter'
import { headings } from './headings'
import { inlineHtml } from './inline-html'
import { images } from './images'
import { inline } from './inline'
import { links } from './links'
import { lists } from './lists'
import { quotes } from './quotes'
import { rules } from './rules'

/** The Markdown elements Live Preview draws out of the box, one file each. */
export const builtinRenderers = (app: App): PreviewRenderer[] => [
  frontmatter,
  headings,
  inline,
  inlineHtml,
  links(app),
  images(app),
  quotes,
  lists,
  code,
  rules,
]
