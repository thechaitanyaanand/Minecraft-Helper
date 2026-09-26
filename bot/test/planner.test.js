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
  assert.ok(legalFight.includes('flee'));
  assert.equal(interrupt(stateFight, legalFight), 'fight');

  // Flee condition (hostile between 5 and 10 blocks)
  const stateFlee = {
    health: 20, food: 20,
    nearby: { hostile_mobs: [{ type: 'skeleton', distance: 8 }] },
  };
  const legalFlee = getLegalInterrupts(stateFlee);
  assert.ok(legalFlee.includes('flee'));
  assert.equal(interrupt(stateFlee, legalFlee), 'flee');

  // Dig in at night
  const stateNight = { health: 20, food: 20, time_of_day: 'night', nearby: { hostile_mobs: [] } };
  const legalNight = getLegalInterrupts(stateNight);
  assert.ok(legalNight.includes('dig_in'));
  assert.equal(interrupt(stateNight, legalNight), 'dig_in');

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
