'use strict';
const os = require('os');
const path = require('path');
process.env.MEMORY_FILE = path.join(os.tmpdir(), `butler-buddyplay-test-${process.pid}.json`);

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const FakeBot = require('./fakeBot');
const { createBuddy } = require('../src/buddy/index');
const { createPlanner } = require('../src/planner/loop');
const sleepSkill = require('../src/skills/sleep');
const { CancelToken } = require('../src/cancel');
const { getMissingKit } = require('../src/safety/kit');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const decider = { decide: async () => ({ answers: {} }), status: () => ({ backend: 'mock' }) };

test('buddy: jumps in when the owner swings at a zombie next to them, not at a creeper without a shield', () => {
  const bot = new FakeBot();
  const owner = { username: 'Alice', position: new Vec3(0, 64, 0) };
  bot.players.Alice = { entity: owner };
  const zombie = { name: 'zombie', position: new Vec3(2, 64, 0), isValid: true };
  bot.entities = { 1: zombie };
  const defended = [];
  const planner = { getState: () => ({ mode: 'goal' }), defendOwner: (t) => { defended.push(t.name); return true; } };
  const buddy = createBuddy(bot, decider, { ownerName: 'Alice' }, () => {}, planner, { getOwnerState: () => ({}), getLastAttacker: () => null });
  buddy.enable();
  try {
    bot.emit('entitySwingArm', owner);
    assert.deepEqual(defended, ['zombie'], 'even while the planner runs a goal (following)');

    zombie.name = 'creeper';
    bot.emit('entitySwingArm', owner);
    assert.equal(defended.length, 1);

    zombie.name = 'zombie'; bot.health = 9;
    bot.emit('entitySwingArm', owner);
    assert.equal(defended.length, 1, 'too hurt to help');
  } finally { buddy.disable(); }
});

test('planner.defendOwner: pauses following, fights, then goes back to following', async () => {
  const bot = new FakeBot();
  bot.players.Alice = { entity: { position: new Vec3(3, 64, 0) } };
  let follows = 0;
  bot.pathfinder.setGoal = (g) => { if (g?.constructor?.name === 'GoalFollow' && g.entity === bot.players.Alice.entity) follows++; };
  const zombie = { name: 'zombie', position: new Vec3(2, 64, 0), isValid: true, height: 1.8 };
  bot.attack = (t) => { t.isValid = false; };
  bot.lookAt = async () => {};
  const planner = createPlanner(bot, decider, { ownerName: 'Alice' }, () => {});
  planner.startGoal('follow_me');
  await wait(30);
  assert.equal(follows, 1);

  assert.equal(planner.defendOwner(zombie), true);
  assert.equal(planner.defendOwner(zombie), false, 'one fight at a time');
  for (let i = 0; i < 50 && follows < 2; i++) await wait(20);
  assert.equal(zombie.isValid, false, 'fought the zombie');
  assert.equal(follows, 2, 'back to following');
  assert.equal(planner.getState().currentGoal, 'follow_me');
  planner.stop();
});

test('sleep_with_owner: places its own bed, sleeps until the owner gets up, then picks the bed back up', async () => {
  const bot = new FakeBot();
  bot.time.timeOfDay = 18000;
  bot.players.Alice = { entity: { position: new Vec3(0, 64, 0) } };
  const mc = bot.registry;
  const world = new Map(); // "x,y,z" -> block name; everything below y=64 is stone
  const blockAt = (p) => {
    const name = world.get(`${p.x},${p.y},${p.z}`) || (p.y < 64 ? 'stone' : 'air');
    return { name, position: p, boundingBox: name === 'air' ? 'empty' : 'block' };
  };
  bot.blockAt = (p) => blockAt(p.floored ? p.floored() : p);
  bot.findBlocks = () => [];
  bot._items = [{ name: 'white_bed', count: 1, type: mc.itemsByName.white_bed.id }];
  bot.equip = async () => {};
  bot.placeBlock = async (ref) => { const p = ref.position.offset(0, 1, 0); world.set(`${p.x},${p.y},${p.z}`, 'white_bed'); bot._items = []; };
  bot.sleep = async () => { bot.isSleeping = true; };
  bot.wake = async () => { bot.isSleeping = false; };
  const dug = [];
  bot.dig = async (b) => { dug.push(b.name); world.delete(`${b.position.x},${b.position.y},${b.position.z}`); };
  bot.nearestEntity = () => null;

  sleepSkill.setOwnerAsleep(true);
  assert.equal(getMissingKit({ ...bot, inventory: { items: () => [] } }).some((m) => m.item === 'white_bed'), true, 'no bed at all: the kit gives one');
  const run = sleepSkill.run(bot, { ownerName: 'Alice' }, new CancelToken());
  await wait(50);
  assert.equal(bot.isSleeping, true);
  assert.equal(getMissingKit(bot).some((m) => m.item === 'white_bed'), false, 'bed is out in the world, not lost');

  sleepSkill.setOwnerAsleep(false);
  const res = await run;
  assert.equal(res.ok, true);
  assert.equal(bot.isSleeping, false);
  assert.deepEqual(dug, ['white_bed']);
  assert.equal(bot._bedPlaced, false);
});
