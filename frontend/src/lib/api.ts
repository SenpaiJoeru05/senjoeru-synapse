import axios from 'axios'

const API_BASE_URL = '/api'

export interface Metrics {
  agents: any
  tasks: any
  tokens: any
  costs: any
  tests: any
  git: any
  sessions: any
  activity: any
}

export const api = {
  async getMetrics(): Promise<Metrics> {
    const response = await axios.get(`${API_BASE_URL}/metrics`)
    return response.data
  },

  async getMetric(type: string): Promise<any> {
    const response = await axios.get(`${API_BASE_URL}/metrics/${type}`)
    return response.data
  },

  async getClaudeInfo(): Promise<any> {
    const response = await axios.get(`${API_BASE_URL}/claude/info`)
    return response.data
  },

  async getSystemHealth(): Promise<any> {
    const response = await axios.get(`${API_BASE_URL}/system/health`)
    return response.data
  },

  async updateMetric(type: string, data: any): Promise<any> {
    const response = await axios.post(`${API_BASE_URL}/metrics/${type}`, data)
    return response.data
  },

  async getSettings(): Promise<any> {
    const response = await axios.get(`${API_BASE_URL}/settings`)
    return response.data
  },

  async saveSettings(config: any): Promise<any> {
    const response = await axios.post(`${API_BASE_URL}/settings`, config)
    return response.data
  },

  async detectRepos(): Promise<any> {
    const response = await axios.get(`${API_BASE_URL}/settings/detect-repos`)
    return response.data
  },

  // Initial paint for the Agent Network page — realtime updates arrive over WS.
  async getAgentNetwork(): Promise<any> {
    const response = await axios.get(`${API_BASE_URL}/agent-network`)
    return response.data
  },

  // ── SQLite-backed (permanent) data ──────────────────────────────────────
  async getDbTasks(): Promise<any> {
    const response = await axios.get(`${API_BASE_URL}/tasks`)
    return response.data
  },

  async getTaskHistory(id: string): Promise<any> {
    const response = await axios.get(`${API_BASE_URL}/tasks/${encodeURIComponent(id)}/history`)
    return response.data
  },

  async getExecutionHistory(limit = 50): Promise<any> {
    const response = await axios.get(`${API_BASE_URL}/execution-history?limit=${limit}`)
    return response.data
  },

  // Phase 3 — computed engineering intelligence (zero-token, derived on read).
  async getIntelligence(): Promise<any> {
    const response = await axios.get(`${API_BASE_URL}/intelligence/summary`)
    return response.data
  },

  // Phase 4 — the AI team (personas + accumulated memory).
  async getTeam(): Promise<any> {
    const response = await axios.get(`${API_BASE_URL}/team`)
    return response.data
  },

  // Phase 4 — Knowledge Layer (notes, bookmarks, docs, keyword search).
  async getNotes(): Promise<any> { return (await axios.get(`${API_BASE_URL}/notes`)).data },
  async createNote(data: any): Promise<any> { return (await axios.post(`${API_BASE_URL}/notes`, data)).data },
  async updateNote(id: number, data: any): Promise<any> { return (await axios.put(`${API_BASE_URL}/notes/${id}`, data)).data },
  async deleteNote(id: number): Promise<any> { return (await axios.delete(`${API_BASE_URL}/notes/${id}`)).data },
  async getBookmarks(): Promise<any> { return (await axios.get(`${API_BASE_URL}/bookmarks`)).data },
  async createBookmark(data: any): Promise<any> { return (await axios.post(`${API_BASE_URL}/bookmarks`, data)).data },
  async deleteBookmark(id: number): Promise<any> { return (await axios.delete(`${API_BASE_URL}/bookmarks/${id}`)).data },
  async getDocs(repo?: string): Promise<any> {
    return (await axios.get(`${API_BASE_URL}/docs${repo ? `?repo=${encodeURIComponent(repo)}` : ''}`)).data
  },
  async search(q: string, kind?: string): Promise<any> {
    const params = new URLSearchParams({ q })
    if (kind) params.set('kind', kind)
    return (await axios.get(`${API_BASE_URL}/search?${params.toString()}`)).data
  },

  // Phase 5 — computed insights & analytics (zero-token, from history).
  async getInsights(days = 30): Promise<any> {
    return (await axios.get(`${API_BASE_URL}/insights/summary?days=${days}`)).data
  },

  // Proactive attention — the "needs you now" queue (zero-token, derived).
  async getAttention(): Promise<any> {
    return (await axios.get(`${API_BASE_URL}/attention`)).data
  },

  // Phase 6 — observation history (sessions the workspace watched Claude run in).
  async getSessions(limit = 100): Promise<any> {
    return (await axios.get(`${API_BASE_URL}/observation/sessions?limit=${limit}`)).data
  },
  async getAgentActivity(limit = 200): Promise<any> {
    return (await axios.get(`${API_BASE_URL}/observation/agent-activity?limit=${limit}`)).data
  },
}
