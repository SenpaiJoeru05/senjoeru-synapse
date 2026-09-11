/**
 * Claude Code as Assistant Mode's answering brain, in the MAIN process.
 *
 * Spawns the installed CLI in print mode — mechanically the same as typing
 * `claude -p "question"` in a terminal, one question per invocation, triggered
 * by the user. It reuses the existing login in ~/.claude/.credentials.json, so
 * no API key is involved.
 *
 * Why this beats the OpenCode fallback it replaces:
 *   - measured ~6s against 12-78s for Joeru on a free model
 *   - it already knows the project. ~/.claude/CLAUDE.md imports joeru-kit's
 *     AGENTS.md, so a bare question comes back knowing the task board path and
 *     that fsweb is read-only — verified, not assumed.
 *
 * The cost: this spends the same subscription quota as interactive coding.
 * Hence haiku by default rather than the strongest model — these are short
 * status questions, not engineering work.
 */
const { spawn } = require('child_process');
const { randomUUID } = require('crypto');
const fs = require('fs');
const path = require('path');

const usage = require('../shared/usage-store');
const { resumeFlags } = require('../shared/assistant-session');

/**
 * Model for one-shot questions. Startup dominates the latency (measured ~5.5s
 * of ~6.4s), so a bigger model buys little speed back — but it does cost more
 * quota, and these questions do not need it.
 *
 * This also overrides the agent's own declared model. joeru.md is built with
 * `model: opus` (targets.json maps his `deep` tier there), and --model wins —
 * verified: asked on this configuration he replies "I'm Joeru … running on
 * Claude Haiku 4.5".
 */
const MODEL = 'haiku';

/**
 * The persona. Without this the CLI answers as plain Claude — "You're talking
 * to Claude Haiku 4.5" — which is accurate but not the assistant Joel built.
 * The agent definition lives at ~/.claude/agents/joeru.md, compiled there by
 * `joeru-kit build`, and carries the routing rules and memory instructions.
 */
const AGENT = 'joeru';

/**
 * Answers here get read aloud, and that changes what a good answer is.
 *
 * Measured without this: 14.4s to answer and 19.6 SECONDS of synthesized
 * speech — a paragraph weighing Whisper against cloud STT. Correct, and
 * unlistenable. Length also costs latency twice, once generating the tokens
 * and again synthesizing them.
 *
 * Joeru's own AGENTS.md already asks for brevity, but that is calibrated for
 * someone reading a terminal, where a list is fine. Spoken, a list is not.
 */
/*
 * How the answer should sound.
 *
 * The earlier version of this was all prohibitions — no lists, no markdown, no
 * numerals, two sentences maximum — and it got exactly what it asked for:
 * clipped, characterless replies. Constraints alone cannot produce a voice.
 * Nothing here told the model to lead with the answer, to sound like a person,
 * or what to do when it does not know, so it defaulted to reciting.
 *
 * So the negatives stay, because each has a real cause — a spoken bullet point
 * is unintelligible, a spoken file path is worse — but they now come after a
 * description of what good sounds like.
 */
const VOICE_STYLE = [
  'Your reply will be SPOKEN ALOUD by a text-to-speech voice, not read on a',
  'screen. Write what a sharp, unhurried colleague would actually say out loud.',

  'Lead with the answer in the first few words — never with a preamble, a',
  'restatement of the question, or "based on the current state". Then at most',
  'one sentence of the detail that matters. Two sentences is the target and',
  'four the hard ceiling; if the full answer is longer than that, give the',
  'headline and say you can go into detail if wanted.',

  'Sound like a person: contractions, ordinary words, and the occasional',
  'connective like "though" or "so". Say what a number MEANS rather than',
  'reciting it — "you are nearly six times over the budget" lands, "595',
  'percent" does not. Round for speech: "about twenty-seven dollars", not',
  '"26 dollars and 74 cents". Do not open with the same phrase every time.',

  'Never use lists, bullet points, headings, code blocks, file paths, URLs,',
  'markdown or emoji — all of them are noise when spoken. Prefer words to',
  'symbols. Say "per cent" not "%", and spell out counts under twenty.',

  'Do not be sycophantic and do not thank the user for asking. If you do not',
  'know, say so in one short sentence and name what you would need — a guess',
  'delivered in a confident voice is the worst thing you can produce here.',
].join(' ');

/** A question that has not answered in this long is not going to. */
const TIMEOUT_MS = 90_000;

