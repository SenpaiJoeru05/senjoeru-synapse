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
  /**
   * Which brain answered. Surfaced in the UI because the three have very
   * different costs: local spends nothing, claude spends subscription quota,
   * joeru spends free-tier requests.
   */
  source: 'local' | 'joeru' | 'claude'
}

const RULES: [RegExp, Intent][] = [
  [/\b(broken|breaking|fail(s|ed|ing|ure|ures)?|stuck|stalled|blocked|errors?)\b/i, 'broken'],
  [/\b(spent|spend|cost|costs|budget|token|tokens|money|bill)\b/i, 'spend'],
  // "attention" belongs here and was missing, which is how "what two items
  // need my attention?" reached the model — the endpoint that answers it is
  // literally called /api/attention. The model then guessed, because it has no
  // access to that data. Grammar gaps do not degrade to a slower answer; they
  // degrade to a wrong one.
  [/\b(attention|needs? me|urgent|important|focus on|priorit)/i, 'next'],
  [/\b(next|should i|should we|what now)/i, 'next'],
  // Plurals are optional, not assumed: \bupdate\b does not match "updates",
  // so "any update" routed locally while "any updates" fell through to the
  // 13s path. A missed plural is a silent downgrade, not a visible error.
  [/\b(status|updates?|progress|working on|going on|state)\b/i, 'status'],
]

export function classify(question: string): Intent {
  for (const [re, intent] of RULES) if (re.test(question)) return intent
  return 'ask'
}

/**
 * These strings are read aloud, so they are written as speech rather than as a
 * status line. Two rules do most of the work:
 *
 *   Spell small numbers out. A TTS engine reads "4 completed" as a fragment
 *   and often clips the digit; "four" scans as part of the sentence.
 *
 *   Join with conjunctions, not full stops. "4 completed. 2 items need
 *   attention." is telegraphic — every period is a hard stop, which is what
 *   makes a synthetic voice sound like a robot reading a table. Commas and
 *   "and" give it the prosody of a spoken clause.
 */
const WORDS = [
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight',
  'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen',
  'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty',
]

/** Words up to twenty, digits above — "thirty-seven tasks" is rarer than useful. */
export function spokenNumber(n: number): string {
  return n >= 0 && n <= 20 && Number.isInteger(n) ? WORDS[n] : String(n)
}

/**
 * "$67.50" is read as "dollar sixty seven point five" by most engines.
 *
 * Digits throughout, deliberately — spelling only the small half produced
 * "124 dollars and sixteen cents", which is worse than either convention.
 * TTS reads bare numerals in a money phrase correctly.
 */
export function spokenMoney(n: number): string {
  const dollars = Math.floor(n)
  const cents = Math.round((n - dollars) * 100)
  const d = `${dollars} dollar${dollars === 1 ? '' : 's'}`
  // "66 dollars 66" is ambiguous out loud; name the unit.
  return cents ? `${d} and ${cents} cent${cents === 1 ? '' : 's'}` : d
}

/**
 * Turns a dashboard detail string into something speakable.
 *
 * These fields are written for the eye — "$124.16 / $50.00 (248%)" — and a TTS
 * engine reads that as "dollar one two four point one six slash dollar fifty".
 * The screen still shows the original; only the spoken copy is rewritten.
 */
export function speakable(detail: string): string {
  return String(detail)
    // $1,234.56 -> 1234 dollars and 56 cents
    .replace(/\$([\d,]+)(?:\.(\d{2}))?/g, (_m, whole: string, cents?: string) => {
      const n = Number(whole.replace(/,/g, ''))
      const base = `${n} dollar${n === 1 ? '' : 's'}`
      const c = cents ? Number(cents) : 0
      return c ? `${base} and ${c} cent${c === 1 ? '' : 's'}` : base
    })
    .replace(/\((\d+(?:\.\d+)?)%\)/g, ', $1 percent')
    .replace(/(\d+(?:\.\d+)?)%/g, '$1 percent')
    .replace(/\s*\/\s*/g, ' of ')
    .replace(/\s{2,}/g, ' ')
    // The substitutions above can leave " ," where a slash preceded a bracket,
    // and a space before a comma becomes an audible stumble.
    .replace(/\s+([,.])/g, '$1')
    .trim()
}

/** Speech starts a sentence; the clauses are written to read mid-sentence. */
const capitalise = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s)

const plural = (n: number, one: string, many = one + 's') =>
  `${spokenNumber(n)} ${n === 1 ? one : many}`

/** Joins clauses the way a person would: "a, b, and c". */
function sentence(clauses: string[]): string {
  const parts = clauses.filter(Boolean)
  if (!parts.length) return ''
  if (parts.length === 1) return `${parts[0]}.`
  if (parts.length === 2) return `${parts[0]}, and ${parts[1]}.`
  return `${parts.slice(0, -1).join(', ')}, and ${parts[parts.length - 1]}.`
}

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
  // Headline plus a count; the screen carries the rest. Reading a list aloud
  // is unbearable past about three items. Phrased as one clause so it does not
  // land as three clipped fragments.
  const detail = top.detail ? ` — ${speakable(top.detail)}` : ''
  const speech = rest > 0
    ? `${plural(items.length, 'thing')} need your attention. The main one is ${top.title}${detail}.`
    : `One thing needs your attention: ${top.title}${detail}.`

  return {
    intent: 'next',
    speech: capitalise(speech.trim()),
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

  // One flowing sentence rather than a list of fragments. Reading the titles
  // of in-progress work aloud is the useful part; the rest is counts.
  const clauses: string[] = []

  if (working.length === 1) {
    clauses.push(`you're working on ${working[0].title}`)
  } else if (working.length > 1) {
    clauses.push(`${plural(working.length, 'task')} are in progress`)
  } else {
    clauses.push("nothing's in progress at the moment")
  }

  if (pending.length) clauses.push(`${plural(pending.length, 'task')} waiting`)
  if (done.length) clauses.push(`${plural(done.length, 'task')} complete`)
  if (needs) clauses.push(`${plural(needs, 'item')} ${needs === 1 ? 'needs' : 'need'} your attention`)

  return {
    intent: 'status',
    speech: capitalise(sentence(clauses)),
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
    speech: `You've spent ${spokenMoney(today)} today, and ${spokenMoney(weekly)} so far this week.`,
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
    ? `${plural(items.length, 'thing')} ${items.length === 1 ? 'looks' : 'look'} wrong — ${items[0].title}.`
    : "Git isn't available, so I can't read repository activity."

  return { intent: 'broken', speech: capitalise(speech), lines, source: 'local' }
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
