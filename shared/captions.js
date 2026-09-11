/**
 * Spoken text as timed caption cues — the subtitle track for Joeru's voice.
 *
 * WHY CUES AND NOT JUST THE ANSWER ON SCREEN
 *
 * Showing the whole answer under the sphere is a paragraph, not a caption. It
 * arrives all at once, it is as tall as it is long, and it tells you nothing
 * about where in the sentence the voice currently is. A caption is the
 * opposite on every count: two lines at most, replaced as the speech moves
 * through them, so reading and listening stay in step.
 *
 * WHY TIMING IS PROPORTIONAL TO CHARACTERS
 *
 * Piper returns one finished WAV with no word timings — there is no alignment
 * data to be had, so exact sync is not on the table. What IS available is the
 * total duration and the playback position, and a neural TTS voice reads at a
 * near-constant rate within one utterance. So a cue's share of the characters
 * is a good estimate of its share of the time.
 *
 * The error this leaves is small and, importantly, self-correcting: it cannot
 * accumulate, because every cue's window is computed from the whole rather
 * than by adding up the ones before it. A cue may appear a fraction early or
 * late; none of them drift.
 *
 * Punctuation is weighted, because it buys silence. A full stop is a pause in
 * the audio and no time at all in a naive character count, which is what makes
 * unweighted estimates run ahead of a voice that is busy taking a breath.
 */

/**
 * Roughly the width of the Assistant window's caption area at its default
 * 440px, in characters. Cues are two lines of this at most.
 */
const LINE_CHARS = 38;
const MAX_LINES = 2;
const MAX_CUE_CHARS = LINE_CHARS * MAX_LINES;

/**
 * Extra "characters" charged for punctuation, standing in for the pause the
 * voice actually takes. Tuned by ear rather than measured: the failure mode
 * without it is captions running ahead of the speech, which is the one that
 * looks broken.
 */
const PAUSE_WEIGHT = { '.': 6, '!': 6, '?': 6, ',': 3, ';': 4, ':': 4, '—': 3 };

/** What a cue costs in time, in arbitrary units proportional to duration. */
function weigh(text) {
  let n = text.length;
  for (const ch of text) n += PAUSE_WEIGHT[ch] || 0;
  return n;
}

/**
 * Break text into caption-sized pieces, preferring sentence ends.
 *
 * Sentences first because a caption that breaks mid-clause is harder to read
 * than one that is slightly short. Only when a sentence will not fit is it
 * broken on words, and only when a single word will not fit is it cut.
 */
function split(text, maxChars) {
  const words = String(text).trim().split(/\s+/).filter(Boolean);
  const cues = [];
  let current = '';

  const flush = () => {
    if (current.trim()) cues.push(current.trim());
    current = '';
  };

  for (const word of words) {
    // A single word longer than a whole cue: emit it alone rather than
    // looping forever trying to make it fit.
    if (word.length > maxChars) {
      flush();
      cues.push(word);
      continue;
    }

    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > maxChars) {
      flush();
      current = word;
    } else {
      current = candidate;
    }

    // A sentence just ended and the cue is substantial enough to stand on its
    // own — break here rather than dragging the next sentence in behind it.
    // The half-length floor stops "Yes." and "OK." becoming their own flashes.
    if (/[.!?]$/.test(current) && current.length >= maxChars / 2) flush();
  }

  flush();
  return cues;
}

/**
 * Timed cues covering the whole utterance.
 *
 * Each cue carries `from`/`to` as a FRACTION of playback (0..1) rather than
 * seconds, because the caller knows the duration and this does not — and a
 * fraction stays correct if playback is rescheduled or the lead-in changes.
 *
 * @returns {{text: string, from: number, to: number}[]}
 */
function toCues(text, { maxChars = MAX_CUE_CHARS } = {}) {
  const clean = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (!clean) return [];

  const pieces = split(clean, maxChars);
  if (!pieces.length) return [];

  const weights = pieces.map(weigh);
  const total = weights.reduce((a, b) => a + b, 0) || 1;

  const cues = [];
  let acc = 0;
  for (let i = 0; i < pieces.length; i++) {
    const from = acc / total;
    acc += weights[i];
    cues.push({
      text: pieces[i],
      from,
      // The last cue is pinned to 1 exactly, so rounding can never leave a
      // sliver at the end of playback with no caption showing.
      to: i === pieces.length - 1 ? 1 : acc / total,
    });
  }
  return cues;
}

/**
 * The cue to show at a given point in playback, or null.
 *
 * Clamped at both ends on purpose: before playback starts the first cue should
 * already be on screen, and after it finishes the last should stay rather than
 * blanking a beat before the audio stops.
 */
function cueAt(cues, progress) {
  if (!cues || !cues.length) return null;
  const p = Math.max(0, Math.min(1, Number(progress) || 0));
  for (const cue of cues) {
    if (p >= cue.from && p < cue.to) return cue;
  }
  return cues[cues.length - 1];
}

/**
 * Wrap one cue into display lines.
 *
 * Done here rather than left to CSS because the caption box is a FIXED two
 * lines tall — it has to be, or the sphere above it moves every time the text
 * changes length, which is the jitter that makes a caption feel cheap. Knowing
 * the lines means the box can be sized once and never reflow.
 */
function toLines(text, { lineChars = LINE_CHARS, maxLines = MAX_LINES } = {}) {
  const words = String(text ?? '').trim().split(/\s+/).filter(Boolean);
  const lines = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > lineChars && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines.slice(0, maxLines);
}

module.exports = { toCues, cueAt, toLines, LINE_CHARS, MAX_LINES, MAX_CUE_CHARS };
