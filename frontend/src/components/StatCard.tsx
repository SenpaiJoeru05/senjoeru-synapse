import { motion } from 'framer-motion'
import { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid } from 'recharts'

interface StatCardProps {
  title: string
  value: string | number
  icon: LucideIcon
  trend?: string
  trendUp?: boolean
  className?: string
  delay?: number
  miniChart?: number[]
  showMiniChart?: boolean
}

export default function StatCard({ 
  title, 
  value, 
  icon: Icon, 
  trend, 
  trendUp = true,
  className,
  delay = 0,
  miniChart,
  showMiniChart = false
}: StatCardProps) {
  const chartData = miniChart?.map((val, index) => ({ 
    value: val,
    index: index + 1
  })) || []

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.3 }}
      className={cn('glass-card relative overflow-hidden group', className)}
    >
      <div className="absolute top-0 right-0 w-32 h-32 bg-gradient-primary opacity-5 rounded-full blur-3xl group-hover:opacity-10 transition-opacity" />
      
      <div className="relative">
        <div className="flex items-start justify-between">
          <div className="p-3 rounded-xl bg-gradient-primary/20">
            <Icon className="w-6 h-6 text-primary" />
          </div>
          {trend && (
            <div className={`flex items-center gap-1 text-sm ${
              trendUp ? 'text-success' : 'text-error'
            }`}>
              <span>{trend}</span>
            </div>
          )}
        </div>
        
        <div className="mt-4">
          <p className="text-sm text-gray-400">{title}</p>
          <p className="text-3xl font-bold mt-1 neon-text">{value}</p>
        </div>

        {showMiniChart && miniChart && miniChart.length > 0 && (
          <div className="mt-4 h-16">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData}>
                <defs>
                  <linearGradient id="colorGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="#6366f1" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(255,255,255,0.05)" />
                <XAxis 
                  dataKey="index" 
                  hide={true}
                />
                <YAxis 
                  hide={true}
                />
                <Tooltip
                  content={({ active, payload }) => {
                    if (active && payload && payload.length) {
                      return (
                        <div className="bg-surface2 border border-white/10 rounded-lg px-3 py-2 shadow-lg">
                          <p className="text-xs text-gray-400">Value</p>
                          <p className="text-sm font-bold text-white">{payload[0].value}</p>
                        </div>
                      )
                    }
                    return null
                  }}
                  cursor={{ stroke: 'rgba(99, 102, 241, 0.3)', strokeWidth: 1 }}
                />
                <Area
                  type="monotone"
                  dataKey="value"
                  stroke="#6366f1"
                  strokeWidth={2}
                  fillOpacity={1}
                  fill="url(#colorGradient)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </motion.div>
  )
}
