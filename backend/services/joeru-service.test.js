/**
 * Tests for JoeruService — specifically that it answers OpenCode's permission
 * requests. A tool call that goes unanswered deadlocks the whole turn, so these
 * assert a reply is sent and that it says the right thing.
 *   cd backend && node --test
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');

const { JoeruService } = require('./joeru-service');

/** A stand-in for `opencode serve`: an /event stream and a permission sink. */
function fakeOpencode() {
  let streamRes = null;
  let onConnect = null;
  const replies = [];
  let onReply = null;

  const server = http.createServer((req, res) => {
    if (req.url.startsWith('/global/health')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: true }));
    }

    if (req.url.startsWith('/event')) {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      streamRes = res;
      onConnect?.();
      return undefined;
    }

    const perm = req.url.match(/^\/session\/([^/]+)\/permissions\/([^/?]+)/);
    if (perm && req.method === 'POST') {
      let raw = '';
      req.on('data', (c) => { raw += c; });
      req.on('end', () => {
        let body = {};
        try { body = JSON.parse(raw); } catch { /* recorded as {} */ }
        replies.push({ sessionId: perm[1], requestId: perm[2], body });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('true');
        onReply?.();
      });
      return undefined;
    }

    res.writeHead(404);
    return res.end();
  });

  return {
    server,
    replies,
    listen: () => new Promise((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve(server.address().port));
    }),
    connected: () => new Promise((resolve) => {
      if (streamRes) return resolve();
      onConnect = resolve;
      return undefined;
    }),
    nextReply: () => new Promise((resolve) => { onReply = resolve; }),
    emit: (event) => streamRes.write(`data: ${JSON.stringify(event)}\n\n`),
    emitRaw: (text) => streamRes.write(text),
  };
}

async function withFake(run) {
  const fake = fakeOpencode();
  const port = await fake.listen();
  const svc = new JoeruService({ baseUrl: `http://127.0.0.1:${port}` });
  try {
    await svc.health();      // starts the watcher
    await fake.connected();  // ...and it is actually subscribed
    await run(svc, fake);
  } finally {
    svc.stopWatching();
    await new Promise((r) => fake.server.close(r));
  }
}

const ASK = (permission, id = 'per_1') => ({
  type: 'permission.asked',
  properties: { id, sessionID: 'ses_1', permission, patterns: [] },
});

test('approves a read — the case that used to hang forever', async () => {
  await withFake(async (svc, fake) => {
    const replied = fake.nextReply();
    fake.emit(ASK('read'));
    await replied;

    assert.equal(fake.replies.length, 1);
    assert.deepEqual(fake.replies[0], {
      sessionId: 'ses_1',
      requestId: 'per_1',
      body: { response: 'once' },
    });
  });
});

test('approves external_directory — memory lives outside the session root', async () => {
  await withFake(async (svc, fake) => {
    const replied = fake.nextReply();
    fake.emit(ASK('external_directory'));
    await replied;
    assert.equal(fake.replies[0].body.response, 'once');
  });
});

test('rejects bash rather than leaving the turn hanging', async () => {
  await withFake(async (svc, fake) => {
    const replied = fake.nextReply();
    fake.emit(ASK('bash'));
    await replied;
    assert.equal(fake.replies[0].body.response, 'reject');
  });
});

test('understands the v2 event shape too', async () => {
  await withFake(async (svc, fake) => {
    const replied = fake.nextReply();
    fake.emit({
      type: 'permission.v2.asked',
      data: { id: 'per_v2', sessionID: 'ses_1', action: 'read', resources: [] },
    });
    await replied;
    assert.equal(fake.replies[0].requestId, 'per_v2');
    assert.equal(fake.replies[0].body.response, 'once');
  });
});

test('a frame split across chunks is still parsed', async () => {
  await withFake(async (svc, fake) => {
    const replied = fake.nextReply();
    const frame = `data: ${JSON.stringify(ASK('read', 'per_split'))}\n\n`;
    const half = Math.floor(frame.length / 2);

    // Break mid-JSON, which is what a real socket does under load.
    fake.emitRaw(frame.slice(0, half));
    await new Promise((r) => setTimeout(r, 20));
    fake.emitRaw(frame.slice(half));

    await replied;
    assert.equal(fake.replies[0].requestId, 'per_split');
    assert.equal(fake.replies[0].body.response, 'once');
  });
});

test('two frames arriving in one chunk are both handled', async () => {
  await withFake(async (svc, fake) => {
    const first = fake.nextReply();
    fake.emitRaw(
      `data: ${JSON.stringify(ASK('read', 'per_a'))}\n\n`
      + `data: ${JSON.stringify(ASK('bash', 'per_b'))}\n\n`,
    );
    await first;
    while (fake.replies.length < 2) await new Promise((r) => setTimeout(r, 10));

    assert.deepEqual(fake.replies.map((r) => [r.requestId, r.body.response]), [
      ['per_a', 'once'],
      ['per_b', 'reject'],
    ]);
  });
});

test('health reports what the permission watcher has done', async () => {
  await withFake(async (svc, fake) => {
    const replied = fake.nextReply();
    fake.emit(ASK('read'));
    await replied;

    const h = await svc.health();
    assert.equal(h.running, true);
    assert.equal(h.permissions.approved, 1);
    assert.equal(h.permissions.rejected, 0);
    assert.equal(h.permissions.lastAction.action, 'read');
  });
});
