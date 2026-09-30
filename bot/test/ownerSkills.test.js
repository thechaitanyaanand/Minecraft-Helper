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

test('parseCoords: correctly parses coordinate variations and rejects non-coordinates', () => {
  const { parseCoords } = require('../src/state/world');
  const c1 = parseCoords('100 64 200');
  assert.deepEqual([c1.x, c1.y, c1.z], [100, 64, 200]);

  const c2 = parseCoords('come to -38.5, 66.9, 18.6');
  assert.deepEqual([c2.x, c2.y, c2.z], [-38.5, 66.9, 18.6]);

  const c3 = parseCoords('X: 500 Y: 72 Z: -300');
  assert.deepEqual([c3.x, c3.y, c3.z], [500, 72, -300]);

  assert.equal(parseCoords('collect wood logs 2'), null);
  assert.equal(parseCoords('make 3 stone pickaxes'), null);
  assert.equal(parseCoords('hello world'), null);
});

test('come_to_owner: travels to coordinates even when owner is out of view', async () => {
  const bot = new FakeBot();
  const token = new CancelToken();
  const ctx = { ownerName: 'Alice' };

  // Owner entity is null (far away outside tracking distance)
  bot.players = { Alice: { entity: null } };
  bot._lastOwnerPos = new Vec3(200, 64, 50);
  bot._lastOwnerPosTime = Date.now();

  assert.equal(skills.come_to_owner.isAvailable(bot, ctx).ok, true);

  const targets = [];
  bot.pathfinder.goto = async (goal) => {
    targets.push(goal);
    // Simulate arriving at goal
    bot.entity.position = new Vec3(goal.x, goal.y ?? 64, goal.z);
  };

  const res = await skills.come_to_owner.run(bot, ctx, token);
  assert.equal(res.ok, true);
  assert.equal(res.message, 'reached owner');
  assert.ok(bot.entity.position.distanceTo(new Vec3(200, 64, 50)) <= 3);
});

test('queryOwnerPos: queries server via /data get entity and resolves coordinates', async () => {
  const { queryOwnerPos } = require('../src/state/world');
  const bot = new FakeBot();

  bot.on('chatSent', (msg) => {
    if (msg.startsWith('/data get entity Alice Pos')) {
      process.nextTick(() => {
        bot.emit('message', 'Alice has the following entity data: [150.5d, 70.0d, -80.25d]');
      });
    }
  });

  const pos = await queryOwnerPos(bot, 'Alice', 1000);
  assert.ok(pos);
  assert.equal(pos.x, 150.5);
  assert.equal(pos.y, 70);
  assert.equal(pos.z, -80.25);
  assert.equal(bot._lastOwnerPos.x, 150.5);
});

