# Assistant Mode — spoken status for Joeru

> **Status:** proposed, not started. Written 2026-09-07.
> A separate always-on-top Electron window, opened from the Joeru → Chat tab,
> that answers spoken questions about the current state of work: *what's the
> status, what's the update, what should we do next.*

---

## The idea in one paragraph

Joeru already exists as a chat. The gap is that checking on work requires
stopping what you are doing, switching to the dashboard, and reading. Assistant
Mode is a small floating window you summon, ask a question out loud, and get an
answer read back — so a status check costs no context switch. It is deliberately
**not** a second chat: it answers a narrow set of questions about state, fast,
and hands anything else to Joeru.

---

## The design decision this hinges on

**Do not route every question through the model.**

Measured on this machine, a reply from `opencode/nemotron-3-ultra-free` takes
**20–35 seconds**. A voice assistant that takes half a minute to say "two tasks
are in progress" is worse than glancing at the dashboard — the entire value is
that it feels immediate.

Almost everything worth asking is already computed locally, zero-token:

| Question | Source | Latency | Cost |
|---|---|---|---|
| "what's the status" / "any update" | `/api/tasks` + `/api/attention` | <100 ms | $0 |
| "what should we do next" | `/api/attention` | <100 ms | $0 |
| "how much have I spent" | `/api/metrics/costs` | <100 ms | $0 |
| "what's broken" | `/api/attention` + `/api/metrics/git` | <100 ms | $0 |
| anything open-ended | `/api/joeru` (the model) | 20–35 s | tokens |

This also preserves the guarantee the README is built around: the observer half
of Synapse spends no tokens. Assistant Mode should stay on that side of the line
by default and cross it only when asked something it genuinely cannot answer.

---

## What already exists (verified 2026-09-07)

The "brain" for *what should we do next* is **already built** —
`backend/services/attention-service.js`, described in its own header as "the
what needs YOU right now queue … 100% zero-token". It ranks four kinds of item
by severity: `failed`, `review`, `stalled`, `budget`.

A live response from `GET /api/attention`:

```json
{
  "items": [
    { "id": "budget:weekly", "kind": "budget", "severity": "high",
      "title": "Over weekly AI budget", "detail": "$67.50 / $50.00 (135%)" }
  ],
  "counts": { "total": 1, "high": 1, "failed": 0, "review": 0, "stalled": 0 }
}
```

That is already the shape of a spoken answer. Assistant Mode is mostly a
**speech and window layer over endpoints that exist**, not new intelligence.

Also in place: `data/tasks.json` as the authoritative board (`metrics/tasks.json`
reports `source: "claude-tasks"`), `git.json` with `available` + `reason`, and
`costs.json` at correct Opus 5 rates.

---

## What is missing

`electron/preload.js` exposes exactly three things:

```js
getMetrics, getSystemInfo, onMetricsUpdate
```

There is **no window management**, and `ipcMain.handle('get-metrics')` in
`electron/main.js` is a stub returning `{}`. So the button cannot open anything
today. Adding one IPC channel is the first real task.

**Consequence:** the button must be hidden when `window.electronAPI` is
undefined, or it appears in `npm run dev:web` and silently does nothing.

---

## Architecture

```
Joeru → Chat  ──[ Assistant Mode ]──►  ipcMain.handle('open-assistant')
                                              │
                                        new BrowserWindow
                                        frameless · transparent · alwaysOnTop
                                        ~420×420 · loads the /assistant route
                                              │
                                     ┌────────┴────────┐
                               intent router    speechSynthesis (out)
                                     │
                     ┌───────────────┼────────────────┐
               /api/attention   /api/tasks       /api/joeru
               /api/metrics/*   (local, $0)      (model, slow)
```

The window loads the **same Vite bundle on a different route**, so it reuses the
existing API client, Tailwind theme and WebSocket. No second build, no second
dependency tree.

---

## Phase 1 — text in, voice out

Scope chosen so the *answers* can be judged before investing in speech
recognition, which is the part most likely to fight us.

