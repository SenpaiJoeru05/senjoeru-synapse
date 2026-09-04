/** Routers for the Phase-4 Knowledge Layer: notes, bookmarks, docs, search. */
const express = require('express');

function sendError(res, err) {
  const msg = err.message || 'Internal error';
  if (/not found/i.test(msg)) return res.status(404).json({ error: msg });
  if (/required|invalid/i.test(msg)) return res.status(400).json({ error: msg });
  return res.status(500).json({ error: msg });
}

function createNotesRouter(service) {
  const r = express.Router();
  r.get('/', (_q, res) => { try { res.json({ notes: service.list() }); } catch (e) { sendError(res, e); } });
  r.get('/:id', (req, res) => {
    try {
      const n = service.get(Number(req.params.id));
      if (!n) return res.status(404).json({ error: 'Note not found' });
      res.json(n);
    } catch (e) { sendError(res, e); }
  });
  r.post('/', (req, res) => { try { res.status(201).json(service.create(req.body || {})); } catch (e) { sendError(res, e); } });
  r.put('/:id', (req, res) => { try { res.json(service.update(Number(req.params.id), req.body || {})); } catch (e) { sendError(res, e); } });
  r.delete('/:id', (req, res) => { try { service.remove(Number(req.params.id)); res.json({ success: true }); } catch (e) { sendError(res, e); } });
  return r;
}

function createBookmarksRouter(service) {
  const r = express.Router();
  r.get('/', (_q, res) => { try { res.json({ bookmarks: service.list() }); } catch (e) { sendError(res, e); } });
  r.post('/', (req, res) => { try { res.status(201).json(service.create(req.body || {})); } catch (e) { sendError(res, e); } });
  r.delete('/:id', (req, res) => { try { service.remove(Number(req.params.id)); res.json({ success: true }); } catch (e) { sendError(res, e); } });
  return r;
}

function createDocsRouter(docRepo, docService) {
  const r = express.Router();
  r.get('/', (req, res) => {
    try {
      const docs = req.query.repo ? docRepo.getByRepo(req.query.repo) : docRepo.getAll();
      res.json({ count: docRepo.count(), docs });
    } catch (e) { sendError(res, e); }
  });
  r.post('/reindex', (_q, res) => { try { res.json(docService.reindex()); } catch (e) { sendError(res, e); } });
  return r;
}

function createSearchRouter(searchService) {
  const r = express.Router();
  r.get('/', (req, res) => {
    try { res.json(searchService.search(req.query.q, { kind: req.query.kind, limit: req.query.limit })); }
    catch (e) { sendError(res, e); }
  });
  return r;
}

module.exports = { createNotesRouter, createBookmarksRouter, createDocsRouter, createSearchRouter };
