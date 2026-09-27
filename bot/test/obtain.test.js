'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { plan } = require('../src/planner/obtain');

test('plan: stone_pickaxe from scratch includes full progression', () => {
  const steps = plan('stone_pickaxe', 1, {});
  assert.ok(Array.isArray(steps), 'Expected steps array');
  assert.ok(steps.length > 0);

  const skills = steps.map((s) => s.skill);
  assert.ok(skills.includes('collect_block'), 'Must collect logs or stone');
  assert.ok(skills.includes('craft'), 'Must craft components');

  // Verify craft steps include wooden_pickaxe and stone_pickaxe
  const craftItems = steps.filter((s) => s.skill === 'craft').map((s) => s.args.item);
  assert.ok(craftItems.includes('wooden_pickaxe'), 'Must craft wooden pickaxe first');
  assert.ok(craftItems.includes('stone_pickaxe'), 'Must craft stone pickaxe');
  assert.ok(craftItems.includes('crafting_table'), 'Must craft crafting table');

  // Verify place_block for crafting table
  const places = steps.filter((s) => s.skill === 'place_block').map((s) => s.args.name);
  assert.ok(places.includes('crafting_table'));
});

test('plan: iron_pickaxe from scratch includes stone_pickaxe, furnace and smelt', () => {
  const steps = plan('iron_pickaxe', 1, {});
  assert.ok(Array.isArray(steps), 'Expected steps array');

  const skills = steps.map((s) => s.skill);
  assert.ok(skills.includes('smelt'), 'Must include smelt step');

  const craftItems = steps.filter((s) => s.skill === 'craft').map((s) => s.args.item);
  assert.ok(craftItems.includes('stone_pickaxe'), 'Must craft stone pickaxe to mine iron');
  assert.ok(craftItems.includes('furnace'), 'Must craft furnace');
  assert.ok(craftItems.includes('iron_pickaxe'), 'Must craft iron pickaxe');

  const smeltItems = steps.filter((s) => s.skill === 'smelt').map((s) => s.args.item);
  assert.ok(smeltItems.includes('iron_ingot'));
});

test('plan: bread returns fail no_source (farming unsupported)', () => {
  const res = plan('bread', 1, {});
  assert.ok(res && res.fail, 'Expected fail response');
  assert.equal(res.fail, 'no_source');
});

test('plan: diamond requires iron_pickaxe first', () => {
  const steps = plan('diamond', 1, {});
  assert.ok(Array.isArray(steps), 'Expected steps array');

  const craftItems = steps.filter((s) => s.skill === 'craft').map((s) => s.args.item);
  assert.ok(craftItems.includes('iron_pickaxe'), 'Mining diamond requires iron pickaxe');

  const mineSteps = steps.filter((s) => s.skill === 'collect_block');
  const hasDiamondOre = mineSteps.some((s) => s.args.blockNames.includes('diamond_ore'));
  assert.ok(hasDiamondOre, 'Must mine diamond ore');
});

test('plan: circular recipe terminates with too_deep, never loops', () => {
  // iron_block -> iron_ingot -> iron_block
  const res = plan('iron_block', 1, {}, 0, new Set(['iron_block']));
  assert.ok(res && res.fail);
  assert.equal(res.fail, 'too_deep');
});

test('plan: item already in inventory returns empty steps', () => {
  const steps = plan('stone_pickaxe', 1, { stone_pickaxe: 1 });
  assert.deepEqual(steps, []);
});

test('plan: group targets resolve correctly', () => {
  const woodSteps = plan('group:logs', 4, {});
  assert.ok(Array.isArray(woodSteps));
  assert.ok(woodSteps.some((s) => s.skill === 'collect_block'));

  const plankSteps = plan('group:planks', 4, { oak_log: 2 });
  assert.ok(Array.isArray(plankSteps));
  assert.ok(plankSteps.some((s) => s.skill === 'craft' && s.args.item === 'oak_planks'));
});

test('plan: torches, iron_sword, and white_bed produce valid progression', () => {
  const torchSteps = plan('torch', 4, {});
  assert.ok(Array.isArray(torchSteps));
  assert.ok(torchSteps.some((s) => s.skill === 'craft' && s.args.item === 'torch'));

  const swordSteps = plan('iron_sword', 1, {});
  assert.ok(Array.isArray(swordSteps));
  assert.ok(swordSteps.some((s) => s.skill === 'smelt' && s.args.item === 'iron_ingot'));
  assert.ok(swordSteps.some((s) => s.skill === 'craft' && s.args.item === 'iron_sword'));

  const bedSteps = plan('white_bed', 1, {});
  assert.ok(Array.isArray(bedSteps));
  assert.ok(bedSteps.some((s) => s.skill === 'craft' && s.args.item === 'white_bed'));
});

test('plan: material balance for iron_pickaxe plans 11 cobblestone and fuel', () => {
  const steps = plan('iron_pickaxe', 1, {});
  const cobble = steps.filter((s) => s.skill === 'collect_block' && s.args.blockNames.includes('stone')).reduce((sum, s) => sum + s.args.count, 0);
  assert.equal(cobble, 11, 'Must plan 3 for stone pickaxe + 8 for furnace');
  assert.ok(steps.some((s) => s.skill === 'craft' && s.args.item.endsWith('_planks')), 'Must plan fuel for smelting');
});

test('plan: group targets recognize non-oak logs and diverse food in inventory', () => {
  assert.deepEqual(plan('group:logs', 8, { birch_log: 8 }), []);
  assert.deepEqual(plan('group:food', 4, { cooked_porkchop: 4 }), []);
});

