'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const FakeBot = require('./fakeBot');
const { createObserver } = require('../src/buddy/observe');
const { createBuddy } = require('../src/buddy/index');
const questions = require('../src/decision/questions');
const { mockDecideSync } = require('../src/decision/mock');

test('observe: tracks broken and placed blocks within 6 blocks of owner', () => {
  const bot = new FakeBot();
  const owner = {
    username: 'nottheGalactic',
    position: new Vec3(10, 64, 10),
  };
  bot.players.nottheGalactic = { username: 'nottheGalactic', entity: owner };

  const observer = createObserver(bot, 'nottheGalactic');

  // Block broken near owner (dist = ~1.4 <= 6)
  bot.emit('blockUpdate', { name: 'oak_log', position: new Vec3(11, 64, 11) }, { name: 'air', position: new Vec3(11, 64, 11) });
  // Block placed near owner (dist = 1 <= 6)
  bot.emit('blockUpdate', { name: 'air', position: new Vec3(10, 65, 10) }, { name: 'oak_planks', position: new Vec3(10, 65, 10) });
  // Block broken far from owner (dist = 20 > 6) -> ignored
  bot.emit('blockUpdate', { name: 'stone', position: new Vec3(30, 64, 10) }, { name: 'air', position: new Vec3(30, 64, 10) });

  const st = observer.getOwnerState();
  assert.equal(st.recent.broke.oak_log, 1);
  assert.equal(st.recent.broke.stone, undefined);
  assert.equal(st.recent.placed.oak_planks, 1);
  observer.stopTracking();
});

test('observe: tracks owner hurt, movement, and hostiles near owner', () => {
  const bot = new FakeBot();
  const owner = {
    username: 'nottheGalactic',
    position: new Vec3(10, 64, 10),
  };
  bot.players.nottheGalactic = { username: 'nottheGalactic', entity: owner };
  const observer = createObserver(bot, 'nottheGalactic');

  // Owner hurt event
  bot.emit('entityHurt', owner);
  let st = observer.getOwnerState();
  assert.equal(st.recent.hurt, 1);
  assert.equal(st.health, 18);

  // Movement tracking
  observer.recordMove(45);
  st = observer.getOwnerState();
  assert.ok(st.recent.moved >= 40, `Expected moved >= 40, got ${st.recent.moved}`);

  // Hostile mob near owner (zombie at dist 5 <= 12)
  bot.entities = {
    101: {
      name: 'zombie',
      position: { x: 14, y: 64, z: 13 },
    },
  };
  st = observer.getOwnerState();
  assert.equal(st.hostiles_near_owner.length, 1);
  assert.equal(st.hostiles_near_owner[0].type, 'zombie');

  observer.stopTracking();
});

test('observe: prune removes events older than 20s window', () => {
  const bot = new FakeBot();
  const observer = createObserver(bot, 'nottheGalactic');

  observer.recordBroke('stone');
  observer.recordHurt();

  const now = Date.now();
  let st = observer.getOwnerState(now);
  assert.equal(st.recent.broke.stone, 1);
  assert.equal(st.recent.hurt, 1);

  // After 21s, recent window should be pruned
  st = observer.getOwnerState(now + 21_000);
  assert.equal(Object.keys(st.recent.broke).length, 0);
  assert.equal(st.recent.hurt, 0);

  observer.stopTracking();
});

test('questions.buddy: produces valid question format', () => {
  const legal = ['stay_close', 'protect_owner', 'gather_same'];
  const q = questions.buddy(legal);

  assert.equal(q.owner_activity.type, 'choice');
  assert.equal(q.needs_help.type, 'noul');
  assert.equal(q.buddy_action.type, 'choice');
  assert.deepEqual(Object.keys(q.buddy_action.criteria), legal);
});

test('mockDecide: answers buddy questions appropriately', () => {
  const legal = ['stay_close', 'protect_owner', 'gather_same'];
  const q = questions.buddy(legal);

  const state = {
    owner: {
      health: 6,
      recent: { broke: { oak_log: 3 }, placed: {}, hurt: 1, moved: 10, died: 0 },
      hostiles_near_owner: [{ type: 'zombie', distance: 4 }],
    },
  };

  const ans = mockDecideSync(state, q);
  assert.equal(ans.owner_activity.choice, 'fighting');
  assert.equal(ans.buddy_action.choice, 'protect_owner');
  assert.ok(ans.needs_help.p > 0.5);
});

test('buddy: getLegalActions correctly filters legal companion actions', () => {
  const bot = new FakeBot();
  const buddy = createBuddy(bot, { decide: async () => ({}) }, { ownerName: 'nottheGalactic' }, () => {}, null, { getOwnerState: () => ({}) });

  // Baseline: only stay_close
  let legal = buddy.getLegalActions({}, 20, {}, 'day', 'none');
  assert.deepEqual(legal, ['stay_close']);

  // Owner broke stone -> gather_same
  legal = buddy.getLegalActions({ recent: { broke: { stone: 5 } } }, 20, {}, 'day', 'none');
  assert.ok(legal.includes('gather_same'));

  // Owner placed planks and helper has planks -> bring_materials
  legal = buddy.getLegalActions({ recent: { placed: { oak_planks: 4 } } }, 20, { oak_planks: 16 }, 'day', 'none');
  assert.ok(legal.includes('bring_materials'));

  // Helper has food and owner hurt -> give_food
  legal = buddy.getLegalActions({ recent: { hurt: 1 }, health: 14 }, 20, { cooked_beef: 5 }, 'day', 'none');
  assert.ok(legal.includes('give_food'));

  // Hostile near owner -> protect_owner
  legal = buddy.getLegalActions({ hostiles_near_owner: [{ type: 'zombie', distance: 4 }] }, 18, {}, 'day', 'none');
  assert.ok(legal.includes('protect_owner'));

  // Dusk -> build_shelter_near_owner
  legal = buddy.getLegalActions({}, 20, {}, 'dusk', 'none');
  assert.ok(legal.includes('build_shelter_near_owner'));

  // Exploring (moved > 40) -> scout_ahead
  legal = buddy.getLegalActions({ recent: { moved: 50 } }, 20, {}, 'day', 'none');
  assert.ok(legal.includes('scout_ahead'));

  // Suppression suppresses action
  buddy.suppress('gather_same', 60_000);
  legal = buddy.getLegalActions({ recent: { broke: { stone: 5 } } }, 20, {}, 'day', 'none');
  assert.ok(!legal.includes('gather_same'));
});

test('buddy: hard override protects owner when owner health <= 8 with hostiles', async () => {
  const bot = new FakeBot();
  bot.health = 20;
  bot.players.nottheGalactic = {
    username: 'nottheGalactic',
    entity: {
      username: 'nottheGalactic',
      position: new Vec3(10, 64, 10),
    },
  };
  let saidMessage = '';
  const say = (msg) => { saidMessage = msg; };

  const observer = {
    getOwnerState: () => ({
      health: 6,
      hostiles_near_owner: [{ type: 'skeleton', distance: 3 }],
      recent: { broke: {}, placed: {}, hurt: 2, moved: 0, died: 0 },
    }),
  };

  let fightExecuted = false;
  const planner = {
    getState: () => ({ mode: 'idle' }),
    runSkillByName: (skill) => { if (skill === 'fight') fightExecuted = true; },
  };

  const buddy = createBuddy(bot, { decide: async () => ({}) }, { ownerName: 'nottheGalactic' }, say, planner, observer);
  buddy.enable();

  await buddy.tick(false);
  assert.ok(saidMessage.includes('Defending you'), `Expected defense chat, got "${saidMessage}"`);
  buddy.disable();
});
