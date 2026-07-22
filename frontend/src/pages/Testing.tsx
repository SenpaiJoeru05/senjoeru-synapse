import { motion } from 'framer-motion'
import { TestTube, CheckCircle, XCircle, Clock, TrendingUp } from 'lucide-react'
import { useRealtime } from '@/lib/realtime'

interface TestSuite {
  name: string
  passed: number
  failed: number
  total: number
  coverage: number
  lastRun: string
  duration: number
}

export default function Testing() {
  const { metrics, ready } = useRealtime()
  const testSuites: TestSuite[] = metrics?.tests?.suites || []
  const loading = !ready && testSuites.length === 0

  const totalPassed = testSuites.reduce((sum, suite) => sum + suite.passed, 0)
  const totalFailed = testSuites.reduce((sum, suite) => sum + suite.failed, 0)
  const totalTests = testSuites.reduce((sum, suite) => sum + suite.total, 0)
  const avgCoverage = testSuites.length > 0 ? Math.round(testSuites.reduce((sum, suite) => sum + suite.coverage, 0) / testSuites.length) : 0

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold neon-text">Testing Dashboard</h1>
        <p className="text-gray-400 mt-2">Monitor test results and coverage</p>
      </div>

      {loading ? (
        <div className="text-gray-400">Loading test data...</div>
      ) : (
        <>
          {/* Overall Stats */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="glass-card"
            >
              <div className="flex items-center gap-3 mb-2">
                <TestTube className="w-5 h-5 text-primary" />
                <span className="text-sm text-gray-400">Total Tests</span>
              </div>
              <p className="text-3xl font-bold neon-text">{totalTests}</p>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              className="glass-card"
            >
              <div className="flex items-center gap-3 mb-2">
                <CheckCircle className="w-5 h-5 text-success" />
                <span className="text-sm text-gray-400">Passed</span>
              </div>
              <p className="text-3xl font-bold text-success">{totalPassed}</p>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
              className="glass-card"
            >
              <div className="flex items-center gap-3 mb-2">
                <XCircle className="w-5 h-5 text-error" />
                <span className="text-sm text-gray-400">Failed</span>
              </div>
              <p className="text-3xl font-bold text-error">{totalFailed}</p>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 }}
              className="glass-card"
            >
              <div className="flex items-center gap-3 mb-2">
                <TrendingUp className="w-5 h-5 text-accent" />
                <span className="text-sm text-gray-400">Coverage</span>
              </div>
              <p className="text-3xl font-bold text-accent">{avgCoverage}%</p>
            </motion.div>
          </div>

          {/* Test Suites */}
          <div className="space-y-4">
            {testSuites.length === 0 ? (
              <div className="text-gray-400">No test suites found</div>
            ) : (
              testSuites.map((suite, index) => (
                <motion.div
                  key={suite.name}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: index * 0.1 }}
                  className="glass-card"
                >
                  <div className="flex items-start justify-between mb-4">
                    <div>
                      <h3 className="font-bold text-lg">{suite.name}</h3>
                      <div className="flex items-center gap-4 mt-1 text-sm text-gray-400">
                        <span className="flex items-center gap-1">
                          <Clock className="w-4 h-4" />
                          {suite.lastRun}
                        </span>
                        <span>{suite.duration}s</span>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-2xl font-bold">
                        {Math.round((suite.passed / suite.total) * 100)}%
                      </p>
                      <p className="text-sm text-gray-400">
                        {suite.passed}/{suite.total} passed
                      </p>
                    </div>
                  </div>

                  <div className="space-y-3">
                    <div>
                      <div className="flex justify-between text-sm mb-1">
                        <span className="text-gray-400">Pass Rate</span>
                        <span>{Math.round((suite.passed / suite.total) * 100)}%</span>
                      </div>
                      <div className="w-full bg-surface2 rounded-full h-2">
                        <div
                          className={`h-2 rounded-full transition-all duration-500 ${
                            suite.failed === 0 ? 'bg-gradient-primary' : 'bg-warning'
                          }`}
                          style={{ width: `${(suite.passed / suite.total) * 100}%` }}
                        />
                      </div>
                    </div>

                    <div>
                      <div className="flex justify-between text-sm mb-1">
                        <span className="text-gray-400">Coverage</span>
                        <span>{suite.coverage}%</span>
                      </div>
                      <div className="w-full bg-surface2 rounded-full h-2">
                        <div
                          className={`h-2 rounded-full transition-all duration-500 ${
                            suite.coverage >= 80 ? 'bg-success' : suite.coverage >= 60 ? 'bg-warning' : 'bg-error'
                          }`}
                          style={{ width: `${suite.coverage}%` }}
                        />
                      </div>
                    </div>
                  </div>

                  {suite.failed > 0 && (
                    <div className="mt-4 p-3 rounded-lg bg-error/10 border border-error/20 flex items-center gap-2">
                      <XCircle className="w-4 h-4 text-error" />
                      <span className="text-sm text-error">{suite.failed} test(s) failed</span>
                    </div>
                  )}
                </motion.div>
              ))
            )}
          </div>
        </>
      )}
    </div>
  )
}
