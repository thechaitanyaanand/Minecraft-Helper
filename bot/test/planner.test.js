'use strict';
process.env.LOG_DECISIONS = 'false';

const test = require('node:test');
const assert = require('node:assert/strict');
const { safetyOverride, interrupt, nextGoal, getLegalInterrupts } = require('../src/planner/heuristics');
const { createPlanner } = require('../src/planner/loop');

test('safetyOverride: triggers hard overrides', () => {
  // Fire/lava
  assert.equal(safetyOverride({ in_lava: true }), 'flee');
  assert.equal(safetyOverride({ on_fire: true }), 'flee');

  // Creeper within 4 blocks
  assert.equal(safetyOverride({ nearby: { hostile_mobs: [{ type: 'creeper', distance: 3 }] } }), 'flee');
  assert.equal(safetyOverride({ nearby: { hostile_mobs: [{ type: 'creeper', distance: 5 }] } }), null);

  // Low health with hostile within 8 blocks
  assert.equal(safetyOverride({ health: 3, nearby: { hostile_mobs: [{ type: 'zombie', distance: 7 }] } }), 'flee');
  assert.equal(safetyOverride({ health: 12, nearby: { hostile_mobs: [{ type: 'zombie', distance: 7 }] } }), null);
});

test('interrupt & getLegalInterrupts: chooses correct response based on state', () => {
  // Fight condition
  const stateFight = {
    health: 20, food: 20,
    nearby: { hostile_mobs: [{ type: 'zombie', distance: 4 }] },
  };
  const legalFight = getLegalInterrupts(stateFight);
  assert.ok(legalFight.includes('fight'));
  assert.ok(!legalFight.includes('flee'), 'a fight it can win is not offered as a chance to run');
  const swarm = { health: 20, food: 20, nearby: { hostile_mobs: [4, 5, 6].map((distance) => ({ type: 'zombie', distance })) } };
  assert.ok(getLegalInterrupts(swarm).includes('flee'), 'outnumbered: running is an option again');
  assert.equal(interrupt(stateFight, legalFight), 'fight');

  // Healthy bot ignores a hostile 8 blocks away; hurt bot flees
  assert.equal(interrupt({ health: 20, food: 20, nearby: { hostile_mobs: [{ type: 'skeleton', distance: 8 }] } }), 'continue_task');
  const stateFlee = {
    health: 8, food: 20,
    nearby: { hostile_mobs: [{ type: 'skeleton', distance: 8 }] },
  };
  const legalFlee = getLegalInterrupts(stateFlee);
  assert.ok(legalFlee.includes('flee'));
  assert.equal(interrupt(stateFlee, legalFlee), 'flee');

  // Night alone does not interrupt a task; being swarmed does
  const stateNight = { health: 20, food: 20, time_of_day: 'night', nearby: { hostile_mobs: [] } };
  assert.deepEqual(getLegalInterrupts(stateNight), ['continue_task']);
  const stateSwarm = { health: 20, food: 20, nearby: { hostile_mobs: [{ type: 'zombie', distance: 12 }, { type: 'zombie', distance: 13 }, { type: 'skeleton', distance: 14 }] } };
  assert.ok(getLegalInterrupts(stateSwarm).includes('dig_in'));

  // Real buildState inventory (name->count map) makes eating legal
  assert.ok(getLegalInterrupts({ food: 10, inventory: { bread: 3 }, nearby: { hostile_mobs: [] } }).includes('eat_food'));

  // Eat when food is low and food available
  const stateEat = { health: 20, food: 12, inventory: { has_food: true }, nearby: { hostile_mobs: [] } };
  const legalEat = getLegalInterrupts(stateEat);
  assert.ok(legalEat.includes('eat_food'));
  assert.equal(interrupt(stateEat, legalEat), 'eat_food');

  // Safe -> continue_task
  const stateSafe = { health: 20, food: 20, time_of_day: 'day', nearby: { hostile_mobs: [] } };
  const legalSafe = getLegalInterrupts(stateSafe);
  assert.deepEqual(legalSafe, ['continue_task']);
  assert.equal(interrupt(stateSafe, legalSafe), 'continue_task');
});

