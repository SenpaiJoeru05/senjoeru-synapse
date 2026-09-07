/**
 * Assistant Mode's brain — deliberately NOT a model.
 *
 * Everything worth asking about the state of work is already computed locally
 * and costs nothing: the attention queue, the task board, git, costs. A reply
 * from the configured OpenCode model measures 10-20s per turn on this machine
 * (and doubles for a question that needs a tool call), so routing "what's the
 * status" through it would make the one thing voice is good for — an instant
 * answer — the slowest way to ask.
 *
 * So: regex to a local endpoint where we can, hand to Joeru where we can't.
 * Anything unmatched is `ask`, and the caller is expected to say so before it
 * starts waiting. Grow the grammar from questions that actually fall through,
 * not from imagined ones.
 */
import { api } from './api'

export type Intent = 'status' | 'next' | 'spend' | 'broken' | 'ask'

export interface Answer {
  intent: Intent
  /** Read aloud. One or two sentences — never a list. */
  speech: string
  /** Shown on screen. The detail the speech deliberately omits. */
  lines: string[]
  source: 'local' | 'joeru'
}

const RULES: [RegExp, Intent][] = [
  [/\b(broken|breaking|fail(ed|ing)?|stuck|stalled|blocked|error)\b/i, 'broken'],
  [/\b(spent|spend|cost|costs|budget|token|tokens|money|bill)\b/i, 'spend'],
  [/\b(next|should i|should we|what now|priorit)/i, 'next'],
  [/\b(status|update|progress|working on|going on|state)\b/i, 'status'],
]

export function classify(question: string): Intent {
  for (const [re, intent] of RULES) if (re.test(question)) return intent
  return 'ask'
}

/** speechSynthesis reads "$67.50" as "dollar sixty seven point five". */
export function spokenMoney(n: number): string {
  const dollars = Math.floor(n)
  const cents = Math.round((n - dollars) * 100)
  const d = `${dollars} dollar${dollars === 1 ? '' : 's'}`
  // "66 dollars 66" is ambiguous out loud; name the unit.
  return cents ? `${d} ${cents} cent${cents === 1 ? '' : 's'}` : d
}

const plural = (n: number, one: string, many = one + 's') =>
  `${n} ${n === 1 ? one : many}`

/** Highest severity first, so the spoken headline is the thing that matters. */
const RANK: Record<string, number> = { high: 0, medium: 1, low: 2 }
const bySeverity = (a: any, b: any) =>
  (RANK[a?.severity] ?? 9) - (RANK[b?.severity] ?? 9)

async function answerNext(): Promise<Answer> {
  const at = await api.getAttention()
  const items = [...(at?.items ?? [])].sort(bySeverity)

  if (!items.length) {
    return {
      intent: 'next',
      speech: 'Nothing needs your attention. The board is clear.',
      lines: [],
      source: 'local',
    }
  }

  const top = items[0]
  const rest = items.length - 1
  // Speak the headline and a count; the screen carries the rest. Reading a
  // list aloud is unbearable past about three items.
  const speech = rest > 0
    ? `${plural(items.length, 'thing')} need attention. Top one: ${top.title}. ${top.detail ?? ''}`
    : `One thing needs attention: ${top.title}. ${top.detail ?? ''}`

  return {
    intent: 'next',
    speech: speech.trim(),
    lines: items.slice(0, 8).map((i: any) =>
      `[${i.severity}] ${i.title}${i.detail ? ` — ${i.detail}` : ''}`),
    source: 'local',
  }
}

