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
  const missing = getMissingKit(bot);
  assert.equal(missing.length, 0, 'No tools or food should be missing');
});

test('kit: replenishKit sends /give commands for missing items', () => {
  const bot = new FakeBot('Helper');
  bot._items = [
    { name: 'wooden_pickaxe', count: 1 },
    { name: 'cooked_beef', count: 10 },
  ];
  const res = replenishKit(bot, { autoKit: true });
  assert.equal(res.ok, true);
  assert.equal(res.replenished.length, 3, 'Should replenish axe, sword, shovel');
  assert.ok(bot.chatLog.some((m) => m === '/give Helper wooden_axe 1'));
  assert.ok(bot.chatLog.some((m) => m === '/give Helper wooden_sword 1'));
  assert.ok(bot.chatLog.some((m) => m === '/give Helper wooden_shovel 1'));
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