test('nextGoal: autopilot baseline ordering', () => {
  const allGoals = ['get_wood', 'make_tools', 'get_food', 'survive_night'];

  // 1. Night -> survive_night
  assert.equal(nextGoal({ time_of_day: 'night', food: 20 }, allGoals), 'survive_night');

  // 2. Starving -> get_food
  assert.equal(nextGoal({ time_of_day: 'day', food: 8 }, allGoals), 'get_food');

  // 3. No pickaxe -> make_tools
  assert.equal(nextGoal({ time_of_day: 'day', food: 20, tools: { pickaxe: 'none' } }, allGoals), 'make_tools');

  // 4. Logs < 8 -> get_wood
  assert.equal(nextGoal({ time_of_day: 'day', food: 20, tools: { pickaxe: 'wooden' }, inventory: { logs: 3 } }, allGoals), 'get_wood');

  // 5. Default -> get_food
  assert.equal(nextGoal({ time_of_day: 'day', food: 20, tools: { pickaxe: 'stone' }, inventory: { logs: 10 } }, allGoals), 'get_food');
});

test('createPlanner: startGoal, stop, and cancellation', async () => {
  let stopped = false;
  const mockBot = {
    version: '1.20.4',
    entity: {
      position: {
        x: 0, y: 64, z: 0,
        floored: () => ({ x: 0, y: 64, z: 0, distanceTo: () => 0 }),
        distanceTo: () => 0,
      },
    },
    pathfinder: {
      stop: () => { stopped = true; },
      setGoal: () => {},
    },
    clearControlStates: () => {},
    inventory: { items: () => [] },
  };

  const messages = [];
  const say = (m) => messages.push(m);
  const decider = { decide: async () => ({ answers: {} }), status: () => ({ backend: 'mock' }) };
  const config = { ownerName: 'owner' };

  const planner = createPlanner(mockBot, decider, config, say);

  // Start goal and verify state
  planner.startGoal('get_wood');
  const st = planner.getState();
  assert.equal(st.mode, 'goal');
  assert.equal(st.currentGoal, 'get_wood');

  // Stop planner
  planner.stop('test stop');
  assert.equal(stopped, true);
  assert.equal(planner.getState().mode, 'idle');
  assert.equal(planner.getState().currentGoal, 'none');
});

test('createPlanner: with materials in hand and a table nearby, crafts straight away and gives only that item', async () => {
  const FakeBot = require('./fakeBot');
  const { Vec3 } = require('vec3');
  const mc = require('minecraft-data')('1.20.4');
  const bot = new FakeBot();
  bot._items = [
    { name: 'cobblestone', count: 3, type: mc.itemsByName.cobblestone.id },
    { name: 'stick', count: 2, type: mc.itemsByName.stick.id },
    { name: 'wooden_axe', count: 1, type: mc.itemsByName.wooden_axe.id },
  ];
  const table = { name: 'crafting_table', position: new Vec3(2, 64, 0) };
  bot._foundBlock = ({ matching }) => (matching === mc.blocksByName.crafting_table.id ? table : null);
  bot.recipesFor = (id, meta, n, t) => (t ? [{ id, result: { count: 1 } }] : []);
  const skillsRun = [];
  bot.craft = async (r) => {
    skillsRun.push(`craft:${mc.items[r.id].name}`);
    bot._items = bot._items.filter((i) => i.name === 'wooden_axe').concat([{ name: 'stone_pickaxe', count: 1, type: r.id }]);
  };
  const tossed = [];
  bot.toss = async (type) => { tossed.push(mc.items[type].name); };
  bot.players = { owner: { entity: { position: new Vec3(3, 64, 3), height: 1.8 } } };

  const messages = [];
  const decider = { decide: async () => ({ answers: {} }), status: () => ({ backend: 'mock' }) };
  const planner = createPlanner(bot, decider, { ownerName: 'owner' }, (m) => messages.push(m));
  planner.startGoal('obtain:stone_pickaxe:1', { give: true });
  for (let i = 0; i < 50 && planner.getState().mode !== 'idle'; i++) await new Promise((r) => setTimeout(r, 20));

  assert.equal(planner.getState().mode, 'idle');
  assert.deepEqual(skillsRun, ['craft:stone_pickaxe'], 'no chopping, no new table');
  assert.deepEqual(tossed, ['stone_pickaxe'], 'gives the pickaxe, keeps its own tools');
  assert.match(messages[0], /already have the materials/);
  planner.stop();
});
