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
  }
}