| # | Change | File |
|---|---|---|
| 1 | `ipcMain.handle('open-assistant')`, singleton window (focus if it already exists) | `electron/main.js` |
| 2 | `openAssistant()` on the bridge | `electron/preload.js` |
| 3 | `/assistant` route; frameless window dragged via `-webkit-app-region: drag` | `frontend/src/App.tsx`, new `pages/Assistant.tsx` |
| 4 | Intent router — regex → existing endpoint | new `frontend/src/lib/assistant-intents.ts` |
| 5 | Answer formatter — JSON → one speakable sentence | same module |
| 6 | `speechSynthesis` output with a voice/mute toggle | `pages/Assistant.tsx` |
| 7 | "Assistant Mode" button beside the tab group, hidden unless Electron | `frontend/src/pages/Joeru.tsx` (~L34-48) |

The button belongs **next to** the tab pills, not inside the `TABS` array — it
is an action, not a fourth view, and rendering it as a tab would imply it swaps
the pane below.

### Intent grammar (starting point)

| Pattern | Intent | Calls |
|---|---|---|
| `status`, `update`, `what.*working` | `status` | tasks + attention |
| `next`, `should i`, `what.*do` | `next` | attention |
| `cost`, `spent`, `budget`, `token` | `spend` | costs + tokens |
| `broken`, `fail`, `stuck`, `stalled` | `broken` | attention + git |
| *(no match)* | `ask` | `/api/joeru` |

### Formatter rules

- Lead with the count, then the highest-severity item. *"One thing needs
  attention: you're over weekly AI budget — $67.50 of $50."*
- Never read a list longer than three items aloud; say the count and the top
  three, show the rest on screen.
- Say "nothing needs attention" rather than reading an empty list.
- Numbers spoken naturally — "sixty-seven dollars fifty", not "67.5".

---

## Deferred, with reasons

| Item | Why not in Phase 1 |
|---|---|
| **Speech-to-text** | `webkitSpeechRecognition` generally does **not** work in Electron — Chromium ships without Google's speech API keys. Needs a prototype: Whisper via transformers.js (WASM, offline, ~40–75 MB, no native build — which matters given the `node-gyp` trouble this project already had) or a cloud STT. Prove it in isolation before wiring it in. |
| **The orb / sphere** | Needs a live mic stream to react to (`AnalyserNode` → canvas), so it follows STT. Cosmetic, and cheap once audio exists. |
| **Wake word** ("Hey Joeru") | Needs Porcupine or equivalent, plus always-on listening. A `globalShortcut` hotkey delivers most of the benefit for none of the cost. |
| **Insights endpoint** | `GET /api/insights` currently returns 404. Do not wire it in until that is understood. |

---

## Risks and constraints

**The router is regex, not a model.** Anything outside the grammar falls through
to Joeru and takes 20–35 seconds. The alternative — LLM intent classification —
makes *every* question slow and costly. Start with regex, log what falls
through, and grow the grammar from real misses rather than guesses.

**Assistant Mode can only read, by design.** `JoeruService` approves read-only
permissions and rejects anything that writes, runs a command, or leaves the
machine (see its header comment). So asking Joeru by voice to *change* something
will be refused. That is correct for an unattended window with no approval UI —
but it must be obvious in the wording, or a refusal reads as a bug.
`SYNAPSE_JOERU_AUTO_APPROVE=all` lifts it and should stay opt-in.

**Voice output needs a mute.** Speech that cannot be silenced instantly is
hostile in a shared room or on a call.

**Cost of asking must stay visible.** A local answer is free; a Joeru answer is
not. The window should show which one it used, or the zero-token guarantee
quietly erodes.

---

## Acceptance criteria for Phase 1

- The button appears in Electron and is absent in `npm run dev:web`.
- Clicking it opens one window; clicking again focuses that window rather than
  opening a second.
- Each of the four local intents answers in under 500 ms with no model call, and
  the Joeru Activity tool-call count does not move.
- An unmatched question routes to Joeru and says so before it starts waiting.
- Answers are read aloud, and mute silences output immediately.
- `npx tsc --noEmit` clean; `node --test` in `backend/` still passes.
- Closing the assistant window does not affect the main window, and quitting the
  app closes both.

---

## Open questions

1. Hotkey to summon the window without the dashboard being focused — worth it in
   Phase 1, or with STT?
2. Should the window remember position and size between launches?
3. Read the answer aloud automatically, or only on request? Auto is the point of
   voice, but it is also the more annoying default.
