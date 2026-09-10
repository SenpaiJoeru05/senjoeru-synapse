/**
 * The sphere — a translucent HUD globe with your voice drawn through it.
 *
 * Canvas rather than SVG or DOM: this repaints every frame off the audio, and
 * animating dozens of DOM nodes at 60fps is how a small always-on-top window
 * starts costing real CPU.
 *
 * Driven by the AnalyserNode the recorder already owns, so the microphone is
 * opened once for both transcription and this.
 *
 * WHAT CHANGED FROM THE FIRST VERSION, and why it matters more than the colour:
 * that one read `getByteFrequencyData` and used the average magnitude to set a
 * radius, so the sphere swelled with your volume but the shape carried no
 * information — a louder ball is a VU meter. The waveform here comes from
 * `getByteTimeDomainData`, the actual pressure trace, so what you see is the
 * shape of the sound: sibilants read as tight ripple, vowels as slow swells.
 * Both are still read, because they answer different questions — the trace
 * gives the line, the spectrum gives the glow.
 *
 * The body is a rim-lit shell rather than a filled ball. A solid sphere hides
 * everything drawn inside it, and the waveform is the point.
 */
import { useEffect, useRef } from 'react'

interface Props {
  /** Live analyser while recording or speaking; null when idle. */
  analyser: AnalyserNode | null
  /** Idle pulse instead of silence, so the window does not look frozen. */
  active: boolean
  /** Thinking state — animates without needing audio. */
  busy?: boolean
  size?: number
}

/**
 * An AnalyserNode outlives its AudioContext as a JS object, but reading it
 * after the context is closed touches a freed native object — which crashes
 * the renderer with an access violation instead of throwing. The owner sets
 * this prop to null before closing, but React re-renders asynchronously, so
 * the animation loop can still hold a stale node for a frame or two.
 */
function usable(an: AnalyserNode): boolean {
  const state = an.context?.state
  return state === 'running' || state === 'suspended'
}

/** Cyan through to indigo. The rim runs hot, the interior stays cold. */
const RIM = '34,211,238'      // cyan-400
const DEEP = '37,99,235'      // blue-600
const HALO = '56,189,248'     // sky-400