async function answerStatus(): Promise<Answer> {
  const [tasksMetric, at] = await Promise.all([
    api.getMetric('tasks').catch(() => null),
    api.getAttention().catch(() => null),
  ])

  const tasks: any[] = tasksMetric?.tasks ?? []
  const working = tasks.filter((t) => t.status === 'Working')
  const pending = tasks.filter((t) => t.status === 'Pending' || t.status === 'Reviewing')
  const done = tasks.filter((t) => t.status === 'Completed')
  const needs = at?.counts?.total ?? 0

  if (!tasks.length) {
    return {
      intent: 'status',
      speech: 'The task board is empty, so there is nothing in progress.',
      lines: ['No tasks on the board — agents write it as work happens.'],
      source: 'local',
    }
  }

  // Built as whole sentences: joining fragments with ". " produced
  // "4 completed. and 2 items needs attention." — a conjunction after a full
  // stop, and a plural noun with a singular verb. Both are obvious out loud.
  const sentences: string[] = [
    working.length
      ? `${plural(working.length, 'task')} in progress: ${working.map((t) => t.title).join(', ')}`
      : 'Nothing is in progress right now',
  ]

  const counts: string[] = []
  if (pending.length) counts.push(`${plural(pending.length, 'task')} waiting`)
  if (done.length) counts.push(`${done.length} completed`)
  if (counts.length) sentences.push(counts.join(' and '))

  if (needs) {
    sentences.push(`${plural(needs, 'item')} ${needs === 1 ? 'needs' : 'need'} attention`)
  }

  return {
    intent: 'status',
    speech: sentences.join('. ') + '.',
    lines: tasks.slice(0, 8).map((t) =>
      `${t.status} · ${t.progress ?? 0}% · ${t.title}`),
    source: 'local',
  }
}

async function answerSpend(): Promise<Answer> {
  const [costs, tokens] = await Promise.all([
    api.getMetric('costs').catch(() => null),
    api.getMetric('tokens').catch(() => null),
  ])

  if (!costs) {
    return {
      intent: 'spend',
      speech: 'I could not read the cost metrics.',
      lines: ['costs.json unavailable — is the collector running?'],
      source: 'local',
    }
  }

  const today = Number(costs.today ?? 0)
  const weekly = Number(costs.weekly ?? 0)

  return {
    intent: 'spend',
    speech: `Today you have spent ${spokenMoney(today)}, and ${spokenMoney(weekly)} this week.`,
    lines: [
      `today   $${today.toFixed(2)}`,
      `week    $${weekly.toFixed(2)}`,
      `month   $${Number(costs.monthly ?? 0).toFixed(2)}`,
      tokens ? `tokens today  ${Number(tokens.today ?? 0).toLocaleString()}` : '',
    ].filter(Boolean),
    source: 'local',
  }
}

async function answerBroken(): Promise<Answer> {
  const [at, git] = await Promise.all([
    api.getAttention().catch(() => null),
    api.getMetric('git').catch(() => null),
  ])

  const items = [...(at?.items ?? [])]
    .filter((i: any) => i.kind === 'failed' || i.kind === 'stalled')
    .sort(bySeverity)

  const lines: string[] = items.map((i: any) =>
    `[${i.kind}] ${i.title}${i.detail ? ` — ${i.detail}` : ''}`)

  // git.available === false is a real breakage worth reporting out loud; an
  // empty repo list is not.
  if (git && git.available === false) {
    lines.push(`git unavailable — ${git.reason ?? 'unknown reason'}`)
  }

  if (!lines.length) {
    return {
      intent: 'broken',
      speech: 'Nothing is failing or stalled.',
      lines: [],
      source: 'local',
    }
  }

  const speech = items.length
    ? `${plural(items.length, 'thing')} looks wrong. ${items[0].title}.`
    : 'Git is not available, so repository activity cannot be read.'

  return { intent: 'broken', speech, lines, source: 'local' }
}

/**
 * Answer a question. Returns null for `ask`, which the caller must route to
 * Joeru — kept out of here so this module stays free of the token-spending
 * path and can be reasoned about as pure local lookups.
 */
export async function answerLocally(question: string): Promise<Answer | null> {
  switch (classify(question)) {
    case 'next': return answerNext()
    case 'status': return answerStatus()
    case 'spend': return answerSpend()
    case 'broken': return answerBroken()
    default: return null
  }
}
