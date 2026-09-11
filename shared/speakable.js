/**
 * Markdown out, speech in.
 *
 * THE BUG THIS FIXES
 *
 * Piper reads what it is given, literally. Asked about a price, Joeru replied
 * with "**hoverboard**" and the voice said "star star hoverboard star star".
 * The prompt already tells him never to use markdown in a spoken answer, and
 * he mostly obeys — but "mostly" is not a guarantee you can build on, and a
 * model emphasising a word is the most natural thing in the world.
 *
 * So this is not a second attempt at the prompt. The prompt asks for good
 * output; this makes bad output harmless. Both are needed: stripping alone
 * would still leave him writing bullet lists that read as run-on sentences.
 *
 * WHY IN THE MAIN PROCESS
 *
 * Applied at synthesis rather than at each call site, so every caller is
 * covered — answers, acknowledgements, confirmations, error messages, and
 * anything added later that nobody remembers to wrap. The renderer keeps the
 * original text and renders it as real markdown, which is the other half of
 * the fix: the bold survives on screen and only disappears from the audio.
 */

/**
 * Text as it should be SPOKEN.
 *
 * Conservative on purpose. Every rule here removes syntax that has a clear
 * spoken equivalent; nothing tries to summarise or rewrite, because a voice
 * that silently drops content is worse than one that reads a stray asterisk.
 */
function speakable(text) {
  let s = String(text ?? '');
  if (!s.trim()) return '';

  /*
   * Fenced code first, before inline code can see the backticks.
   *
   * Code read aloud is unusable — punctuation, indentation and all — so it is
   * replaced by a short spoken placeholder rather than deleted outright. A
   * silent deletion would have the voice skip straight past something that
   * was the whole point of the answer, with no sign anything was missing.
   */
  s = s.replace(/```[\s\S]*?```/g, ' (code omitted) ');
  // An unterminated fence, which a truncated answer produces.
  s = s.replace(/```[\s\S]*$/g, ' (code omitted) ');

  // Images before links: the syntax differs by one leading character, and
  // doing links first would leave a stray "!" in front of the alt text.
  s = s.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1');
  // Links keep their text and lose the URL — a spoken URL is noise at best.
  s = s.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');

  // Inline code. The backticks go; the word inside is usually meaningful.
  s = s.replace(/`([^`]+)`/g, '$1');
  s = s.replace(/`/g, '');

  /*
   * Emphasis.
   *
   * Longest run first — **bold** before *italic* — or the italic rule would
   * eat one asterisk from each side of a bold run and leave the other behind,
   * turning "star star" into a single "star".
   */
  s = s.replace(/\*\*\*([^*]+)\*\*\*/g, '$1');
  s = s.replace(/\*\*([^*]+)\*\*/g, '$1');
  s = s.replace(/\*([^*\n]+)\*/g, '$1');
  s = s.replace(/~~([^~]+)~~/g, '$1');
  /*
   * Underscores only when they wrap a word.
   *
   * A blanket strip would mangle identifiers like file_path and task_id, which
   * do get spoken — "taskid" is wrong but recoverable, whereas "task underscore
   * id" was never the problem. Requiring a word boundary on both sides leaves
   * snake_case alone.
   */
  s = s.replace(/(^|\s)__([^_]+)__(?=\s|$|[.,!?;:])/g, '$1$2');
  s = s.replace(/(^|\s)_([^_]+)_(?=\s|$|[.,!?;:])/g, '$1$2');

  // Headings: the text is real content, the hashes are not.
  s = s.replace(/^\s{0,3}#{1,6}\s+/gm, '');
  // Block quotes.
  s = s.replace(/^\s{0,3}>\s?/gm, '');

  /*
   * List markers become sentence breaks, not nothing.
   *
   * Simply deleting the bullet runs every item into the last, so five items
   * arrive as one breathless sentence. A full stop gives the voice somewhere
   * to pause — the closest thing to a list that speech has.
   */
  s = s.replace(/^\s*[-*+]\s+/gm, '');
  s = s.replace(/^\s*\d+[.)]\s+/gm, '');

  // Horizontal rules carry nothing at all.
  s = s.replace(/^\s*([-*_])\1{2,}\s*$/gm, '');

  /*
   * Table pipes.
   *
   * A table spoken as "pipe name pipe status pipe" is unintelligible; without
   * the pipes it is at least a sequence of words. The separator row (|---|)
   * is dropped entirely — it is pure formatting.
   */
  s = s.replace(/^\s*\|?[\s:|-]*\|[\s:|-]*$/gm, (m) => (/-/.test(m) ? '' : m));
  s = s.replace(/\s*\|\s*/g, ', ');

  /*
   * A line that ended without punctuation gets a full stop, so the voice
   * pauses where the writing meant it to. Done before whitespace collapse,
   * while the line breaks still exist to be read.
   */
  s = s.replace(/([^\s.!?:;,])\n+/g, '$1. ');

  // Collapse the whitespace the rules above left behind.
  s = s.replace(/\s*\n\s*/g, ' ');
  s = s.replace(/[ \t]{2,}/g, ' ');
  // ". ." from a line that already ended in a full stop.
  s = s.replace(/\.\s*\./g, '.');
  s = s.replace(/\s+([.,!?;:])/g, '$1');

  return s.trim();
}

module.exports = { speakable };
