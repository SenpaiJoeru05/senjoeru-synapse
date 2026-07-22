const fs = require('fs-extra');
const path = require('path');

const METRICS_DIR = path.join(__dirname, '../metrics');

// Sample data for agents
const agentsData = {
  lastUpdated: new Date().toISOString(),
  agents: [
    {
      id: '1',
      name: 'Backend Agent',
      status: 'Working',
      currentTask: 'Implementing user authentication',
      progress: 85,
      runtime: 7200,
      lastUpdate: '2 min ago',
      assignedProject: 'Synapse'
    },
    {
      id: '2',
      name: 'QA Agent',
      status: 'Testing',
      currentTask: 'Running integration tests',
      progress: 60,
      runtime: 3600,
      lastUpdate: '5 min ago',
      assignedProject: 'Synapse'
    },
    {
      id: '3',
      name: 'Reviewer Agent',
      status: 'Reviewing',
      currentTask: 'Code review PR #42',
      progress: 90,
      runtime: 1800,
      lastUpdate: '1 min ago',
      assignedProject: 'Synapse'
    }
  ],
  active: 3,
  total: 5
};

// Sample data for tasks
const tasksData = {
  lastUpdated: new Date().toISOString(),
  tasks: [
    {
      id: '1',
      title: 'Implement user authentication',
      assignedAgent: 'Backend Agent',
      progress: 85,
      status: 'Working',
      eta: '2h',
      priority: 'High'
    },
    {
      id: '2',
      title: 'Write unit tests for API',
      assignedAgent: 'QA Agent',
      progress: 60,
      status: 'Working',
      eta: '1h',
      priority: 'High'
    },
    {
      id: '3',
      title: 'Review PR #42',
      assignedAgent: 'Reviewer Agent',
      progress: 90,
      status: 'Reviewing',
      eta: '30m',
      priority: 'Medium'
    },
    {
      id: '4',
      title: 'Update documentation',
      assignedAgent: 'Documentation Agent',
      progress: 30,
      status: 'Working',
      eta: '3h',
      priority: 'Low'
    }
  ],
  running: 3,
  total: 8,
  completed: 4
};

// Sample data for tokens
const tokensData = {
  lastUpdated: new Date().toISOString(),
  today: 45200,
  weekly: 307000,
  trend: 12,
  weeklyTrend: 8,
  daily: [
    { day: 'Mon', tokens: 45000, cost: 0.45 },
    { day: 'Tue', tokens: 52000, cost: 0.52 },
    { day: 'Wed', tokens: 38000, cost: 0.38 },
    { day: 'Thu', tokens: 61000, cost: 0.61 },
    { day: 'Fri', tokens: 47000, cost: 0.47 },
    { day: 'Sat', tokens: 29000, cost: 0.29 },
    { day: 'Sun', tokens: 35000, cost: 0.35 }
  ],
  sessions: [
    { session: 'Session 1', tokens: 15000 },
    { session: 'Session 2', tokens: 22000 },
    { session: 'Session 3', tokens: 18000 },
    { session: 'Session 4', tokens: 25000 },
    { session: 'Session 5', tokens: 12000 }
  ]
};

// Sample data for costs
const costsData = {
  lastUpdated: new Date().toISOString(),
  today: 0.45,
  weekly: 3.07,
  trend: 5,
  weeklyTrend: -3
};

// Sample data for tests
const testsData = {
  lastUpdated: new Date().toISOString(),
  suites: [
    {
      name: 'Unit Tests',
      passed: 145,
      failed: 3,
      total: 148,
      coverage: 92,
      lastRun: '5 min ago',
      duration: 45
    },
    {
      name: 'Integration Tests',
      passed: 67,
      failed: 1,
      total: 68,
      coverage: 85,
      lastRun: '15 min ago',
      duration: 120
    },
    {
      name: 'E2E Tests',
      passed: 23,
      failed: 0,
      total: 23,
      coverage: 78,
      lastRun: '1 hour ago',
      duration: 300
    },
    {
      name: 'API Tests',
      passed: 89,
      failed: 2,
      total: 91,
      coverage: 88,
      lastRun: '30 min ago',
      duration: 60
    }
  ],
  passRate: 95.5,
  totalTests: 330,
  totalPassed: 324,
  totalFailed: 6
};

// Sample data for git
const gitData = {
  lastUpdated: new Date().toISOString(),
  repos: [
    {
      path: 'd:/JOELRAYTON WORKS/senjoeru-synapse',
      branch: 'main',
      current: 'main',
      tracking: 'origin/main',
      files: [],
      staged: ['src/App.tsx', 'src/pages/Overview.tsx'],
      modified: ['package.json'],
      created: ['frontend/src/pages/Analytics.tsx'],
      deleted: [],
      commits: [
        { hash: 'abc123', message: 'Add analytics page', date: '2 hours ago' },
        { hash: 'def456', message: 'Update dependencies', date: '5 hours ago' },
        { hash: 'ghi789', message: 'Fix layout issues', date: '1 day ago' }
      ],
      ahead: 2,
      behind: 0
    }
  ]
};

