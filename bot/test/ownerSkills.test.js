'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const FakeBot = require('./fakeBot');
const { CancelToken } = require('../src/cancel');
const { skills, getSkill } = require('../src/skills');

test('skills/index: owner and explore skills resolve correctly', () => {
  assert.ok(getSkill('come_to_owner'));
  assert.ok(getSkill('follow_owner'));
  assert.ok(getSkill('give_to_owner'));
  assert.ok(getSkill('explore'));
});

test('come_to_owner: handles owner visibility and navigates to owner', async () => {
  const bot = new FakeBot();
  const token = new CancelToken();
  const ctx = { ownerName: 'Alice' };

  // Owner not visible
  assert.equal(skills.come_to_owner.isAvailable(bot, ctx).ok, false);

  // Owner visible
  const ownerEntity = { position: new Vec3(10, 64, 10) };
  bot.players = { Alice: { entity: ownerEntity } };
  assert.equal(skills.come_to_owner.isAvailable(bot, ctx).ok, true);

  let targetGoal = null;
  bot.pathfinder.goto = async (goal) => { targetGoal = goal; };

  const res = await skills.come_to_owner.run(bot, ctx, token);
  assert.equal(res.ok, true);
  assert.ok(targetGoal);
  assert.equal(res.message, 'reached owner');
});

test('follow_owner: sets GoalFollow and stops on cancellation', async () => {
  const bot = new FakeBot();
  const token = new CancelToken();
  const ctx = { ownerName: 'Alice' };

  const ownerEntity = { position: new Vec3(5, 64, 5) };
  bot.players = { Alice: { entity: ownerEntity } };

  let followGoal = null;
  bot.pathfinder.setGoal = (goal) => {
    if (goal) followGoal = goal;
  };

  // Cancel after 50ms
  setTimeout(() => token.cancel('user stopped'), 50);

  const res = await skills.follow_owner.run(bot, ctx, token);
  assert.equal(res.ok, true);
  assert.ok(followGoal);
  assert.equal(res.message, 'stopped following');
});

test('give_to_owner: walks to owner, faces owner, and tosses items', async () => {
  const bot = new FakeBot();
  const token = new CancelToken();
  const ctx = { ownerName: 'Alice' };

  // No items
  const ownerEntity = { position: new Vec3(2, 64, 2), height: 1.8 };
  bot.players = { Alice: { entity: ownerEntity } };
  assert.equal(skills.give_to_owner.isAvailable(bot, ctx).ok, false);

  // Has items
  bot._items = [
    { type: 1, name: 'oak_log', count: 4 },
    { type: 2, name: 'dirt', count: 2 },
  ];
  assert.equal(skills.give_to_owner.isAvailable(bot, ctx).ok, true);

  let lookedAt = false;
  bot.lookAt = async () => { lookedAt = true; };
  bot.pathfinder.goto = async () => {};
  const tossed = [];
  bot.toss = async (type, metadata, count) => {
    tossed.push({ type, count });
  };

  // Toss specific item
  const resSpecific = await skills.give_to_owner.run(bot, ctx, token, { item: 'oak_log', count: 2 });
  assert.equal(resSpecific.ok, true);
  assert.equal(resSpecific.tossedCount, 2);
  assert.equal(lookedAt, true);

  // Toss all items
  tossed.length = 0;
  const resAll = await skills.give_to_owner.run(bot, ctx, token);
  assert.equal(resAll.ok, true);
  assert.equal(resAll.tossedCount, 6);
  assert.equal(tossed.length, 2);
});

test('explore: navigates random direction and completes after moving distance', async () => {
  const bot = new FakeBot();
  const token = new CancelToken();

  assert.equal(skills.explore.isAvailable(bot).ok, true);

  let exploreGoal = null;
  bot.pathfinder.setGoal = (goal) => {
    if (goal) exploreGoal = goal;
    // Simulate bot moving 30 blocks
    bot.entity.position = new Vec3(30, 64, 0);
  };

  const res = await skills.explore.run(bot, {}, token, { distance: 35, angle: 0 });
  assert.equal(res.ok, true);
  assert.ok(exploreGoal);
  assert.ok(res.distanceMoved >= 25);
});

test('clearCeilingIfUnderground: clears ceiling block when owner is above', async () => {
  const { clearCeilingIfUnderground } = require('../src/skills/owner');
  const bot = new FakeBot();
  bot.entity.position = new Vec3(0, 50, 0);
  const ownerPos = new Vec3(0, 55, 0);

  let dugBlock = null;
  bot.blockAt = (p) => {
    if (p.y === 52) return { name: 'dirt', boundingBox: 'block' };
    return { name: 'air' };
  };
  bot.dig = async (b) => { dugBlock = b; };

  await clearCeilingIfUnderground(bot, ownerPos);
  assert.ok(dugBlock);
  assert.equal(dugBlock.name, 'dirt');
});
