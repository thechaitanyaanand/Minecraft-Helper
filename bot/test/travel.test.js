'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const FakeBot = require('./fakeBot');
const { CancelToken } = require('../src/cancel');
const { travel } = require('../src/skills/travel');

// Fake pathfinder: planning a route longer than `maxPlan` blocks times out, like the real 5 s thinkTimeout does.
function botWithPathfinder({ maxPlan = 40, unreachable = null } = {}) {
  const bot = new FakeBot();
  const planned = [];
  bot.pathfinder.goto = async (goal) => {
    const p = bot.entity.position, y = goal.y ?? p.y;
    planned.push(goal.constructor.name);
    if (Math.hypot(goal.x - p.x, goal.z - p.z) > maxPlan) throw Object.assign(new Error('Took to long to decide path to goal!'), { name: 'Timeout' });
    if (unreachable && goal.y === unreachable.y) throw Object.assign(new Error('No path to the goal!'), { name: 'NoPath' });
    bot.entity.position = new Vec3(goal.x, y, goal.z);
  };
  return { bot, planned };
}

test('travel: a 200-block trip succeeds in hops instead of timing out', async () => {
  const { bot } = botWithPathfinder();
  const res = await travel(bot, () => ({ x: 200, y: 64, z: 50 }), new CancelToken(), 2);
  assert.equal(res.ok, true);
  assert.ok(bot.entity.position.distanceTo(new Vec3(200, 64, 50)) <= 3);
});

test('travel: follows a target that moves during the trip', async () => {
  const { bot } = botWithPathfinder();
  let calls = 0;
  const res = await travel(bot, () => (++calls < 3 ? { x: 100, y: 64, z: 0 } : { x: 0, y: 64, z: 100 }), new CancelToken(), 2);
  assert.equal(res.ok, true);
  assert.ok(bot.entity.position.distanceTo(new Vec3(0, 64, 100)) <= 3);
});

test('travel: an unreachable exact spot (owner mid-air) settles for standing beside it', async () => {
  const { bot, planned } = botWithPathfinder({ unreachable: { y: 70 } });
  const res = await travel(bot, () => ({ x: 10, y: 70, z: 0 }), new CancelToken(), 2);
  assert.equal(res.ok, true);
  assert.equal(planned.at(-1), 'GoalNearXZ');
});

test('travel: gives up with no_path when nothing works, and reports a cancel as a cancel', async () => {
  const { bot } = botWithPathfinder({ maxPlan: 0 });
  const res = await travel(bot, () => ({ x: 100, y: 64, z: 0 }), new CancelToken(), 2);
  assert.deepEqual([res.ok, res.reason], [false, 'no_path']);

  const token = new CancelToken();
  bot.pathfinder.goto = async () => { token.cancel('interrupt'); throw new Error('Path was stopped'); };
  await assert.rejects(travel(bot, () => ({ x: 100, y: 64, z: 0 }), token, 2), { name: 'CancelledError' });
});
