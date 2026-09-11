/**
 * Ground truth for the fallback, so it answers from data instead of guessing.
 *
 * The failure this exists to stop: asked "what two items need my attention?"
 * the model replied "I can't access your memory file yet… the task board shows
 * everything's completed… what two items should I flag for you?". Two items
 * DID need attention — /api/attention said so — but the model had no way to
 * see them, so it hedged, asserted something it could not know, and handed the
 * question back.
 *
 * A model with no data will fill the gap. The fix is not a sterner prompt, it
 * is giving it the numbers and telling it to say so when they are absent.
 */
import { api } from './api'
import { isOn as presentationOn } from './presentation'

/** Compact enough to prepend to every question without meaningful cost. */
export async function currentState(): Promise<string> {
  const [tasks, attention, tokens, git, memory, usage] = await Promise.all([
    api.getMetric('tasks').catch(() => null),
    api.getAttention().catch(() => null),
    api.getMetric('tokens').catch(() => null),
    api.getMetric('git').catch(() => null),
    /*
     * The memory index, because its absence was the whole problem.
     *
     * Asked "how do I work?", the Chat tab read MEMORY.md and answered from
     * it; Assistant Mode did not — and that was not the model. The state
     * block held tasks, attention, usage and git and no memory at all, while
     * the prompt below told it not to go looking for files. So it had neither
     * the facts nor permission to fetch them, and answered from general
     * knowledge instead.
     *
     * The index is cheap: 16 memories, about 2KB of names and hooks. Bodies
     * are deliberately left out — Joeru's own instruction is to read the
     * index first and open a file only when its line looks relevant, and that
     * is exactly what the prompt now permits.
     */
    api.joeruMemory().catch(() => null),
    /*
     * Real plan limits, so "how much have I used?" is answerable.
     *
     * Distinct from the token counts below, and the distinction is the point:
     * tokens measure how much work has been done, while this is the cap that
     * actually stops the work. Asked "am I close to my limit" when the block
     * held only a dollar budget, the model answered about the budget — the
     * same category error as the "ok thanks" budget report, and just as
     * confidently wrong.
     */
    (window.electronAPI?.claudeUsage
      ? window.electronAPI.claudeUsage()
      : api.usage()).catch(() => null),
  ])

  const lines: string[] = []

  if (attention?.items) {
    const items = attention.items as any[]
    lines.push(`Attention queue (${items.length} item${items.length === 1 ? '' : 's'}):`)
    if (!items.length) lines.push('  (empty)')
    for (const i of items) {
      /*
       * No masking needed here any more.
       *
       * This used to strip the detail off `budget` items, because theirs read
       * "$297.28 / $50.00 (595%)" and leaving it would have leaked the exact
       * spend figures the line below was masking. Those items are gone — the
       * queue now carries `limit` items whose detail is "96% used · resets in
       * 3h", which is a percentage of a rate-limit window and discloses
       * nothing about the business.
       */
      const detail = i.detail
      lines.push(`  - [${i.severity}] ${i.kind}: ${i.title}${detail ? ` (${detail})` : ''}`)
    }
  } else {
    lines.push('Attention queue: UNAVAILABLE')
  }

  if (tasks?.tasks) {
    const list = tasks.tasks as any[]
    const byStatus = list.reduce((acc: Record<string, number>, t) => {
      acc[t.status] = (acc[t.status] || 0) + 1
      return acc
    }, {})
    lines.push(`Task board (${list.length} tasks, source ${tasks.source}): `
      + (Object.entries(byStatus).map(([s, n]) => `${n} ${s}`).join(', ') || 'empty'))
    // Only unfinished work — completed titles are noise for "what now".
    for (const t of list.filter((x) => x.status !== 'Completed')) {
      lines.push(`  - ${t.status} ${t.progress ?? 0}%: ${t.title}`)
    }
  } else {
    lines.push('Task board: UNAVAILABLE')
  }

  /*
   * Token volume, not money.
   *
   * The dollar figures that used to sit here were removed rather than masked,
   * because they were not true: the collector priced every token at one flat
   * Sonnet rate whatever model actually ran, and a subscription has no
   * per-token bill for them to describe. Handing the model a wrong number and
   * asking it not to over-report it was solving the wrong problem — it was the
   * figure that was wrong, not the model's willingness to read it out.
   *
   * Token counts ARE real (deduplicated by message id from the transcripts),
   * so they stay, and they are still masked in presentation mode: a volume of
   * work leaks less than an amount of money, but it is not nothing.
   */
  if (presentationOn()) {
    lines.push('Token usage: HIDDEN (presentation mode) — do not state or estimate any figure')
  } else if (tokens) {
    lines.push(`Token usage: ${Number(tokens.today ?? 0).toLocaleString()} today, `
      + `${Number(tokens.weekly ?? 0).toLocaleString()} this week`)
    lines.push('  (there is NO dollar cost figure in this system — it is a '
      + 'subscription, and any amount you state would be invented)')
  } else {
    lines.push('Token usage: UNAVAILABLE')
  }

  /*
   * Names and hooks only, with the path to each.
   *
   * The path matters: it is what makes "read the one that looks relevant"
   * actionable rather than a suggestion the model cannot act on.
   */
  const memories: any[] = memory?.memories ?? []
  if (memories.length) {
    lines.push(`Memory index (${memories.length} memories, in ${memory.dir}):`)
    for (const m of memories) {
      lines.push(`  - ${m.folder}/${m.slug}.md — ${m.name}${m.description ? `: ${m.description}` : ''}`)
    }
  } else if (memory && memory.available === false) {
    // Said explicitly, because "no memory" and "the kit is not checked out
    // here" lead to different answers and only one of them is the model's
    // fault.
    lines.push('Memory: UNAVAILABLE (joeru-kit not found at the configured path)')
  } else {
    lines.push('Memory: UNAVAILABLE')
  }

  /*
   * Percentages of a rate-limit window, never masked by presentation mode:
   * they say nothing about the business, unlike a token or money figure.
   *
   * The "not observed yet" case is spelled out rather than omitted, because
   * silence here is what made the model guess. A window it cannot see must
   * produce "I can't see it", not a reassuring number.
   */
  const windows = usage?.usage?.windows
  if (windows && Object.keys(windows).length) {
    const label: Record<string, string> = {
      five_hour: '5-hour session limit',
      seven_day: '7-day weekly limit',
      seven_day_opus: 'Opus weekly limit',
      seven_day_sonnet: 'Sonnet weekly limit',
    }
    const parts: string[] = []
    for (const [key, win] of Object.entries(windows as Record<string, any>)) {
      const resets = typeof win.resetsAt === 'number'
        ? `, resets ${new Date(win.resetsAt * 1000).toLocaleString()}`
        : ''
      parts.push(`${label[key] ?? key} ${win.usedPercent}% used${resets}`)
    }
    lines.push(`Claude plan limits (${usage.stale ? 'last seen' : 'current'}): ${parts.join('; ')}`)
    lines.push('  (these are subscription rate limits — the cap that stops '
      + 'work, not a measure of how much work was done)')
  } else {
    lines.push('Claude plan limits: UNAVAILABLE (not observed yet this session)')
  }

  if (git?.available === false) {
    lines.push(`Git: UNAVAILABLE (${git.reason ?? 'unknown'})`)
  } else if (git?.repos) {
    const repos = git.repos as any[]
    lines.push(`Git (${repos.length} repos): `
      + repos.map((r) => `${r.name} on ${r.branch}, ${(r.modified || []).length} modified`).join('; '))
  }

  return lines.join('\n')
}

