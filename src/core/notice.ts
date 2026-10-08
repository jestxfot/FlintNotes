let host: HTMLElement | undefined

/** Shows a short message in the corner of the screen. */
export function notice(message: string, timeout = 4000): void {
  if (!host) {
    host = document.createElement('div')
    host.className = 'notices'
    host.popover = 'manual'
    document.body.append(host)
  }
  const container = host
  const el = document.createElement('div')
  el.className = 'notice'
  el.textContent = message
  container.append(el)
  // Re-entering the top layer keeps notices above any dialog opened since.
  if (container.matches(':popover-open')) container.hidePopover()
  container.showPopover()
  setTimeout(() => {
    el.remove()
    if (!container.childElementCount && container.matches(':popover-open')) container.hidePopover()
  }, timeout)
}

export const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err))
