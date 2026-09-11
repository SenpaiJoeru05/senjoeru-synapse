/**
 * Turning data into something a person would actually say.
 *
 * The local answers were correct and read like a dashboard being dictated:
 *
 *   "Nothing's in progress at the moment, one task waiting, fifteen tasks
 *    complete, and two items need your attention."
 *   "The main one is Almost out of weekly (7d) limit — 96% used · resets in 3h."
 *
 * Three things are wrong with those, and none of them is the facts.
 *
 * They are LISTS, joined with commas. Four counts in one breath is a table
 * read aloud; a person leads with the one that matters and stops.
 *
 * They are OVER-PRECISE. Nobody wants "96.4 per cent" spoken, or a bracketed
 * "(7d)" that only means anything on screen. Exact figures stay in the
 * transcript, where scanning is cheap.
 *
 * They report FIELDS rather than meaning. "Almost out of weekly (7d) limit,
 * 96% used" is a row from the attention queue; "you're at 96 per cent of your
 * weekly limit, resetting in 3h" is what it means. Reading the title as a noun
 * phrase is what makes it sound like a machine — it never rephrases, because
 * it never understood.
 *
 * The money helpers this file used to carry (approxMoney, moneyAdjective,
 * overBy) went with the cost metrics: those figures priced every token at one
 * flat rate whatever model ran, and a subscription has no per-token bill for
 * them to describe. Phrasing a wrong number well is not an improvement.
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
 * A task item's `title` is a real noun phrase and speaks well; a limit item's
 * is "Almost out of weekly (7d) limit", which can only be read out, not said.
 * The figures are recovered from `detail` — "96% used · resets in 3h" — since
 * that is where the service puts them.
 */
export function phraseItem(item: AttentionItem): string {
  const title = String(item?.title ?? '').trim() || 'something'

  /*
   * Plan-limit items, which replaced the old dollar-budget ones.
   *
   * The detail is "96% used · resets in 3h", and both halves matter out loud:
   * the percentage says how bad it is and the reset says whether to wait or
   * work around it. Nothing here is masked in presentation mode — a share of
   * a rate-limit window discloses nothing about the business, which was the
   * whole reason the old version had to hide its figures.
   */
  if (item?.kind === 'limit') {
    const pct = String(item.detail ?? '').match(/([\d.]+)%/)
    const resets = String(item.detail ?? '').match(/resets in ([\dhm\s]+)/)
    // "Almost out of weekly (7d) limit" → "your weekly limit". The bracketed
    // window length is for the eye, not the ear.
    const which = title
      .replace(/^(Almost out of|Approaching)\s*/i, '')
      .replace(/\s*\([^)]*\)/g, '')
      .trim() || 'usage limit'
    const head = pct
      ? `you're at ${Math.round(Number(pct[1]))} per cent of your ${which}`
      : `you're close to your ${which}`
    return resets ? `${head}, resetting in ${resets[1].trim()}` : head
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
