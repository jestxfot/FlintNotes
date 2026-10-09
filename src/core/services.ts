import { Events, type Off } from './events'

/**
 * Lets one plugin offer something to the others without either importing the
 * other: a plugin provides a service under a name, another asks for it and
 * simply does without when the first is switched off.
 *
 * `app.services.provide('templates', { render })` / `app.services.get('templates')`
 */
export class Services extends Events<{ change: [name: string] }> {
  private services = new Map<string, unknown>()

  provide(name: string, service: unknown): Off {
    this.services.set(name, service)
    this.trigger('change', name)
    return () => {
      if (this.services.get(name) === service) this.services.delete(name)
      this.trigger('change', name)
    }
  }

  get<T>(name: string): T | undefined {
    return this.services.get(name) as T | undefined
  }
}
