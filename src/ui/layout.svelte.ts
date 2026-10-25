// The phone's frame: whether this device gets it, and what a touch screen needs that a mouse does not.
//
// A phone or a small tablet (a finger, not a mouse, and a narrow screen) gets the frame of its own: a bar on
// top, a bar of buttons below, the sidebars as drawers and menus as sheets from the bottom. The choice is the
// device's, not the vault's (the vault's settings are the same on the computer and on the phone): kept in
// this browser, and `?layout=mobile` or `?layout=desktop` in the address sets it too.

const KEY = 'flint-layout'
type Choice = 'mobile' | 'desktop' | 'auto'

const touchScreen = matchMedia('(pointer: coarse) and (max-width: 900px), (pointer: coarse) and (max-height: 520px)')

function storedChoice(): Choice {
  const asked = new URLSearchParams(location.search).get('layout')
  if (asked === 'mobile' || asked === 'desktop' || asked === 'auto') {
    remember(asked)
    return asked
  }
  try {
    const kept = localStorage.getItem(KEY)
    return kept === 'mobile' || kept === 'desktop' ? kept : 'auto'
  } catch {
    return 'auto'
  }
}

function remember(choice: Choice) {
  try {
    if (choice === 'auto') localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, choice)
  } catch {
    // A private window: the choice lasts as long as the page.
  }
}

let choice = storedChoice()
const decide = () => (choice === 'auto' ? touchScreen.matches : choice === 'mobile')

export const layout = $state({ mobile: decide() })

function apply() {
  layout.mobile = decide()
  document.documentElement.classList.toggle('mobile', layout.mobile)
}
touchScreen.addEventListener('change', apply)
apply()

/** Sets the frame of this device: the phone's, the computer's, or as the screen says. */
export function setLayout(next: Choice): void {
  choice = next
  remember(next)
  apply()
}

/** The other frame than the one on screen, kept for this device. */
export const toggleLayout = () => setLayout(layout.mobile ? 'desktop' : 'mobile')

// ---- the height left above the keyboard
//
// Android gives the page the room above the keyboard by itself (`interactive-widget` in index.html); iOS lays
// the keyboard over the page. There the visible part is read from the visual viewport and the frame is fitted
// to it, so the bar over the keyboard stays in sight.
const viewport = window.visualViewport
function fit() {
  if (!viewport || !layout.mobile) return document.documentElement.style.removeProperty('--visible-height')
  document.documentElement.style.setProperty('--visible-height', `${Math.round(viewport.height)}px`)
}
viewport?.addEventListener('resize', fit)
fit()

// ---- a long press opens the menu of what is under the finger
//
// Android sends `contextmenu` for a long press by itself, Safari on the iPhone does not. Where nothing came,
// one is sent after the wait; a finger that moved or lifted sends nothing.
let press: { timer: ReturnType<typeof setTimeout>; x: number; y: number; target: EventTarget | null; native: boolean } | null = null
const HOLD = 560

window.addEventListener(
  'touchstart',
  (event) => {
    if (!layout.mobile || event.touches.length !== 1) return (press = cancel(press))
    const touch = event.touches[0]
    const target = event.target as Element | null
    // The editor keeps its own long press: selecting words.
    if (target?.closest?.('.cm-content, input, textarea, [contenteditable="true"]')) return (press = cancel(press))
    cancel(press)
    const started = { timer: 0 as unknown as ReturnType<typeof setTimeout>, x: touch.clientX, y: touch.clientY, target, native: false }
    started.timer = setTimeout(() => {
      if (press !== started || started.native) return
      press = null
      started.target?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: started.x, clientY: started.y, button: 2 }))
    }, HOLD)
    press = started
  },
  { passive: true, capture: true },
)
window.addEventListener(
  'touchmove',
  (event) => {
    const touch = event.touches[0]
    if (press && touch && Math.hypot(touch.clientX - press.x, touch.clientY - press.y) > 10) press = cancel(press)
  },
  { passive: true, capture: true },
)
for (const name of ['touchend', 'touchcancel'] as const) window.addEventListener(name, () => (press = cancel(press)), { passive: true, capture: true })
window.addEventListener('contextmenu', (event) => event.isTrusted && press && (press.native = true), true)

function cancel(started: typeof press): null {
  if (started) clearTimeout(started.timer)
  return null
}
