/** The signals there are to choose from, gentlest first. */
export const SOUNDS = [
  { id: 'glass', name: 'Стекло — тихий звон' },
  { id: 'marimba', name: 'Маримба' },
  { id: 'harp', name: 'Арфа' },
  { id: 'drop', name: 'Капля' },
  { id: 'chime', name: 'Перезвон' },
  { id: 'bell', name: 'Колокольчик' },
  { id: 'soft', name: 'Две ноты' },
  { id: 'classic', name: 'Три гудка' },
] as const

/** How often the signal comes back while an alert waits for an answer. */
export type Repeat = 'once' | 'few' | 'until'

const RATE = 44_100

/** One struck note into an offline context: it sounds at once and dies away, with overtones that die sooner. */
function strike(context: OfflineAudioContext, frequency: number, at: number, length: number, loud: number, overtones: [ratio: number, share: number][] = [], type: OscillatorType = 'sine', glide = 0): void {
  for (const [ratio, share] of [[1, 1], ...overtones] as [number, number][]) {
    const oscillator = context.createOscillator()
    const gain = context.createGain()
    oscillator.type = type
    oscillator.frequency.setValueAtTime(frequency * ratio, at)
    // A drop of water: the note falls a little as it sounds.
    if (glide) oscillator.frequency.exponentialRampToValueAtTime(frequency * ratio * glide, at + length * 0.6)
    gain.gain.setValueAtTime(0.0001, at)
    // A soft start (25 ms) instead of a click; then the note dies away.
    gain.gain.exponentialRampToValueAtTime(loud * share, at + 0.025)
    gain.gain.exponentialRampToValueAtTime(0.0001, at + length / Math.sqrt(ratio))
    oscillator.connect(gain).connect(context.destination)
    oscillator.start(at)
    oscillator.stop(at + length + 0.05)
  }
}

/** The notes of each signal. */
function compose(kind: string, context: OfflineAudioContext): void {
  if (kind === 'glass') {
    // Two high notes, far apart in time, ringing long and quietly.
    strike(context, 1318.5, 0, 2.2, 0.5, [[2.01, 0.12]])
    strike(context, 1760, 0.32, 2.4, 0.4, [[2.01, 0.1]])
  } else if (kind === 'marimba') {
    // Wood: a short body and a faint fourth partial, rising.
    ;[523.25, 659.25, 783.99].forEach((f, i) => strike(context, f, i * 0.16, 0.9, 0.55, [[3.99, 0.18]]))
  } else if (kind === 'harp') {
    // Plucked strings: a soft triangle of a chord, spread out.
    ;[392, 493.88, 587.33, 783.99].forEach((f, i) => strike(context, f, i * 0.11, 1.8, 0.4, [[2, 0.2], [3, 0.06]], 'triangle'))
  } else if (kind === 'drop') {
    strike(context, 1200, 0, 0.45, 0.6, [[2, 0.08]], 'sine', 0.55)
    strike(context, 1500, 0.28, 0.4, 0.4, [[2, 0.06]], 'sine', 0.6)
  } else if (kind === 'bell') {
    // A small bell: the uneven overtones of metal, kept quiet.
    strike(context, 659.25, 0, 2.2, 0.5, [[2.76, 0.22], [5.4, 0.09]])
  } else if (kind === 'soft') {
    strike(context, 523.25, 0, 1.1, 0.5, [[2, 0.12]], 'triangle')
    strike(context, 783.99, 0.22, 1.4, 0.45, [[2, 0.1]], 'triangle')
  } else if (kind === 'classic') {
    ;[880, 1100, 1320].forEach((f, i) => strike(context, f, i * 0.22, 0.2, 0.5))
  } else {
    // The chime: a rising chord, each note ringing into the next.
    ;[783.99, 987.77, 1174.66, 1567.98].forEach((f, i) => strike(context, f, i * 0.14, 1.5, 0.4, [[2, 0.15]]))
  }
}

/**
 * The sound of reminders. Each signal is worked out once, ahead of time, into a
 * recording (an offline audio context), so that sounding it later is only
 * playing that recording back: nothing to compute while the processor is busy,
 * no crackle. There is one voice: a new signal stops the one still sounding,
 * so signals that a busy page let pile up can never add up to a loud noise.
 * All signals are brought to the same peak, and the volume follows the ear.
 */
