/**
 * One ordering for the board, used by every view that lists tasks.
 *
 * WHY THE ORDER CHANGED
 *
 * It used to lead with Working. That reads as "what is happening", which is
 * the wrong question for a board you glance at: the things that need YOU are
 * Reviewing and Failed, and both sat below the active work. Three tasks were
 * handed back finished and went unnoticed under two older ones.
 *
 * Now it leads with the queue that is blocked on a decision. Reviewing first
 * because an agent handing work back is the normal end of a task and the only
 * way it gets marked done; Failed next because something broken needs you just
 * as much but happens far less often.
 *
 * WHY RECENCY RATHER THAN PRIORITY AS THE TIEBREAK
 *
 * Tasks.tsx sorted by priority inside a status and Overview.tsx sorted by
 * recency, so the same board came out in two different orders on two pages.
 * Recency wins because it answers the question that was actually being asked —
 * "did the thing I just did show up?" — and priority stays visible as a badge
 * rather than quietly reordering rows. A High task from last week outranking
 * the one finished a minute ago is exactly the confusion this replaces.
 */

/** Most needs-you first. Anything unrecognised sorts last, never first. */
const RANK: Record<string, number> = {
  reviewing: 0,
  review: 0,
  failed: 1,
  fail: 1,
  working: 2,
  'in progress': 2,
  inprogress: 2,
  ongoing: 2,
  pending: 3,
  todo: 3,
  'to do': 3,
  completed: 4,
  complete: 4,
  done: 4,
}

/** The board's statuses in display order — for filter chips and legends. */
export const STATUS_ORDER = ['Reviewing', 'Failed', 'Working', 'Pending', 'Completed'] as const

export function statusRank(status?: string | null): number {
  return RANK[String(status ?? '').toLowerCase().trim()] ?? 99
}

interface Sortable {
  status?: string
  lastUpdated?: string | number | null
  taskLastUpdated?: string | number | null
  updatedAt?: string | number | null
}

const when = (t: Sortable): number => {
  const raw = t.lastUpdated ?? t.taskLastUpdated ?? t.updatedAt ?? 0
  const ms = new Date(raw as string).getTime()
  return Number.isFinite(ms) ? ms : 0
}

/** Needs-you first, then most recently touched. Never mutates the input. */
export function sortTasks<T extends Sortable>(tasks: T[]): T[] {
  return [...tasks].sort((a, b) => {
    const r = statusRank(a.status) - statusRank(b.status)
    return r !== 0 ? r : when(b) - when(a)
  })
}
