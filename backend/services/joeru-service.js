/**
 * JoeruService — the bridge between Synapse and a running `opencode serve`.
 *
 * This is the one part of Synapse that is NOT zero-token: talking to Joeru
 * spends model calls. It is deliberately isolated in its own service, route,
 * and process boundary so the observer half keeps its zero-token guarantee.
 *
 * The server is something Joel starts (`opencode serve --port 4096`); Synapse
 * never spawns it. If it isn't running, every method degrades to a clear
 * "not running" answer rather than throwing — a dashboard that breaks because
 * an optional companion process is down is worse than one that says so.
 */

const DEFAULT_TIMEOUT_MS = 15_000;

// A free-tier reply can take a minute; the request must outlive the model.
const PROMPT_TIMEOUT_MS = 10 * 60_000;

/**
 * Tool use is not synchronous on OpenCode's side: it emits `permission.asked`
 * on /event and blocks the turn until something POSTs a reply. Nothing here
 * used to listen, so the first tool call in a chat deadlocked until the
 * 10-minute timeout — and since Joeru reads its memory index before answering
 * almost anything, that was most turns.
 *
 * Approving only reads keeps the chat honest about what it is. Anything that
 * writes, runs a command, or leaves the machine is refused rather than left
 * hanging: the model is told no and can say so, which is a real answer. Set
 * SYNAPSE_JOERU_AUTO_APPROVE=all to approve everything instead — that grants
 * unattended `bash` and `edit` to whatever model is configured, so it is opt-in.
 */
const READ_ONLY_ACTIONS = new Set([
  'read', 'list', 'glob', 'grep', 'lsp', 'external_directory',
]);

const APPROVE_EVERYTHING = process.env.SYNAPSE_JOERU_AUTO_APPROVE === 'all';

const RECONNECT_MIN_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;

class JoeruService {
  #watcher = null;

  #abort = null;

  #stopped = false;

  #stats = { watching: false, approved: 0, rejected: 0, lastAction: null };

  /** @param {{ baseUrl: string }} opts */
  constructor({ baseUrl }) {
    this.baseUrl = String(baseUrl || '').replace(/\/$/, '');
  }

