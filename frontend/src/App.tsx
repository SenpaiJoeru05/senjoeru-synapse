import { BrowserRouter as Router, Routes, Route } from 'react-router-dom'
import { RealtimeProvider } from './lib/realtime'
import Layout from './components/Layout'
import Overview from './pages/Overview'
import Agents from './pages/Agents'
import Tasks from './pages/Tasks'
import Analytics from './pages/Analytics'
import Git from './pages/Git'
import Testing from './pages/Testing'
import Activity from './pages/Activity'
import AgentNetwork from './pages/AgentNetwork'
import Settings from './pages/Settings'

function App() {
  return (
    <Router>
      <RealtimeProvider>
        <Routes>
          <Route path="/" element={<Layout />}>
            <Route index element={<Overview />} />
            <Route path="agents" element={<Agents />} />
            <Route path="tasks" element={<Tasks />} />
            <Route path="analytics" element={<Analytics />} />
            <Route path="git" element={<Git />} />
            <Route path="testing" element={<Testing />} />
            <Route path="activity" element={<Activity />} />
            <Route path="network" element={<AgentNetwork />} />
            <Route path="settings" element={<Settings />} />
          </Route>
        </Routes>
      </RealtimeProvider>
    </Router>
  )
}

export default App
