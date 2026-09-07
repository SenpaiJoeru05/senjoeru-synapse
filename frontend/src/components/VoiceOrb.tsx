/**
 * The sphere. Canvas rather than SVG or DOM: this repaints every frame off the
 * audio spectrum, and animating dozens of DOM nodes at 60fps is how a small
 * always-on-top window starts costing real CPU.
 *
 * Driven by the AnalyserNode the Recorder already owns, so the microphone is
 * opened once for both transcription and this.
 */
import { useEffect, useRef } from 'react'

interface Props {
  /** Live analyser while recording; null when idle. */
  analyser: AnalyserNode | null
  /** Idle pulse instead of silence, so the window does not look frozen. */
  active: boolean
  /** Thinking state — spins without needing audio. */
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
    let smoothed = 0
    const bins = new Uint8Array(1024)

    const draw = () => {
      const { analyser: an, active: on, busy: thinking } = state.current
      const cx = size / 2
      const cy = size / 2
      const base = size * 0.26

      // Target radius: real audio when we have it, a gentle breath otherwise.
      let target = 0
      if (an && usable(an)) {
        try {
          an.getByteFrequencyData(bins as any)
          const n = Math.min(an.frequencyBinCount, bins.length)
          let sum = 0
          // Low half only — speech energy lives there, and the top bins are
          // mostly hiss that makes the orb jitter.
          const half = Math.max(1, Math.floor(n / 2))
          for (let i = 0; i < half; i++) sum += bins[i]
          target = Math.min(1, sum / half / 140)
        } catch {
          // The node went away between the check and the read. Fall through to
          // the idle pulse rather than letting the loop die.
          target = 0
        }
      } else if (thinking) {
        target = 0.35 + Math.sin(phase * 2.2) * 0.12
      } else if (on) {
        target = 0.14 + Math.sin(phase * 1.1) * 0.05
      }

      // Exponential smoothing: raw FFT frames make it twitch.
      smoothed += (target - smoothed) * 0.18
      phase += 0.03

      ctx.clearRect(0, 0, size, size)

      const r = base * (1 + smoothed * 0.55)

      // Outer glow
      const glow = ctx.createRadialGradient(cx, cy, r * 0.4, cx, cy, r * 2.1)
      glow.addColorStop(0, `rgba(139,92,246,${0.20 + smoothed * 0.30})`)
      glow.addColorStop(1, 'rgba(139,92,246,0)')
      ctx.fillStyle = glow
      ctx.beginPath()
      ctx.arc(cx, cy, r * 2.1, 0, Math.PI * 2)
      ctx.fill()

      // Wobbling body — three summed harmonics so it reads organic rather
      // than as a pulsing circle.
      ctx.beginPath()
      const STEPS = 96
      for (let i = 0; i <= STEPS; i++) {
        const a = (i / STEPS) * Math.PI * 2
        const wob =
          Math.sin(a * 3 + phase * 1.7) * 0.05 +
          Math.sin(a * 5 - phase * 1.1) * 0.03 +
          Math.sin(a * 2 + phase * 0.6) * 0.04
        const rr = r * (1 + wob * (0.35 + smoothed))
        const x = cx + Math.cos(a) * rr
        const y = cy + Math.sin(a) * rr
        if (i === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      }
      ctx.closePath()

      const body = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.35, r * 0.1, cx, cy, r * 1.25)
      body.addColorStop(0, 'rgba(196,164,255,0.95)')
      body.addColorStop(0.55, 'rgba(139,92,246,0.80)')
      body.addColorStop(1, 'rgba(79,70,229,0.55)')
      ctx.fillStyle = body
      ctx.fill()

      ctx.strokeStyle = `rgba(226,214,255,${0.30 + smoothed * 0.45})`
      ctx.lineWidth = 1.2
      ctx.stroke()

      // Specular highlight, so it reads as a sphere and not a disc.
      const spec = ctx.createRadialGradient(cx - r * 0.34, cy - r * 0.4, 0, cx - r * 0.34, cy - r * 0.4, r * 0.7)
      spec.addColorStop(0, 'rgba(255,255,255,0.42)')
      spec.addColorStop(1, 'rgba(255,255,255,0)')
      ctx.fillStyle = spec
      ctx.beginPath()
      ctx.arc(cx - r * 0.3, cy - r * 0.35, r * 0.62, 0, Math.PI * 2)
      ctx.fill()

      raf = requestAnimationFrame(draw)
    }

    draw()
    return () => cancelAnimationFrame(raf)
  }, [size])

  return <canvas ref={canvasRef} style={{ width: size, height: size }} className="block" />
}
