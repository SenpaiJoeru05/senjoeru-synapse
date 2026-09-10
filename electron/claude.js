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
const fs = require('fs');
const path = require('path');

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
    tools: ALLOWED_TOOLS,
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
function ask(question) {
  cancel();

  const q = String(question || '').trim();
  if (!q) return Promise.resolve('');

  const cli = findCli();
  if (!cli) return Promise.reject(new Error(describe().reason));

  return new Promise((resolve, reject) => {
    const dirs = extraDirs();

    // No shell: the exe is invoked directly, so arguments containing spaces
    // need no quoting and cannot be re-split.
    const proc = spawn(cli, [
      '-p', '--agent', AGENT, '--model', MODEL,
      // Append rather than replace: --system-prompt would discard the agent's
      // persona and this project's context, which are the reason for using
      // the agent at all.
      '--append-system-prompt', VOICE_STYLE,
      '--allowedTools', ...ALLOWED_TOOLS,
      ...(dirs.length ? ['--add-dir', ...dirs] : []),
    ], {
      windowsHide: true,
      // Run from the dashboard repo so any project-level context it picks up is
      // this project's, not whatever directory Electron happened to start in.
      cwd: path.join(__dirname, '..'),
    });
    current = proc;

    let out = '';
    let err = '';
    const timer = setTimeout(() => {
      try { proc.kill(); } catch { /* already gone */ }
      reject(new Error(`Claude did not answer within ${TIMEOUT_MS / 1000}s`));
    }, TIMEOUT_MS);

    proc.stdout.on('data', (d) => { out += d.toString(); });
    proc.stderr.on('data', (d) => { err += d.toString(); });

    proc.on('error', (e) => {
      clearTimeout(timer);
      current = null;
      reject(new Error(`could not start Claude Code: ${e.message}`));
    });

    proc.on('close', (code, signal) => {
      clearTimeout(timer);
      current = null;
      if (signal) { resolve(''); return; }   // cancelled

      const text = out.trim();
      if (code !== 0) {
        // The CLI reports quota and auth problems on stderr; pass the real
        // message through rather than a generic failure.
        const detail = (err.trim() || text).split('\n').filter(Boolean).slice(-3).join(' ');
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

module.exports = { ask, cancel, describe, MODEL, AGENT };
