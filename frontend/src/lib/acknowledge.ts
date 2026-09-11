/**
 * The short thing Joeru says before the slow work, so a wait is not silence.
 *
 * The slow path takes 6-13 seconds, and during it the window said nothing at
 * all. A voice assistant that goes quiet is indistinguishable from one that has
 * hung — you cannot tell "working" from "crashed" without a spoken cue, and the
 * orb alone does not carry that when you are not looking at the screen.
 *
 * Two rules make this help rather than annoy:
 *
 *   It must overlap the work, not precede it. Spoken first and awaited, it
 *   would ADD its own duration to every answer. The caller starts the request
 *   and the acknowledgement together.
 *
 *   It must only fire when the wait is real. Locally answered questions come
 *   back in milliseconds, and "Got it, one moment… everything is completed"
 *   is worse than just the answer.
 */

/**
 * Does this ask for a change, or for information?
 *
 * Worth separating because the natural acknowledgement differs: "doing that
 * now" for a change, "let me check" for a question. Getting it backwards is
 * conspicuous — "let me check" in reply to "mark task three done" sounds like
 * it misheard.
 *
 * Deliberately matched on the leading verb rather than anywhere in the
 * sentence. "What is blocking the update to task three" asks a question that
 * merely mentions updating, and only the opening word says which it is.
 */
const ACTION = new RegExp(
  '^(?:please\\s+|can you\\s+|could you\\s+|would you\\s+|go\\s+(?:ahead\\s+)?and\\s+)*'
  + '(mark|set|update|change|add|create|make|write|record|file|note|remember'
  + '|remove|delete|rename|move|fix|start|stop|close|open|assign|bump|log|save'
  + '|commit|push)\\b',
  'i',
)

export function isAction(question: string): boolean {
  return ACTION.test(String(question).trim())
}

/*
 * Several phrasings, because one fixed line said on every slow question is
 * how a person starts to hear a machine. Kept short on purpose: the caller
 * waits for this to finish before speaking the answer rather than cutting it
 * off mid-word, so a long acknowledgement would delay a fast answer.
 */
const ACTION_ACKS = [
  'Got it, doing that now.',
  'On it.',
  'Sure, making that change now.',
  'Right, doing that.',
]

const QUESTION_ACKS = [
  'Let me check.',
  'One moment.',
  'Checking now.',
  'Let me look that up.',
]

/** The last line used, so the same one is never heard twice in a row. */
let previous: string | null = null

/**
 * Pick an acknowledgement for this question.
 *
 * Random, but never a repeat of the line before it — back-to-back repetition
 * is the thing that reads as canned, far more than the words themselves.
 */
export function acknowledgement(question: string): string {
  const pool = isAction(question) ? ACTION_ACKS : QUESTION_ACKS
  const options = pool.length > 1 && previous ? pool.filter((p) => p !== previous) : pool
  const pick = options[Math.floor(Math.random() * options.length)]
  previous = pick
  return pick
}

/** Test seam — resets the no-repeat memory. */
export function resetAcknowledgements(): void {
  previous = null
}
