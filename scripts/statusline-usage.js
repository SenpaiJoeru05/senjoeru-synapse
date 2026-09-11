#!/usr/bin/env node
/**
 * Claude Code statusline that also feeds Synapse the real plan usage.
 *
 * OPTIONAL. Synapse already records these figures from its own Chat and
 * Assistant Mode answers, so nothing breaks without this. What it adds is
 * freshness: the limits are account-wide, and most of Joel's consumption comes
 * from interactive terminal and VSCode sessions rather than from Synapse. With
 * this installed, every keystroke-level statusline refresh in those sessions
 * updates the dashboard — at zero token cost, because the statusline is handed
 * the numbers that already came back on the last response.
 *
 * INSTALL — add to ~/.claude/settings.json:
 *
 *   { "statusLine": {
 *       "type": "command",
 *       "command": "node \"D:/Personal Works/senjoeru-synapse/scripts/statusline-usage.js\""
 *   } }
 *
 * Use the path the repo is actually checked out at; it differs per laptop.
 *
 * Claude Code invokes this on every render with the session payload on stdin
 * and takes the first line of stdout as the status line. Two consequences
 * shape everything below: it must be fast, and it must never fail loudly. A
 * crash here would put a stack trace where the status line goes, on every
 * render, so every path ends in a printed line.
 */
const path = require('path');

/** Read stdin fully. Claude Code closes it, so this always settles. */
function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    // If stdin never arrives, print something rather than hanging the line.
    const timer = setTimeout(() => resolve(data), 1000);
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { data += chunk; });
    process.stdin.on('end', () => { clearTimeout(timer); resolve(data); });
    process.stdin.on('error', () => { clearTimeout(timer); resolve(data); });
  });
}

function bar(pct) {
  const filled = Math.round(Math.max(0, Math.min(100, pct)) / 10);
  return `${'#'.repeat(filled)}${'.'.repeat(10 - filled)}`;
}

async function main() {
  let payload = {};
  try {
    payload = JSON.parse(await readStdin()) || {};
  } catch {
    // Not JSON — still print a line.
  }

  const parts = [];

  const model = payload.model?.display_name;
  if (model) parts.push(model);

  const dir = payload.workspace?.current_dir || payload.cwd;
  if (dir) parts.push(path.basename(dir));

  /*
   * `rate_limits_available` is false on API-key, Bedrock and Vertex sessions,
   * where plan windows do not apply and `rate_limits` is null. Recording
   * nothing in that case is the point — writing zeroes would tell the
   * dashboard the allowance is untouched.
   */
  const limits = payload.rate_limits;
  if (limits && payload.rate_limits_available !== false) {
    try {
      // Required lazily so a broken checkout still renders a status line.
      const { recordStatusline } = require('../shared/usage-store');
      recordStatusline(limits);
    } catch {
      // Synapse not reachable from here; the status line itself still works.
    }

    // `used_percentage` is already 0-100 in this payload — see usage-limits.js
    // for why the two producers' scales are never inferred.
    const fiveHour = limits.five_hour?.used_percentage;
    const sevenDay = limits.seven_day?.used_percentage;
    if (typeof fiveHour === 'number') parts.push(`5h ${bar(fiveHour)} ${Math.round(fiveHour)}%`);
    if (typeof sevenDay === 'number') parts.push(`7d ${bar(sevenDay)} ${Math.round(sevenDay)}%`);
  }

  process.stdout.write(parts.join('  |  ') || 'claude');
}

main().catch(() => {
  // Last resort: a status line, never a stack trace.
  process.stdout.write('claude');
});