/**
 * Tools Joeru may use here, and why this list is what it is.
 *
 * Print mode cannot prompt for permission — there is no terminal to answer —
 * so anything not granted up front is refused. That is why asking him to
 * remember something produced "I hit a permission error on the memory
 * directory": nothing was granted, so nothing was allowed.
 *
 * Read/Write/Edit are granted because memory is the point: Joeru is supposed
 * to be the one who files what he learns. Glob and Grep let him find the right
 * memory file instead of guessing a path.
 *
 * Bash and Task are deliberately NOT granted. A voice window answering
 * unattended should not be able to run shell commands or spawn subagents on a
 * misheard sentence, and neither is needed to write a memory file.
 *
 * Note what the safety net is NOT: memory writes are invisible to git here.
 * `memory/` is gitignored for new files and the tracked ones carry
 * skip-worktree, so a filed memory does not appear in `git status` and will not
 * reach the other laptop. The tool list is therefore the whole of the
 * restriction — review means reading `<kit>/memory/` directly.
 */
const ALLOWED_TOOLS = ['Read', 'Write', 'Edit', 'Glob', 'Grep'];

/**
 * Git, by subcommand — so real work can actually be finished here.
 *
 * THE PROBLEM
 *
 * Asked to commit, Joeru got as far as "System won't let me run git checkout
 * or stash even with your authorization". That was not caution, it was the
 * tool list above: `Bash` was never granted, and print mode cannot prompt for
 * permission because there is no terminal to answer, so every shell call was
 * refused outright. Making a change and then being unable to commit it makes
 * the window a demo.
 *
 * WHY SUBCOMMANDS RATHER THAN PLAIN `Bash` OR `Bash(git *)`
 *
 * Measured, because the security argument turned out to rest on a mistaken
 * assumption:
 *
 *   - `whoami` runs even with NO Bash grant at all. Claude Code exempts
 *     harmless reads from permission, so "Bash is not granted" never meant
 *     "no commands run" the way the old comment here claimed.
 *   - A write outside the working directory is refused — but by the DIRECTORY
 *     scope (cwd plus --add-dir), not by the tool list. That is the real
 *     containment boundary, and it is already in place.
 *   - `git push` IS refused when only `git status` is granted. So subcommand
 *     scoping genuinely works, and is worth spending.
 *
 * So: name the subcommands. `Bash(git *)` would sweep in `push`, `reset
 * --hard` and `clean -fd` for no benefit, and plain `Bash` would hand a window
 * that acts on misheard speech the whole shell.
 *
 * WHAT IS DELIBERATELY ABSENT
 *
 * `git push` — the one irreversible, outward-facing operation. A commit is
 * local and recoverable; a push is neither, and pushing is exactly the step
 * worth a human deciding. Joel pushes.
 *
 * `checkout` and `stash` ARE here, because branch work needs them, with the
 * caveat that `git checkout -- .` can discard uncommitted changes. That is the
 * sharpest edge in this list; it is included because the alternative is the
 * feature not working, and it stays inside a repo that is under git anyway.
 */
const GIT_TOOLS = [
  // Read-only.
  'Bash(git status:*)',
  'Bash(git diff:*)',
  'Bash(git log:*)',
  'Bash(git show:*)',
  'Bash(git branch:*)',
  'Bash(git remote:*)',
  'Bash(git rev-parse:*)',
  // Local and recoverable.
  'Bash(git add:*)',
  'Bash(git commit:*)',
  'Bash(git restore:*)',
  'Bash(git stash:*)',
  'Bash(git switch:*)',
  'Bash(git checkout:*)',
];

/** Everything the CLI may use here: files, search, and scoped git. */
const GRANTED_TOOLS = [...ALLOWED_TOOLS, ...GIT_TOOLS];

/**
 * Memory lives in joeru-kit, outside this repo, and Claude Code confines tool
 * access to the working directory unless told otherwise. Without this he could
 * not even READ his own memory index — verified: "I cannot read the file —
 * Claude needs permission to access …/joeru-kit/memory/MEMORY.md".
 *
 * Resolved from the workspace config rather than hardcoded, because the kit
 * sits at a different path on Joel's other laptop.
 */
function extraDirs() {
  try {
    const { getConfig } = require('../shared/workspace-config');
    const kit = getConfig()?.paths?.joeruKitDir;
    return kit && fs.existsSync(kit) ? [kit] : [];
  } catch {
    return [];
  }
}

