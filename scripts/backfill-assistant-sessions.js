#!/usr/bin/env node
/**
 * One-off: mark the Assistant Mode transcripts that already exist.
 *
 * Going forward `ask()` records its own session id, but the transcripts
 * written before that change carry no marker — so without this they would go
 * on cluttering Chat's conversation list forever.
 *
 * These are identifiable by content: every one begins with the grounding
 * preamble, because that is the first user message Assistant Mode sends. That
 * is exactly the fragile, expensive test the live path deliberately avoids
 * (see electron/assistant-sessions.js) — acceptable here because it runs once,
 * by hand, and reads only the first user line of each file.
 *
 * Safe to re-run: ids already recorded are skipped, and nothing is deleted.
 * The transcripts stay on disk; they are only hidden from Chat's list.
 */
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const assistantSessions = require('../electron/assistant-sessions');

/**
 * Openings that `ground()` has used, current first.
 *
 * Both are needed: the prompt was rewritten when the blanket "do not go
 * looking for files" ban was replaced with the narrow memory-read exception,
 * and 25 transcripts still carry the older wording. Matching only the current
 * text left those in the list — which is the same fragility that keeps this
 * detection out of the live path.
 */
const PREAMBLES = [
  'You are answering one turn of a spoken conversation',
  'Answer using ONLY the CURRENT STATE below',
];

const projectDir = path.join(__dirname, '..');
const slug = String(projectDir).replace(/[^A-Za-z0-9]/g, '-');
const dir = path.join(
  process.env.USERPROFILE || process.env.HOME || '', '.claude', 'projects', slug,
);

/**
 * The first user message, read a line at a time.
 *
 * Streamed rather than read whole: this directory holds a 23MB transcript and
 * the answer is always in the first few lines.
 */
async function firstUserText(file) {
  const stream = fs.createReadStream(file, { encoding: 'utf8' });
  const lines = readline.createInterface({ input: stream, crlfDelay: Infinity });
  try {
    let seen = 0;
    for await (const line of lines) {
      // Give up rather than scan a whole transcript for a message that is
      // not there — a file whose first turns are not a user message is not
      // one of ours.
      if (seen > 40) return null;
      seen += 1;
      if (!line.includes('"type":"user"')) continue;
      let entry;
      try { entry = JSON.parse(line); } catch { continue; }
      const content = entry?.message?.content;
      if (typeof content === 'string') return content;
      if (Array.isArray(content)) {
        const text = content.find((b) => b?.type === 'text');
        if (text) return String(text.text ?? '');
      }
      return null;
    }
  } finally {
    lines.close();
    stream.destroy();
  }
  return null;
}

async function main() {
  if (!fs.existsSync(dir)) {
    console.error(`No session directory at ${dir}`);
    process.exit(1);
  }

  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl'));
  const already = assistantSessions.ids();
  const found = [];
  let skipped = 0;

  for (const f of files) {
    const id = path.basename(f, '.jsonl');
    if (already.has(id)) { skipped += 1; continue; }
    let text = null;
    try {
      text = await firstUserText(path.join(dir, f));
    } catch {
      continue;
    }
    if (text && PREAMBLES.some((p) => text.startsWith(p))) found.push(id);
  }

  const added = assistantSessions.rememberAll(found);
  console.log(`transcripts scanned:      ${files.length}`);
  console.log(`already marked:           ${skipped}`);
  console.log(`Assistant Mode found:     ${found.length}`);
  console.log(`newly marked:             ${added}`);
  console.log(`remaining in Chat's list: ${files.length - skipped - found.length}`);
  console.log(`\nrecorded in ${assistantSessions.FILE}`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
