/**
 * Assistant Mode's brain — deliberately NOT a model.
 *
 * Everything worth asking about the state of work is already computed locally
 * and costs nothing: the attention queue, the task board, git, plan limits. A reply
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
import {
  phraseItem, spokenNumber, vary,
} from './phrasing'
import { isOn as presentationOn } from './presentation'

export type Intent = 'status' | 'next' | 'spend' | 'broken' | 'chat' | 'ask'

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

/**
 * Words that carry no request — the ones a closing remark is made of.
 *
 * "ok thanks" used to reach Claude Haiku wrapped in "answer using ONLY the
 * current state", and with no question in it the model did the most literal
 * thing available: it read out the most urgent thing in the state. The reply
 * was "you're over budget, five hundred eighty-five percent on the week" —
 * true, sourced from the attention queue, and completely unrelated to what was
 * said. It also spent quota and thirteen seconds to say it.
 *
 * Matched by requiring EVERY word to be in here, not by looking for "thanks"
 * anywhere. "thanks, what is the status" is a real question that happens to
 * open with courtesy, and a substring test would swallow it.
 *
 * Kept deliberately tight. Words that could carry a question — "all", "done",
 * "that", "what" — are left out even though they appear in closing remarks,
 * because "all done?" is a genuine question and answering it with "anytime"
 * would be worse than the bug this fixes.
 */
const COURTESY = new Set([
  'ok', 'okay', 'k', 'kk', 'alright', 'right', 'cool', 'nice', 'great',
  'awesome', 'perfect', 'excellent', 'lovely', 'sweet',
  'thanks', 'thank', 'you', 'thx', 'ty', 'cheers', 'appreciated',
  'got', 'it', 'i', 'see', 'understood', 'noted', 'gotcha',
  'sure', 'yep', 'yeah', 'yup', 'nope', 'nah',
  // Intensifiers, so "thanks so much" and "thanks a lot" land here too.
  'much', 'lot', 'a', 'very',
  // "good" is safe only because the phrases that would trap it carry a word
  // from outside this set: "all good" has "all", "is it good" has "is".
  'good', 'hi', 'hello', 'hey', 'yo', 'morning', 'evening',
  'bye', 'goodbye', 'later', 'night', 'nevermind', 'nvm', 'never', 'mind',
  'joeru', 'please', 'lol', 'haha', 'well', 'so', 'um', 'uh',
])

const words = (s: string) =>
  String(s).toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(Boolean)

