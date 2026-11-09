import { type App } from '../../api'
import { newId, starterTemplates, templateErrors, type NoteTemplate } from './model'

/** All data belongs to this module's settings scope, independent of legacy Markdown templates. */
export class TemplateStore {
  constructor(readonly app: App) {}

  list(): NoteTemplate[] {
    const saved = this.app.settings.get<{ version: number; templates: NoteTemplate[] } | undefined>('new-note', 'library')
    return JSON.parse(JSON.stringify(saved?.templates ?? starterTemplates()))
  }

  initialize(): void {
    if (!this.app.settings.get('new-note', 'library')) this.write(starterTemplates())
  }

  private write(templates: NoteTemplate[]): void {
    this.app.settings.set('new-note', 'library', { version: 1, templates })
  }

  save(template: NoteTemplate): void {
    const errors = templateErrors(template)
    if (errors.length) throw new Error(errors.join('. '))
    const all = this.list()
    const index = all.findIndex((item) => item.id === template.id)
    const copy = JSON.parse(JSON.stringify(template)) as NoteTemplate
    if (index < 0) all.push(copy)
    else all[index] = copy
    this.write(all)
  }

  remove(id: string): void {
    this.write(this.list().filter((template) => template.id !== id))
  }

  duplicate(template: NoteTemplate): NoteTemplate {
    return { ...JSON.parse(JSON.stringify(template)), id: newId(), name: `${template.name} — копия` }
  }
}
