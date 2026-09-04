import { useState } from 'react'
import { Bot, MessageSquare, Activity, Brain } from 'lucide-react'
import JoeruChat from './JoeruChat'
import JoeruActivity from './JoeruActivity'
import JoeruMemory from './JoeruMemory'

const TABS = [
  { key: 'chat', label: 'Chat', icon: MessageSquare },
  { key: 'memory', label: 'Memory', icon: Brain },
  { key: 'activity', label: 'Activity', icon: Activity },
] as const

type TabKey = (typeof TABS)[number]['key']

export default function Joeru() {
  // Chat first: talking to Joeru is the point of the page, and the metrics are
  // what you check after something went wrong.
  const [tab, setTab] = useState<TabKey>('chat')

  return (
    <div className="p-8 w-full">
      <div className="flex flex-wrap items-end justify-between gap-4 mb-5">
        <div>
          <h1 className="text-2xl font-bold neon-text flex items-center gap-2">
            <Bot className="w-6 h-6" /> Joeru
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {tab === 'chat' ? 'Your engineering assistant — he manages the team'
              : tab === 'memory' ? 'What he remembers — edit or delete anything here'
              : 'OpenCode sessions, delegations, and tool activity'}
          </p>
        </div>

        <div className="flex items-center gap-1 p-1 rounded-xl bg-surface2 w-fit">
          {TABS.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-sm transition-colors ${
                tab === key
                  ? 'bg-white/10 text-white'
                  : 'text-gray-500 hover:text-gray-300'
              }`}
            >
              <Icon className="w-3.5 h-3.5" /> {label}
            </button>
          ))}
        </div>
      </div>

      {/*
        Both stay mounted and are toggled with CSS. Conditional rendering
        unmounts the chat when you glance at Activity, which throws away the
        conversation — switching tabs must not destroy state.
      */}
      <div className={tab === 'chat' ? '' : 'hidden'}><JoeruChat /></div>
      <div className={tab === 'memory' ? '' : 'hidden'}><JoeruMemory /></div>
      <div className={tab === 'activity' ? '' : 'hidden'}><JoeruActivity /></div>
    </div>
  )
}
