import { motion } from 'framer-motion'
import { XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar, Area, AreaChart } from 'recharts'
import { Coins, DollarSign, TrendingUp, Calendar } from 'lucide-react'
import { useRealtime } from '@/lib/realtime'
import { formatNumber } from '@/lib/utils'

interface TokenData {
  day: string
  tokens: number
  cost: number
}

interface SessionData {
  session: string
  tokens: number
}

export default function Analytics() {
  const { metrics } = useRealtime()
  const tokens = metrics?.tokens ?? null
  const costs = metrics?.costs ?? null
  const tokenData: TokenData[] = tokens?.daily || []
  const sessionData: SessionData[] = tokens?.sessions || []

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold neon-text">Analytics</h1>
        <p className="text-gray-400 mt-2">Token usage and cost analysis</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass-card"
        >
          <div className="flex items-center gap-3 mb-2">
            <Coins className="w-5 h-5 text-primary" />
            <span className="text-sm text-gray-400">Today's Tokens</span>
          </div>
          <p className="text-3xl font-bold neon-text">
            {tokens?.today ? formatNumber(tokens.today) : '0'}
          </p>
          <p className="text-sm text-success mt-1">
            {tokens?.trend ? `+${tokens.trend}% from yesterday` : 'N/A'}
          </p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="glass-card"
        >
          <div className="flex items-center gap-3 mb-2">
            <Calendar className="w-5 h-5 text-primary" />
            <span className="text-sm text-gray-400">Weekly Tokens</span>
          </div>
          <p className="text-3xl font-bold neon-text">
            {tokens?.weekly ? formatNumber(tokens.weekly) : '0'}
          </p>
          <p className="text-sm text-success mt-1">
            {tokens?.weeklyTrend ? `+${tokens.weeklyTrend}% from last week` : 'N/A'}
          </p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="glass-card"
        >
          <div className="flex items-center gap-3 mb-2">
            <DollarSign className="w-5 h-5 text-primary" />
            <span className="text-sm text-gray-400">Today's Cost</span>
          </div>
          <p className="text-3xl font-bold neon-text">
            ${costs?.today?.toFixed(2) || '0.00'}
          </p>
          <p className="text-sm text-warning mt-1">
            {costs?.trend ? `+${costs.trend}% from yesterday` : 'N/A'}
          </p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="glass-card"
        >
          <div className="flex items-center gap-3 mb-2">
            <TrendingUp className="w-5 h-5 text-primary" />
            <span className="text-sm text-gray-400">Weekly Cost</span>
          </div>
          <p className="text-3xl font-bold neon-text">
            ${costs?.weekly?.toFixed(2) || '0.00'}
          </p>
          <p className="text-sm text-success mt-1">
            {costs?.weeklyTrend ? `${costs.weeklyTrend}% from last week` : 'N/A'}
          </p>
        </motion.div>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass-card"
        >
          <h3 className="text-xl font-bold mb-6">Token Usage (7 Days)</h3>
          <ResponsiveContainer width="100%" height={300}>
            <AreaChart data={tokenData} margin={{ top: 5, right: 5, left: 5, bottom: 5 }}>
              <defs>
                <linearGradient id="tokenGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#6366f1" stopOpacity={0.4} />
                  <stop offset="100%" stopColor="#6366f1" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
              <XAxis 
                dataKey="day" 
                stroke="#6b7280" 
                tick={{ fill: '#9ca3af', fontSize: 12 }}
                axisLine={{ stroke: '#374151' }}
                tickLine={false}
              />
              <YAxis 
                stroke="#6b7280" 
                tick={{ fill: '#9ca3af', fontSize: 12 }}
                axisLine={{ stroke: '#374151' }}
                tickLine={false}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: 'rgba(26, 26, 36, 0.95)',
                  border: '1px solid rgba(99, 102, 241, 0.3)',
                  borderRadius: '12px',
                  padding: '12px',
                  backdropFilter: 'blur(8px)',
                }}
                itemStyle={{ color: '#fff', fontSize: '12px' }}
                cursor={{ fill: 'rgba(99, 102, 241, 0.1)' }}
              />
              <Area
                type="monotone"
                dataKey="tokens"
                stroke="#6366f1"
                strokeWidth={3}
                fill="url(#tokenGradient)"
                animationDuration={1500}
              />
            </AreaChart>
          </ResponsiveContainer>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="glass-card"
        >
          <h3 className="text-xl font-bold mb-6">Session Usage</h3>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={sessionData} margin={{ top: 5, right: 5, left: 5, bottom: 5 }}>
              <defs>
                <linearGradient id="sessionGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#8b5cf6" stopOpacity={1} />
                  <stop offset="100%" stopColor="#a78bfa" stopOpacity={0.8} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
              <XAxis 
                dataKey="session" 
                stroke="#6b7280" 
                tick={{ fill: '#9ca3af', fontSize: 12 }}
                axisLine={{ stroke: '#374151' }}
                tickLine={false}
              />
              <YAxis 
                stroke="#6b7280" 
                tick={{ fill: '#9ca3af', fontSize: 12 }}
                axisLine={{ stroke: '#374151' }}
                tickLine={false}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: 'rgba(26, 26, 36, 0.95)',
                  border: '1px solid rgba(139, 92, 246, 0.3)',
                  borderRadius: '12px',
                  padding: '12px',
                  backdropFilter: 'blur(8px)',
                }}
                itemStyle={{ color: '#fff', fontSize: '12px' }}
                cursor={{ fill: 'rgba(139, 92, 246, 0.1)' }}
              />
              <Bar 
                dataKey="tokens" 
                fill="url(#sessionGradient)" 
                radius={[8, 8, 0, 0]}
                animationDuration={1200}
              />
            </BarChart>
          </ResponsiveContainer>
        </motion.div>
      </div>

      {/* Cost Trends */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className="glass-card mt-6"
      >
        <h3 className="text-xl font-bold mb-6">Cost Trends (7 Days)</h3>
        <ResponsiveContainer width="100%" height={300}>
          <AreaChart data={tokenData} margin={{ top: 5, right: 5, left: 5, bottom: 5 }}>
            <defs>
              <linearGradient id="costGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#06b6d4" stopOpacity={0.4} />
                <stop offset="100%" stopColor="#06b6d4" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
            <XAxis 
              dataKey="day" 
              stroke="#6b7280" 
              tick={{ fill: '#9ca3af', fontSize: 12 }}
              axisLine={{ stroke: '#374151' }}
              tickLine={false}
            />
            <YAxis 
              stroke="#6b7280" 
              tick={{ fill: '#9ca3af', fontSize: 12 }}
              axisLine={{ stroke: '#374151' }}
              tickLine={false}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: 'rgba(26, 26, 36, 0.95)',
                border: '1px solid rgba(6, 182, 212, 0.3)',
                borderRadius: '12px',
                padding: '12px',
                backdropFilter: 'blur(8px)',
              }}
              itemStyle={{ color: '#fff', fontSize: '12px' }}
              cursor={{ fill: 'rgba(6, 182, 212, 0.1)' }}
            />
            <Area
              type="monotone"
              dataKey="cost"
              stroke="#06b6d4"
              strokeWidth={3}
              fill="url(#costGradient)"
              animationDuration={1500}
            />
          </AreaChart>
        </ResponsiveContainer>
      </motion.div>
    </div>
  )
}
