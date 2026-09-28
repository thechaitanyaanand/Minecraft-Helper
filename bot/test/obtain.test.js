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


test('plan: uses tables/furnaces already in the world instead of crafting new ones', () => {
  const steps = plan('stone_pickaxe', 1, { cobblestone: 3, stick: 2, placed_crafting_table: 1 });
  assert.deepEqual(steps, [{ skill: 'craft', args: { item: 'stone_pickaxe', runs: 1 } }]);
});

test('plan: logs come from any tree, meat uses 1.20 item names, food hunts any animal', () => {
  const logStep = plan('group:logs', 4, {})[0];
  assert.ok(logStep.args.blockNames.includes('birch_log') && logStep.args.blockNames.includes('spruce_log'));
  assert.equal(logStep.args.dropName, 'logs');

  const beef = plan('cooked_beef', 1, { placed_furnace: 1, coal: 1 });
  assert.deepEqual(beef.map((s) => s.skill), ['hunt', 'smelt']);
  assert.deepEqual(plan('cooked_beef', 1, { beef: 1, coal: 1, placed_furnace: 1 }).map((s) => s.skill), ['smelt']);

  const food = plan('group:food', 4, {});
  assert.equal(food[0].skill, 'hunt');
  assert.ok(food[0].args.mobNames.includes('pig') && food[0].args.mobNames.includes('chicken'));
});

test('plan: ore collection counts the drop (raw_iron), not the ore block', () => {
  const step = plan('raw_iron', 2, { stone_pickaxe: 1 })[0];
  assert.equal(step.args.dropName, 'raw_iron');
});
