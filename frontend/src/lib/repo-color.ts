/**
 * Stable colours for repository names.
 *
 * These used to be hardcoded maps of one workspace's repo names, so every repo
 * belonging to anyone else fell through to grey. Deriving the colour from the
 * name means any workspace gets a full palette, and a given repo keeps the same
 * colour everywhere it appears without anything to configure.
 */

const PALETTE = [
  { badge: 'bg-violet-500/20 text-violet-300', dot: 'bg-violet-500', border: 'border-violet-500/30' },
  { badge: 'bg-emerald-500/20 text-emerald-300', dot: 'bg-emerald-500', border: 'border-emerald-500/30' },
  { badge: 'bg-cyan-500/20 text-cyan-300', dot: 'bg-cyan-500', border: 'border-cyan-500/30' },
  { badge: 'bg-amber-500/20 text-amber-300', dot: 'bg-amber-500', border: 'border-amber-500/30' },
  { badge: 'bg-purple-500/20 text-purple-300', dot: 'bg-purple-500', border: 'border-purple-500/30' },
  { badge: 'bg-sky-500/20 text-sky-300', dot: 'bg-sky-500', border: 'border-sky-500/30' },
  { badge: 'bg-rose-500/20 text-rose-300', dot: 'bg-rose-500', border: 'border-rose-500/30' },
  { badge: 'bg-teal-500/20 text-teal-300', dot: 'bg-teal-500', border: 'border-teal-500/30' },
  { badge: 'bg-indigo-500/20 text-indigo-300', dot: 'bg-indigo-500', border: 'border-indigo-500/30' },
]

const NEUTRAL = {
  badge: 'bg-gray-500/20 text-gray-400',
  dot: 'bg-gray-500',
  border: 'border-gray-500/30',
}

/** djb2 — small, stable, and good enough to spread names across a palette. */
function hash(name: string): number {
  let h = 5381
  for (let i = 0; i < name.length; i++) h = ((h << 5) + h + name.charCodeAt(i)) | 0
  return Math.abs(h)
}

function slotFor(repo: string | null | undefined) {
  if (!repo) return NEUTRAL
  return PALETTE[hash(repo) % PALETTE.length]
}

/** Tailwind classes for a repo pill. */
export function repoBadge(repo: string | null | undefined): string {
  return slotFor(repo).badge
}

/** Tailwind class for a small repo dot. */
export function repoDot(repo: string | null | undefined): string {
  return slotFor(repo).dot
}

/** Badge classes plus a matching border, for outlined repo pills. */
export function repoPill(repo: string | null | undefined): string {
  const slot = slotFor(repo)
  return `${slot.badge} ${slot.border}`
}