// Sample data for sessions
const sessionsData = {
  lastUpdated: new Date().toISOString(),
  sessionCount: 5,
  claudePath: 'C:\\Users\\joelr\\.claude',
  exists: true,
  duration: '2h 30m',
  active: true
};

// Sample data for activity
const activityData = {
  lastUpdated: new Date().toISOString(),
  events: [
    {
      id: '1',
      type: 'agent',
      title: 'Backend Agent completed task',
      description: 'Finished implementing user authentication API',
      timestamp: '2 min ago',
      icon: 'Bot'
    },
    {
      id: '2',
      type: 'commit',
      title: 'New commit pushed',
      description: 'feat: Add analytics page with token usage charts',
      timestamp: '5 min ago',
      icon: 'GitCommit'
    },
    {
      id: '3',
      type: 'test',
      title: 'Test suite completed',
      description: 'Unit tests: 145 passed, 3 failed (92% coverage)',
      timestamp: '10 min ago',
      icon: 'TestTube'
    },
    {
      id: '4',
      type: 'agent',
      title: 'QA Agent started testing',
      description: 'Running integration tests for payment module',
      timestamp: '15 min ago',
      icon: 'Bot'
    },
    {
      id: '5',
      type: 'error',
      title: 'Build failed',
      description: 'Agent encountered build error in FlowerStore',
      timestamp: '20 min ago',
      icon: 'AlertCircle'
    }
  ]
};

// Sample data for agent network
const agentNetworkData = {
  lastUpdated: new Date().toISOString(),
  agents: [
    {
      id: '1',
      name: 'Backend Agent',
      type: 'Development',
      status: 'active',
      x: 0,
      y: 0,
      connections: ['2', '3'],
      messageCount: 156,
      lastActivity: '2 min ago'
    },
    {
      id: '2',
      name: 'QA Agent',
      type: 'Testing',
      status: 'active',
      x: 0,
      y: 0,
      connections: ['1', '4'],
      messageCount: 89,
      lastActivity: '5 min ago'
    },
    {
      id: '3',
      name: 'Reviewer Agent',
      type: 'Review',
      status: 'active',
      x: 0,
      y: 0,
      connections: ['1', '5'],
      messageCount: 67,
      lastActivity: '1 min ago'
    },
    {
      id: '4',
      name: 'Documentation Agent',
      type: 'Documentation',
      status: 'idle',
      x: 0,
      y: 0,
      connections: ['2'],
      messageCount: 34,
      lastActivity: '15 min ago'
    },
    {
      id: '5',
      name: 'Orchestrator Agent',
      type: 'Orchestration',
      status: 'active',
      x: 0,
      y: 0,
      connections: ['1', '2', '3', '4'],
      messageCount: 234,
      lastActivity: '30 sec ago'
    }
  ],
  connections: [
    { from: '1', to: '2', type: 'request', timestamp: '2 min ago' },
    { from: '2', to: '1', type: 'response', timestamp: '2 min ago' },
    { from: '1', to: '3', type: 'request', timestamp: '5 min ago' },
    { from: '3', to: '1', type: 'response', timestamp: '5 min ago' },
    { from: '5', to: '1', type: 'broadcast', timestamp: '1 min ago' },
    { from: '5', to: '2', type: 'broadcast', timestamp: '1 min ago' },
    { from: '5', to: '3', type: 'broadcast', timestamp: '1 min ago' },
    { from: '5', to: '4', type: 'broadcast', timestamp: '1 min ago' },
    { from: '2', to: '4', type: 'request', timestamp: '10 min ago' },
    { from: '4', to: '2', type: 'response', timestamp: '10 min ago' },
  ]
};

// Write all sample data
async function populateSampleData() {
  try {
    await fs.writeJson(path.join(METRICS_DIR, 'agents.json'), agentsData, { spaces: 2 });
    await fs.writeJson(path.join(METRICS_DIR, 'tasks.json'), tasksData, { spaces: 2 });
    await fs.writeJson(path.join(METRICS_DIR, 'tokens.json'), tokensData, { spaces: 2 });
    await fs.writeJson(path.join(METRICS_DIR, 'costs.json'), costsData, { spaces: 2 });
    await fs.writeJson(path.join(METRICS_DIR, 'tests.json'), testsData, { spaces: 2 });
    await fs.writeJson(path.join(METRICS_DIR, 'git.json'), gitData, { spaces: 2 });
    await fs.writeJson(path.join(METRICS_DIR, 'sessions.json'), sessionsData, { spaces: 2 });
    
    // Create activity.json if it doesn't exist
    const activityPath = path.join(METRICS_DIR, 'activity.json');
    if (!fs.existsSync(activityPath)) {
      await fs.writeJson(activityPath, activityData, { spaces: 2 });
    }
    
    // Create agent-networkx.json
    const networkPath = path.join(METRICS_DIR, 'agent-network.json');
    await fs.writeJson(networkPath, agentNetworkData, { spaces: 2 });
    
    console.log('Sample data populated successfully!');
  } catch (error) {
    console.error('Error populating sample data:', error);
  }
}

populateSampleData();
