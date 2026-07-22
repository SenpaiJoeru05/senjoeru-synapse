import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Settings as SettingsIcon,
  Cpu,
  GitBranch,
  Shield,
  RefreshCw,
  Save,
  Plus,
  Trash2,
  Search,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Clock,
  DollarSign,
} from 'lucide-react'
import { api } from '@/lib/api'

interface Config {
  claudeDir: string
  pollInterval: number
  monitorClaudeDir: boolean
  repositories: string[]
  autoRefresh: boolean
  notifications: boolean
  hourlyBudget: number
  weeklyBudget: number
}

const DEFAULTS: Config = {
  claudeDir: 'C:\\Users\\joelr\\.claude',
  pollInterval: 30,
  monitorClaudeDir: true,
  repositories: [],
  autoRefresh: true,
  notifications: false,
  hourlyBudget: 5,
  weeklyBudget: 50,
}

type SaveState = 'idle' | 'saving' | 'saved' | 'error'

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
        checked ? 'bg-primary' : 'bg-gray-600'
      }`}
    >
      <span
        className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${
          checked ? 'translate-x-5' : 'translate-x-0.5'
        }`}
      />
    </button>
  )
}

export default function Settings() {
  const [config, setConfig] = useState<Config>(DEFAULTS)
  const [loading, setLoading] = useState(true)
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [newRepo, setNewRepo] = useState('')
  const [detecting, setDetecting] = useState(false)
  const [detectedRepos, setDetectedRepos] = useState<string[]>([])
  const [showDetected, setShowDetected] = useState(false)

  useEffect(() => {
    api.getSettings()
      .then(data => setConfig({ ...DEFAULTS, ...data }))
      .catch(() => setConfig(DEFAULTS))
      .finally(() => setLoading(false))
  }, [])

  const update = (patch: Partial<Config>) => {
    setConfig(prev => ({ ...prev, ...patch }))
    setSaveState('idle')
  }

  const addRepo = (repoPath: string) => {
    const trimmed = repoPath.trim()
    if (!trimmed || config.repositories.includes(trimmed)) return
    update({ repositories: [...config.repositories, trimmed] })
    setNewRepo('')
  }

  const removeRepo = (repoPath: string) => {
    update({ repositories: config.repositories.filter(r => r !== repoPath) })
  }

  const handleDetect = async () => {
    setDetecting(true)
    setShowDetected(false)
    try {
      const result = await api.detectRepos()
      const fresh = (result.detected as string[]).filter(
        r => !config.repositories.includes(r)
      )
      setDetectedRepos(fresh)
      setShowDetected(true)
    } catch {
      setDetectedRepos([])
      setShowDetected(true)
    } finally {
      setDetecting(false)
    }
  }

  const handleSave = async () => {
    setSaveState('saving')
    try {
      await api.saveSettings(config)
      setSaveState('saved')
      setTimeout(() => setSaveState('idle'), 3000)
    } catch {
      setSaveState('error')
      setTimeout(() => setSaveState('idle'), 4000)
    }
  }

  const handleReset = () => {
    setConfig(DEFAULTS)
    setSaveState('idle')
    setDetectedRepos([])
    setShowDetected(false)
  }

  if (loading) {
    return (
      <div className="p-8 flex items-center gap-3 text-gray-400">
        <Loader2 className="w-5 h-5 animate-spin" />
        Loading settings…
      </div>
    )
  }

  return (
    <div className="p-8 w-full">
      <div className="mb-8">
        <h1 className="text-3xl font-bold neon-text">Settings</h1>
        <p className="text-gray-400 mt-2">Configure your Synapse experience</p>
      </div>

      <div className="space-y-6">

        {/* ── General ─────────────────────────────────────────────────────── */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="glass-card">
          <h2 className="text-xl font-bold mb-6 flex items-center gap-2">
            <SettingsIcon className="w-5 h-5 text-primary" />
            General
          </h2>

          <div className="space-y-4">
            <div className="flex items-center justify-between p-4 rounded-lg bg-surface2">
              <div>
                <p className="font-medium">Auto-refresh Dashboard</p>
                <p className="text-sm text-gray-400">Re-fetch metrics automatically</p>
              </div>
              <Toggle checked={config.autoRefresh} onChange={v => update({ autoRefresh: v })} />
            </div>

            <div className="flex items-center justify-between p-4 rounded-lg bg-surface2">
              <div>
                <p className="font-medium">Desktop Notifications</p>
                <p className="text-sm text-gray-400">Show alerts for important events</p>
              </div>
              <Toggle checked={config.notifications} onChange={v => update({ notifications: v })} />
            </div>

            <div className="p-4 rounded-lg bg-surface2">
              <div className="flex items-center gap-2 mb-3">
                <Clock className="w-4 h-4 text-primary" />
                <label className="font-medium">Poll Interval</label>
                <span className="ml-auto text-primary font-bold">{config.pollInterval}s</span>
              </div>
              <input
                type="range"
                min={5}
                max={120}
                step={5}
                value={config.pollInterval}
                onChange={e => update({ pollInterval: Number(e.target.value) })}
                className="w-full accent-primary"
              />
              <div className="flex justify-between text-xs text-gray-500 mt-1">
                <span>5s</span>
                <span>30s</span>
                <span>60s</span>
                <span>120s</span>
              </div>
            </div>
          </div>
        </motion.div>

        {/* ── Claude ──────────────────────────────────────────────────────── */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }} className="glass-card">
          <h2 className="text-xl font-bold mb-6 flex items-center gap-2">
            <Cpu className="w-5 h-5 text-primary" />
            Claude Configuration
          </h2>

          <div className="space-y-4">
            <div className="p-4 rounded-lg bg-surface2">
              <label className="block text-sm font-medium mb-2 text-gray-400">Claude Directory Path</label>
              <input
                type="text"
                value={config.claudeDir}
                onChange={e => update({ claudeDir: e.target.value })}
                className="w-full px-4 py-2 rounded-lg bg-background border border-white/10 focus:border-primary focus:outline-none font-mono text-sm"
              />
              <p className="text-xs text-gray-500 mt-2">Read-only — never modified by Synapse</p>
            </div>

            <div className="flex items-center justify-between p-4 rounded-lg bg-surface2">
              <div>
                <p className="font-medium">Watch Claude Directory</p>
                <p className="text-sm text-gray-400">React instantly to file changes</p>
              </div>
              <Toggle checked={config.monitorClaudeDir} onChange={v => update({ monitorClaudeDir: v })} />
            </div>
          </div>
        </motion.div>

        {/* ── Repositories ────────────────────────────────────────────────── */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="glass-card">
          <h2 className="text-xl font-bold mb-6 flex items-center gap-2">
            <GitBranch className="w-5 h-5 text-primary" />
            Monitored Repositories
          </h2>

          {/* Current list */}
          <div className="space-y-2 mb-4">
            {config.repositories.length === 0 && (
              <p className="text-sm text-gray-500 p-4 rounded-lg bg-surface2">No repositories configured yet.</p>
            )}
            <AnimatePresence>
              {config.repositories.map(repo => (
                <motion.div
                  key={repo}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 10 }}
                  className="flex items-center gap-3 p-3 rounded-lg bg-surface2 group"
                >
                  <GitBranch className="w-4 h-4 text-primary shrink-0" />
                  <span className="flex-1 font-mono text-sm truncate">{repo}</span>
                  <button
                    onClick={() => removeRepo(repo)}
                    className="text-gray-600 hover:text-error transition-colors opacity-0 group-hover:opacity-100"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>

          {/* Add manually */}
          <div className="flex gap-2 mb-4">
            <input
              type="text"
              value={newRepo}
              onChange={e => setNewRepo(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addRepo(newRepo)}
              placeholder="d:\path\to\repo"
              className="flex-1 px-4 py-2 rounded-lg bg-surface2 border border-white/10 focus:border-primary focus:outline-none font-mono text-sm"
            />
            <button
              onClick={() => addRepo(newRepo)}
              disabled={!newRepo.trim()}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary/20 text-primary hover:bg-primary/30 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Plus className="w-4 h-4" />
              Add
            </button>
          </div>

          {/* Auto-detect */}
          <div>
            <button
              onClick={handleDetect}
              disabled={detecting}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-surface2 hover:bg-surface transition-colors text-sm disabled:opacity-60"
            >
              {detecting ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Search className="w-4 h-4 text-accent" />
              )}
              {detecting ? 'Scanning sessions…' : 'Detect repos from active sessions'}
            </button>

            <AnimatePresence>
              {showDetected && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="mt-3 overflow-hidden"
                >
                  {detectedRepos.length === 0 ? (
                    <p className="text-sm text-gray-500 p-3 rounded-lg bg-surface2">
                      No new repos detected — all found paths are already added.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      <p className="text-xs text-gray-500 mb-2">Found {detectedRepos.length} new repo(s):</p>
                      {detectedRepos.map(repo => (
                        <div key={repo} className="flex items-center gap-3 p-3 rounded-lg bg-accent/10 border border-accent/20">
                          <GitBranch className="w-4 h-4 text-accent shrink-0" />
                          <span className="flex-1 font-mono text-sm truncate">{repo}</span>
                          <button
                            onClick={() => {
                              addRepo(repo)
                              setDetectedRepos(prev => prev.filter(r => r !== repo))
                            }}
                            className="flex items-center gap-1 px-3 py-1 rounded-lg bg-accent/20 text-accent text-xs hover:bg-accent/30 transition-colors"
                          >
                            <Plus className="w-3 h-3" />
                            Add
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </motion.div>

        {/* ── Budget Limits ───────────────────────────────────────────────── */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }} className="glass-card">
          <h2 className="text-xl font-bold mb-6 flex items-center gap-2">
            <DollarSign className="w-5 h-5 text-warning" />
            Budget Limits
          </h2>

          <div className="space-y-4">
            <div className="p-4 rounded-lg bg-surface2">
              <label className="block text-sm font-medium mb-1">Hourly Budget (USD)</label>
              <p className="text-xs text-gray-500 mb-3">Alert when spending exceeds this amount in a single hour</p>
              <div className="flex items-center gap-3">
                <span className="text-gray-400 text-sm">$</span>
                <input
                  type="number"
                  min={0.5}
                  max={100}
                  step={0.5}
                  value={config.hourlyBudget}
                  onChange={e => update({ hourlyBudget: Math.max(0.5, Number(e.target.value)) })}
                  className="w-32 px-3 py-2 rounded-lg bg-background border border-white/10 focus:border-primary focus:outline-none text-sm font-mono"
                />
                <span className="text-gray-500 text-sm">per hour</span>
              </div>
            </div>

            <div className="p-4 rounded-lg bg-surface2">
              <label className="block text-sm font-medium mb-1">Weekly Budget (USD)</label>
              <p className="text-xs text-gray-500 mb-3">Alert when weekly spending exceeds this amount</p>
              <div className="flex items-center gap-3">
                <span className="text-gray-400 text-sm">$</span>
                <input
                  type="number"
                  min={1}
                  max={500}
                  step={5}
                  value={config.weeklyBudget}
                  onChange={e => update({ weeklyBudget: Math.max(1, Number(e.target.value)) })}
                  className="w-32 px-3 py-2 rounded-lg bg-background border border-white/10 focus:border-primary focus:outline-none text-sm font-mono"
                />
                <span className="text-gray-500 text-sm">per week</span>
              </div>
            </div>

            <p className="text-xs text-gray-600 px-1">
              Based on Sonnet 4.6 pricing: $3/M input · $15/M output · $0.30/M cache-read · $3.75/M cache-write
            </p>
          </div>
        </motion.div>

        {/* ── Security ────────────────────────────────────────────────────── */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className="glass-card">
          <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
            <Shield className="w-5 h-5 text-success" />
            Security
          </h2>
          <div className="p-4 rounded-lg bg-success/5 border border-success/20">
            <div className="flex items-center gap-2 mb-2">
              <CheckCircle2 className="w-4 h-4 text-success" />
              <span className="font-medium text-success">Local Only Mode Active</span>
            </div>
            <p className="text-sm text-gray-400">
              All data stays on your machine. No cloud services. Claude directory is read-only — Synapse never modifies it.
            </p>
          </div>
        </motion.div>

        {/* ── Actions ─────────────────────────────────────────────────────── */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 }} className="flex items-center gap-4">
          <button
            onClick={handleSave}
            disabled={saveState === 'saving'}
            className="flex items-center gap-2 px-6 py-3 rounded-xl bg-gradient-primary text-white font-medium hover:opacity-90 transition-opacity disabled:opacity-60"
          >
            {saveState === 'saving' ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : saveState === 'saved' ? (
              <CheckCircle2 className="w-5 h-5" />
            ) : saveState === 'error' ? (
              <AlertCircle className="w-5 h-5" />
            ) : (
              <Save className="w-5 h-5" />
            )}
            {saveState === 'saving' ? 'Saving…'
              : saveState === 'saved' ? 'Saved!'
              : saveState === 'error' ? 'Save failed'
              : 'Save Settings'}
          </button>

          <button
            onClick={handleReset}
            className="flex items-center gap-2 px-6 py-3 rounded-xl bg-surface2 text-white font-medium hover:bg-surface transition-colors"
          >
            <RefreshCw className="w-5 h-5" />
            Reset to Defaults
          </button>
        </motion.div>

      </div>
    </div>
  )
}
