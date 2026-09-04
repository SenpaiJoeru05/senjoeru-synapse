import { BrowserRouter as Router, Routes, Route } from 'react-router-dom'
import { RealtimeProvider } from './lib/realtime'
import Layout from './components/Layout'
import Overview from './pages/Overview'
import Tasks from './pages/Tasks'
import Git from './pages/Git'
import History from './pages/History'
import Intelligence from './pages/Intelligence'
import Team from './pages/Team'
import Joeru from './pages/Joeru'
import Knowledge from './pages/Knowledge'
import Insights from './pages/Insights'
import AgentNetwork from './pages/AgentNetwork'
import Settings from './pages/Settings'

function App() {
  return (
    <Router>
      <RealtimeProvider>
        <Routes>
          <Route path="/" element={<Layout />}>
            <Route index element={<Overview />} />
            <Route path="tasks" element={<Tasks />} />
            <Route path="git" element={<Git />} />
            <Route path="history" element={<History />} />
            <Route path="intelligence" element={<Intelligence />} />
            <Route path="team" element={<Team />} />
            <Route path="joeru" element={<Joeru />} />
            <Route path="knowledge" element={<Knowledge />} />
            <Route path="insights" element={<Insights />} />
            <Route path="network" element={<AgentNetwork />} />
            <Route path="settings" element={<Settings />} />
          </Route>
        </Routes>
      </RealtimeProvider>
    </Router>
  )
}

export default App
