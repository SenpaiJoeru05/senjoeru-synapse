/**
 * Renderer side of voice. Deliberately thin: recognition and synthesis both
 * happen in the main process, so this only plays audio and opens a microphone
 * for the orb to react to.
 *
 * That split is the lesson from the earlier attempt — Whisper via onnxruntime
 * WASM crashed Chromium with an access violation and blanked the window. The
 * renderer now runs no native inference at all.
 */

const api = () => window.electronAPI

/**
 * Breadcrumb to the main process.
 *
 * The renderer has been dying with an access violation (0xC0000005) somewhere
 * in this file's native calls — Web Audio, not the WASM that was originally
 * blamed. A crashed renderer takes its console with it, so each step is
 * reported to the main process before it is attempted; the last line in the
 * terminal is the call that killed it.
 */
const trace = (step: string) => { try { api()?.trace?.(step) } catch { /* never block */ } }

export function voiceAvailable() {
  return !!api()?.speak && !!api()?.listen
}

/**
 * Silence scheduled before the first sample.
 *
 * Windows ramps up an idle output device, and the first tens of milliseconds
 * get swallowed — which is heard as the opening word stuttering or losing its
 * consonant. Starting slightly in the future gives the device time to wake, so
 * playback begins on a stream that is already running.
 */
const LEAD_IN_SECONDS = 0.09

interface Pcm {
  sampleRate: number
  // Explicitly backed by ArrayBuffer, not ArrayBufferLike: copyToChannel
  // rejects the wider type, since a SharedArrayBuffer would not be valid here.
  channels: Float32Array<ArrayBuffer>[]
}

/**
 * Parses a 16-bit PCM WAV in JavaScript, instead of calling decodeAudioData.
 *
 * decodeAudioData crashed the renderer outright — access violation
 * (0xC0000005), traced to that exact call. The context runs at 48000Hz while
 * Piper emits 22050Hz, so the native decoder was resampling, and that path
 * faults on this Chromium build. Parsing here is a few lines, cannot crash the
 * process, and lets the context be created at the file's own rate so no
 * resampling happens at all.
 *
 * Chunks are walked rather than assuming a 44-byte header: Piper's output is
 * canonical today, but a `LIST` chunk before `data` is legal and would offset
 * every sample into noise.
 */
function decodeWav(buf: ArrayBuffer): Pcm {
  const view = new DataView(buf)
  const ascii = (off: number, len: number) =>
    String.fromCharCode(...new Uint8Array(buf, off, len))

  if (ascii(0, 4) !== 'RIFF' || ascii(8, 4) !== 'WAVE') throw new Error('not a WAV')

  let sampleRate = 22050
  let channelCount = 1
  let bits = 16
  let dataOffset = -1
  let dataLength = 0

  let p = 12
  while (p + 8 <= view.byteLength) {
    const id = ascii(p, 4)
    const size = view.getUint32(p + 4, true)
    const body = p + 8
    if (id === 'fmt ') {
      channelCount = view.getUint16(body + 2, true)
      sampleRate = view.getUint32(body + 4, true)
      bits = view.getUint16(body + 14, true)
    } else if (id === 'data') {
      dataOffset = body
      dataLength = Math.min(size, view.byteLength - body)
    }
    p = body + size + (size % 2)   // chunks are word-aligned
  }

  if (dataOffset < 0) throw new Error('WAV has no data chunk')
  if (bits !== 16) throw new Error(`expected 16-bit PCM, got ${bits}-bit`)

  const frames = Math.floor(dataLength / 2 / channelCount)
  const channels = Array.from({ length: channelCount }, () => new Float32Array(frames))

  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < channelCount; c++) {
      const s = view.getInt16(dataOffset + (i * channelCount + c) * 2, true)
      channels[c][i] = s / 32768
    }
  }

  return { sampleRate, channels }
}