/** One exchange, as the model should see it. */
export interface Exchange {
  question: string
  answer: string
  /**
   * Which brain answered — and therefore whether the CLI already knows about
   * this turn. See `history()` below for why only some are re-sent.
   */
  source?: 'local' | 'claude' | 'joeru'
}

/**
 * The turns the CLI cannot see, so a follow-up still means what it says.
 *
 * THIS USED TO BE THE WHOLE CONVERSATION, AND NO LONGER IS.
 *
 * Assistant Mode now holds one CLI session for the app run, so the model has
 * genuine memory of everything it answered — re-sending those turns would
 * show it the same exchange twice, once from its own transcript and once
 * quoted back at it, which is a good way to make it distrust both.
 *
 * But the session has holes. Most questions never reach the CLI at all: the
 * status, next, spend and small-talk intents are answered locally in
 * assistant-intents.ts precisely because they are instant and free. Those
 * exchanges happened as far as the user is concerned, and are invisible to the
 * session. So a conversation can go:
 *
 *   "what needs my attention?"   → answered locally, CLI never saw it
 *   "mark the second one done"   → goes to the CLI, which has no idea
 *
 * which is the original failure returning by a new route. Hence: send exactly
 * the turns the CLI did not handle, and label them as such.
 */
const HISTORY_TURNS = 4