export default function VoiceOrb({ analyser, active, busy = false, size = 132 }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  // Read through refs so the animation loop is started once, not restarted on
  // every prop change (which would reset the phase and make it stutter).
  const state = useRef({ analyser, active, busy })
  useEffect(() => { state.current = { analyser, active, busy } }, [analyser, active, busy])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    canvas.width = size * dpr
    canvas.height = size * dpr
    ctx.scale(dpr, dpr)

    let raf = 0
    let phase = 0
    let spin = 0
    let level = 0
    const freq = new Uint8Array(1024)
    const wave = new Uint8Array(1024)
    /** Smoothed copy of the trace: raw frames alias into visible flicker. */
    const trace = new Float32Array(96)

    const draw = () => {
      const { analyser: an, active: on, busy: thinking } = state.current
      const cx = size / 2
      const cy = size / 2
      /*
       * Sized so that EVERYTHING drawn fits inside the canvas.
       *
       * At 0.27 it did not, and the failure was not subtle once seen: the halo
       * reaches r * 2.2, which on a 150px canvas is 178px, so the gradient was
       * cut off by the canvas edge while still partly opaque. Because the
       * corners sit further from the centre than the edges do (75 vs 106), the
       * cut faded unevenly and read as a faint rounded rectangle around the
       * orb — an invisible container with a highlighted border, which is
       * exactly what it looked like. The outer ring overflowed too, but only
       * at high volume, so it flickered rather than sitting there.
       *
       * 0.235 keeps the outer ring inside the box at full level:
       *   base * 1.30 (peak swell) * 1.55 (outer ring) = 0.473 * size < size/2
       * and the halo is clamped below so it reaches zero alpha exactly at the
       * edge rather than being truncated.
       */
      const base = size * 0.235

      let target = 0
      let live = false

      if (an && usable(an)) {
        try {
          an.getByteFrequencyData(freq as any)
          an.getByteTimeDomainData(wave as any)
          const n = Math.min(an.frequencyBinCount, freq.length)
          let sum = 0
          // Low half only — speech energy lives there, and the top bins are
          // mostly hiss that makes the glow jitter.
          const half = Math.max(1, Math.floor(n / 2))
          for (let i = 0; i < half; i++) sum += freq[i]
          target = Math.min(1, sum / half / 140)
          live = true
        } catch {
          // The node went away between the check and the read. Fall through to
          // the idle pulse rather than letting the loop die.
          target = 0
        }
      } else if (thinking) {
        target = 0.34 + Math.sin(phase * 2.2) * 0.12
      } else if (on) {
        target = 0.13 + Math.sin(phase * 1.1) * 0.05
      }

      level += (target - level) * 0.18
      phase += 0.03
      // Rings drift slowly at rest and hurry while thinking — the one cue that
      // reads as "working" without any audio to react to.
      spin += thinking ? 0.016 : 0.004

      // Fill the trace buffer. Live audio when there is any; otherwise a
      // travelling wave so the line is never a dead flat rule.
      const N = trace.length
      for (let i = 0; i < N; i++) {
        let v: number
        if (live) {
          const src = Math.floor((i / N) * Math.min(wave.length, 512))
          v = (wave[src] - 128) / 128
        } else {
          const t = (i / N) * Math.PI * 2
          v = Math.sin(t * 3 + phase * 2.4) * 0.35 + Math.sin(t * 7 - phase * 1.6) * 0.15
          v *= thinking ? 0.9 : 0.25
        }
        // A window that pins the ends to zero, so the line meets the rim
        // instead of being clipped mid-swing.
        const w = Math.sin((i / (N - 1)) * Math.PI)
        trace[i] += (v * w - trace[i]) * 0.35
      }

      ctx.clearRect(0, 0, size, size)
      const r = base * (1 + level * 0.30)

      /* ── outer halo ─────────────────────────────────────────────────────── */
      // Clamped to the half-width so the gradient's transparent stop lands ON
      // the canvas edge. Any larger and the fade is truncated while still
      // visible, which is what drew a box around the orb.
      const haloR = Math.min(r * 2.2, size / 2)
      const glow = ctx.createRadialGradient(cx, cy, r * 0.5, cx, cy, haloR)
      glow.addColorStop(0, `rgba(${HALO},${0.16 + level * 0.26})`)
      glow.addColorStop(1, `rgba(${HALO},0)`)
      ctx.fillStyle = glow
      ctx.beginPath()
      ctx.arc(cx, cy, haloR, 0, Math.PI * 2)
      ctx.fill()

      /* ── HUD rings ──────────────────────────────────────────────────────── */
      // Two rings turning in opposite directions, with a broken arc on each so
      // the rotation is legible. A perfectly smooth circle spinning looks
      // static, which is why the ticks exist.
      for (const [k, dir] of [[1.55, 1], [1.30, -1]] as const) {
        const rr = r * k
        ctx.strokeStyle = `rgba(${RIM},0.18)`
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.arc(cx, cy, rr, 0, Math.PI * 2)
        ctx.stroke()

        const a0 = spin * dir
        ctx.strokeStyle = `rgba(${RIM},${0.45 + level * 0.4})`
        ctx.lineWidth = 1.4
        ctx.beginPath()
        ctx.arc(cx, cy, rr, a0, a0 + Math.PI * 0.42)
        ctx.stroke()

        ctx.strokeStyle = `rgba(${RIM},0.30)`
        ctx.lineWidth = 1
        for (let i = 0; i < 24; i++) {
          const a = a0 * dir + (i / 24) * Math.PI * 2
          const inner = rr - (i % 6 === 0 ? size * 0.022 : size * 0.010)
          ctx.beginPath()
          ctx.moveTo(cx + Math.cos(a) * inner, cy + Math.sin(a) * inner)
          ctx.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr)
          ctx.stroke()
        }
      }

      /* ── the shell ──────────────────────────────────────────────────────── */
      const shell = ctx.createRadialGradient(cx, cy, r * 0.15, cx, cy, r)
      shell.addColorStop(0, `rgba(${DEEP},0.30)`)
      shell.addColorStop(0.72, `rgba(${DEEP},0.16)`)
      shell.addColorStop(1, `rgba(${RIM},0.26)`)
      ctx.fillStyle = shell
      ctx.beginPath()
      ctx.arc(cx, cy, r, 0, Math.PI * 2)
      ctx.fill()

      /* ── interior: latitudes and the waveform, clipped to the sphere ────── */
      ctx.save()
      ctx.beginPath()
      ctx.arc(cx, cy, r * 0.985, 0, Math.PI * 2)
      ctx.clip()

      // Latitude arcs. Flattened ellipses read as a globe rather than a disc,
      // which is what the specular highlight used to do in the old version.
      ctx.strokeStyle = `rgba(${RIM},0.13)`
      ctx.lineWidth = 0.8
      for (const f of [-0.55, -0.28, 0, 0.28, 0.55]) {
        const ry = Math.abs(Math.cos(f * Math.PI * 0.5)) * r * 0.30 + 1
        ctx.beginPath()
        ctx.ellipse(cx, cy + f * r, r * Math.sqrt(1 - f * f), ry, 0, 0, Math.PI * 2)
        ctx.stroke()
      }

      // The trace, drawn twice: a wide soft pass for bloom, then a tight
      // bright pass. One stroke at full brightness reads as a hairline; the
      // pair is what gives it the lit-from-within look.
      const amp = r * 0.62
      const path = () => {
        ctx.beginPath()
        for (let i = 0; i < N; i++) {
          const x = cx - r + (i / (N - 1)) * r * 2
          const y = cy + trace[i] * amp
          if (i === 0) ctx.moveTo(x, y)
          else ctx.lineTo(x, y)
        }
      }

      ctx.lineJoin = 'round'
      ctx.lineCap = 'round'
      ctx.strokeStyle = `rgba(${HALO},${0.20 + level * 0.25})`
      ctx.lineWidth = 4.5
      path()
      ctx.stroke()

      ctx.strokeStyle = `rgba(190,242,255,${0.65 + level * 0.35})`
      ctx.lineWidth = 1.3
      path()
      ctx.stroke()

      // Its mirror, faint — the symmetry is what makes it read as contained by
      // the sphere rather than a line laid across it.
      ctx.strokeStyle = `rgba(${RIM},0.20)`
      ctx.lineWidth = 1
      ctx.beginPath()
      for (let i = 0; i < N; i++) {
        const x = cx - r + (i / (N - 1)) * r * 2
        const y = cy - trace[i] * amp
        if (i === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      }
      ctx.stroke()

      ctx.restore()

      /* ── rim light ──────────────────────────────────────────────────────── */
      // Drawn last so it sits over the interior, which is what separates a
      // shell from a flat disc with lines on it.
      ctx.strokeStyle = `rgba(${RIM},${0.55 + level * 0.40})`
      ctx.lineWidth = 1.5
      ctx.beginPath()
      ctx.arc(cx, cy, r, 0, Math.PI * 2)
      ctx.stroke()

      // A brighter cap where the light falls, so it has an up.
      ctx.strokeStyle = `rgba(220,250,255,${0.30 + level * 0.35})`
      ctx.lineWidth = 1.6
      ctx.beginPath()
      ctx.arc(cx, cy, r, Math.PI * 1.15, Math.PI * 1.75)
      ctx.stroke()

      raf = requestAnimationFrame(draw)
    }

    draw()
    return () => cancelAnimationFrame(raf)
  }, [size])

  return <canvas ref={canvasRef} style={{ width: size, height: size }} className="block" />
}