/**
 * The real executable, not the .cmd shim.
 *
 * claude.cmd just forwards to bin/claude.exe, and going through cmd.exe broke
 * the moment an argument contained spaces: the long --append-system-prompt
 * value made cmd re-split the command line and it tried to run "C:\Program".
 * A native exe can be spawned directly with an argv array, so no shell parses
 * anything and no quoting is required.
 *
 * Absolute paths, resolved once: PATH problems already cost an afternoon on
 * this machine when git went missing.
 */
const CANDIDATES = [
  path.join(process.env.ProgramFiles || 'C:\\Program Files', 'nodejs',
    'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe'),
  path.join(process.env.APPDATA || '', 'npm',
    'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe'),
  path.join(process.env.LOCALAPPDATA || '', 'Programs', 'claude', 'claude.exe'),
];

let cached = null;

function findCli() {
  if (cached !== null) return cached;
  cached = CANDIDATES.find((p) => p && fs.existsSync(p)) || null;
  return cached;
}

function describe() {
  const cli = findCli();
  const agentFile = path.join(
    process.env.USERPROFILE || process.env.HOME || '', '.claude', 'agents', `${AGENT}.md`,
  );
  const hasAgent = fs.existsSync(agentFile);
  const dirs = extraDirs();
  return {
    available: !!cli,
    cli,
    model: MODEL,
    agent: AGENT,
    // Reported rather than assumed: if joeru-kit has not been built on this
    // machine the agent is missing and answers come back as plain Claude.
    agentInstalled: hasAgent,
    // What is actually passed to the CLI, not just the file tools — otherwise
    // the diagnostics panel would report no git access while git works.
    tools: GRANTED_TOOLS,
    // Empty means memory is unreachable and he will say he cannot access it.
    extraDirs: dirs,
    canWriteMemory: dirs.length > 0 && ALLOWED_TOOLS.includes('Write'),
    reason: !cli
      ? 'Claude Code CLI not found. Install it with: npm install -g @anthropic-ai/claude-code'
      : !hasAgent
        ? `Agent "${AGENT}" not found at ${agentFile} — run npm run build in joeru-kit`
        : null,
  };
}

let current = null;

/**
 * Ask one question. Resolves with the answer text.
 *
 * The prompt goes over stdin rather than argv: it contains whatever the user
 * said, and quoting arbitrary speech through cmd.exe is a bug waiting to
 * happen (an apostrophe or a double quote would truncate or corrupt it).
 */
/**
 * Flags that make the CLI emit a readable event stream.
 *
 * Shared so ask() and chat() cannot drift: the moment one of them streamed
 * tool calls and the other did not, Assistant Mode had no idea what was being
 * read while Chat showed every file by name.
 */
const STREAM_FLAGS = [
  '--output-format', 'stream-json', '--verbose',
  // Token deltas. Note this does NOT replace the complete `assistant` events —
  // both arrive, which is why text is read only from deltas below.
  '--include-partial-messages',
];

/**
 * A reader for the CLI's newline-delimited JSON stream.
 *
 * Buffers the tail on purpose. A chunk boundary can fall mid-object, so
 * parsing each chunk on its own drops events at random under load — which
 * shows up as a tool call that sometimes appears and sometimes does not.
 */
function makeStreamReader(onEvent = () => {}) {
  let buffer = '';
  const state = { text: '', tools: [], costUsd: null, turns: null };

  function handle(event) {
    if (event?.type === 'stream_event' && event.event?.type === 'content_block_delta') {
      const delta = event.event.delta;
      if (delta?.type === 'text_delta' && delta.text) {
        state.text += delta.text;
        onEvent({ type: 'text', text: delta.text });
      } else if (delta?.type === 'thinking_delta' && delta.thinking) {
        onEvent({ type: 'reasoning', text: delta.thinking });
      }
      return;
    }

    const blocks = event?.message?.content;
    if (Array.isArray(blocks)) {
      for (const b of blocks) {
        // tool_use only. Text here is the settled version of what the deltas
        // already delivered, and taking both duplicates the whole reply.
        if (b.type === 'tool_use') {
          const entry = { name: b.name, input: b.input, at: Date.now() };
          state.tools.push(entry);
          onEvent({ type: 'tool', ...entry });
        }
      }
      return;
    }

    /*
     * Real account usage, free.
     *
     * The plan windows are account-wide, so this one-line Haiku answer reports
     * the same 5h/7d utilisation as a heavy Opus session in the terminal. That
     * is what makes this worth reading here rather than polling an endpoint:
     * the numbers are already in the stream of a call we were making anyway.
     *
     * Emitted only when the figures change, so its absence is normal and must
     * never be read as "usage is zero".
     */
    if (event?.type === 'rate_limit_event') {
      usage.recordStreamEvent(event.rate_limit_info);
      return;
    }

    if (event?.type === 'result') {
      // The result event carries the settled answer; prefer it over the
      // accumulated deltas, which can include intermediate text.
      if (typeof event.result === 'string' && event.result.trim()) state.text = event.result;
      state.costUsd = event.total_cost_usd ?? null;
      state.turns = event.num_turns ?? null;
      onEvent({ type: 'done', costUsd: state.costUsd, turns: state.turns });
    }
  }

  return {
    feed(chunk) {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.trim()) continue;
        try { handle(JSON.parse(line)); } catch { /* not a complete object */ }
      }
    },
    result() {
      return { text: state.text.trim(), tools: state.tools, costUsd: state.costUsd };
    },
  };
}

