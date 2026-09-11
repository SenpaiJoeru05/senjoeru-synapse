/**
 * Understanding "mark task fifteen complete", and refusing to guess.
 *
 * Asking by voice to change a task used to go through Claude: thirteen seconds
 * and subscription quota to change one string in a JSON file, plus a model
 * deciding by itself which task was meant. Done here it is instant, free, and
 * — the part that matters — it can say "which one?" instead of picking.
 *
 * THE RISK THIS EXISTS TO CONTAIN. Every other intent only reads, so a
 * misheard question wastes a moment. This one writes, and speech recognition
 * mishears constantly: measured on this machine, project vocabulary scored
 * 6/24 before correction. "Mark task three complete" landing on task eight is
 * not recoverable by saying "no". So nothing here acts — `parse` returns an
 * INTENT, the caller confirms it out loud, and only an explicit yes performs
 * it. That confirmation is not politeness; it is the entire safety model.
 */
import { api } from './api'

/** The board's vocabulary. shared/tasks-write.js is the other authority. */
export type TaskStatus = 'Pending' | 'Working' | 'Reviewing' | 'Completed' | 'Failed'

export interface TaskRef {
  id: string
  title: string
  status: string
}

export type ActionParse =
  /** Not a task command at all. */
  | { kind: 'none' }
  /** Understood and unambiguous — ask the user to confirm this. */
  | { kind: 'ready'; task: TaskRef; status: TaskStatus }
  /** Understood, but more than one task fits. Ask which. */
  | { kind: 'ambiguous'; status: TaskStatus; candidates: TaskRef[]; described: string }
  /** Understood the verb, found nothing to apply it to. */
  | { kind: 'notFound'; status: TaskStatus; described: string }

/**
 * Words that name a target status.
 *
 * Ordered longest-first within each group so "in progress" is tested before
 * "progress" could match something else, and checked as whole words so
 * "completed" in a title cannot be read as a command.
 */
const STATUS_WORDS: [RegExp, TaskStatus][] = [
  [/\b(complete|completed|done|finish|finished|close|closed|ship|shipped)\b/i, 'Completed'],
  [/\b(review|reviewing|for review|needs review)\b/i, 'Reviewing'],
  [/\b(working|in progress|start|started|begin|resume)\b/i, 'Working'],
  [/\b(pending|hold|on hold|park|parked|blocked|waiting)\b/i, 'Pending'],
  [/\b(failed|fail|broken|abandon|abandoned)\b/i, 'Failed'],
]

/**
 * The command must OPEN with an instruction.
 *
 * Anchored to the start so a question that merely mentions changing something
 * cannot trigger a write. "What is left before I can mark task three done?" is
 * a question; "mark task three done" is a command; only the first word tells
 * them apart, and the cost of confusing them is a wrong write.
 */
const COMMAND = new RegExp(
  '^(?:please\\s+|can you\\s+|could you\\s+|now\\s+|go\\s+(?:ahead\\s+)?and\\s+)*'
  + '(mark|set|move|change|update|make|flag|put|complete|finish|close|reopen|start)\\b',
  'i',
)

/** Spoken numbers, since "task fifteen" arrives as words from speech. */
const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
  nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14,
  fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
  twenty: 20,
}

/**
 * The task number, if one was named.
 *
 * Requires "task" before it. A bare number in a sentence is far more likely to
 * be a quantity than an id — "mark the two review tasks done" is about two
 * tasks, not task 2 — and acting on that reading would write to the wrong row.
 */
