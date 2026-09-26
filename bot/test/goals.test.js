'use strict';
process.env.LOG_DECISIONS = 'false';

const test = require('node:test');
const assert = require('node:assert/strict');
const { GOALS, getFirstNeededStep } = require('../src/planner/goals');

function mockBot({ items = [], food = 20, time = 6000, table = false, pos = { x: 0, y: 64, z: 0 }, ownerPos = null } = {}) {
  return {
    version: '1.20.4',
    food,
    time: { timeOfDay: time },
    entity: { position: { distanceTo: (p) => Math.hypot(pos.x - p.x, pos.y - p.y, pos.z - p.z) } },
    players: ownerPos ? {
      owner: { entity: { position: ownerPos } },
    } : {},
    inventory: {
      items: () => items.map((it) => (typeof it === 'string' ? { name: it, count: 1 } : it)),
    },
    findBlock: ({ matching }) => (table ? { position: { x: 1, y: 64, z: 1 } } : null),
  };
}

test('goals: get_wood progression', () => {
  const goal = GOALS.get_wood;
  const botEmpty = mockBot({ items: [] });
  assert.equal(goal.done(botEmpty), false);
  const step1 = getFirstNeededStep(goal, botEmpty);
  assert.equal(step1?.skill, 'collect_logs');
  assert.equal(step1?.args?.count, 8);

  const bot8Logs = mockBot({ items: [{ name: 'oak_log', count: 8 }] });
  assert.equal(goal.done(bot8Logs), true);
  assert.equal(getFirstNeededStep(goal, bot8Logs), null);
});

test('goals: make_tools full step-by-step progression', () => {
  const goal = GOALS.make_tools;

  // 1. Empty inventory -> collect 3 logs
  const b1 = mockBot({ items: [] });
  assert.equal(getFirstNeededStep(goal, b1)?.skill, 'collect_logs');

  // 2. Has 3 logs -> craft planks
  const b2 = mockBot({ items: [{ name: 'oak_log', count: 3 }] });
  assert.equal(getFirstNeededStep(goal, b2)?.skill, 'craft_planks');

  // 3. Has 12 planks, 0 sticks -> craft sticks
  const b3 = mockBot({ items: [{ name: 'oak_planks', count: 12 }] });
  assert.equal(getFirstNeededStep(goal, b3)?.skill, 'craft_sticks');

  // 4. Has planks and sticks, no crafting table nearby -> place_crafting_table
  const b4 = mockBot({ items: [{ name: 'oak_planks', count: 10 }, { name: 'stick', count: 4 }], table: false });
  assert.equal(getFirstNeededStep(goal, b4)?.skill, 'place_crafting_table');

  // 5. Table nearby, no pickaxe -> craft wooden_pickaxe
  const b5 = mockBot({ items: [{ name: 'oak_planks', count: 8 }, { name: 'stick', count: 4 }], table: true });
  const s5 = getFirstNeededStep(goal, b5);
  assert.equal(s5?.skill, 'craft_tool');
  assert.equal(s5?.args?.item, 'wooden_pickaxe');

  // 6. Has wooden pickaxe and sticks, < 6 cobblestone -> mine_stone
  const b6 = mockBot({ items: [{ name: 'wooden_pickaxe', count: 1 }, { name: 'cobblestone', count: 2 }, { name: 'stick', count: 2 }], table: true });
  const s6 = getFirstNeededStep(goal, b6);
  assert.equal(s6?.skill, 'mine_stone');
  assert.equal(s6?.args?.count, 6);

  // 7. Has wooden pickaxe and 6 cobblestone, table nearby -> craft stone_pickaxe
  const b7 = mockBot({ items: [{ name: 'wooden_pickaxe', count: 1 }, { name: 'cobblestone', count: 6 }, { name: 'stick', count: 2 }], table: true });
  const s7 = getFirstNeededStep(goal, b7);
  assert.equal(s7?.skill, 'craft_tool');
  assert.equal(s7?.args?.item, 'stone_pickaxe');

  // 8. Has stone pickaxe -> goal is done
  const b8 = mockBot({ items: [{ name: 'stone_pickaxe', count: 1 }] });
  assert.equal(goal.done(b8), true);
  assert.equal(getFirstNeededStep(goal, b8), null);
});

test('goals: get_food handles eat vs hunt', () => {
  const goal = GOALS.get_food;

  // Starving with food in inventory -> eat first
  const bEat = mockBot({ food: 10, items: [{ name: 'cooked_beef', count: 2 }] });
  assert.equal(getFirstNeededStep(goal, bEat)?.skill, 'eat');

  // Low food items (< 4) and not hungry -> hunt_food
  const bHunt = mockBot({ food: 20, items: [{ name: 'cooked_beef', count: 1 }] });
  assert.equal(getFirstNeededStep(goal, bHunt)?.skill, 'hunt_food');

  // Has 4+ food items -> done
  const bDone = mockBot({ food: 20, items: [{ name: 'cooked_beef', count: 4 }] });
  assert.equal(goal.done(bDone), true);
  assert.equal(getFirstNeededStep(goal, bDone), null);
});

test('goals: survive_night and movement goals', () => {
  const ctx = { ownerName: 'owner' };

  // survive_night
  const bNight = mockBot({ time: 14000 });
  assert.equal(GOALS.survive_night.done(bNight), false);
  assert.equal(getFirstNeededStep(GOALS.survive_night, bNight)?.skill, 'dig_in');

  const bDay = mockBot({ time: 6000 });
  assert.equal(GOALS.survive_night.done(bDay), true);

  // come_here
  const bFar = mockBot({ pos: { x: 0, y: 64, z: 0 }, ownerPos: { x: 20, y: 64, z: 0 } });
  assert.equal(GOALS.come_here.done(bFar, ctx), false);
  assert.equal(getFirstNeededStep(GOALS.come_here, bFar, ctx)?.skill, 'come_to_owner');

  const bClose = mockBot({ pos: { x: 0, y: 64, z: 0 }, ownerPos: { x: 1, y: 64, z: 0 } });
  assert.equal(GOALS.come_here.done(bClose, ctx), true);

  // follow_me
  assert.equal(getFirstNeededStep(GOALS.follow_me, bFar, ctx)?.skill, 'follow_owner');

  // give_items
  const bItems = mockBot({ items: [{ name: 'dirt', count: 5 }] });
  assert.equal(GOALS.give_items.done(bItems), false);
  assert.equal(getFirstNeededStep(GOALS.give_items, bItems)?.skill, 'give_to_owner');

  const bNoItems = mockBot({ items: [] });
  assert.equal(GOALS.give_items.done(bNoItems), true);
});