/** Long answers are truncated: enough to resolve a reference, not to re-read. */
const HISTORY_CHARS = 400

function history(recent: Exchange[]): string[] {
  const unseen = recent.filter((e) => e.question && e.answer && e.source !== 'claude')
  const use = unseen.slice(-HISTORY_TURNS)
  if (!use.length) return []
  return [
    // Named for what it is. "CONVERSATION SO FAR" would contradict the
    // transcript the model already holds, which is worse than saying nothing.
    '--- EARLIER TURNS YOU DID NOT HANDLE (answered without you, oldest first) ---',
    ...use.flatMap((e) => [
      `Me: ${e.question}`,
      `Answered for you: ${e.answer.length > HISTORY_CHARS
        ? `${e.answer.slice(0, HISTORY_CHARS)}…` : e.answer}`,
    ]),
    '--- END EARLIER TURNS ---',
    '',
  ]
}

/**
 * Wraps a question with the state, the recent conversation, and the rules.
 *
 * The prohibitions are specific because each observed failure was specific.
 * It invented a summary of the board and asked the user to supply the answer.
 * And told "ok thanks" — which is not a question at all — it obeyed "answer
 * from the state" literally and read out the most urgent thing in it, a budget
 * overrun nobody had asked about. Both are worse than saying nothing useful:
 * one cannot be trusted even when right, the other answers a question that was
 * never asked.
 */
export function ground(question: string, state: string, recent: Exchange[] = []): string {
  return [
    'You are answering one turn of a spoken conversation.',
    '',
    'The CURRENT STATE below is read live from the dashboard and is',
    'authoritative for tasks, attention, usage and git — prefer it over',
    'anything you remember or infer, and do not go hunting through the',
    'repository to re-confirm those numbers.',
    '',
    /*
     * The hazard that comes with holding one session for the whole app run.
     *
     * Every question carries a fresh state block, so after twenty questions
     * the transcript holds twenty of them — one saying the 5-hour window is
     * at 40 per cent, a later one at 90. Nothing in the earlier prompts said
     * which wins, and reading an old one would produce a confidently wrong
     * answer from correct data. That is the same shape as the "ok thanks"
     * budget report: not a hallucination, a context mistake.
     *
     * Stated on every turn rather than once at the start, because the turn
     * being answered is the one that has to get it right, and a rule from
     * twenty messages ago competes with nineteen stale blocks.
     */
    'This conversation may contain EARLIER CURRENT STATE blocks from previous',
    'questions. They are out of date. Only the last one — the one below — is',
    'true. Never quote a figure from an earlier block, and if you notice two',
    'that disagree, the later one is correct.',
    '',
    /*
     * The one exception, and it exists because the blanket ban was wrong.
     *
     * The instruction used to be "answer using ONLY the current state, do not
     * go looking for files". Combined with a state block that contained no
     * memory, that guaranteed the failure: asked about preferences or past
     * decisions it had neither the facts nor permission to fetch them, so it
     * answered from general knowledge — while the Chat tab, under no such
     * ban, read MEMORY.md and got it right.
     *
     * Reading one named memory file is a single tool call against a file
     * whose path is listed above. That is a very different act from searching
     * a repository, which is what the ban was actually for.
     */
    'ONE EXCEPTION: the memory index above lists names, hooks and paths, not',
    'the memories themselves. If a question is about how Joel works, what was',
    'decided before, or anything a listed memory plainly covers, READ that',
    'file before answering — its path is given. Answer from what it says, not',
    'from what the hook implies. If no memory covers it, say so rather than',
    'guessing at a preference.',
    '',
    'Answer the question that was actually asked, and nothing else. Do not',
    'volunteer other things from the state because they look urgent — if the',
    'question is about tasks, do not mention spend. If what was said is not a',
    'question at all, reply in a few words as a person would and report no',
    'state whatsoever.',
    '',
    'If the state does not contain the answer, say plainly that you cannot see',
    'it and name what is missing. Never guess a number, never describe the',
    'board without reading it here, and never ask the user to supply the answer',
    'you were asked for. Anything marked UNAVAILABLE is genuinely unknown.',
    '',
    'Resolve "that", "it" and "the one you mentioned" against the conversation',
    'below. If a reference is still ambiguous, ask which one — do not pick.',
    '',
    ...history(recent),
    '--- CURRENT STATE ---',
    state,
    '--- END STATE ---',
    '',
    `Me: ${question}`,
  ].join('\n')
}