function namedId(text: string): string | null {
  const digits = text.match(/\btask\s+#?(\d+)\b/i)
  if (digits) return digits[1]
  const words = text.match(/\btask\s+([a-z]+)\b/i)
  const n = words ? NUMBER_WORDS[words[1].toLowerCase()] : undefined
  return n ? String(n) : null
}

/** A status named as the thing being referred to: "the reviewing one". */
const REFERENCED_STATUS: [RegExp, string][] = [
  [/\b(under review|in review|reviewing|for review)\b/i, 'Reviewing'],
  [/\b(in progress|working|current|active)\b/i, 'Working'],
  [/\b(pending|waiting|on hold)\b/i, 'Pending'],
  [/\b(failed|failing)\b/i, 'Failed'],
]

const clean = (s: string) => s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim()

/**
 * Work out which task and which status, or why it cannot be decided.
 *
 * Reads the board rather than trusting the conversation, so "the one under
 * review" is resolved against what is true now.
 */
export async function parse(text: string): Promise<ActionParse> {
  const said = String(text || '')
  if (!COMMAND.test(said.trim())) return { kind: 'none' }

  const target = STATUS_WORDS.find(([re]) => re.test(said))?.[1]
  if (!target) return { kind: 'none' }

  const metric = await api.getMetric('tasks').catch(() => null)
  const all: TaskRef[] = (metric?.tasks ?? []).map((t: any) => ({
    id: String(t.id), title: String(t.title ?? 'Untitled'), status: String(t.status ?? ''),
  }))
  if (!all.length) return { kind: 'notFound', status: target, described: 'any task' }

  // 1. An explicit number wins — it is the only unambiguous reference there is.
  const id = namedId(said)
  if (id) {
    const task = all.find((t) => t.id === id)
    return task
      ? { kind: 'ready', task, status: target }
      : { kind: 'notFound', status: target, described: `task ${id}` }
  }

  /*
   * 2. Referred to by its current state: "the one under review".
   *
   * The status being referred TO must not be the status being set, or "mark
   * the reviewing task as reviewing" resolves against itself. More
   * importantly "mark the under review task as complete" names two statuses,
   * and picking the wrong one as the target silently reverses the command.
   */
  for (const [re, status] of REFERENCED_STATUS) {
    if (status === target || !re.test(said)) continue
    const matches = all.filter((t) => t.status === status)
    if (matches.length === 1) return { kind: 'ready', task: matches[0], status: target }
    if (matches.length > 1) {
      return { kind: 'ambiguous', status: target, candidates: matches, described: `in ${status}` }
    }
    return { kind: 'notFound', status: target, described: `anything ${re.source.includes('review') ? 'under review' : `in ${status}`}` }
  }

  // 3. By words from the title. Every significant word must appear, so a
  //    single incidental overlap cannot select a task.
  const stop = new Set([
    'mark', 'set', 'move', 'change', 'update', 'make', 'flag', 'put', 'the',
    'a', 'an', 'as', 'to', 'task', 'please', 'now', 'can', 'you', 'could',
    'and', 'go', 'ahead', 'it', 'that', 'this', 'complete', 'completed',
    'done', 'finish', 'finished', 'close', 'closed', 'working', 'pending',
    'reviewing', 'review', 'failed', 'start', 'started',
  ])
  const terms = clean(said).split(' ').filter((w) => w.length > 2 && !stop.has(w))
  if (terms.length) {
    const hits = all.filter((t) => {
      const title = clean(t.title)
      return terms.every((w) => title.includes(w))
    })
    if (hits.length === 1) return { kind: 'ready', task: hits[0], status: target }
    if (hits.length > 1) {
      return { kind: 'ambiguous', status: target, candidates: hits, described: terms.join(' ') }
    }
  }

  return { kind: 'notFound', status: target, described: terms.join(' ') || 'a task' }
}

/** Perform it. Only ever called after an explicit confirmation. */
export async function apply(taskId: string, status: TaskStatus) {
  return api.setTaskStatus(taskId, status)
}

/** How to ask "are you sure", out loud. */
export function confirmationFor(task: TaskRef, status: TaskStatus): string {
  const verb = status === 'Completed' ? 'mark it complete'
    : status === 'Failed' ? 'mark it failed'
      : `move it to ${status.toLowerCase()}`
  // The TITLE is read back, not the number. Hearing "task fifteen?" confirms
  // nothing — it repeats the digit that was most likely misheard in the first
  // place, so the reply that catches an error is the one that says what the
  // task actually is.
  return `${task.title}, currently ${task.status.toLowerCase()}. Shall I ${verb}?`
}

/** Whether a reply to that question was a yes. Anything unclear is not. */
const YES = /^(yes|yeah|yep|yup|sure|ok|okay|do it|go ahead|please do|confirm|correct|right|affirmative|proceed)\b/i
const NO = /^(no|nope|nah|cancel|stop|don'?t|never ?mind|forget it|wait)\b/i

export function isYes(reply: string): boolean {
  return YES.test(String(reply).trim())
}

export function isNo(reply: string): boolean {
  return NO.test(String(reply).trim())
}
