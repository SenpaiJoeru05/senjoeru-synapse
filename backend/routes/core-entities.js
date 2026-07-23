/**
 * Routers for the relational core entities (workspaces, projects, repositories).
 * Controllers stay lightweight: validate + call the service + format the
 * response. No SQL here (that's the repositories); no business rules (services).
 */
const express = require('express');

// Map a thrown service error to an HTTP status: "not found" → 404,
// validation/"required"/"already exists" → 400, else 500.
function sendError(res, err) {
  const msg = err.message || 'Internal error';
  if (/not found/i.test(msg)) return res.status(404).json({ error: msg });
  if (/required|already exists|invalid/i.test(msg)) return res.status(400).json({ error: msg });
  return res.status(500).json({ error: msg });
}

function createWorkspacesRouter(service) {
  const router = express.Router();
  router.get('/', (_req, res) => { try { res.json({ workspaces: service.list() }); } catch (e) { sendError(res, e); } });
  router.get('/:id', (req, res) => {
    try {
      const ws = service.get(Number(req.params.id));
      if (!ws) return res.status(404).json({ error: 'Workspace not found' });
      res.json(ws);
    } catch (e) { sendError(res, e); }
  });
  router.post('/', (req, res) => { try { res.status(201).json(service.create(req.body || {})); } catch (e) { sendError(res, e); } });
  router.put('/:id', (req, res) => { try { res.json(service.update(Number(req.params.id), req.body || {})); } catch (e) { sendError(res, e); } });
  return router;
}

function createProjectsRouter(service) {
  const router = express.Router();
  router.get('/', (req, res) => {
    try {
      const { workspaceId } = req.query;
      const projects = workspaceId ? service.listByWorkspace(Number(workspaceId)) : service.list();
      res.json({ projects });
    } catch (e) { sendError(res, e); }
  });
  router.get('/:id', (req, res) => {
    try {
      const p = service.get(Number(req.params.id));
      if (!p) return res.status(404).json({ error: 'Project not found' });
      res.json(p);
    } catch (e) { sendError(res, e); }
  });
  router.post('/', (req, res) => { try { res.status(201).json(service.create(req.body || {})); } catch (e) { sendError(res, e); } });
  router.put('/:id', (req, res) => { try { res.json(service.update(Number(req.params.id), req.body || {})); } catch (e) { sendError(res, e); } });
  return router;
}

function createRepositoriesRouter(service) {
  const router = express.Router();
  router.get('/', (req, res) => {
    try {
      const { projectId } = req.query;
      const repositories = projectId ? service.listByProject(Number(projectId)) : service.list();
      res.json({ repositories });
    } catch (e) { sendError(res, e); }
  });
  router.get('/:id', (req, res) => {
    try {
      const r = service.get(Number(req.params.id));
      if (!r) return res.status(404).json({ error: 'Repository not found' });
      res.json(r);
    } catch (e) { sendError(res, e); }
  });
  router.post('/', (req, res) => { try { res.status(201).json(service.register(req.body || {})); } catch (e) { sendError(res, e); } });
  router.put('/:id', (req, res) => { try { res.json(service.update(Number(req.params.id), req.body || {})); } catch (e) { sendError(res, e); } });
  return router;
}

module.exports = { createWorkspacesRouter, createProjectsRouter, createRepositoriesRouter };