function ask(question, onEvent, sessionId = null) {
  cancel();

  const q = String(question || '').trim();
  if (!q) return Promise.resolve('');

  const cli = findCli();
  if (!cli) return Promise.reject(new Error(describe().reason));

  return new Promise((resolve, reject) => {
    const dirs = extraDirs();

    /*
     * One conversation, continued.
     *
     * This used to mint a fresh session per question, which meant Joeru
     * genuinely could not remember the previous sentence — continuity was
     * faked by pasting the last four exchanges into the prompt, and broke on
     * the fifth. The caller now supplies the session for the whole app run;
     * see shared/assistant-session.js for the measurements behind that, and
     * why it costs less rather than more.
     *
     * Falling back to a fresh id keeps this callable without a session — the
     * alternative is throwing inside a voice answer, which would be a worse
     * failure than a turn that simply forgets.
     */
    const session = String(sessionId || '').trim() || randomUUID();

    // No shell: the exe is invoked directly, so arguments containing spaces
    // need no quoting and cannot be re-split.
    const proc = spawn(cli, [
      '-p', '--agent', AGENT, '--model', MODEL,
      // Start or continue — one shared decision, tested in shared/. Getting
      // it backwards is how "Session ID already in use" happened.
      ...resumeFlags(session, { started, exists: transcriptExists }),
      // Append rather than replace: --system-prompt would discard the agent's
      // persona and this project's context, which are the reason for using
      // the agent at all.
      '--append-system-prompt', VOICE_STYLE,
      '--allowedTools', ...GRANTED_TOOLS,
      ...(dirs.length ? ['--add-dir', ...dirs] : []),
      /*
       * Streamed, so the voice window can show what is being read.
       *
       * This used to be plain text, which meant Assistant Mode had no idea
       * what was happening during a thirteen-second wait while Chat showed
       * every file by name. The answer is still returned as one string —
       * callers are unchanged — the events are additional.
       */
      ...STREAM_FLAGS,
    ], {
      windowsHide: true,
      // Run from the dashboard repo so any project-level context it picks up is
      // this project's, not whatever directory Electron happened to start in.
      cwd: path.join(__dirname, '..'),
    });
    started.add(session);
    current = proc;

    const reader = makeStreamReader(onEvent);
    let err = '';
    const timer = setTimeout(() => {
      try { proc.kill(); } catch { /* already gone */ }
      reject(new Error(`Claude did not answer within ${TIMEOUT_MS / 1000}s`));
    }, TIMEOUT_MS);

    proc.stdout.on('data', (d) => reader.feed(d));
    proc.stderr.on('data', (d) => { err += d.toString(); });

    /*
     * Un-remember a session the CLI never actually created.
     *
     * `started` is added to at spawn time as a fast path, for the window where
     * we know the session exists but its transcript is not yet flushed. If the
     * spawn or the turn then FAILS, that entry is a lie — and with one session
     * held for the whole app run it is a durable one: every later question
     * would ask to --resume a session the CLI has no record of, and be refused.
     * A single failed first question would break voice until restart.
     *
     * The disk is the arbiter, as everywhere else here: keep the entry only if
     * a transcript really exists.
     */
    const forgetIfNeverCreated = () => {
      try {
        if (!transcriptExists(session)) started.delete(session);
      } catch {
        started.delete(session);
      }
    };

    proc.on('error', (e) => {
      clearTimeout(timer);
      current = null;
      forgetIfNeverCreated();
      reject(new Error(`could not start Claude Code: ${e.message}`));
    });

    proc.on('close', (code, signal) => {
      clearTimeout(timer);
      current = null;
      if (signal) {
        // Cancelled. The transcript may or may not exist depending on how far
        // the turn got, so ask rather than assume.
        forgetIfNeverCreated();
        resolve('');
        return;
      }

      const { text } = reader.result();
      if (code !== 0) {
        forgetIfNeverCreated();
        // Colour codes stripped first: they make the message unreadable and
        // stop the caller's failure patterns matching the words in it.
        const detail = stripAnsi(err.trim() || text)
          .split('\n').filter(Boolean).slice(-3).join(' ');
        reject(new Error(detail || `Claude Code exited ${code}`));
        return;
      }
      resolve(text);
    });

    proc.stdin.on('error', () => {});   // killed mid-write
    proc.stdin.end(q);
  });
}

