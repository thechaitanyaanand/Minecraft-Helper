'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const mcData = require('minecraft-data')('1.20.4');
const FakeBot = require('./fakeBot');
const {
  timeOfDayLabel,
  countItem,
  countItemsMatching,
  bestToolTier,
  logBlockIds,
  hostilesNear,
  ownerEntity,
  checkNames,
  HOSTILE_MOBS,
  FOOD_MOBS,
} = require('../src/state/world');

test('world: timeOfDayLabel maps time correctly', () => {
  assert.equal(timeOfDayLabel(1000), 'day');
  assert.equal(timeOfDayLabel(11999), 'day');
  assert.equal(timeOfDayLabel(12000), 'dusk');
  assert.equal(timeOfDayLabel(12999), 'dusk');
  assert.equal(timeOfDayLabel(13000), 'night');
  assert.equal(timeOfDayLabel(22999), 'night');
  assert.equal(timeOfDayLabel(23000), 'dawn');
  assert.equal(timeOfDayLabel(24000), 'dawn');
  assert.equal(timeOfDayLabel(null), 'day');
});

test('world: countItem and countItemsMatching count inventory items', () => {
  const bot = new FakeBot();
  bot._items = [
    { name: 'oak_log', count: 4 },
    { name: 'birch_log', count: 2 },
    { name: 'dirt', count: 64 },
    { name: 'dirt', count: 10 },
  ];

  assert.equal(countItem(bot, 'dirt'), 74);
  assert.equal(countItem(bot, 'oak_log'), 4);
  assert.equal(countItem(bot, 'stone'), 0);

  assert.equal(countItemsMatching(bot, /_log$/), 6);
  assert.equal(countItemsMatching(bot, /^dirt$/), 74);
  assert.equal(countItemsMatching(bot, /diamond/), 0);
});

test('world: bestToolTier finds highest tier', () => {
  const bot = new FakeBot();
  bot._items = [
    { name: 'wooden_pickaxe', count: 1 },
    { name: 'iron_pickaxe', count: 1 },
    { name: 'stone_pickaxe', count: 1 },
    { name: 'diamond_sword', count: 1 },
  ];

  assert.equal(bestToolTier(bot, 'pickaxe'), 'iron');
  assert.equal(bestToolTier(bot, 'sword'), 'diamond');
  assert.equal(bestToolTier(bot, 'axe'), 'none');
});

test('world: logBlockIds returns valid IDs from mcData', () => {
  const ids = logBlockIds(mcData);
  assert.ok(Array.isArray(ids));
  assert.ok(ids.length >= 8);
  assert.ok(ids.includes(mcData.blocksByName.oak_log.id));
  assert.ok(ids.includes(mcData.blocksByName.birch_log.id));
});

test('world: hostilesNear filters, sorts, and applies enderman <= 4 rule', () => {
  const bot = new FakeBot();
  bot.entity.position = { x: 0, y: 64, z: 0, distanceTo: (p) => Math.hypot(p.x - 0, p.y - 64, p.z - 0) };

  bot.entities = {
    1: { name: 'zombie', position: { x: 10, y: 64, z: 0 } },
    2: { name: 'creeper', position: { x: 3, y: 64, z: 0 } },
    3: { name: 'cow', position: { x: 2, y: 64, z: 0 } }, // passive
    4: { name: 'enderman', position: { x: 5, y: 64, z: 0 } }, // distance 5 > 4: skipped
    5: { name: 'enderman', position: { x: 4, y: 64, z: 0 } }, // distance 4 <= 4: included
    6: { name: 'skeleton', position: { x: 25, y: 64, z: 0 } }, // distance 25 > 16: skipped
  };

  const near = hostilesNear(bot, 16);
  assert.equal(near.length, 3);
  assert.equal(near[0].type, 'creeper');
  assert.equal(near[0].distance, 3);
  assert.equal(near[1].type, 'enderman');
  assert.equal(near[1].distance, 4);
  assert.equal(near[2].type, 'zombie');
  assert.equal(near[2].distance, 10);
});

test('world: ownerEntity looks up owner in players map', () => {
  const bot = new FakeBot();
  const ownerEnt = { id: 42, position: { x: 1, y: 64, z: 1 } };
  bot.players = {
    Alice: { entity: ownerEnt },
  };

  assert.equal(ownerEntity(bot, 'Alice'), ownerEnt);
  assert.equal(ownerEntity(bot, 'Bob'), null);
});

test('world: checkNames passes on valid mcData and throws on missing names', () => {
  // Should pass with real mcData
  assert.doesNotThrow(() => checkNames(mcData));

  // Should throw listing the missing names
  assert.throws(
    () => checkNames(mcData, ['fake_magic_block', 'nonexistent_weapon']),
    (err) => {
      assert.match(err.message, /Missing minecraft-data block\/item names/);
      assert.match(err.message, /fake_magic_block/);
      assert.match(err.message, /nonexistent_weapon/);
      return true;
    }
  );
});
