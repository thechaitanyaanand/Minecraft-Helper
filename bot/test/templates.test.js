'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const templates = require('../src/chat/templates');

test('templates.explain matches topics from conversational text', () => {
  const craft1 = templates.explain('how do i make a crafting table');
  const craft2 = templates.explain('what is a workbench');
  assert.ok(craft1.includes('crafting table'));
  assert.equal(craft1, craft2);

  const pick1 = templates.explain('why do i need a pickaxe');
  const pick2 = templates.explain('how to mine stone');
  assert.ok(pick1.includes('pickaxe'));
  assert.equal(pick1, pick2);

  const night1 = templates.explain('its getting dark what do i do');
  const night2 = templates.explain('raat ho gayi kaise bache');
  assert.ok(night1.includes('night') || night1.includes('monsters'));
  assert.equal(night1, night2);

  const food1 = templates.explain('im hungry where to find food');
  const food2 = templates.explain('khana chahiye kaise milega');
  assert.ok(food1.includes('hunger') || food1.includes('food'));
  assert.equal(food1, food2);

  const unknown = templates.explain('something completely random');
  assert.ok(unknown.includes('Ask me about'));
});

test('templates.announceGoal and stepStart support learn mode', () => {
  const goalNorm = templates.announceGoal('get_wood', false);
  const goalLearn = templates.announceGoal('get_wood', true);
  assert.notEqual(goalNorm, goalLearn);
  assert.ok(goalLearn.includes('planks'));

  const stepNorm = templates.stepStart('craft_planks', {}, false);
  const stepLearn = templates.stepStart('craft_planks', {}, true);
  assert.notEqual(stepNorm, stepLearn);
  assert.ok(stepLearn.includes('2x2 grid') || stepLearn.includes('(E)'));
});

test('templates.stepFailed returns human-readable message without error stack', () => {
  const res1 = templates.stepFailed('mine_stone', 'no_target');
  assert.ok(res1.includes('targets nearby'));
  assert.ok(!res1.includes('Error:'));

  const res2 = templates.stepFailed('place_block', 'no_space');
  assert.ok(res2.includes('open spot') || res2.includes('space'));

  const res3 = templates.stepFailed('craft', 'no_recipe_or_missing_items');
  assert.ok(res3.includes('Missing ingredients'));
});

test('all template outputs are within 240 chars limit', () => {
  const samples = [
    templates.welcome('Steve'),
    templates.help(),
    templates.status({ health: 20, food: 20, timeOfDay: 'day', activity: 'idle', backend: 'mock' }),
    templates.whyLast({ purpose: 'intent', chosen: 'get_wood', confidence: 0.95, topProbs: { get_wood: 0.95, make_tools: 0.05 }, backend: 'local' }),
    templates.didYouMean('make tools'),
    templates.pickOne(['get wood', 'make tools', 'get food']),
    templates.unclear(),
    templates.announceGoal('get_wood', true),
    templates.announceGoal('make_tools', true),
    templates.stepStart('collect_logs', { count: 4 }, true),
    templates.stepStart('craft_tool', { item: 'stone_pickaxe' }, true),
    templates.stepStart('hunt_food', {}, true),
    templates.stepStart('eat', {}, true),
    templates.stepStart('dig_in', {}, true),
    templates.stepFailed('collect_block', 'no_target'),
    templates.explain('how do i make a crafting table'),
    templates.explain('pickaxe'),
    templates.explain('night'),
    templates.explain('food'),
  ];

  for (const s of samples) {
    assert.ok(typeof s === 'string');
    assert.ok(s.length <= 240, `String exceeded 240 chars (${s.length}): "${s}"`);
  }
});
