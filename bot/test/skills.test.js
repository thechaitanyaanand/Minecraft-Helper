'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const FakeBot = require('./fakeBot');
const { CancelToken } = require('../src/cancel');
const { skills, aliases, getSkill } = require('../src/skills');
const { handleDebugSkill } = require('../src/chat/debug');

test('skills/index: aliases and registry resolve correctly', () => {
  assert.ok(getSkill('collect_block'));
  assert.ok(getSkill('craft'));
  assert.ok(getSkill('place_block'));
  assert.ok(getSkill('collect_logs'));
  assert.ok(getSkill('mine_stone'));
  assert.ok(getSkill('craft_planks'));
  assert.ok(getSkill('craft_sticks'));
  assert.ok(getSkill('craft_tool'));
  assert.ok(getSkill('place_crafting_table'));
  assert.equal(getSkill('nonexistent_skill'), null);
});

test('collect_block.isAvailable: checks slots and tools', () => {
  const bot = new FakeBot();
  bot.inventory.emptySlotCount = () => 1;
  assert.deepEqual(skills.collect_block.isAvailable(bot, {}), { ok: false, reason: 'inventory_full' });

  bot.inventory.emptySlotCount = () => 10;
  bot._items = [];
  assert.deepEqual(skills.collect_block.isAvailable(bot, {}, { needsTool: 'pickaxe' }), { ok: false, reason: 'no_tool' });

  bot._items = [{ name: 'wooden_pickaxe' }];
  assert.deepEqual(skills.collect_block.isAvailable(bot, {}, { needsTool: 'pickaxe' }), { ok: true });
});

test('collect_block.run: handles no_target and protection', async () => {
  const bot = new FakeBot();
  const token = new CancelToken();
  bot.inventory.emptySlotCount = () => 10;

  // No blocks found
  bot._foundBlocks = [];
  const res1 = await skills.collect_block.run(bot, {}, token, { blockNames: ['oak_log'] });
  assert.equal(res1.ok, false);
  assert.equal(res1.reason, 'no_target');

  // Found blocks are all protected
  const protPos = new Vec3(5, 64, 5);
  bot._foundBlocks = [protPos];
  bot._blockAtFn = (p) => ({ name: 'oak_planks', position: p }); // protected block
  const res2 = await skills.collect_block.run(bot, {}, token, { blockNames: ['oak_log'] });
  assert.equal(res2.ok, false);
  assert.equal(res2.reason, 'no_target');
});

test('collect_block.run: collects block and equips tool', async () => {
  const bot = new FakeBot();
  const token = new CancelToken();
  let equipped = null;
  bot.inventory.emptySlotCount = () => 10;
  bot._items = [{ name: 'wooden_pickaxe' }];
  bot.equip = async (item) => { equipped = item.name; };

  const logPos = new Vec3(2, 64, 2);
  bot._foundBlocks = [logPos];
  bot._blockAtFn = (p) => ({ name: 'oak_log', position: p });

  let collected = false;
  bot.collectBlock = {
    collect: async () => {
      collected = true;
      bot._items.push({ name: 'oak_log', count: 1 });
    },
  };

  const res = await skills.collect_block.run(bot, {}, token, {
    blockNames: ['oak_log'],
    dropName: 'logs',
    needsTool: 'pickaxe',
  });

  assert.equal(equipped, 'wooden_pickaxe');
  assert.equal(collected, true);
  assert.equal(res.ok, true);
  assert.equal(res.collectedCount, 1);
});

test('craft.run: 2x2 craft calculates runs and crafts without table', async () => {
  const bot = new FakeBot();
  const token = new CancelToken();
  let craftArgs = null;

  bot.recipesFor = (id) => [{ id, result: { count: 4 } }];
  bot.craft = async (recipe, runs, table) => {
    craftArgs = { recipe, runs, table };
  };

  const res = await skills.craft.run(bot, {}, token, { item: 'stick', count: 4 });
  assert.equal(res.ok, true);
  assert.equal(craftArgs.runs, 1);
  assert.equal(craftArgs.table, undefined);
});

test('craft.run: 3x3 tool craft requires table or walks to it', async () => {
  const bot = new FakeBot();
  const token = new CancelToken();

  bot.findBlock = () => null;
  const res1 = await skills.craft.run(bot, {}, token, { item: 'wooden_pickaxe' });
  assert.equal(res1.ok, false);
  assert.equal(res1.reason, 'no_table');

  const tableBlock = { position: new Vec3(10, 64, 10) };
  let visited = false;
  bot.findBlock = ({ maxDistance }) => (maxDistance <= 4 && !visited ? null : tableBlock);
  bot.pathfinder.goto = async () => { visited = true; };
  bot.recipesFor = () => [{ result: { count: 1 } }];
  bot.craft = async () => {};

  const res2 = await skills.craft.run(bot, {}, token, { item: 'wooden_pickaxe' });
  assert.equal(res2.ok, true);
  assert.equal(visited, true);
});

test('place_block.run: finds solid ground and places block', async () => {
  const bot = new FakeBot();
  const token = new CancelToken();
  bot._items = [{ name: 'crafting_table' }];
  let placed = null;

  bot.blockAt = (p) => {
    if (p.x === 2 && p.y === 63 && p.z === 0) return { name: 'dirt', boundingBox: 'block' };
    return { name: 'air' };
  };
  bot.equip = async () => {};
  bot.placeBlock = async (ground, face) => { placed = { ground, face }; };

  const res = await skills.place_block.run(bot, {}, token, { name: 'crafting_table' });
  assert.equal(res.ok, true);
  assert.ok(placed);
  assert.equal(placed.ground.name, 'dirt');
});

test('chat/debug: handleDebugSkill runs skill when DEBUG=true', async () => {
  const origDebug = process.env.DEBUG;
  process.env.DEBUG = 'true';
  const bot = new FakeBot();
  const token = new CancelToken();
  const messages = [];
  const say = (m) => messages.push(m);

  // Unknown skill
  await handleDebugSkill('unknown_thing', bot, {}, token, say);
  assert.ok(messages.some((m) => m.includes('Unknown skill')));

  // Valid craft_sticks alias
  bot.recipesFor = () => [{ result: { count: 4 } }];
  bot.craft = async () => {};
  await handleDebugSkill('craft_sticks {"count":4}', bot, {}, token, say);
  assert.ok(messages.some((m) => m.includes('Crafting sticks')));
  assert.ok(messages.some((m) => m.includes('Done:')));

  // Disabled when DEBUG != true
  process.env.DEBUG = 'false';
  messages.length = 0;
  await handleDebugSkill('craft_sticks', bot, {}, token, say);
  assert.ok(messages.some((m) => m.includes('Debug commands are disabled')));

  process.env.DEBUG = origDebug;
});
