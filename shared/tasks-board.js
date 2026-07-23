/**
 * Shared reader/normalizer for the Claude-authored task board
 * (C:\Users\<user>\.claude\tasks.json).
 *
 * Ownership (per ARCHITECTURE-V2 + PHASE-1): `.claude/tasks.json` is Claude's
 * authoring inbox — READ ONLY for Synapse. This module never writes it. The
 * backend's TaskSyncService uses this to import the board into SQLite.
 *
 * Tolerates invalid JSON escape sequences (agents sometimes paste code like
 * `\$queue` into notes), repairing them IN MEMORY only — the live file is never
 * modified. Mirrors the collector's behaviour so both agree on what a task is.
 */
const fs = require('fs');

// Valid JSON string escapes. Anything else after a backslash inside a string is
// an invalid escape that breaks JSON.parse — we drop the stray backslash.
const VALID_JSON_ESCAPES = new Set(['"', '\\', '/', 'b', 'f', 'n', 'r', 't', 'u']);

function repairInvalidJsonEscapes(raw) {
  let out = '';
  let inStr = false;
  let fixes = 0;
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (!inStr) { out += c; if (c === '"') inStr = true; continue; }
    if (c === '\\') {
      const nxt = raw[i + 1];
      if (VALID_JSON_ESCAPES.has(nxt)) { out += c + nxt; i++; }
      else { fixes++; out += nxt; i++; } // drop stray backslash, keep the char
    } else { out += c; if (c === '"') inStr = false; }
  }
  return { text: out, fixes };
}

/** Parse raw board text leniently. Returns the parsed object or null. */
function parseBoardText(raw) {
  try {
    return JSON.parse(raw);
  } catch (_) {
    const { text } = repairInvalidJsonEscapes(raw);
    try {
      return JSON.parse(text);
    } catch (_) {
      return null;
    }
  }
}

/** Read + leniently parse the board file. Returns the parsed object or null. */
function readBoardFile(filePath) {
  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (_) {
    return null; // missing/unreadable
  }
  return parseBoardText(raw);
}

/**
 * Normalize a parsed board object into a clean task list, filling the same
 * defaults the collector uses so SQLite and the dashboard agree.
 */
function normalizeBoard(board) {
  if (!board || !Array.isArray(board.tasks)) return [];
  const boardUpdated = board.lastUpdated || null;
  return board.tasks.map((t, i) => ({
    id:            String(t.id || i + 1),
    title:         t.title || 'Untitled task',
    assignedAgent: t.assignedAgent || 'AI Chatbot Engineer',
    repos:         Array.isArray(t.repos) ? t.repos : [],
    progress:      typeof t.progress === 'number' ? t.progress : 0,
    status:        t.status || 'Pending',
    eta:           t.eta || 'TBD',
    priority:      t.priority || 'Medium',
    notes:         t.notes || '',
    lastUpdated:   t.lastUpdated || boardUpdated,
  }));
}

module.exports = { readBoardFile, parseBoardText, normalizeBoard, repairInvalidJsonEscapes };