/** True when the whole utterance is courtesy and asks for nothing. */
export function isSmallTalk(question: string): boolean {
  const w = words(question)
  return w.length > 0 && w.length <= 5 && w.every((x) => COURTESY.has(x))
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

/**
 * A local intent can only answer ONE short, factual question.
 *
 * The rules above test for a keyword anywhere in the string, which is fine for
 * "what's the status" and catastrophic for anything longer. A 79-word message
 * asking whether Assistant Mode's UI needed work — three questions, an aside
 * about STT, and an instruction to leave it for now — was answered with the
 * task board, because the word "status" appeared once in the middle of it.
 *
 * That is the same failure as the budget answer to "ok thanks", from the
 * opposite end: routing decided by a word rather than by what was being asked.
 * A keyword says what an utterance MENTIONS; these gates ask what it IS.
 */
const MAX_LOCAL_WORDS = 12

/**
 * Asking for a judgement, which no local lookup can supply.
 *
 * "Is it good already or what?" and "how about the UI and UX" want an opinion
 * grounded in the code. The attention queue cannot produce one, and answering
 * from it means confidently changing the subject.
 *
 * "should we" is deliberately absent — it belongs to the `next` rule, and
 * putting it here would send "what should we do next" to the slow path, which
 * is a working instant answer today.
 */
const JUDGEMENT = new RegExp(
  '\\b(improve|improvements?|improving|better|worse|opinion|'
  // "thoughts?" does not match "think" — the two most natural ways to ask for
  // an opinion needed listing separately.
  + 'thoughts?|think|thinks|thinking|'
  + 'recommend|recommendation|suggest|suggestions?|advice|advise|'
  + 'how about|what about|any good|good already|'
  // "is it good" was too literal: "is the status good already or what" asks
  // exactly the same thing and named its subject instead of pronouning it.
  + 'is (it|this|that|the [a-z]+) good|worth (it|doing)|'
  + 'ux|ui|design|refactor|rewrite|architecture)\\b',
  'i',
)

/** More than one question in one breath — a single intent cannot serve both. */
const questionCount = (s: string) => (String(s).match(/\?/g) || []).length

export function classify(question: string): Intent {
  // Before the keyword rules, because this is decided by what the utterance is
  // ENTIRELY made of, and a rule that merely looks for words would let
  // "thanks, what's the status" be mistaken for a closing remark.
  if (isSmallTalk(question)) return 'chat'

  // Also before the keyword rules, and for the same reason in reverse: these
  // decide whether a local answer could POSSIBLY be the right shape, and a
  // keyword found inside a paragraph is not evidence that it is.
  if (words(question).length > MAX_LOCAL_WORDS) return 'ask'
  if (questionCount(question) > 1) return 'ask'
  if (JUDGEMENT.test(question)) return 'ask'

  for (const [re, intent] of RULES) if (re.test(question)) return intent
  return 'ask'
}

/**
 * Reply to a closing remark or a greeting.
 *
 * Answered here rather than by the model on purpose: it is instant, costs no
 * quota, and — the actual point — it cannot decide to tell you about your
 * budget instead. There is no data in scope to get wrong.
 */
const GREETING = /^(hi|hello|hey|yo|morning|evening)\b/i
const FAREWELL = /^(bye|goodbye|later|night|good\s?night)\b/i

const CHAT_REPLIES = {
  greeting: ['Hello.', 'Hi. What do you need?', 'Hey.'],
  farewell: ['Talk later.', 'Goodbye.'],
  thanks: ['Anytime.', 'No problem.', 'Sure.', 'Any time.'],
}

function answerChat(question: string): Answer {
  const kind = GREETING.test(question.trim()) ? 'greeting'
    : FAREWELL.test(question.trim()) ? 'farewell'
      : 'thanks'
  const pool = CHAT_REPLIES[kind]
  return {
    intent: 'chat',
    speech: pool[Math.floor(Math.random() * pool.length)],
    lines: [],
    source: 'local',
  }
}

/*
 * ── The answers ─────────────────────────────────────────────────────────────
 *
 * Every `speech` below is read aloud, so it is written as speech. Money and
 * ratios are phrased by ./phrasing; what follows decides WHICH facts to say.
 *
 * That choice is the whole game, and this file used to get it backwards. The
 * rule here was "join with conjunctions, not full stops", on the theory that
 * periods are hard stops and sound telegraphic. Followed honestly it produced
 * "Nothing's in progress, one task waiting, fifteen complete, and two items
 * need your attention" — four counts in one breath, which is a table being
 * dictated, and the comma-joining was not the problem.
 *
 * The real rule is fewer FACTS, not fewer full stops: lead with the one that
 * matters, allow at most one follow-up in a second short sentence, and leave
 * everything else in `lines` for the screen, where scanning is cheap.
 */

/** Speech starts a sentence; the clauses are written to read mid-sentence. */
const capitalise = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s)

