'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { Vec3 } = require('vec3');
const { startWeb, publish } = require('../src/web');
const { buildLiveState } = require('../src/liveState');

function stubBot() {
  const pos = new Vec3(10.4, 64, -3.6);
  const me = { position: pos, yaw: 0 };
  return {
    username: 'Butler', health: 17, food: 9, time: { timeOfDay: 14000 },
    entity: me, heldItem: { name: 'wooden_pickaxe' },
    inventory: { items: () => [{ name: 'oak_log', count: 3 }, { name: 'oak_log', count: 2 }, { name: 'wooden_pickaxe', count: 1 }] },
    entities: {
      1: me,
      2: { type: 'player', username: 'Steve', position: pos.offset(3, 0, 4) },
      3: { type: 'mob', name: 'zombie', position: pos.offset(-5, 0, 0) },
      4: { type: 'object', name: 'item', position: pos.offset(1, 0, 0) },
      5: { type: 'mob', name: 'cow', position: pos.offset(100, 0, 0) },   // off the map
    },
    blockAt: (p) => ({ name: p.y === 63 ? 'grass_block' : 'air' }),
  };
}

test('buildLiveState summarises the bot for the live view', () => {
  const s = buildLiveState(stubBot(), { activity: 'idle', backend: 'mock', owner: 'Steve', withMap: true });
  assert.strictEqual(s.online, true);
  assert.deepStrictEqual(s.pos, { x: 10, y: 64, z: -4 });
  assert.strictEqual(s.time, 'night');
  assert.deepStrictEqual(s.inventory, [{ name: 'oak_log', count: 5 }, { name: 'wooden_pickaxe', count: 1 }]);
  assert.deepStrictEqual(s.entities.map((e) => e.kind).sort(), ['hostile', 'owner']);
  assert.strictEqual(s.map.length, 25);
  assert.strictEqual(s.map[12][12], 'grass_block');
  assert.strictEqual(buildLiveState(null, { activity: 'idle' }).online, false);
});

test('live view serves the page and replays state to new viewers', async () => {
  const server = startWeb(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const page = await fetch(base + '/');
    assert.strictEqual(page.status, 200);
    assert.match(await page.text(), /<title>Butler/);

    publish('snapshot', { online: true, health: 20 });
    publish('decision', { backend: 'local', answers: { intent: { type: 'choice', choice: 'get_wood' } } });

    const ac = new AbortController();
    const res = await fetch(base + '/events', { signal: ac.signal });
    const reader = res.body.getReader();
    let text = '';
    while (!text.includes('event: decision')) text += new TextDecoder().decode((await reader.read()).value);
    ac.abort();
    assert.match(text, /event: snapshot\ndata: \{"online":true/);
    assert.match(text, /"choice":"get_wood"/);
  } finally {
    server.closeAllConnections();
    server.close();
  }
});
