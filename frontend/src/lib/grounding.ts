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

/** Compact enough to prepend to every question without meaningful cost. */
export async function currentState(): Promise<string> {
  const [tasks, attention, costs, git] = await Promise.all([
    api.getMetric('tasks').catch(() => null),
    api.getAttention().catch(() => null),
    api.getMetric('costs').catch(() => null),
    api.getMetric('git').catch(() => null),
  ])

  const lines: string[] = []

  if (attention?.items) {
    const items = attention.items as any[]
    lines.push(`Attention queue (${items.length} item${items.length === 1 ? '' : 's'}):`)
    if (!items.length) lines.push('  (empty)')
    for (const i of items) {
      lines.push(`  - [${i.severity}] ${i.kind}: ${i.title}${i.detail ? ` (${i.detail})` : ''}`)
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

  if (costs) {
    lines.push(`Spend: $${Number(costs.today ?? 0).toFixed(2)} today, `
      + `$${Number(costs.weekly ?? 0).toFixed(2)} this week, `
      + `$${Number(costs.monthly ?? 0).toFixed(2)} this month`)
  } else {
    lines.push('Spend: UNAVAILABLE')
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
}

/**
 * The recent conversation, so a follow-up means what it says.
 *
 * Every call is a fresh `claude -p` process with no memory of the last one, so
 * "mark that as complete" arrived with nothing for "that" to refer to. It has
 * appeared to work, which is worse than failing: asked to mark "that" complete
 * it went and found the single task in Reviewing and was right by luck. With
 * two such tasks it would have picked one.
 *
 * Four exchanges, not the whole session. Every line is re-sent on every
 * question — there is no server-side session to append to — so history is paid
 * for in full each time, and a voice conversation refers back a turn or two,
 * not twenty.
 */
const HISTORY_TURNS = 4

/** Long answers are truncated: enough to resolve a reference, not to re-read. */
const HISTORY_CHARS = 400

function history(recent: Exchange[]): string[] {
  const use = recent.slice(-HISTORY_TURNS).filter((e) => e.question && e.answer)
  if (!use.length) return []
  return [
    '--- CONVERSATION SO FAR (oldest first) ---',
    ...use.flatMap((e) => [
      `Me: ${e.question}`,
      `You: ${e.answer.length > HISTORY_CHARS
        ? `${e.answer.slice(0, HISTORY_CHARS)}…` : e.answer}`,
    ]),
    '--- END CONVERSATION ---',
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
    'Answer using ONLY the CURRENT STATE below. It is read live from the',
    'dashboard and is authoritative — prefer it over anything you remember or',
    'infer, and do not go looking for files to confirm it.',
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
