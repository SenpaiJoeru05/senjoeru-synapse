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

class JoeruService {
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

  /** Is `opencode serve` up? Never throws — "is it running" is the question. */
  async health() {
    try {
      const info = await this.#request('/global/health', { timeout: 2500 });
      return { running: true, url: this.baseUrl, info };
    } catch (err) {
      return {
        running: false,
        url: this.baseUrl,
        reason: err.name === 'AbortError'
          ? `No response from ${this.baseUrl}`
          : err.message,
        hint: 'Start it with: opencode serve --port 4096',
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