function cancel() {
  if (current && !current.killed) {
    try { current.kill(); } catch { /* already gone */ }
  }
  current = null;
}

/* ── the Chat tab: a real conversation, not a one-shot ─────────────────────── */

/**
 * A turn in the Chat tab, on the Claude Code CLI.
 *
 * Two things make this different from ask() above, and both are deliberate.
 *
 * IT KEEPS A SESSION. `--session-id <uuid>` on the first turn and `--resume` on
 * every one after it; the CLI persists the conversation itself. Verified in
 * print mode — a fact given in turn one was recalled in turn two. Assistant
 * Mode instead re-sends its last four exchanges every time, which is right for
 * a voice window that refers back a turn or two, and wrong here: Chat sessions
 * run long, and re-sending the whole history each turn makes input grow
 * quadratically. Measured on this machine, cache reads were already the single
 * largest cost component of a CLI call — about $1.01 of a $2.17 request — so
 * paying to re-read a growing transcript is the expensive way to do this.
 *
 * IT DOES NOT PIN A MODEL. ask() forces haiku because you are talking to it and
 * latency dominates. Here the agent's own declared tier applies: joeru gets
 * opus, frontend-engineer gets sonnet, from joeru-kit's targets.json. That is
 * what the tier system is for, and measurement supports it — on a real planning
 * task all four Opus configurations spotted that SDL capture indices renumber
 * when a device is plugged in (so a device must be persisted by NAME, not
 * index) and neither Sonnet configuration did. Pinning a fast model here would
 * throw that away.
 *
 * Tools match ask() exactly — Read, Write, Edit, Glob, Grep. No Bash. Chat is
 * the defensible place to widen that, since you are watching and can read the
 * diff, but widening it is a decision to take on purpose rather than a side
 * effect of moving Chat onto this runner.
 */
const CHAT_TIMEOUT_MS = 600_000;

/** Session ids the CLI has already seen, so the next turn resumes instead of colliding. */
const started = new Set();

/**
 * The process serving each session, so a turn can be cancelled precisely.
 *
 * Not the module-level `current` that ask() and cancel() share: both the Chat
 * tab and Assistant Mode go through this file, and `current` holds whichever
 * spawned last. Pressing stop in Chat would then kill an Assistant Mode answer
 * that happened to start after it — two windows, one variable, and the wrong
 * one dies.
 */
const inFlight = new Map();

/**
 * Does the CLI already hold a transcript for this session?
 *
 * Required lazily so this module keeps working if the sessions helper is ever
 * moved or removed — a failure to answer degrades to "treat it as new", which
 * is the same behaviour as before this check existed.
 */
function transcriptExists(sessionId) {
  try {
    // eslint-disable-next-line global-require
    const sessions = require('./claude-sessions');
    const dir = sessions.sessionDir(path.join(__dirname, '..'));
    return Boolean(dir && fs.existsSync(path.join(dir, `${sessionId}.jsonl`)));
  } catch {
    return false;
  }
}

/**
 * Strip terminal colour codes from a CLI message.
 *
 * The CLI writes its errors for a terminal, so the raw text arrives wrapped in
 * escape sequences — the "already in use" error reached the UI as
 * `[0m[31m[31mError: …[39m[0m`, which is both unreadable and stops the
 * failure patterns from matching what they are looking for.
 */
