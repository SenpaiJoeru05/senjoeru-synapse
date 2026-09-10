/**
 * Turning data into something a person would actually say.
 *
 * The local answers were correct and read like a dashboard being dictated:
 *
 *   "Nothing's in progress at the moment, one task waiting, fifteen tasks
 *    complete, and two items need your attention."
 *   "The main one is Over weekly AI budget — 297 dollars and 28 cents of 50
 *    dollars, 595 percent."
 *
 * Three things are wrong with those, and none of them is the facts.
 *
 * They are LISTS, joined with commas. Four counts in one breath is a table
 * read aloud; a person leads with the one that matters and stops.
 *
 * They are OVER-PRECISE. Nobody wants "26 dollars and 74 cents" spoken —
 * "about twenty-seven dollars" is the same information at the resolution the
 * question was asked in. Exact figures stay on screen, where scanning is cheap.
 *
 * They report FIELDS rather than meaning. "Over weekly AI budget, 595 percent"
 * is a row from the attention queue; "you're nearly six times over your weekly
 * budget" is what it means. Reading the title as a noun phrase is what makes
 * it sound like a machine — it never rephrases, because it never understood.
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
 * Money at the precision speech wants.
 *
 * Cents are dropped above a few dollars because they are noise out loud, and
 * the hedge is explicit — "about" — so rounding can never be mistaken for a
 * precise claim. Under a dollar the cents ARE the answer, so they stay.
 */
export function approxMoney(n: number): string {
  const v = Math.abs(Number(n) || 0)
  if (v < 1) return `${Math.round(v * 100)} cents`
  const rounded = Math.round(v)
  const dollars = `${rounded} dollar${rounded === 1 ? '' : 's'}`
  // Only hedge when something was actually dropped.
  return Math.abs(v - rounded) < 0.005 ? dollars : `about ${dollars}`
}

/**
 * Money used as an adjective: "a 50 dollar budget", never "50 dollars budget".
 *
 * English puts an attributive noun in the singular, and getting it wrong is
 * conspicuous out loud — it is the kind of slip that marks generated speech
 * more than any amount of stiffness.
 */
export function moneyAdjective(n: number): string {
  return `${Math.round(Math.abs(Number(n) || 0))} dollar`
}

/**
 * A ratio as a person says it, rather than as a percentage.
 *
 * "595 percent" needs mental arithmetic to mean anything; "nearly six times
 * over" lands immediately. Percentages survive only in the range where they
 * are the natural unit — approaching the limit.
 *
 * Every branch returns a fragment that composes with a following "the X
 * budget", including the under-limit one. An earlier version returned
 * "90 percent of it" there, which built "90 percent of it the 50 dollar
 * budget" — the grammar has to hold for every branch, not just the ones the
 * example happened to exercise.
 */
export function overBy(spent: number, limit: number): string {
  if (!limit || limit <= 0) return ''
  const ratio = spent / limit
  if (ratio < 1) return `at ${Math.round(ratio * 100)} percent of`
  if (ratio < 1.15) return 'just over'
  if (ratio < 1.9) return `about ${Math.round(ratio * 10) / 10} times over`
  const times = Math.round(ratio)
  // "nearly" when rounding up to reach it, "more than" when already past.
  const word = times > ratio ? 'nearly' : 'more than'
  return `${word} ${spokenNumber(times)} times over`
}

/**
 * Pick a phrasing, never the same one twice running.
 *
 * Variation is most of what separates an assistant from an announcement
 * system. Keyed per call site so alternatives for "nothing to report" do not
 * suppress alternatives for something unrelated.
 */
const lastUsed = new Map<string, string>()

export function vary(key: string, options: string[]): string {
  if (options.length < 2) return options[0] ?? ''
  const previous = lastUsed.get(key)
  const pool = previous ? options.filter((o) => o !== previous) : options
  const pick = pool[Math.floor(Math.random() * pool.length)]
  lastUsed.set(key, pick)
  return pick
}

/** Test seam. */
export function resetVariation(): void {
  lastUsed.clear()
}

export interface AttentionItem {
  severity?: string
  kind?: string
  title?: string
  detail?: string
}

/**
 * One attention item as a spoken clause.
 *
 * Phrased per kind, because the queue stores what is convenient for a table.
 * A task item's `title` is a real noun phrase and speaks well; a budget item's
 * is "Over weekly AI budget", which can only be read out, not said. The money
 * is recovered from `detail` — "$297.28 / $50.00 (595%)" — since that is where
 * the service puts it.
 */
export function phraseItem(item: AttentionItem): string {
  const title = String(item?.title ?? '').trim() || 'something'

  if (item?.kind === 'budget') {
    const nums = String(item.detail ?? '').match(/\$([\d.,]+)\s*\/\s*\$([\d.,]+)/)
    const scope = /hour/i.test(title) ? 'this hour' : 'this week'
    if (nums) {
      const spent = Number(nums[1].replace(/,/g, ''))
      const limit = Number(nums[2].replace(/,/g, ''))
      const over = overBy(spent, limit)
      return `your AI spend ${scope} is ${approxMoney(spent)}`
        + `, ${over ? `${over} the ${moneyAdjective(limit)} budget` : 'past the budget'}`
    }
    return `you're over the AI budget ${scope}`
  }

  switch (item?.kind) {
    case 'failed': return `${title} has failed`
    case 'review': return `${title} is waiting on your review`
    case 'stalled': {
      const days = String(item.detail ?? '').match(/untouched (\d+)d/)
      return days
        ? `${title} hasn't moved in ${spokenNumber(Number(days[1]))} day${days[1] === '1' ? '' : 's'}`
        : `${title} has stalled`
    }
    default: return title
  }
}
