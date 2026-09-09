/**
 * Corrects project vocabulary in a transcription.
 *
 * Whisper knows English, not this workspace. Measured on synthesized clips of
 * real commands, generic phrasing scored 14/20 while project vocabulary scored
 * 6/24 — and "Joeru", the name of the agent being spoken to, was recognised
 * correctly zero times out of six:
 *
 *   joeru          -> "Joe Ru", "Jourue", "Jory", "Joe Aru", "Joe Roo", "Joryu"
 *   fsweb          -> "F-swept", "F-Swab"
 *   opencode       -> "open code"
 *   chatbot        -> "chat box"
 *   fs-llm-service -> "FSDell LMM service"
 *
 * whisper-stream has no --prompt flag, so the vocabulary cannot be biased
 * during decoding on the live path — correction has to happen after the fact.
 *
 * The approach is edit distance on a de-spaced form rather than a lookup table
 * of the spellings observed above. A table only ever covers the voices it was
 * built from, and the interesting property of these errors is that they are
 * almost all *word-splits*: "Joe Ru" and "Joe Roo" collapse to "joeru" and
 * "joeroo", which are distance 0 and 1 from the target. Removing spaces does
 * most of the work, and a small distance budget covers the rest.
 */

/**
 * Terms worth correcting, as spoken.
 *
 * Deliberately short. Every entry is a chance to corrupt a correct
 * transcription, so a term earns its place by being (a) said often and (b)
 * unlike ordinary English — which is what makes a false positive unlikely.
 * Common words must never appear here: "status", "task" and "next" are already
 * recognised reliably and would only add risk.
 */
const TERMS = [
  { spoken: 'senjoeru synapse', canonical: 'Senjoeru Synapse' },
  { spoken: 'fs llm service', canonical: 'fs-llm-service' },
  { spoken: 'cs dashboard', canonical: 'cs-dashboard' },
  { spoken: 'chat widget', canonical: 'chat-widget' },
  { spoken: 'seller page', canonical: 'seller-page' },
  { spoken: 'joeru kit', canonical: 'joeru-kit' },
  { spoken: 'flowerstore', canonical: 'FlowerStore' },
  { spoken: 'senjoeru', canonical: 'Senjoeru' },
  { spoken: 'opencode', canonical: 'OpenCode' },
  { spoken: 'chatbot', canonical: 'chatbot' },
  { spoken: 'synapse', canonical: 'Synapse' },
  { spoken: 'fsweb', canonical: 'fsweb' },
  { spoken: 'joeru', canonical: 'Joeru' },
  { spoken: 'haiku', canonical: 'Haiku' },
];

/** Strip everything that carries no sound: spaces, hyphens, punctuation. */
const key = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');

function distance(a, b) {
  if (a === b) return 0;
  const prev = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    let last = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(
        prev[j] + 1,            // deletion
        prev[j - 1] + 1,        // insertion
        last + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      last = tmp;
    }
  }
  return prev[b.length];
}

/**
 * How wrong a candidate may be and still count as the term.
 *
 * Scaled by length because one wrong letter in five matters far more than one
 * in fifteen, and capped so a long term cannot drift into a different phrase.
 */
function budget(len) {
  if (len <= 4) return 0;   // too short to distinguish from real words
  if (len <= 8) return 2;
  return 3;
}

/**
 * Distance from a candidate to a term, or null if it is not that term.
 *
 * A candidate must open with the same letter. Whisper mangles the middle and
 * end of an unfamiliar word ("Joe Roo", "Joryu") but almost never its opening
 * consonant, so requiring it costs nothing in recall and removes the false
 * positives a bare distance check invites — without it "jury", "hero" and
 * "kit" all sit within budget of something.
 */
function score(candidate, spokenKey) {
  const c = key(candidate);
  if (!c || c[0] !== spokenKey[0]) return null;
  const allowed = budget(spokenKey.length);
  // A candidate wildly longer or shorter than the term is a different word.
  if (Math.abs(c.length - spokenKey.length) > allowed) return null;
  const d = distance(c, spokenKey);
  return d <= allowed ? d : null;
}

/**
 * Rewrite project vocabulary in the given text.
 *
 * At each word position every term is tried at several widths, because the
 * characteristic error changes word count: whisper splits one spoken word into
 * two ("Joe Ru") or joins two into one ("F-sweptbroken"). So a term of n words
 * is compared against runs of n-1, n and n+1 words.
 *
 * The winner is the CLOSEST fit, not the widest — and that distinction is
 * load-bearing. Scanning widest-first let a correctly-heard term swallow the
 * word after it: "Joeru do today" matched "Joeru do" against "joeru" within
 * budget and deleted the verb, and "Joeru do it" became "joeru-kit". Ranking
 * by distance means an exact match at one word always beats a sloppy match at
 * two, so a term that arrived intact is left alone.
 *
 * Ties go to the wider span, so "Joryu Kit" resolves to "joeru-kit" rather
 * than stopping at "Joeru" and leaving "Kit" behind.
 */
function correct(text) {
  if (!text) return text;

  const raw = String(text).trim().split(/\s+/).filter(Boolean);
  if (!raw.length) return text;

  const out = [];
  let i = 0;

  while (i < raw.length) {
    let best = null;

    for (const term of TERMS) {
      const spokenKey = key(term.spoken);
      const n = term.spoken.split(' ').length;

      for (const span of [n - 1, n, n + 1]) {
        if (span < 1 || i + span > raw.length) continue;

        // Trailing punctuation belongs to the sentence, not to the term.
        const joined = raw.slice(i, i + span).join(' ');
        const trailing = (joined.match(/[^\p{L}\p{N}]+$/u) || [''])[0];
        const candidate = joined.slice(0, joined.length - trailing.length);
        if (!candidate) continue;

        const d = score(candidate, spokenKey);
        if (d === null) continue;
        if (!best || d < best.d || (d === best.d && span > best.span)) {
          best = { d, span, trailing, canonical: term.canonical };
        }
      }
    }

    if (best) {
      out.push(best.canonical + best.trailing);
      i += best.span;
    } else {
      out.push(raw[i]);
      i += 1;
    }
  }

  return out.join(' ');
}

/*
 * Two observed misrecognitions this deliberately does NOT fix.
 *
 *   "Send your use synapse."      for "senjoeru synapse"
 *   "Any errors in FSDell LMM."   for "fs-llm-service"
 *
 * Both need a distance of 4 on a 12-to-15 character target — proportionally
 * looser than the budget allowed anywhere else, and loosening it that far is
 * what lets "jury" become "Joeru". The second is really a different problem:
 * whisper renders letter-by-letter acronyms badly ("L L M" -> "Dell LMM"),
 * which is a spelling failure rather than a phonetic drift, and edit distance
 * over the whole phrase is the wrong tool for it.
 */

module.exports = { correct, TERMS, _internals: { key, distance, score } };
