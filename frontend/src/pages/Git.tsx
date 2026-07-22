import { motion } from 'framer-motion'
import { GitBranch, GitCommit, FileText, Clock } from 'lucide-react'
import { useRealtime } from '@/lib/realtime'

interface GitRepo {
  path: string
  branch: string
  current: string
  tracking: string | null
  files: any[]
  staged: string[]
  modified: string[]
  created: string[]
  deleted: string[]
  commits: any[]
  ahead: number
  behind: number
}

export default function Git() {
  const { metrics, ready } = useRealtime()
  const repos: GitRepo[] = metrics?.git?.repos || []
  const loading = !ready && repos.length === 0

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold neon-text">Git Dashboard</h1>
        <p className="text-gray-400 mt-2">Monitor repository activity</p>
      </div>

      {loading ? (
        <div className="text-gray-400">Loading git data...</div>
      ) : repos.length === 0 ? (
        <div className="text-gray-400">No repositories found</div>
      ) : (
        repos.map((repo, repoIndex) => (
          <motion.div
            key={repo.path}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: repoIndex * 0.1 }}
            className="glass-card mb-6"
          >
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-3">
                <GitBranch className="w-6 h-6 text-primary" />
                <div>
                  <h3 className="font-bold text-lg">{repo.path.split('/').pop()}</h3>
                  <p className="text-sm text-gray-400">{repo.path}</p>
                </div>
              </div>
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-gray-400">Branch:</span>
                  <span className="font-medium">{repo.current}</span>
                </div>
                {repo.ahead > 0 && (
                  <span className="px-2 py-1 rounded bg-success/20 text-success text-xs">
                    +{repo.ahead} ahead
                  </span>
                )}
                {repo.behind > 0 && (
                  <span className="px-2 py-1 rounded bg-warning/20 text-warning text-xs">
                    -{repo.behind} behind
                  </span>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
              <div className="p-4 rounded-xl bg-surface2">
                <div className="flex items-center gap-2 mb-2">
                  <FileText className="w-4 h-4 text-primary" />
                  <span className="text-sm text-gray-400">Modified</span>
                </div>
                <p className="text-2xl font-bold">{repo.modified.length}</p>
              </div>
              <div className="p-4 rounded-xl bg-surface2">
                <div className="flex items-center gap-2 mb-2">
                  <FileText className="w-4 h-4 text-accent" />
                  <span className="text-sm text-gray-400">Staged</span>
                </div>
                <p className="text-2xl font-bold">{repo.staged.length}</p>
              </div>
              <div className="p-4 rounded-xl bg-surface2">
                <div className="flex items-center gap-2 mb-2">
                  <GitCommit className="w-4 h-4 text-success" />
                  <span className="text-sm text-gray-400">Commits</span>
                </div>
                <p className="text-2xl font-bold">{repo.commits.length}</p>
              </div>
              <div className="p-4 rounded-xl bg-surface2">
                <div className="flex items-center gap-2 mb-2">
                  <Clock className="w-4 h-4 text-secondary" />
                  <span className="text-sm text-gray-400">Tracking</span>
                </div>
                <p className="text-lg font-bold">{repo.tracking || 'None'}</p>
              </div>
            </div>

            {/* Changed Files */}
            {(repo.modified.length > 0 || repo.staged.length > 0 || repo.created.length > 0) && (
              <div className="mb-6">
                <h4 className="font-bold mb-3">Changed Files</h4>
                <div className="space-y-2">
                  {repo.staged.map((file, i) => (
                    <div key={i} className="flex items-center gap-3 p-3 rounded-lg bg-success/10 border border-success/20">
                      <span className="text-success text-xs font-medium">STAGED</span>
                      <span className="text-sm">{file}</span>
                    </div>
                  ))}
                  {repo.modified.map((file, i) => (
                    <div key={i} className="flex items-center gap-3 p-3 rounded-lg bg-warning/10 border border-warning/20">
                      <span className="text-warning text-xs font-medium">MODIFIED</span>
                      <span className="text-sm">{file}</span>
                    </div>
                  ))}
                  {repo.created.map((file, i) => (
                    <div key={i} className="flex items-center gap-3 p-3 rounded-lg bg-accent/10 border border-accent/20">
                      <span className="text-accent text-xs font-medium">NEW</span>
                      <span className="text-sm">{file}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Recent Commits */}
            <div>
              <h4 className="font-bold mb-3">Recent Commits</h4>
              <div className="space-y-2">
                {repo.commits.map((commit, i) => (
                  <div key={i} className="flex items-center gap-4 p-3 rounded-lg bg-surface2">
                    <GitCommit className="w-4 h-4 text-gray-400" />
                    <div className="flex-1">
                      <p className="font-medium">{commit.message}</p>
                      <p className="text-xs text-gray-400">{commit.hash} • {commit.date}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </motion.div>
        ))
      )}
    </div>
  )
}