const plural = (n: number, one: string, many = one + 's') =>
  `${spokenNumber(n)} ${n === 1 ? one : many}`

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

  // One item spoken properly, and a count for the rest. The screen carries the
  // list; reading more than one aloud is where it starts sounding like a
  // machine working through a queue.
  const top = phraseItem(items[0])
  const rest = items.length - 1

  /*
   * The count, then the item as its own sentence.
   *
   * "The bigger one is ${top}" collided with the clause phraseItem returns and
   * produced "The bigger one is your AI spend this week is about 300 dollars"
   * — two verbs, because the template assumed a noun and got a sentence. Left
   * standing on its own the clause needs no grammatical join at all, which is
   * both correct and how someone would actually say it.
   */
  const lead = rest > 0
    ? vary('next.lead', [
      `${plural(items.length, 'thing')} need a look`,
      `${plural(items.length, 'thing')} could use your attention`,
      `${plural(items.length, 'thing')} outstanding`,
    ])
    : vary('next.one', ['One thing', 'Just one thing'])

  const speech = `${capitalise(lead)}. ${capitalise(top)}.`

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

  /*
   * Lead with the state of play, then at most one follow-up.
   *
   * The old version joined four counts with commas — in-progress, waiting,
   * complete, attention — which is a table read aloud. The completed total is
   * the first casualty: fifteen finished tasks are not news, they are the pile
   * behind you, and they belong on screen. What matters spoken is what is
   * moving, what is stuck, and whether anything wants you.
   */
  let headline: string
  if (working.length === 1) {
    headline = `${vary('status.working', [
      "You're working on", 'In progress:', 'Currently on',
    ])} ${working[0].title}`
  } else if (working.length > 1) {
    headline = `${capitalise(plural(working.length, 'task'))} in progress`
  } else if (!pending.length && !needs) {
    /*
     * Nothing moving, nothing queued, nothing flagged — only here can the
     * completed count be the news, and only here is "all clear" true.
     *
     * The `!needs` half was missing and produced a reply that contradicted
     * itself in consecutive sentences: "Everything's done — sixteen tasks
     * complete. One thing needs a look." Both halves were accurate; the board
     * was clear and the attention queue was not. Saying "all clear" while
     * something wants you is worse than either fact alone, because it tells
     * you to stop looking.
     */
    headline = vary('status.clear', [
      `Everything's done — ${plural(done.length, 'task')} complete`,
      `All clear, ${plural(done.length, 'task')} finished`,
      `Nothing outstanding — all ${plural(done.length, 'task')} complete`,
    ])
  } else if (!pending.length) {
    // Board clear but the attention queue is not, so say only the first part
    // and let the follow-up carry the rest.
    headline = vary('status.doneButFlagged', [
      `The board's clear — ${plural(done.length, 'task')} complete`,
      `${capitalise(plural(done.length, 'task'))} complete, nothing in progress`,
    ])
  } else {
    headline = vary('status.idle', [
      "Nothing's in progress right now",
      'Nothing being worked on at the moment',
    ])
  }

  const follow: string[] = []
  if (pending.length) {
    follow.push(`${plural(pending.length, 'task')} ${pending.length === 1 ? 'is' : 'are'} waiting on you`)
  }
  if (needs) {
    follow.push(vary('status.needs', [
      `${plural(needs, 'thing')} ${needs === 1 ? 'needs' : 'need'} a look`,
      `${plural(needs, 'thing')} could use your attention`,
    ]))
  }

  return {
    intent: 'status',
    // A full stop between them, not a comma: two short sentences are how this
    // is spoken, and a comma-spliced chain is what made it sound recited. Each
    // is capitalised in turn — capitalising only the headline left "right now.
    // one task is waiting", which a TTS voice reads with the wrong cadence.
    speech: [headline, follow.join(', and ')]
      .filter(Boolean)
      .map((s) => capitalise(s.replace(/\.$/, '')))
      .join('. ') + '.',
    /*
     * The unfinished work, not the first eight rows of the file.
     *
     * `tasks.slice(0, 8)` took board order and ignored status, which on a real
     * board is worse than noise — measured against Joel's 19 tasks it showed
     * eight Completed rows and omitted the single Reviewing task entirely. The
     * one row worth reading was the one row missing.
     *
     * `lines` is meant to carry the detail the SPEECH left out, and the speech
     * deliberately drops the completed pile. So: what is moving or waiting,
     * and only then a count of what is behind you.
     *
     * When nothing is outstanding the completed list becomes the useful
     * detail — but most-recent first, since "what did I just finish" is the
     * question that has an answer then.
     */
    lines: (() => {
      const unfinished = [...working, ...pending]
      if (unfinished.length) {
        return [
          ...unfinished.map((t) => `${t.status} · ${t.progress ?? 0}% · ${t.title}`),
          done.length ? `+ ${done.length} completed` : '',
        ].filter(Boolean).slice(0, 8)
      }
      const recent = [...done].sort((a, b) =>
        String(b.lastUpdated ?? '').localeCompare(String(a.lastUpdated ?? '')))
      return recent.slice(0, 6).map((t) => `Completed · ${t.title}`)
    })(),
    source: 'local',
  }
}

