/**
 * "Remember that…" — filing a fact into joeru-kit's memory, by voice.
 *
 * Memory is the centre of this workspace: one store, in the kit, read by Claude
 * Code and OpenCode alike. Yet Assistant Mode could only write to it by asking
 * Claude, which meant thirteen seconds and subscription quota to append a few
 * lines of markdown — and a model choosing the folder, the filename and the
 * wording on its own.
 *
 * The backend already does the careful part: MemoryService validates the folder
 * and slug, refuses path traversal, writes the frontmatter, and keeps MEMORY.md
 * in step. This decides only what to file and where.
 *
 * LIKE TASK ACTIONS, THIS NEVER ACTS. It returns an intent for the caller to
 * confirm out loud. A write into a git repo the user owns is not somewhere to
 * be approximately right, and speech recognition is approximately right by
 * nature — so the fact is read back verbatim before anything is saved. A
 * misheard memory is worse than a missing one: it is wrong, permanent, and
 * read as authoritative by every agent afterwards.
 */
import { api } from './api'

/** MemoryService's folders. It is the authority; this must match it. */
export type MemoryFolder = 'facts' | 'preferences' | 'decisions' | 'corrections'

export interface MemoryDraft {
  folder: MemoryFolder
  slug: string
  /** The index line — one sentence, shown in MEMORY.md. */
  description: string
  /** The file body. */
  body: string
}

export type MemoryParse =
  | { kind: 'none' }
  | { kind: 'ready'; draft: MemoryDraft }
  /** Heard the instruction but nothing to file after it. */
  | { kind: 'empty' }

/**
 * The instruction, and everything after it is the fact.
 *
 * Anchored to the start, for the same reason task commands are: "what did you
 * remember about the budget" is a question, and only the opening words
 * separate it from an instruction to file something.
 *
 * The capture group deliberately takes the REST of the utterance verbatim.
 * Summarising it here would be the one place a paraphrase could quietly
 * replace what was actually said.
 */
const INSTRUCTION = new RegExp(
  '^(?:please\\s+|can you\\s+|could you\\s+|now\\s+)*'
  + '(?:remember|note|make a note|jot down|keep in mind|write down|file)'
  + '(?:\\s+(?:that|this|it))?'
  + '\\s*[:,]?\\s+(.+)$',
  'i',
)

/** "don't forget X" says the same thing with a negative. */
const DONT_FORGET = /^(?:please\s+)?(?:don'?t|do not)\s+forget\s+(?:that\s+|about\s+)?(.+)$/i

/**
 * Which folder a fact belongs in.
 *
 * Ordered by how specific the signal is. A correction is also a fact and a
 * preference is also a fact, so the narrower readings are tested first and
 * `facts` is what remains — which matches how the folders are actually used.
 */
const FOLDER_RULES: [RegExp, MemoryFolder][] = [
  [/\b(actually|correction|i was wrong|that'?s wrong|not .{2,30} but|instead it'?s)\b/i, 'corrections'],
  [/\b(we (decided|chose|agreed|settled|rejected|are going with|went with)|decided to|going with|rejected|instead of|in favour of|in favor of)\b/i, 'decisions'],
  [/\b(i (prefer|like|hate|want|always|never|don'?t)|prefers?|always|never|please stop|from now on)\b/i, 'preferences'],
]

function folderFor(fact: string): MemoryFolder {
  return FOLDER_RULES.find(([re]) => re.test(fact))?.[1] ?? 'facts'
}

/**
 * Words too common to identify anything, dropped from the filename only.
 *
 * The slug is a handle, not a summary — the description and body keep the
 * exact wording, so trimming here loses nothing recoverable.
 */
const SLUG_STOP = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'that', 'this', 'it', 'its', 'to', 'of', 'in', 'on', 'at', 'for', 'with',
  'and', 'or', 'but', 'so', 'because', 'we', 'i', 'you', 'my', 'our', 'his',
  'their', 'them', 'has', 'have', 'had', 'do', 'does', 'did', 'will', 'would',
  'should', 'can', 'could', 'about', 'from', 'as', 'by', 'not',
  // Question words identify nothing. Without these, "it is what it is" filed
  // itself as `what.md`, which is a valid slug and a useless filename.
  'what', 'when', 'where', 'why', 'how', 'who', 'which',
])

/** MemoryService's own pattern. A slug that fails it is rejected server-side. */
const VALID_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/**
 * A filename for the fact.
 *
 * Six significant words is enough to recognise a memory in a directory listing
 * without becoming a sentence. If nothing survives the filter — a fact made
 * entirely of common words — a date-stamped fallback keeps the write valid
 * rather than failing on a slug the server would reject.
 */
export function slugFor(fact: string): string {
  const words = fact
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 1 && !SLUG_STOP.has(w))
    .slice(0, 6)

  const slug = words.join('-').replace(/^-+|-+$/g, '')
  if (slug && VALID_SLUG.test(slug)) return slug
  return `note-${new Date().toISOString().slice(0, 10)}`
}

/** One sentence for MEMORY.md, which is scanned rather than read. */
function describe(fact: string): string {
  const first = fact.split(/(?<=[.!?])\s/)[0].trim() || fact.trim()
  return first.length > 120 ? `${first.slice(0, 117).trimEnd()}…` : first
}

/** Capitalise for the file body; speech arrives lowercase from the recogniser. */
const sentence = (s: string) => {
  const t = s.trim()
  if (!t) return t
  const capped = t.charAt(0).toUpperCase() + t.slice(1)
  return /[.!?]$/.test(capped) ? capped : `${capped}.`
}

export function parse(text: string): MemoryParse {
  const said = String(text || '').trim()
  const m = said.match(INSTRUCTION) || said.match(DONT_FORGET)
  if (!m) return { kind: 'none' }

  const fact = m[1].trim()

  /*
   * "remember" with nothing after it is an instruction with no object.
   *
   * A length check alone was not enough. The "that/this/it" group is optional,
   * so on "remember that" the regex simply skipped it and captured "that" as
   * the fact — four characters, past any length gate, and it would have filed
   * a memory whose entire content was the word "that". Filler has to be
   * rejected by what it is, not by how long it is.
   */
  if (fact.length < 3) return { kind: 'empty' }
  if (/^(that|this|it|the)\b[\s.,!?]*$/i.test(fact)) return { kind: 'empty' }

  const body = sentence(fact)
  return {
    kind: 'ready',
    draft: {
      folder: folderFor(fact),
      slug: slugFor(fact),
      description: describe(body),
      body,
    },
  }
}

/** Save it. Only ever called after an explicit confirmation. */
export async function apply(draft: MemoryDraft) {
  return api.joeruSaveMemory(draft.folder, draft.slug, {
    description: draft.description,
    body: draft.body,
  })
}

/** The word for a folder, as it would be said rather than as it is spelled. */
const SPOKEN: Record<MemoryFolder, string> = {
  facts: 'a fact',
  preferences: 'a preference',
  decisions: 'a decision',
  corrections: 'a correction',
}

/**
 * How to ask before writing.
 *
 * The FACT is read back in full, not the filename. A filename is a summary,
 * and confirming a summary confirms nothing about whether the sentence being
 * stored is the sentence that was said.
 */
export function confirmationFor(draft: MemoryDraft): string {
  return `I'll file that as ${SPOKEN[draft.folder]}: "${draft.body}" Save it?`
}
