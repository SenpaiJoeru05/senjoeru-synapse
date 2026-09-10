/**
 * Presentation mode — keep money off the screen while you are sharing it.
 *
 * The dashboard shows AI spend, budgets and token counts, and none of that
 * belongs in a recording of a work call. This hides those values in the app's
 * OWN rendering, which is worth being explicit about: it is not a screen
 * capture flag. Everyone sees the same screen, you included.
 *
 * That is a deliberate choice rather than a limitation. Capture protection
 * blanks the whole window, so you would lose the dashboard you were presenting;
 * it behaves differently across Windows versions and between display, window
 * and hardware capture; and it cannot be verified from inside the app, so you
 * would be trusting an invisible guarantee. Redaction is checkable — if you
 * cannot see the number, neither can the recording.
 *
 * Values are MASKED rather than removed. Deleting the element shifts the layout
 * and reads as a rendering fault mid-presentation, where a mask reads as a
 * decision. Blur was the first idea and is worse than either: it stays legible
 * at a glance, survives a screenshot and a sharpen, and looks like a bug.
 */

import { useSyncExternalStore } from 'react'

const KEY = 'synapse.presentationMode'

/** Unmistakably deliberate, and the same width whatever it replaces. */
export const MASK = '•••'

function read(): boolean {
  try {
    return localStorage.getItem(KEY) === '1'
  } catch {
    // Private windows and blocked site data both throw here. Defaulting to OFF
    // is the safe direction: a dashboard that hides your data unasked is
    // confusing, while one that shows it is merely the normal state.
    return false
  }
}

let enabled = read()
const listeners = new Set<() => void>()

function emit() {
  listeners.forEach((fn) => fn())
}

export function isOn(): boolean {
  return enabled
}

export function setOn(next: boolean): void {
  if (enabled === next) return
  enabled = next
  try {
    localStorage.setItem(KEY, next ? '1' : '0')
  } catch { /* the session still works, it just will not persist */ }
  emit()
}

export function toggle(): void {
  setOn(!enabled)
}

/* ── React binding ────────────────────────────────────────────────────────── */

function subscribe(fn: () => void): () => void {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

/**
 * Re-render when the mode changes.
 *
 * useSyncExternalStore rather than a context provider, because this is read in
 * leaf components scattered across pages and every one of them needs the
 * current value — threading a provider through would touch far more of the
 * tree than the feature warrants.
 *
 * The store itself is plain module state, so the non-React callers (the
 * Assistant's answer builders) read isOn() directly without a hook.
 */
export function usePresentationMode(): boolean {
  return useSyncExternalStore(subscribe, isOn, () => false)
}

/* ── formatters ───────────────────────────────────────────────────────────── */

/**
 * A dollar amount, or the mask.
 *
 * The currency symbol is kept so the shape of the row still reads as money —
 * "$•••" says a figure is hidden, where a bare "•••" could be anything.
 */
export function money(n: number | null | undefined): string {
  if (enabled) return `$${MASK}`
  return `$${Number(n ?? 0).toFixed(2)}`
}

/** A count — tokens, requests — or the mask. */
export function count(n: number | null | undefined): string {
  if (enabled) return MASK
  return Number(n ?? 0).toLocaleString()
}

/** Any already-formatted string that should disappear in presentation mode. */
export function hidden(value: string): string {
  return enabled ? MASK : value
}
