/**
 * What Assistant Mode gets asked, and which brain answered it.
 *
 * The point is not analytics. Local intents answer in ~1.5s for free; the
 * Claude fallback takes ~13s and spends quota. So every question that keeps
 * falling through to the fallback is a candidate for being made instant — and
 * the only way to know which ones those are is to record what is actually
 * asked, rather than guess at a grammar.
 *
 * Deliberately a plain JSON file next to the task board: greppable, diffable,
 * and something Joel can read and correct by hand. It lives under data/, which
 * is gitignored, because it is a record of one machine's use.
 */
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'data', 'assistant-questions.json');

/** Asked this many times through a slow route before it is worth suggesting. */
const SUGGEST_AFTER = 2;

/**
 * Collapses phrasings of the same question onto one key.
 *
 * "What's the status?", "whats the status" and "So, what is the status" should
 * all count as the same thing, or nothing ever reaches a threshold. Politeness
 * and address forms are stripped for the same reason — they carry no intent.
 */
function normalize(question) {
  return String(question || '')
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\b(hey|hi|ok|okay|so|um|uh|please|joeru|jarvis)\b/g, ' ')
    .replace(/\b(can|could|would|will)\s+you\b/g, ' ')
    // Lead-ins that carry no intent. Without these, "what's uncommitted" and
    // "can you tell me what is uncommitted" counted as different questions and
    // neither ever reached the threshold.
    .replace(/\b(tell|show|give|remind)\s+me\b/g, ' ')
    .replace(/\bi\s+(want|need)\s+to\s+know\b/g, ' ')
    .replace(/\bdo\s+you\s+know\b/g, ' ')
    .replace(/\b(what\s+is|what\s+s)\b/g, 'whats')
    .replace(/\s+/g, ' ')
    .trim();
}

function load() {
  try {
    const raw = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    if (raw && typeof raw === 'object' && Array.isArray(raw.questions)) return raw;
  } catch { /* missing or corrupt — start fresh rather than fail a voice turn */ }
  return { lastUpdated: null, questions: [] };
}

function save(db) {
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    db.lastUpdated = new Date().toISOString();
    fs.writeFileSync(FILE, `${JSON.stringify(db, null, 2)}\n`, 'utf8');
  } catch (err) {
    // Never let bookkeeping break the thing being logged.
    console.error(`[questions] could not save: ${err.message}`);
  }
}

/**
 * @param {string} question   what was asked, verbatim
 * @param {'local'|'claude'|'joeru'|'failed'} route who answered
 * @param {number} ms         how long it took, end to end
 * @param {string|null} intent the local intent used, when there was one
 */
function record(question, route, ms, intent = null) {
  const key = normalize(question);
  if (!key) return;

  const db = load();
  let entry = db.questions.find((q) => q.key === key);

  if (!entry) {
    entry = {
      key,
      // Every distinct phrasing, so a future grammar can be built from real
      // wording rather than invented examples.
      phrasings: [],
      count: 0,
      routes: {},
      intent: null,
      slowestMs: 0,
      firstAsked: new Date().toISOString(),
      lastAsked: null,
    };
    db.questions.push(entry);
  }

  const raw = String(question).trim();
  if (raw && !entry.phrasings.includes(raw)) entry.phrasings.push(raw);
  entry.count += 1;
  entry.routes[route] = (entry.routes[route] || 0) + 1;
  if (intent) entry.intent = intent;
  if (ms > entry.slowestMs) entry.slowestMs = Math.round(ms);
  entry.lastAsked = new Date().toISOString();

  db.questions.sort((a, b) => b.count - a.count);
  save(db);
}

/**
 * Questions worth making instant: asked more than once, and never yet answered
 * locally. Something already served locally needs no suggestion, however often
 * it is asked.
 */
function insights() {
  const db = load();
  const slow = (r) => (r.claude || 0) + (r.joeru || 0);

  const candidates = db.questions
    .filter((q) => q.count >= SUGGEST_AFTER && slow(q.routes) > 0 && !(q.routes.local > 0))
    .slice(0, 8)
    .map((q) => ({
      key: q.key,
      phrasing: q.phrasings[q.phrasings.length - 1] || q.key,
      phrasings: q.phrasings,
      count: q.count,
      slowCalls: slow(q.routes),
      slowestMs: q.slowestMs,
      lastAsked: q.lastAsked,
    }));

  const totals = db.questions.reduce((acc, q) => {
    for (const [route, n] of Object.entries(q.routes)) acc[route] = (acc[route] || 0) + n;
    return acc;
  }, {});

  return { candidates, totals, distinct: db.questions.length, file: FILE };
}

module.exports = { record, insights, normalize, FILE, SUGGEST_AFTER };
