/**
 * One tool call, turned into what a person reads at a glance.
 *
 * WHY THIS EXISTS, AND THE HONEST LIMIT OF WHAT IT SHARES
 *
 * Assistant.tsx already has this mapping once, for the CALLING agent's own
 * tool calls (`TOOL_VERB`/`toolDetail`). This module is NOT that code reused
 * — it is a second, deliberately-worded-to-match implementation, for a
 * reason worth stating rather than glossing over: Assistant.tsx's version
 * returns a verb and a detail SEPARATELY, composed by the caller, and the
 * frontend has never imported anything from `shared/` before (checked —
 * zero precedent), so whether Vite cleanly consumes a plain CommonJS export
 * inside a browser bundle is unverified. This module runs only in Node
 * (this backend service, and joeru-kit's build step), where every other
 * `shared/*.js` module already runs, so that risk does not apply here.
 *
 * The wording below matches Assistant.tsx's choices exactly (same verbs,
 * same "Glob -> Looking for") so the two surfaces read identically even
 * though they are two implementations — genuine code-sharing across the
 * Node/renderer boundary is a real follow-up, not something to attempt
 * silently inside an unrelated feature.
 */

/** Lucide icon names — already the icon set this stack uses everywhere. */
const TOOL_ICON = {
  Read: 'file-text',
  Write: 'file-plus',
  Edit: 'pencil',
  MultiEdit: 'pencil',
  Bash: 'terminal',
  Grep: 'search',
  Glob: 'search',
  Task: 'users',
  Agent: 'users', // the CLI's own transcript label for the Task tool
  WebSearch: 'globe',
  WebFetch: 'globe',
  TodoWrite: 'list-checks',
};

/**
 * The path a tool call names, whichever field it used.
 *
 * Both spellings, because the CLI reports `file_path` on some tools and
 * `filePath` on others — the same inconsistency `describeInput` (task 25)
 * already had to handle for the top-level stream. Basename only: a full
 * "D:\Personal Works\..." fills any of the spaces this renders into.
 */
function basename(raw) {
  return String(raw || '').replace(/^.*[\\/]([^\\/]+)$/, '$1');
}

/**
 * One tool call -> { icon, label }.
 *
 * @param {string} toolName the `tool_name` field from a hook payload.
 * @param {object} toolInput the `tool_input` field from the same payload.
 */
function describeToolCall(toolName, toolInput) {
  const input = toolInput && typeof toolInput === 'object' ? toolInput : {};
  const icon = TOOL_ICON[toolName] || 'activity';

  switch (toolName) {
    case 'Read':
      return { icon, label: `Reading ${basename(input.file_path ?? input.filePath)}` };
    case 'Write':
      return { icon, label: `Writing ${basename(input.file_path ?? input.filePath)}` };
    case 'Edit':
    case 'MultiEdit':
      return { icon, label: `Editing ${basename(input.file_path ?? input.filePath)}` };
    case 'Bash': {
      const cmd = String(input.command ?? '').replace(/\s+/g, ' ').trim();
      return { icon, label: cmd.length > 40 ? `${cmd.slice(0, 40)}…` : cmd || 'Running a command' };
    }
    case 'Grep':
      return { icon, label: `Searching "${input.pattern ?? ''}"` };
    case 'Glob':
      return { icon, label: `Looking for ${input.pattern ?? ''}` };
    case 'Task':
    case 'Agent':
      return { icon, label: `Delegating to ${input.subagent_type ?? 'a specialist'}` };
    case 'WebSearch':
      return { icon, label: String(input.query ?? '') };
    case 'WebFetch':
      return { icon, label: String(input.url ?? '') };
    case 'TodoWrite':
      return { icon, label: 'Updating the plan' };
    default:
      return { icon, label: toolName || 'Working' };
  }
}

module.exports = { describeToolCall, TOOL_ICON };