export class Signal {
  private context: AudioContext | null = null
  private out: GainNode | null = null
  private recordings = new Map<string, Promise<AudioBuffer | null>>()
  private voice: AudioBufferSourceNode | null = null
  private lastPlayed = -Infinity
  private timer: ReturnType<typeof setTimeout> | undefined
  private running = false
  /** How many signals have sounded since the last `start`. */
  count = 0

  constructor() {
    // Browsers keep sound off until the page has been touched; the first touch turns it on.
    const unlock = () => void this.audio()?.resume().catch(() => {})
    window.addEventListener('pointerdown', unlock, { capture: true, passive: true })
    window.addEventListener('keydown', unlock, true)
  }

  private audio(): AudioContext | null {
    if (this.context) return this.context
    try {
      const context = new AudioContext({ latencyHint: 'playback' })
      // A limiter last: whatever happens, the signal cannot jump out loud.
      const limiter = context.createDynamicsCompressor()
      limiter.threshold.value = -12
      limiter.knee.value = 6
      limiter.ratio.value = 12
      limiter.attack.value = 0.003
      limiter.release.value = 0.25
      this.out = context.createGain()
      this.out.connect(limiter).connect(context.destination)
      this.context = context
      return context
    } catch {
      return null
    }
  }

  /** The recording of a signal, made the first time it is asked for. */
  private recording(kind: string): Promise<AudioBuffer | null> {
    let made = this.recordings.get(kind)
    if (!made) {
      made = (async () => {
        try {
          const offline = new OfflineAudioContext(1, Math.ceil(RATE * 3), RATE)
          compose(kind, offline)
          const buffer = await offline.startRendering()
          // Every signal to the same peak, so that changing the sound does not change the loudness.
          const data = buffer.getChannelData(0)
          let peak = 0
          for (let i = 0; i < data.length; i++) peak = Math.max(peak, Math.abs(data[i]))
          if (peak > 0) for (let i = 0; i < data.length; i++) data[i] *= 0.7 / peak
          return buffer
        } catch {
          return null
        }
      })()
      this.recordings.set(kind, made)
    }
    return made
  }

  /** Sounds a signal once. `volume` is 0..1 as set; the ear hears loudness roughly as its square. */
  async play(kind: string, volume: number): Promise<void> {
    // Two signals within a second and a half are one: timers that a busy page held up fire together.
    if (performance.now() - this.lastPlayed < 1500) return
    this.lastPlayed = performance.now()
    // Counted even with no sound device: the signal was given, the alert is on screen.
    this.count++
    const context = this.audio()
    if (!context || !this.out) return
    const buffer = await this.recording(kind)
    if (!buffer) return
    void context.resume().catch(() => {})
    try {
      this.voice?.stop()
    } catch {
      // Already over.
    }
    const level = Math.max(0, Math.min(1, volume))
    this.out.gain.setValueAtTime(level * level, context.currentTime)
    const voice = context.createBufferSource()
    voice.buffer = buffer
    voice.connect(this.out)
    voice.start()
    voice.onended = () => this.voice === voice && (this.voice = null)
    this.voice = voice
  }

  /**
   * Sounds the signal now and again later while the alert waits: `once`, a `few`
   * times with growing pauses, or `until` answered, every `every` seconds. Each
   * next signal is set only after the one before, so none are made up for.
   */
  start(kind: string, volume: number, repeat: Repeat, every: number): void {
    if (this.running) return
    this.running = true
    this.count = 0
    const pause = Math.max(2, every) * 1000
    let n = 0
    const next = () => {
      void this.play(kind, volume)
      n++
      const wait = repeat === 'until' ? pause : repeat === 'few' && n < 4 ? pause * 2 ** (n - 1) : null
      if (wait !== null && this.running) this.timer = setTimeout(next, wait)
    }
    next()
  }

  stop(): void {
    this.running = false
    clearTimeout(this.timer)
    try {
      this.voice?.stop()
    } catch {
      // Already over.
    }
    this.voice = null
  }
}
