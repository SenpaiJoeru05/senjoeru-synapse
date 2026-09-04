import { Outlet, Link, useLocation } from 'react-router-dom'
import { motion } from 'framer-motion'
import AttentionNotifier from './AttentionNotifier'
import {
  LayoutDashboard,
  ListTodo,
  GitBranch,
  Settings,
  Network,
  History,
  Brain,
  Users,
  BookOpen,
  TrendingUp,
  Bot
} from 'lucide-react'

const navSections = [
  {
    title: null,
    items: [{ path: '/', label: 'Overview', icon: LayoutDashboard }],
  },
  {
    title: 'Work',
    items: [
      { path: 'joeru', label: 'Joeru', icon: Bot },
      { path: 'team', label: 'Team', icon: Users },
      { path: 'tasks', label: 'Tasks', icon: ListTodo },
    ],
  },
  {
    title: 'Analyze',
    items: [
      { path: 'intelligence', label: 'Intelligence', icon: Brain },
      { path: 'insights', label: 'Insights', icon: TrendingUp },
      { path: 'knowledge', label: 'Knowledge', icon: BookOpen },
    ],
  },
  {
    title: 'Activity',
    items: [
      { path: 'git', label: 'Git', icon: GitBranch },
      { path: 'history', label: 'History', icon: History },
      { path: 'network', label: 'Agent Network', icon: Network },
    ],
  },
  {
    title: 'System',
    items: [{ path: 'settings', label: 'Settings', icon: Settings }],
  },
]

export default function Layout() {
  const location = useLocation()

  return (
    <div className="flex h-screen bg-background">
      {/* Sidebar — compact 200px */}
      <motion.aside
        initial={{ x: -260 }}
        animate={{ x: 0 }}
        className="w-[200px] shrink-0 glass border-r border-white/10 flex flex-col"
      >
        {/* Logo */}
        <div className="px-4 py-4 border-b border-white/10">
          <div className="flex items-center gap-2.5">
            <svg
              viewBox="155 70 265 340"
              className="h-10 w-8 shrink-0"
              style={{ filter: 'drop-shadow(0 0 5px rgba(99,102,241,0.55))' }}
              aria-label="SenJoeru Synapse logo"
            >
              <defs>
                <linearGradient id="lgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#6366f1" />
                  <stop offset="100%" stopColor="#a855f7" />
                </linearGradient>
              </defs>
              <g transform="translate(0,400) scale(0.1,-0.1)" fill="url(#lgGrad)" stroke="none">
                <path d="M2901 3143 c-23 -43 -70 -123 -106 -177 l-65 -100 0 -690 0 -691 -122 123 c-68 68 -166 158 -220 200 l-96 77 144 3 144 3 0 109 0 110 -351 0 -351 0 -99 -52 c-55 -29 -99 -55 -99 -58 0 -3 59 -36 132 -75 465 -247 838 -610 1083 -1055 25 -46 47 -85 48 -86 1 -1 3 546 4 1217 0 670 -1 1219 -2 1219 -2 0 -22 -35 -44 -77z" />
                <path d="M3060 2000 l0 -1225 68 120 c38 66 87 147 110 180 l42 60 0 328 c0 180 3 327 7 327 3 0 71 -67 151 -150 79 -82 147 -150 150 -150 4 1 42 34 85 74 l78 73 -128 126 -128 127 318 0 318 0 99 53 c55 28 100 54 100 57 0 3 -26 18 -58 35 -311 162 -506 300 -718 510 -175 174 -298 335 -423 556 l-71 124 0 -1225z m517 229 c48 -41 102 -84 118 -96 l30 -22 -222 -1 -223 0 0 202 0 202 104 -106 c57 -58 144 -138 193 -179z" />
              </g>
            </svg>
            <div className="min-w-0">
              <h1 className="text-sm font-bold neon-text truncate">SenJoeru-Synapse</h1>
              <p className="text-[10px] text-gray-400">AI Ops Center</p>
            </div>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 p-3 overflow-y-auto scrollbar-hide">
          {navSections.map((section, si) => (
            <div key={section.title ?? 'top'} className={si > 0 ? 'mt-4' : ''}>
              {section.title && (
                <p className="px-3 mb-1 text-[10px] font-semibold uppercase tracking-wider text-gray-600">
                  {section.title}
                </p>
              )}
              <div className="space-y-0.5">
                {section.items.map((item) => {
                  const Icon = item.icon
                  const isActive = location.pathname === item.path ||
                    (item.path !== '/' && location.pathname.startsWith('/' + item.path))

                  return (
                    <Link
                      key={item.path}
                      to={item.path}
                      className={`flex items-center gap-2.5 px-3 py-2 rounded-lg transition-all duration-150 ${
                        isActive
                          ? 'bg-gradient-primary text-white neon-glow'
                          : 'text-gray-400 hover:text-white hover:bg-white/5'
                      }`}
                    >
                      <Icon className="w-4 h-4 shrink-0" />
                      <span className="text-sm font-medium">{item.label}</span>
                    </Link>
                  )
                })}
              </div>
            </div>
          ))}
        </nav>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-white/10">
          <p className="text-[10px] text-gray-500 text-center">v1.0 · Local Only</p>
        </div>
      </motion.aside>

      {/* Main Content */}
      <main className="flex-1 overflow-auto min-w-0">
        <Outlet />
      </main>

      {/* Global desktop-notification driver (renders nothing) */}
      <AttentionNotifier />
    </div>
  )
}
