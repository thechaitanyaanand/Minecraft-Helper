'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const FakeBot = require('./fakeBot');
const { buildState } = require('../src/state/buildState');
const log = require('../src/log');

test('buildState: returns byte-identical output for identical input', () => {
  const bot1 = new FakeBot();
  const bot2 = new FakeBot();
  const ctx = { ownerName: 'Alice', currentGoal: 'none', currentStep: 'none', lastStepResult: 'none', autopilot: false };
  const opts = { purpose: 'intent', playerMessage: 'i need wood' };

  const s1 = buildState(bot1, ctx, opts);
  const s2 = buildState(bot2, ctx, opts);

  assert.equal(JSON.stringify(s1), JSON.stringify(s2));
});

test('buildState: exact key order for purpose intent', () => {
  const bot = new FakeBot();
  const s = buildState(bot, { ownerName: 'Alice' }, { purpose: 'intent', playerMessage: 'hello' });
  const keys = Object.keys(s);

  assert.deepEqual(keys, [
    'purpose',
    'player_message',
    'time_of_day',
    'health',
    'food',
    'y_level',
    'in_water',
    'inventory',
    'tools',
    'nearby',
    'current_goal',
    'current_step',
    'last_step_result',
    'autopilot',
  ]);
});

test('buildState: exact key order for non-intent purpose omits player_message', () => {
  const bot = new FakeBot();
  const s = buildState(bot, { ownerName: 'Alice' }, { purpose: 'interrupt', playerMessage: 'hello' });
  const keys = Object.keys(s);

  assert.deepEqual(keys, [
    'purpose',
    'time_of_day',
    'health',
    'food',
    'y_level',
    'in_water',
    'inventory',
    'tools',
    'nearby',
    'current_goal',
    'current_step',
    'last_step_result',
    'autopilot',
  ]);
  assert.equal(s.player_message, undefined);
});

test('buildState: sanitizes, truncates, and strips colour codes from player_message', () => {
  const bot = new FakeBot();
  const longMsg = '§a§lHello   world!§r ' + 'a'.repeat(300);
  const s = buildState(bot, {}, { purpose: 'intent', playerMessage: longMsg });

  assert.ok(!s.player_message.includes('§'));
  assert.ok(!s.player_message.includes('   '));
  assert.ok(s.player_message.startsWith('Hello world! '));
  assert.ok(s.player_message.length <= 200);
});

test('buildState: caps inventory at 15 sorted items and sums stacks', () => {
  const bot = new FakeBot();
  // Provide 20 distinct items plus duplicates
  const items = [];
  for (let i = 0; i < 20; i++) {
    items.push({ name: `item_${String.fromCharCode(97 + i)}`, count: 2 });
  }
  // Add duplicates for item_a
  items.push({ name: 'item_a', count: 5 });
  bot._items = items;

  const s = buildState(bot, {}, { purpose: 'intent' });
  const invKeys = Object.keys(s.inventory);

  assert.equal(invKeys.length, 15);
  // Must be sorted alphabetically
  assert.deepEqual(invKeys, [...invKeys].sort());
  // Stacks summed: 2 + 5 = 7
  assert.equal(s.inventory['item_a'], 7);
  // 16th item ('item_p') must not be present
  assert.equal(s.inventory['item_p'], undefined);
});

test('buildState: correctly computes tools and nearby objects', () => {
  const bot = new FakeBot();
  bot._items = [
    { name: 'iron_pickaxe', count: 1 },
    { name: 'diamond_sword', count: 1 },
  ];
  bot._foundBlocks = [{ x: 1, y: 64, z: 1 }, { x: 2, y: 64, z: 2 }];
  bot._foundBlock = { x: 5, y: 64, z: 5, name: 'stone' };
  bot.players = {
    Alice: { entity: { position: { x: 3, y: 64, z: 4 } } }, // distance = 5
  };
  bot.entities = {
    1: { name: 'cow', position: { x: 2, y: 64, z: 0 } },
    2: { name: 'cow', position: { x: 4, y: 64, z: 0 } }, // duplicate cow name
    3: { name: 'zombie', position: { x: 8, y: 64, z: 0 } },
  };

  const s = buildState(bot, { ownerName: 'Alice' }, { purpose: 'intent', playerMessage: 'mine stone' });

  assert.deepEqual(s.tools, {
    pickaxe: 'iron',
    axe: 'none',
    sword: 'diamond',
  });

  assert.equal(s.nearby.trees_within_32, 2);
  assert.equal(s.nearby.stone_within_16, true);
  assert.deepEqual(s.nearby.passive_food_mobs, ['cow']);
  assert.equal(s.nearby.hostile_mobs.length, 1);
  assert.equal(s.nearby.hostile_mobs[0].type, 'zombie');
  assert.equal(s.nearby.owner_distance, 5);
});

test('buildState: warns when state JSON exceeds 1500 chars', () => {
  const bot = new FakeBot();
  let warned = false;
  const origWarn = log.warn;
  log.warn = (...args) => {
    if (args.join(' ').includes('exceeds 1500 chars limit')) warned = true;
  };

  try {
    // Generate large context
    const ctx = {
      ownerName: 'Alice',
      currentGoal: 'x'.repeat(1600),
    };
    buildState(bot, ctx, { purpose: 'intent' });
    assert.equal(warned, true);
  } finally {
    log.warn = origWarn;
  }
});
