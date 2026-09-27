'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadBlueprint, listBlueprints, calculateMaterials, generatePlacements } = require('../src/planner/blueprint');
const { trigramSimilarity, parseAmount, parseDirectTarget, rankShortlist } = require('../src/planner/shortlist');
const mcData = require('minecraft-data')('1.20.4');

test('blueprints: load hut_5x5 and hut_7x7', () => {
  const list = listBlueprints();
  assert.ok(list.includes('hut_5x5'));
  assert.ok(list.includes('hut_7x7'));

  const b5 = loadBlueprint('hut_5x5');
  assert.equal(b5.id, 'hut_5x5');
  assert.equal(b5.layers.length, 4);

  const b7 = loadBlueprint('hut_7x7');
  assert.equal(b7.id, 'hut_7x7');
  assert.equal(b7.layers.length, 4);
});

test('blueprints: calculateMaterials counts blocks correctly', () => {
  const b5 = loadBlueprint('hut_5x5');
  const mats = calculateMaterials(b5);
  assert.ok(mats.oak_planks > 0);
  assert.equal(mats.oak_door, 1);
});

test('blueprints: generatePlacements orders layers bottom to top and door last', () => {
  const b5 = loadBlueprint('hut_5x5');
  const origin = { x: 10, y: 64, z: 10 };
  const placements = generatePlacements(b5, origin);
  assert.ok(placements.length > 0);

  // First placement should be on layer 0 (y = 64)
  assert.equal(placements[0].y, 64);

  // Last placement should be door
  const last = placements[placements.length - 1];
  assert.equal(last.blockName, 'oak_door');
});

test('shortlist: trigramSimilarity scores identical strings high and different low', () => {
  const high = trigramSimilarity('wooden pickaxe', 'wooden pickaxe');
  const mid = trigramSimilarity('wood pickaxe', 'wooden pickaxe');
  const low = trigramSimilarity('banana', 'wooden pickaxe');
  assert.equal(high, 1.0);
  assert.ok(mid > 0.5);
  assert.equal(low, 0);
});

test('shortlist: parseAmount extracts counts', () => {
  assert.equal(parseAmount('give me 10 planks'), 10);
  assert.equal(parseAmount('i need a stack of wood'), 64);
  assert.equal(parseAmount('get a few cobblestone'), 4);
  assert.equal(parseAmount('make a pickaxe'), 1);
});

test('shortlist: parseDirectTarget extracts items, mobs, and blueprints', () => {
  assert.equal(parseDirectTarget('helper lakdi chahiye', mcData), 'oak_log');
  assert.equal(parseDirectTarget('make an iron pickaxe', mcData), 'iron_pickaxe');
  assert.equal(parseDirectTarget('khana do', mcData), 'cooked_beef');
  assert.equal(parseDirectTarget('i need torches', mcData), 'torch');
  assert.equal(parseDirectTarget('kill that spider', mcData), 'mob:spider');
  assert.equal(parseDirectTarget('build a house', mcData), 'blueprint:hut_5x5');
  assert.equal(parseDirectTarget('build a bigger house', mcData), 'blueprint:hut_7x7');
});

test('build_blueprint skill runs successfully on fakeBot', async () => {
  const buildBlueprint = require('../src/skills/buildBlueprint');
  const { CancelToken } = require('../src/cancel');
  let placedBlocks = 0;
  const fakeBot = {
    version: '1.20.4',
    entity: { position: { x: 0, y: 64, z: 0, floored: () => ({ x: 0, y: 64, z: 0, offset: (dx, dy, dz) => ({ x: dx, y: 64 + dy, z: dz }) }) } },
    blockAt: () => ({ name: 'air' }),
    inventory: { items: () => [{ name: 'oak_planks', count: 64 }] },
    equip: async () => {},
    placeBlock: async () => { placedBlocks++; },
  };
  const res = await buildBlueprint.run(fakeBot, {}, new CancelToken(), { id: 'hut_5x5' });
  assert.equal(res.ok, true);
  assert.ok(res.message.includes('hut_5x5'));
});

test('shortlist: rankShortlist returns top items under limit', () => {
  const shortlist = rankShortlist('pickaxe', mcData.itemsArray, 10);
  assert.ok(shortlist.length <= 10);
  assert.ok(shortlist.some((name) => name.includes('pickaxe')));
});
