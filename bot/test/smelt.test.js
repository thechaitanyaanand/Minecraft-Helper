'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { CancelToken } = require('../src/cancel');
const smelt = require('../src/skills/smelt');

test('smelt.isAvailable: checks furnace presence', () => {
  const fakeBot1 = {
    version: '1.20.4',
    inventory: { items: () => [{ name: 'furnace', count: 1 }] },
  };
  assert.equal(smelt.isAvailable(fakeBot1), true);

  const fakeBot2 = {
    version: '1.20.4',
    inventory: { items: () => [] },
    findBlock: () => null,
  };
  assert.equal(smelt.isAvailable(fakeBot2), false);
});

test('smelt.run: returns no_furnace if furnace not nearby', async () => {
  const fakeBot = {
    version: '1.20.4',
    findBlock: () => null,
  };
  const res = await smelt.run(fakeBot, {}, new CancelToken(), { item: 'iron_ingot', count: 1 });
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'no_furnace');
});

test('smelt.run: returns missing_input if input items absent', async () => {
  const fakeFurnaceBlock = { position: { x: 0, y: 64, z: 0 } };
  const fakeBot = {
    version: '1.20.4',
    findBlock: () => fakeFurnaceBlock,
    inventory: { items: () => [] },
  };
  const res = await smelt.run(fakeBot, {}, new CancelToken(), { item: 'iron_ingot', count: 1 });
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'missing_input');
});

test('smelt.run: returns missing_fuel if fuel absent', async () => {
  const fakeFurnaceBlock = { position: { x: 0, y: 64, z: 0 } };
  const fakeBot = {
    version: '1.20.4',
    findBlock: () => fakeFurnaceBlock,
    inventory: { items: () => [{ name: 'raw_iron', count: 2, type: 400 }] },
  };
  const res = await smelt.run(fakeBot, {}, new CancelToken(), { item: 'iron_ingot', count: 1 });
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'missing_fuel');
});

test('smelt.run: operates furnace and retrieves output', async () => {
  let fuelPut = 0;
  let inputPut = 0;
  let taken = false;
  let closed = false;

  const fakeFurnace = {
    putFuel: async (type, meta, count) => { fuelPut += count; },
    putInput: async (type, meta, count) => { inputPut += count; },
    outputItem: () => ({ name: 'iron_ingot', count: 1, slot: 2 }),
    takeOutput: async () => { taken = true; return { name: 'iron_ingot', count: 1 }; },
    close: () => { closed = true; },
  };

  const fakeFurnaceBlock = { position: { x: 0, y: 64, z: 0 } };
  const fakeBot = {
    version: '1.20.4',
    findBlock: () => fakeFurnaceBlock,
    openFurnace: async () => fakeFurnace,
    inventory: {
      items: () => [
        { name: 'raw_iron', count: 1, type: 400 },
        { name: 'coal', count: 4, type: 500 },
      ],
    },
  };

  const res = await smelt.run(fakeBot, {}, new CancelToken(), { item: 'iron_ingot', count: 1 });
  assert.equal(res.ok, true);
  assert.equal(fuelPut, 1);
  assert.equal(inputPut, 1);
  assert.equal(taken, true);
  assert.equal(closed, true);
  assert.equal(res.item, 'iron_ingot');
});