/**
 * Plays WAV bytes from the main process. Resolves when playback finishes.
 *
 * Decodes the whole buffer up front and plays it through an
 * AudioBufferSourceNode rather than an HTMLAudioElement.
 *
 * The element approach clipped the first word: createMediaElementSource streams,
 * so `play()` could begin before the graph was connected and before a suspended
 * AudioContext had resumed, and whatever had already been emitted was lost. A
 * decoded buffer has no such race — the graph is complete and the context
 * running before a single sample is scheduled.
 */
class Player {
  /**
   * ONE context for the window's lifetime, reused across utterances.
   *
   * Creating a context per utterance re-initialises the output device every
   * time, and Windows takes tens of milliseconds to bring an idle device up —
   * which is exactly the first-word stutter. Piper's WAV has no leading
   * silence (measured: first audible sample at 0.0ms), so that delay eats real
   * speech rather than padding. A persistent context keeps the device warm.
   */
  private ctx: AudioContext | null = null

  private analyserNode: AnalyserNode | null = null

  private src: AudioBufferSourceNode | null = null

  /** Resolver for the in-flight play(), so stopping ends the wait. */
  private endedResolve: (() => void) | null = null

  /**
   * The caption's animation frame, so an interrupted utterance stops driving
   * it. Without cancelling, barge-in leaves the previous answer's caption
   * advancing underneath the new one.
   */
  private raf: number | null = null

  /** Non-null only while speaking, so the orb knows when to follow output. */
  analyser: AnalyserNode | null = null

  /**
   * The context is pinned to the audio's own sample rate. Left to itself
   * Chromium picks the device rate (48000 here) and resamples — the path that
   * was crashing. Matching the source means no conversion at all.
   */
  private graph(sampleRate: number): { ctx: AudioContext; analyser: AnalyserNode } {
    if (this.ctx && this.ctx.sampleRate !== sampleRate) {
      trace(`play: rate changed ${this.ctx.sampleRate} -> ${sampleRate}, rebuilding`)
      this.dispose()
    }
    if (!this.ctx) {
      trace(`play: new AudioContext @ ${sampleRate}Hz`)
      this.ctx = new AudioContext({ sampleRate })
      trace(`play: context created (state=${this.ctx.state}, rate=${this.ctx.sampleRate})`)
      this.analyserNode = this.ctx.createAnalyser()
      this.analyserNode.fftSize = 1024
      this.analyserNode.smoothingTimeConstant = 0.75
      this.analyserNode.connect(this.ctx.destination)
      trace('play: graph connected')
    }
    return { ctx: this.ctx, analyser: this.analyserNode! }
  }

  async play(
    wav: ArrayBuffer,
    onStart?: (a: AnalyserNode | null) => void,
    /**
     * Playback position as a fraction, 0..1, roughly once per frame.
     *
     * Piper hands back one finished WAV with no word timings, so there is no
     * alignment data to sync a caption against. Position plus total duration
     * is what there is, and it is enough: see shared/captions.js for why a
     * character-proportional estimate holds within a single utterance.
     */
    onProgress?: (p: number) => void,
  ): Promise<void> {
    this.stop()

    trace(`play: parsing wav (${wav.byteLength} bytes)`)
    const pcm = decodeWav(wav)
    trace(`play: parsed ${pcm.channels[0].length} frames @ ${pcm.sampleRate}Hz, ${pcm.channels.length}ch`)

    const { ctx, analyser } = this.graph(pcm.sampleRate)

    const decoded = ctx.createBuffer(pcm.channels.length, pcm.channels[0].length, pcm.sampleRate)
    for (let c = 0; c < pcm.channels.length; c++) decoded.copyToChannel(pcm.channels[c], c)
    trace(`play: buffer built ${decoded.duration.toFixed(2)}s`)

    // Autoplay policy can leave a context suspended; starting a source on a
    // suspended context drops the beginning.
    if (ctx.state === 'suspended') { trace('play: resuming context'); await ctx.resume() }

    const src = ctx.createBufferSource()
    src.buffer = decoded
    src.connect(analyser)

    this.src = src
    this.analyser = analyser

    trace('play: start')
    await new Promise<void>((resolve) => {
      this.endedResolve = resolve
      src.onended = () => { this.endedResolve = null; resolve() }
      // Small cushion even with a warm device: scheduling in the future means
      // the stream is already running when the first speech sample lands.
      const startAt = ctx.currentTime + LEAD_IN_SECONDS
      src.start(startAt)
      onStart?.(analyser)

      /*
       * Drive the caption off the audio clock, not a timer.
       *
       * setInterval would drift against playback and keep running if the
       * source is stopped early; AudioContext.currentTime is the same clock
       * the samples are played on, so the caption cannot slide out of step
       * with what is being said. rAF also pauses when the window is hidden,
       * which is exactly right for something only worth drawing when visible.
       */
      if (onProgress) {
        const total = decoded.duration || 1
        const tick = () => {
          // Stop when this source is no longer the current one — an
          // interrupted answer must not keep captioning over the next.
          if (this.src !== src) return
          const p = (ctx.currentTime - startAt) / total
          onProgress(Math.max(0, Math.min(1, p)))
          if (p < 1) this.raf = requestAnimationFrame(tick)
        }
        this.raf = requestAnimationFrame(tick)
      }
    })
    trace('play: ended')

    this.stopSource()
  }

