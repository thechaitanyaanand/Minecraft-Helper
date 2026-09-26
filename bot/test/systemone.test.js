'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { createSystemOneClient, DecisionError } = require('../src/decision/systemone');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'systemone_response_example.json');
const fixture = JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf8'));

function startTestServer(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      resolve({
        server,
        baseUrl: `http://127.0.0.1:${port}`,
        close: () => new Promise((res) => server.close(res)),
      });
    });
  });
}

test('systemone client: 200 with fixture', async () => {
  const testServer = await startTestServer((req, res) => {
    if (req.url === '/v1/systemone' && req.method === 'POST') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(fixture));
    } else {
      res.writeHead(404);
      res.end();
    }
  });

  try {
    const client = createSystemOneClient({ baseUrl: testServer.baseUrl, timeoutMs: 2000 });
    const result = await client({ player_message: 'i need wood' }, {});
    assert.deepEqual(result, fixture);
  } finally {
    await testServer.close();
  }
});

test('systemone client: 422 error', async () => {
  const testServer = await startTestServer((req, res) => {
    res.writeHead(422, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ detail: 'Unprocessable Entity' }));
  });

  try {
    const client = createSystemOneClient({ baseUrl: testServer.baseUrl, timeoutMs: 2000 });
    await assert.rejects(
      async () => {
        await client({}, {});
      },
      (err) => {
        assert.ok(err instanceof DecisionError);
        assert.equal(err.status, 422);
        assert.match(err.message, /HTTP 422/);
        return true;
      }
    );
  } finally {
    await testServer.close();
  }
});

test('systemone client: timeout error', async () => {
  const testServer = await startTestServer((req, res) => {
    // Deliberately delay past timeoutMs
    setTimeout(() => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{}');
    }, 200);
  });

  try {
    const client = createSystemOneClient({ baseUrl: testServer.baseUrl, timeoutMs: 50 });
    await assert.rejects(
      async () => {
        await client({}, {});
      },
      (err) => {
        assert.ok(err instanceof DecisionError);
        assert.match(err.message, /network\/timeout/);
        return true;
      }
    );
  } finally {
    await testServer.close();
  }
});

test('systemone client: invalid JSON', async () => {
  const testServer = await startTestServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('not valid json {');
  });

  try {
    const client = createSystemOneClient({ baseUrl: testServer.baseUrl, timeoutMs: 2000 });
    await assert.rejects(
      async () => {
        await client({}, {});
      },
      (err) => {
        assert.ok(err instanceof DecisionError);
        assert.match(err.message, /invalid JSON from decision server/);
        return true;
      }
    );
  } finally {
    await testServer.close();
  }
});

test('systemone client: auth header only when apiKey set', async () => {
  let receivedHeaders = null;
  const testServer = await startTestServer((req, res) => {
    receivedHeaders = req.headers;
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(fixture));
  });

  try {
    // 1. Without apiKey: no authorization header
    const clientNoKey = createSystemOneClient({ baseUrl: testServer.baseUrl, timeoutMs: 2000 });
    await clientNoKey({}, {});
    assert.equal(receivedHeaders.authorization, undefined);

    // 2. With apiKey: Bearer authorization header
    const clientWithKey = createSystemOneClient({
      baseUrl: testServer.baseUrl,
      apiKey: 'test-secret-key-123',
      timeoutMs: 2000,
    });
    await clientWithKey({}, {});
    assert.equal(receivedHeaders.authorization, 'Bearer test-secret-key-123');

    // 3. Custom auth header
    const clientCustomAuth = createSystemOneClient({
      baseUrl: testServer.baseUrl,
      apiKey: 'custom-key',
      authHeader: 'x-api-key',
      timeoutMs: 2000,
    });
    await clientCustomAuth({}, {});
    assert.equal(receivedHeaders['x-api-key'], 'custom-key');
  } finally {
    await testServer.close();
  }
});
