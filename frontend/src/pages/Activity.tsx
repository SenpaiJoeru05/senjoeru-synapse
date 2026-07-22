import { motion } from 'framer-motion'
import { Clock, Bot, ListTodo, CheckCircle, GitCommit, FileText, AlertCircle } from 'lucide-react'
import { useRealtime } from '@/lib/realtime'

interface ActivityEvent {
  id: string
  type: 'agent' | 'task' | 'commit' | 'test' | 'error'
  title: string
  description: string
  timestamp: string
  icon: string
}

const typeColors = {
  agent: 'bg-primary',
  task: 'bg-secondary',
  commit: 'bg-success',
  test: 'bg-accent',
  error: 'bg-error'
}

const iconMap: Record<string, any> = {
  Bot,
  ListTodo,
  CheckCircle,
  GitCommit,
  FileText,
  AlertCircle,
  Activity: Clock
}

/** Stable identity for a row, independent of the collector's per-poll id. */
function eventKey(e: ActivityEvent): string {
  return `${e.type}|${e.title}|${e.description}`
}

export default function Activity() {
  // Realtime feed pushed over the shared WebSocket — no polling. Rows are keyed
  // by content (see eventKey) so unchanged pushes never re-mount/re-animate.
  const { metrics, ready } = useRealtime()
  const activities: ActivityEvent[] = metrics?.activity?.events || []
  const loading = !ready && activities.length === 0

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold neon-text">Activity Timeline</h1>
        <p className="text-gray-400 mt-2">Real-time activity feed</p>
      </div>

      {loading ? (
        <div className="text-gray-400">Loading activities...</div>
      ) : activities.length === 0 ? (
        <div className="text-gray-400">No activity found</div>
      ) : (
        <div className="space-y-4">
          {activities.map((activity, index) => {
            const IconComponent = iconMap[activity.icon] || Clock
            
            return (
              <motion.div
                key={eventKey(activity)}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: Math.min(index, 8) * 0.05 }}
                className="glass-card relative"
              >
                <div className="absolute left-0 top-0 bottom-0 w-1 rounded-l-lg bg-gradient-primary" />
                
                <div className="flex items-start gap-4 pl-4">
                  <div className={`p-3 rounded-xl ${typeColors[activity.type]}20`}>
                    <IconComponent className={`w-5 h-5 text-${typeColors[activity.type].replace('bg-', '')}`} />
                  </div>
                  
                  <div className="flex-1">
                    <div className="flex items-start justify-between">
                      <div>
                        <h3 className="font-bold text-lg">{activity.title}</h3>
                        <p className="text-sm text-gray-400 mt-1">{activity.description}</p>
                      </div>
                      <div className="flex items-center gap-2 text-sm text-gray-500">
                        <Clock className="w-4 h-4" />
                        <span>{activity.timestamp}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </motion.div>
            )
          })}
        </div>
      )}
    </div>
  )
}