function stripAnsi(text) {
  /*
   * The escape byte is OPTIONAL in this pattern, and that is the point.
   *
   * By the time a message has crossed a pipe and a JSON round trip the 0x1b
   * can already be gone, leaving the bare "[0m[31m" that reached the UI in
   * the reported failure. A pattern that requires the escape byte cleans the
   * raw form and leaves the one you actually see.
   *
   * Spelled as a unicode escape rather than a literal control character: the
   * first version of this line carried a real 0x1b byte in the source, which
   * is invisible in an editor and made the pattern silently stricter than it
   * appeared. cat -A was what revealed it.
   */
  // eslint-disable-next-line no-control-regex
  return String(text || '').replace(/\u001b?\[[0-9;]*[A-Za-z]/g, '');
}

/**
 * Ask within a session. Resolves with the text, and reports tool use as it
 * happens through `onEvent`.
 *
 * stream-json rather than plain text because it carries every tool call with
 * its full arguments — a Read event names the file, an Edit event carries the
 * before and after. That is what lets the UI show what the agent is actually
 * touching instead of asserting that something happened.
 */
function chat({ sessionId, agent, text }, onEvent = () => {}) {
  const cli = findCli();
  if (!cli) return Promise.reject(new Error(describe().reason));

  const q = String(text || '').trim();
  if (!q) return Promise.resolve({ text: '', tools: [] });
  if (!sessionId) return Promise.reject(new Error('a session id is required'));

  /*
   * Start or continue — the same decision Assistant Mode makes, in one place.
   *
   * It used to be an inline conditional here and nowhere else, which is how it
   * shipped wrong and produced "Session ID <uuid> is already in use". It now
   * lives in shared/assistant-session.js with the tests that pin the case that
   * broke, and both callers ask that function rather than each keeping their
   * own version to drift apart.
   */
  const dirs = extraDirs();

  return new Promise((resolve, reject) => {
    const proc = spawn(cli, [
      '-p',
      ...resumeFlags(sessionId, { started, exists: transcriptExists }),
      '--agent', agent || AGENT,
      // No --model: the agent's declared tier decides. See the note above.
      ...STREAM_FLAGS,
      '--allowedTools', ...GRANTED_TOOLS,
      ...(dirs.length ? ['--add-dir', ...dirs] : []),
    ], { windowsHide: true, cwd: path.join(__dirname, '..') });

    started.add(sessionId);
    current = proc;
    inFlight.set(sessionId, proc);

    const reader = makeStreamReader(onEvent);
    let err = '';

    const timer = setTimeout(() => {
      try { proc.kill(); } catch { /* gone */ }
      reject(new Error(`Claude did not finish within ${CHAT_TIMEOUT_MS / 60_000} minutes`));
    }, CHAT_TIMEOUT_MS);

    proc.stdout.on('data', (d) => reader.feed(d));
    proc.stderr.on('data', (d) => { err += d.toString(); });

    proc.on('error', (e) => {
      clearTimeout(timer);
      current = null;
      reject(new Error(`could not start Claude Code: ${e.message}`));
    });

    proc.on('close', (code, signal) => {
      clearTimeout(timer);
      current = null;
      inFlight.delete(sessionId);
      if (signal) {
        const partial = reader.result();
        resolve({ text: partial.text, tools: partial.tools, cancelled: true });
        return;
      }
      if (code !== 0) {
        // Colour codes stripped before the message goes anywhere: they made
        // the text unreadable in the UI and stopped the failure patterns from
        // matching the words they look for.
        const detail = stripAnsi(err).trim().split('\n').filter(Boolean).slice(-3).join(' ');
        reject(new Error(detail || `Claude Code exited ${code}`));
        return;
      }
      resolve(reader.result());
    });

    proc.stdin.on('error', () => {});
    proc.stdin.end(q);
  });
}

/**
 * Stop the turn in flight for one session.
 *
 * Returns whether there was anything to stop, so the caller can tell a real
 * cancellation from a button pressed after the answer already landed.
 */
function cancelChat(sessionId) {
  const proc = inFlight.get(sessionId);
  if (!proc || proc.killed) return false;
  try { proc.kill(); } catch { /* already gone */ }
  inFlight.delete(sessionId);
  return true;
}

/** Forget a session, so a fresh one with the same id starts rather than resumes. */
function forget(sessionId) {
  started.delete(sessionId);
}

module.exports = {
  ask, chat, cancelChat, forget, cancel, describe, MODEL, AGENT, ALLOWED_TOOLS,
};