  /**
   * Ends the current utterance but keeps the device warm for the next one.
   *
   * Resolving the pending play() is not tidiness, it is the difference between
   * an interruption and a hang. Nulling `onended` before calling `stop()` — as
   * this must, or stopping would look like finishing — means the 'ended' event
   * never fires, so a `play()` awaited by a caller stayed pending forever.
   * Barge-in therefore stranded whatever was waiting on `say()`: the caller
   * that interrupts an acknowledgement to speak an answer would simply never
   * reach the answer.
   */
  private stopSource() {
    if (this.raf !== null) {
      cancelAnimationFrame(this.raf)
      this.raf = null
    }
    if (this.src) {
      this.src.onended = null
      try { this.src.stop() } catch { /* not started, or already ended */ }
      this.src.disconnect()
      this.src = null
    }
    this.analyser = null

    const resolve = this.endedResolve
    this.endedResolve = null
    resolve?.()
  }

  stop() {
    this.stopSource()
  }

  /** Release the device. For unmount only — not between utterances. */
  dispose() {
    this.stopSource()
    this.ctx?.close().catch(() => {})
    this.ctx = null
    this.analyserNode = null
  }
}

export const player = new Player()

/**
 * Synthesize and play. Cancels anything already speaking.
 *
 * `onStart` fires the moment playback is scheduled, with the analyser driving
 * it — so the orb can react from the first word instead of being polled on a
 * guessed delay.
 */
/** One caption line group, as the main process timed it. */
export interface Cue {
  text: string
  /** Fractions of playback, 0..1. */
  from: number
  to: number
}

/**
 * The cue to show at a point in playback.
 *
 * A lookup, deliberately — all the actual logic (splitting, punctuation
 * weighting, timing) lives in shared/captions.js where CI tests it, and the
 * cues arrive already timed. Duplicating any of that here is how the two would
 * drift apart.
 */
export function cueAt(cues: Cue[] | null, progress: number): string {
  if (!cues || !cues.length) return ''
  const p = Math.max(0, Math.min(1, Number.isFinite(progress) ? progress : 0))
  for (const cue of cues) if (p >= cue.from && p < cue.to) return cue.text
  // Clamped rather than blanked: the last cue stays up until the audio stops.
  return cues[cues.length - 1].text
}

