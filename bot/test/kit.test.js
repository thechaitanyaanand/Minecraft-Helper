'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const FakeBot = require('./fakeBot');
const { getMissingKit, replenishKit, startAutoReplenish } = require('../src/safety/kit');

test('kit: getMissingKit reports all 4 tools and bread on empty inventory', () => {
  const bot = new FakeBot();
  bot._items = [];
  const missing = getMissingKit(bot);
  const items = missing.map((m) => m.item);
  assert.ok(items.includes('wooden_pickaxe'));
  assert.ok(items.includes('wooden_axe'));
  assert.ok(items.includes('wooden_sword'));
  assert.ok(items.includes('wooden_shovel'));
  assert.ok(items.includes('bread'));
  assert.ok(items.includes('shield'));
  assert.ok(items.includes('crafting_table'));
});

test('kit: does not replenish wooden tool if higher tier is present', () => {
  const bot = new FakeBot();
  bot._items = [
    { name: 'stone_pickaxe', count: 1 },
    { name: 'iron_axe', count: 1 },
    { name: 'diamond_sword', count: 1 },
    { name: 'wooden_shovel', count: 1 },
    { name: 'cooked_beef', count: 10 },
  ];
  bot._items.push({ name: 'bow', count: 1 }, { name: 'arrow', count: 32 }, { name: 'red_bed', count: 1 }, { name: 'crafting_table', count: 64 });
  bot.inventory.slots = { 5: { name: 'iron_helmet' }, 6: { name: 'leather_chestplate' }, 7: { name: 'leather_leggings' }, 8: { name: 'diamond_boots' }, 45: { name: 'shield', count: 1 } };
  const missing = getMissingKit(bot);
  assert.equal(missing.length, 0, 'No tools or food should be missing');
});

test('kit: replenishKit sends /give commands for missing items', () => {
  const bot = new FakeBot('Butler');
  bot._items = [
    { name: 'wooden_pickaxe', count: 1 },
    { name: 'cooked_beef', count: 10 },
  ];
  const res = replenishKit(bot, { autoKit: true });
  assert.equal(res.ok, true);
  assert.deepEqual(res.replenished.map((r) => r.item).sort(), [
    'arrow', 'bow', 'crafting_table', 'leather_boots', 'leather_chestplate', 'leather_helmet', 'leather_leggings',
    'shield', 'white_bed', 'wooden_axe', 'wooden_shovel', 'wooden_sword',
  ]);
  assert.ok(bot.chatLog.some((m) => m === '/give Butler wooden_axe 1'));
  assert.ok(bot.chatLog.some((m) => m === '/give Butler wooden_sword 1'));
  assert.ok(bot.chatLog.some((m) => m === '/give Butler wooden_shovel 1'));
  assert.ok(bot.chatLog.some((m) => m === '/give Butler shield 1'));
  assert.ok(bot.chatLog.some((m) => m === '/give Butler crafting_table 64'));
  assert.ok(!bot.chatLog.some((m) => m.includes('wooden_pickaxe')));
});

test('kit: replenishKit respects autoKit false', () => {
  const bot = new FakeBot();
  bot._items = [];
  const res = replenishKit(bot, { autoKit: false });
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'disabled');
  assert.equal(bot.chatLog.length, 0);

  // Force flag bypasses disabled
  const forced = replenishKit(bot, { autoKit: false }, { force: true });
  assert.equal(forced.ok, true);
  assert.ok(bot.chatLog.length > 0);
});

test('kit: startAutoReplenish periodically checks and can be stopped', async () => {
  const bot = new FakeBot('Worker');
  bot._items = [];
  const handler = startAutoReplenish(bot, { autoKit: true }, 50);
  assert.ok(typeof handler.stop === 'function');
  assert.ok(bot.chatLog.length >= 4, 'Initial replenishment fired');

  await new Promise((resolve) => setTimeout(resolve, 60));
  handler.stop();
  const countAfterStop = bot.chatLog.length;
  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.equal(bot.chatLog.length, countAfterStop, 'No more commands after stop');
});