  async #request(path, { method = 'GET', body, timeout = DEFAULT_TIMEOUT_MS } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        method,
        signal: controller.signal,
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!res.ok) {
        throw new Error(`opencode ${method} ${path} → ${res.status} ${res.statusText}`);
      }
      return res.status === 204 ? null : await res.json();
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Subscribe to /event and answer permission requests. Idempotent — the first
   * prompt starts it and it then reconnects on its own, because the interesting
   * case is OpenCode restarting under a dashboard nobody reloaded.
   */
  #watchPermissions() {
    if (this.#watcher || this.#stopped) return;

    this.#watcher = (async () => {
      let backoff = RECONNECT_MIN_MS;
      while (!this.#stopped) {
        try {
          this.#abort = new AbortController();
          const res = await fetch(`${this.baseUrl}/event`, {
            headers: { Accept: 'text/event-stream' },
            signal: this.#abort.signal,
          });
          if (!res.ok || !res.body) throw new Error(`event stream → ${res.status}`);

          this.#stats.watching = true;
          backoff = RECONNECT_MIN_MS;

          let buffer = '';
          for await (const chunk of res.body) {
            buffer += Buffer.from(chunk).toString('utf8').replace(/\r\n/g, '\n');
            let cut;
            // SSE frames are blank-line delimited; a chunk may hold several or
            // half of one.
            while ((cut = buffer.indexOf('\n\n')) >= 0) {
              const frame = buffer.slice(0, cut);
              buffer = buffer.slice(cut + 2);
              await this.#onFrame(frame);
            }
          }
        } catch {
          // Down, restarting, or the stream dropped — all the same from here.
        }
        this.#stats.watching = false;
        if (this.#stopped) break;
        // unref: a pending reconnect must not be the reason the process lives.
        await new Promise((r) => setTimeout(r, backoff).unref());
        backoff = Math.min(backoff * 2, RECONNECT_MAX_MS);
      }
    })();
  }

  /** Drop the event subscription. For tests and for a clean shutdown. */
  stopWatching() {
    this.#stopped = true;
    this.#abort?.abort();
    this.#stats.watching = false;
  }

  async #onFrame(frame) {
    const payload = frame
      .split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trim())
      .join('');
    if (!payload) return;

    let event;
    try { event = JSON.parse(payload); } catch { return; }

    // v1 puts it in `properties` and calls the field `permission`; v2 uses
    // `data` and calls it `action`. Both ship in 1.18, so accept either.
    const ask = event?.type === 'permission.asked' ? event.properties
      : event?.type === 'permission.v2.asked' ? event.data
        : null;
    if (!ask) return;

    const action = ask.permission ?? ask.action ?? '';
    const sessionId = ask.sessionID;
    const requestId = ask.id;
    if (!sessionId || !requestId) return;

    const approve = APPROVE_EVERYTHING || READ_ONLY_ACTIONS.has(action);
    this.#stats.lastAction = { action, approved: approve, at: new Date().toISOString() };
    this.#stats[approve ? 'approved' : 'rejected'] += 1;

    try {
      await this.#request(
        `/session/${encodeURIComponent(sessionId)}/permissions/${encodeURIComponent(requestId)}`,
        { method: 'POST', body: { response: approve ? 'once' : 'reject' }, timeout: 10_000 },
      );
    } catch {
      // A reply that fails leaves the turn to time out, which is the old
      // behaviour — nothing better to do, and throwing would kill the watcher.
    }
  }

  /** Is `opencode serve` up? Never throws — "is it running" is the question. */
  async health() {
    try {
      const info = await this.#request('/global/health', { timeout: 2500 });
      this.#watchPermissions();
      return { running: true, url: this.baseUrl, info, permissions: { ...this.#stats } };
    } catch (err) {
      return {
        running: false,
        url: this.baseUrl,
        reason: err.name === 'AbortError'
          ? `No response from ${this.baseUrl}`
          : err.message,
        // Port 4097, not OpenCode's default 4096 — that one collides with the
        // Kilo Code VS Code extension, and this hint used to send people
        // straight into that error.
        hint: 'Start it with: npm run dev:joeru  (opencode serve --port 4097)',
      };
    }
  }

  listSessions() {
    return this.#request('/session');
  }

  createSession(title) {
    return this.#request('/session', { method: 'POST', body: title ? { title } : {} });
  }

  messages(sessionId, limit) {
    const q = limit ? `?limit=${encodeURIComponent(limit)}` : '';
    return this.#request(`/session/${encodeURIComponent(sessionId)}/message${q}`);
  }

  /** Stop a run that's in flight. Returns whatever OpenCode reports. */
  abort(sessionId) {
    return this.#request(`/session/${encodeURIComponent(sessionId)}/abort`, {
      method: 'POST',
      timeout: 5_000,
    });
  }

  /**
   * Send a prompt and wait for the reply. `agent` and `model` are optional —
   * omitting them lets OpenCode use its own defaults, which is what keeps the
   * free-model choice in opencode.json rather than duplicated here.
   */
  sendMessage(sessionId, text, { agent, model } = {}) {
    // Must be listening before the model can ask, or the first tool call in a
    // fresh backend deadlocks the turn it was asked in.
    this.#watchPermissions();
    return this.#request(`/session/${encodeURIComponent(sessionId)}/message`, {
      method: 'POST',
      timeout: PROMPT_TIMEOUT_MS,
      body: {
        ...(agent ? { agent } : {}),
        ...(model ? { model } : {}),
        parts: [{ type: 'text', text }],
      },
    });
  }
}

module.exports = { JoeruService };