export async function say(
  text: string,
  onStart?: (a: AnalyserNode | null) => void,
  /**
   * The caption, as it should read right now. Fires on every animation frame
   * of playback, and once with '' when the utterance ends.
   */
  onCaption?: (line: string) => void,
): Promise<void> {
  const a = api()
  if (!a?.speak || !text.trim()) return
  await a.stopSpeaking?.()
  player.stop()
  trace(`say: synthesizing ${text.length} chars`)

  const result = await a.speak(text)
  /*
   * Tolerates the old shape.
   *
   * `speak` used to resolve with a bare ArrayBuffer and now resolves with
   * { wav, spoken, cues }. Handling both keeps the renderer working against a
   * main process that has not been restarted — which is exactly the state the
   * app is in between a code change and a relaunch, and a hard failure there
   * looks like the voice being broken rather than stale.
   */
  const wav = result instanceof ArrayBuffer ? result : result?.wav ?? null
  const cues = result instanceof ArrayBuffer ? null : result?.cues ?? null
  trace(`say: got ${wav ? wav.byteLength + ' bytes' : 'null'}, ${cues?.length ?? 0} cues`)

  if (!wav) return
  try {
    await player.play(
      wav,
      onStart,
      onCaption && cues ? (p) => onCaption(cueAt(cues, p)) : undefined,
    )
  } finally {
    // Clear it here rather than leaving the last line frozen on screen — the
    // caption is a caption, not a transcript.
    onCaption?.('')
  }
}

export async function hush(): Promise<void> {
  player.stop()
  await api()?.stopSpeaking?.()
}

/** Release the audio device. Call on unmount, not between utterances. */
export function disposeVoice(): void {
  player.dispose()
}

export interface Heard {
  text: string
  confidence: number
  grammar: string
  alternate: string
}

/**
 * True when the main process can own the microphone (whisper-stream + SDL2).
 *
 * Preferred over every renderer capture design: two of those crashed Chromium
 * with an access violation on sample-rate conversion, and SDL2 opens the
 * device at 16kHz natively so nothing resamples.
 */
export function usesMainProcessCapture() {
  return !!api()?.listenStart && !!api()?.listenStop
}

/** Begin capturing. The transcript arrives from endListening. */
export async function beginListening(): Promise<void> {
  await hush()   // never transcribe our own voice
  await api()?.listenStart?.()
}

/** Stop capturing and return what was said. */
export async function endListening(): Promise<Heard | null> {
  const r = await api()?.listenStop?.()
  return r?.text ? r : null
}

export async function abortListening(): Promise<void> {
  await api()?.listenCancel?.()
}

/**
 * Listen once with Windows System.Speech, which captures its own audio.
 * The fallback path; see recordAndTranscribe for whisper.
 */
export async function hear(): Promise<Heard | null> {
  const a = api()
  if (!a?.listen) return null
  await hush()   // never transcribe our own voice
  return a.listen()
}

/** Transcribe a WAV the renderer captured, via whisper.cpp in the main process. */
export async function transcribe(wav: ArrayBuffer): Promise<Heard | null> {
  const a = api()
  if (!a?.transcribe) return null
  const r = await a.transcribe(wav)
  return r?.text ? r : null
}

export async function stopHearing(): Promise<void> {
  await api()?.cancelListen?.()
}

/**
 * A microphone stream purely for the orb while the main process is listening.
 * The recogniser opens its own device; Windows shares the mic, so both can
 * read it. If this fails the orb falls back to its idle pulse rather than
 * blocking recognition.
 */
export class MicLevel {
  private stream: MediaStream | null = null

  private ctx: AudioContext | null = null

  analyser: AnalyserNode | null = null

  async start(): Promise<AnalyserNode | null> {
    try {
      trace('mic: getUserMedia')
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      trace('mic: stream acquired')
      this.ctx = new AudioContext()
      trace('mic: createMediaStreamSource')
      const src = this.ctx.createMediaStreamSource(this.stream)
      this.analyser = this.ctx.createAnalyser()
      this.analyser.fftSize = 1024
      this.analyser.smoothingTimeConstant = 0.75
      src.connect(this.analyser)
      trace('mic: ready')
      return this.analyser
    } catch (e: any) {
      trace(`mic: FAILED ${e?.name ?? ''} ${e?.message ?? e}`)
      this.stop()
      return null
    }
  }

  stop() {
    this.stream?.getTracks().forEach((t) => t.stop())
    this.ctx?.close().catch(() => {})
    this.stream = null
    this.ctx = null
    this.analyser = null
  }
}
