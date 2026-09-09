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

/**
 * Wraps a question with the state and the rules for using it.
 *
 * The prohibitions are specific because the observed failure was specific: it
 * invented a summary of the board and then asked the user to supply the answer.
 * Both are worse than "I don't know" — a voice assistant that hands the
 * question back has done nothing, and one that guesses cannot be trusted on
 * the answers that happen to be right.
 */
export function ground(question: string, state: string): string {
  return [
    'Answer using ONLY the CURRENT STATE below. It is read live from the',
    'dashboard and is authoritative — prefer it over anything you remember or',
    'infer, and do not go looking for files to confirm it.',
    '',
    'If the state does not contain the answer, say plainly that you cannot see',
    'it and name what is missing. Never guess a number, never describe the',
    'board without reading it here, and never ask the user to supply the answer',
    'you were asked for. Anything marked UNAVAILABLE is genuinely unknown.',
    '',
    '--- CURRENT STATE ---',
    state,
    '--- END STATE ---',
    '',
    `Question: ${question}`,
  ].join('\n')
}
