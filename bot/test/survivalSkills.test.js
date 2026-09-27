'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const FakeBot = require('./fakeBot');
const { CancelToken } = require('../src/cancel');
const { skills, aliases, getSkill } = require('../src/skills');

test('skills/index: survival skills and aliases resolve correctly', () => {
  assert.ok(getSkill('hunt'));
  assert.ok(getSkill('hunt_food'));
  assert.ok(getSkill('eat'));
  assert.ok(getSkill('flee'));
  assert.ok(getSkill('fight'));
  assert.ok(getSkill('dig_in'));
});

test('hunt: isAvailable and run attack loop with drop collection', async () => {
  const bot = new FakeBot();
  const token = new CancelToken();
  bot._items = [{ name: 'wooden_sword' }];

  // No mob nearby
  bot.nearestEntity = () => null;
  assert.equal(skills.hunt.isAvailable(bot, {}).ok, false);

  // Cow nearby
  const cow = { name: 'cow', position: new Vec3(2, 64, 0), isValid: true };
  bot.nearestEntity = () => cow;
  assert.equal(skills.hunt.isAvailable(bot, {}).ok, true);

  let equipped = null;
  bot.equip = async (it) => { equipped = it.name; };
  let attacked = false;
  bot.attack = (target) => {
    attacked = true;
    target.isValid = false; // Cow dies after 1 hit
  };

  const res = await skills.hunt.run(bot, {}, token, { mobNames: ['cow'] });
  assert.equal(res.ok, true);
  assert.equal(equipped, 'wooden_sword');
  assert.equal(attacked, true);
  assert.equal(res.target, 'cow');
});

test('eat: checks hunger threshold, priority, and consumes food', async () => {
  const bot = new FakeBot();
  const token = new CancelToken();

  bot.food = 19;
  bot._items = [{ name: 'beef' }, { name: 'cooked_beef' }];
  assert.equal(skills.eat.isAvailable(bot).ok, false); // not hungry

  bot.food = 12;
  assert.equal(skills.eat.isAvailable(bot).ok, true);

  let equipped = null;
  let consumed = false;
  bot.equip = async (it) => { equipped = it.name; };
  bot.consume = async () => { consumed = true; bot.food = 20; };

  const res = await skills.eat.run(bot, {}, token);
  assert.equal(res.ok, true);
  assert.equal(equipped, 'cooked_beef'); // cooked_beef has higher priority than beef
  assert.equal(consumed, true);
});

test('flee: isAvailable and flees away from hostile mob', async () => {
  const bot = new FakeBot();
  const token = new CancelToken();

  // No hostiles
  bot.entities = {};
  assert.equal(skills.flee.isAvailable(bot).ok, false);

  // Hostile zombie 4 blocks away
  const zombie = { name: 'zombie', position: new Vec3(4, 64, 0), isValid: true };
  bot.entities = { 1: zombie };
  bot.nearestEntity = () => zombie;
  assert.equal(skills.flee.isAvailable(bot).ok, true);

  let fleeGoal = null;
  bot.pathfinder.setGoal = (g) => {
    if (g) fleeGoal = g;
    // Simulate bot successfully running away > 16 blocks
    bot.entity.position = new Vec3(25, 64, 0);
  };

  const res = await skills.flee.run(bot, {}, token);
  assert.equal(res.ok, true);
  assert.ok(fleeGoal);
});

test('fight: ignores creeper, retreats on low health, and defeats zombie', async () => {
  const bot = new FakeBot();
  const token = new CancelToken();
  bot._items = [{ name: 'stone_sword' }];

  // Creeper should not be engaged
  const creeper = { name: 'creeper', position: new Vec3(2, 64, 0), isValid: true };
  bot.nearestEntity = (fn) => (fn(creeper) ? creeper : null);
  assert.equal(skills.fight.isAvailable(bot).ok, false);

  // Zombie nearby
  const zombie = { name: 'zombie', position: new Vec3(2, 64, 0), isValid: true, height: 1.8 };
  bot.nearestEntity = (fn) => (fn(zombie) ? zombie : null);
  assert.equal(skills.fight.isAvailable(bot).ok, true);

  // Abort if health <= 8
  bot.health = 7;
  const resLow = await skills.fight.run(bot, {}, token);
  assert.equal(resLow.ok, false);
  assert.equal(resLow.reason, 'low_health');

  // Successful fight
  bot.health = 20;
  let attacked = false;
  bot.attack = (target) => {
    attacked = true;
    target.isValid = false;
  };
  bot.lookAt = async () => {};

  const res = await skills.fight.run(bot, {}, token);
  assert.equal(res.ok, true);
  assert.equal(attacked, true);
  assert.equal(res.target, 'zombie');
});

test('fight: engages targetEntity directly and sets GoalFollow', async () => {
  const bot = new FakeBot();
  const token = new CancelToken();
  bot._items = [{ name: 'stone_sword' }];
  let goalSet = null;
  const skeleton = { name: 'skeleton', position: new Vec3(2, 64, 0), isValid: true, height: 1.8 };
  bot.pathfinder = {
    setGoal: (g) => { if (g) goalSet = g; },
    stop: () => {},
  };

  let attacked = false;
  bot.attack = (target) => {
    attacked = true;
    target.isValid = false;
  };
  bot.lookAt = async () => {};

  const res = await skills.fight.run(bot, {}, token, { targetEntity: skeleton });
  assert.equal(res.ok, true);
  assert.equal(res.target, 'skeleton');
  assert.equal(attacked, true);
  assert.ok(goalSet, 'GoalFollow must be set for targetEntity');
});



test('dig_in: digs 3 blocks down and seals ceiling', async () => {
  const bot = new FakeBot();
  const token = new CancelToken();
  bot._items = [{ name: 'dirt', count: 3 }];

  bot.blockAt = (p) => {
    if (p.y <= 63) return { name: 'dirt', boundingBox: 'block' };
    return { name: 'air' };
  };

  assert.equal(skills.dig_in.isAvailable(bot).ok, true);

  const dug = [];
  bot.dig = async (b) => { dug.push(b); };
  let placed = false;
  bot.placeBlock = async () => { placed = true; };
  bot.look = async () => {};

  const res = await skills.dig_in.run(bot, {}, token);
  assert.equal(res.ok, true);
  assert.equal(dug.length, 3);
  assert.equal(placed, true);
  assert.equal(res.message, 'shelter sealed');
});
