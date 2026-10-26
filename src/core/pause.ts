const waiting: (() => void)[] = []
let channel: MessageChannel | undefined

/**
 * Lets the page answer clicks and typing in the middle of long work, then goes on.
 * Not a timer: the timers of a window that is hidden (in the tray, minimised) wait up to a second,
 * and later up to a minute, so an app started into the tray would read its notes that slowly,
 * and remind of nothing until it was done. A message between two ends of a channel is not held back.
 */
export function pause(): Promise<void> {
  if (!channel) {
    channel = new MessageChannel()
    channel.port1.onmessage = () => waiting.shift()?.()
  }
  return new Promise((resume) => {
    waiting.push(resume)
    channel!.port2.postMessage(0)
  })
}