/**
 * "How much have I used?" — answered with the real plan windows.
 *
 * This used to answer in dollars, and every figure in it was invented twice
 * over: the collector priced every token at one flat Sonnet rate whatever
 * model actually ran, and the verdict compared that to a budget ceiling that
 * had no bearing on when work would actually stop. On a subscription there is
 * no per-token bill at all.
 *
 * So the question is now answered with the thing it was really asking: how
 * full the 5-hour and weekly windows are, reported by the server itself. The
 * token count comes along as the volume measure, because that number was
 * always real — deduplicated by message id straight from the transcripts.
 */
async function answerSpend(): Promise<Answer> {
  const [usage, tokens] = await Promise.all([
    (window.electronAPI?.claudeUsage
      ? window.electronAPI.claudeUsage()
      : api.usage()).catch(() => null),
    api.getMetric('tokens').catch(() => null),
  ])

  /*
   * Presentation mode silences this answer rather than masking it.
   *
   * Hiding the figures on screen would achieve nothing here: this answer is
   * SPOKEN, and a call picks up the speakers. Masking the text while Piper
   * reads the numbers aloud would be the illusion of privacy — worse than no
   * feature, because you would rely on it.
   *
   * Percentages of a rate limit would arguably be safe to say out loud, but
   * the token volume in the same breath is not, and one gate is easier to
   * trust than a per-figure rule.
   */
  if (presentationOn()) {
    return {
      intent: 'spend',
      speech: "Figures are hidden while you're presenting.",
      lines: ['Usage hidden — turn off "Figures hidden" in the sidebar to see it.'],
      source: 'local',
    }
  }

  const windows = usage?.usage?.windows ?? null
  const session = windows?.five_hour ?? null
  const week = windows?.seven_day ?? null

  if (!session && !week) {
    return {
      intent: 'spend',
      speech: vary('spend.unseen', [
        "I haven't seen your usage yet — it turns up with the next answer.",
        "Nothing recorded yet. Ask me anything else and it'll show up.",
      ]),
      lines: ['No plan-limit reading recorded yet (it arrives with the next CLI answer).'],
      source: 'local',
    }
  }

  /*
   * The verdict, not just the figure — the same principle as the old budget
   * answer, but against a real ceiling this time. Phrased on the window that
   * is furthest along, since that is the one that will stop the work.
   */
  const worst = [session, week]
    .filter(Boolean)
    .sort((a: any, b: any) => b.usedPercent - a.usedPercent)[0] as any
  const verdict = worst.usedPercent >= 95
    ? ', so you are nearly out'
    : worst.usedPercent >= 80
      ? ', so it is worth pacing'
      : ', plenty of room'

  const said: string[] = []
  if (session) said.push(`${Math.round(session.usedPercent)} per cent of your five hour window`)
  if (week) said.push(`${Math.round(week.usedPercent)} per cent of the week`)

  return {
    intent: 'spend',
    speech: `${capitalise(vary('spend.lead', [
      `You're at ${said.join(' and ')}`,
      `${said.join(', and ')}`,
      `Using ${said.join(' and ')}`,
    ]))}${verdict}.`,
    lines: [
      session ? `session (5h)  ${session.usedPercent}% used` : '',
      week ? `weekly (7d)   ${week.usedPercent}% used` : '',
      tokens ? `tokens today  ${Number(tokens.today ?? 0).toLocaleString()}` : '',
      usage?.stale ? 'reading is not current — updates on the next answer' : '',
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

  // phraseItem rather than the bare title, so this says WHAT is wrong. The
  // title alone gave "one thing looks wrong — the git collector fix", which
  // names the thing and withholds the only part worth hearing.
  const speech = items.length
    ? `${capitalise(plural(items.length, 'thing'))} ${items.length === 1 ? 'looks' : 'look'} wrong. `
      + `${capitalise(phraseItem(items[0]))}.`
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
    case 'chat': return answerChat(question)
    default: return null
  }
}
