const simpleGit = require('simple-git');
const fs = require('fs-extra');
const path = require('path');
const axios = require('axios');

const METRICS_DIR = path.join(__dirname, '../metrics');
const BACKEND_URL = 'http://localhost:3001';

// Repositories to monitor
const REPOSITORIES = [
  'd:/JOELRAYTON WORKS/senjoeru-synapse',
  'd:/FlowerStorePH/fs-llm-service',
  // Add more repositories as needed
];

const updateGitMetrics = async () => {
  try {
    const gitPath = path.join(METRICS_DIR, 'git.json');
    const currentData = await fs.readJson(gitPath);
    
    const repoData = [];

    for (const repoPath of REPOSITORIES) {
      if (!fs.existsSync(repoPath)) {
        continue;
      }

      try {
        const git = simpleGit(repoPath);
        const status = await git.status();
        const log = await git.log({ maxCount: 5 });
        const branch = status.current;

        repoData.push({
          path: repoPath,
          branch,
          current: status.current,
          tracking: status.tracking,
          files: status.files,
          staged: status.staged,
          modified: status.modified,
          created: status.created,
          deleted: status.deleted,
          commits: log.all,
          ahead: status.ahead,
          behind: status.behind
        });
      } catch (error) {
        console.error(`Error reading git repo ${repoPath}:`, error.message);
      }
    }

    const updatedData = {
      ...currentData,
      lastUpdated: new Date().toISOString(),
      data: repoData
    };

    await fs.writeJson(gitPath, updatedData, { spaces: 2 });
    
    // Notify backend
    await axios.post(`${BACKEND_URL}/api/metrics/git`, updatedData);
    
    console.log('Git metrics updated');
  } catch (error) {
    console.error('Error updating git metrics:', error.message);
  }
};

// Start git collector
console.log('Starting Git collector...');

// Update every 10 seconds
setInterval(updateGitMetrics, 10000);

// Initial update
updateGitMetrics();

console.log('Git collector started');
