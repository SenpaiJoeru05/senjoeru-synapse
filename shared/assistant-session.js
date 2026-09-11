/**
 * Session lifecycle for the CLI: whether to start or resume, and which
 * conversation Assistant Mode is currently in.
 *
 * WHY THIS IS ITS OWN MODULE
 *
 * The start-or-resume decision produced the "Session ID <uuid> is already in
 * use" error, and it did so because it was expressed as one inline
 * conditional inside a 70-line spawn call where it could not be tested. It
 * lives here so it can be, and so Assistant Mode and Chat cannot drift apart
 * on it — they now ask the same function.
 */

/**
 * The CLI flags that start or continue a session.
 *
 * `--session-id` NAMES a new session and fails if the CLI already has one by
 * that id. `--resume` continues an existing one and fails if it does not
 * exist. Getting this backwards is not a silent degradation — the CLI refuses
 * the call — so the decision has to be right rather than approximately right.
 *
 * The disk check is the authority, not the in-memory set. The set was the
 * original implementation and it was wrong in two ordinary situations: it is
 * empty on every app start, and opening a stored conversation from Chat's
 * sidebar gives the renderer a session id the main process has never seen. In
 * both, the next turn passed `--session-id` for a session the CLI already had
 * on disk, and the CLI rejected it. The set survives only as a fast path for
 * a session this process created moments ago, where the transcript may not be
 * flushed yet.
 *
 * @param {string} sessionId
 * @param {{ started?: Set<string>, exists?: (id: string) => boolean }} deps
 * @returns {string[]} flags to splice into the argv
 */
function resumeFlags(sessionId, { started = null, exists = null } = {}) {
  const id = String(sessionId || '').trim();
  if (!id) throw new Error('a session id is required');

  let onDisk = false;
  if (typeof exists === 'function') {
    try {
      onDisk = Boolean(exists(id));
    } catch {
      // A failure to answer degrades to "treat it as new", which is the
      // behaviour that predates this check.
      onDisk = false;
    }
  }

  const resuming = Boolean(started && started.has(id)) || onDisk;
  return resuming ? ['--resume', id] : ['--session-id', id];
}

/**
 * Which conversation Assistant Mode is in.
 *
 * One session for as long as the app is running, which is the whole point:
 * before this, every spoken question was its own session, so Joeru genuinely
 * could not remember the previous sentence. Continuity was faked by pasting
 * the last four exchanges into the prompt, which worked until the fifth.
 *
 * Measured before changing it, because the obvious objection is cost: across
 * 45 real one-shot transcripts the pasted history was ~500 tokens against
 * ~44,000 tokens of fixed context (system prompt, agent definition,
 * CLAUDE.md) re-paid on every question — including 8,260 cache-WRITE tokens,
 * rebuilt each time precisely because each question was a new session. So
 * conversation history was never the expensive part, and holding one session
 * lets that prefix stay cached instead of being rewritten.
 *
 * Deliberately NOT persisted across restarts. Quitting the app is the natural
 * "start again", and a session restored from last week would carry a
 * conversation nobody remembers having. `reset()` is the same gesture without
 * quitting — needed because "resets on restart" is no bound at all on a
 * window that stays open for days.
 */
function createTracker({ uuid } = {}) {
  if (typeof uuid !== 'function') {
    throw new Error('createTracker requires a uuid function');
  }

  let id = null;
  // Sessions this tracker has handed out, newest last. Kept so a reset can
  // say what it replaced, which is what lets the UI name the old conversation.
  const history = [];

  return {
    /** The current session, minted on first use rather than at startup. */
    current() {
      if (!id) {
        id = uuid();
        history.push(id);
      }
      return id;
    },

    /** Start a fresh conversation. Returns the new id. */
    reset() {
      const previous = id;
      id = uuid();
      history.push(id);
      return { id, previous };
    },

    /** True once a question has actually been asked in this run. */
    started() {
      return id !== null;
    },

    /** Every session this run has used, oldest first. */
    all() {
      return [...history];
    },
  };
}

module.exports = { resumeFlags, createTracker };
