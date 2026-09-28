'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const templates = require('../src/chat/templates');

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
  ];

  for (const s of samples) {
    assert.ok(typeof s === 'string');
    assert.ok(s.length <= 240, `String exceeded 240 chars (${s.length}): "${s}"`);
  }
});

test('navigation announcements and step messages are silenced', () => {
  assert.equal(templates.announceGoal('come_here'), '');
  assert.equal(templates.announceGoal('follow_me'), '');
  assert.equal(templates.stepStart('come_to_owner'), '');
  assert.equal(templates.stepStart('follow_owner'), '');
  assert.equal(templates.stepDone('come_to_owner'), '');
  assert.equal(templates.stepDone('follow_owner'), '');
  assert.equal(templates.stepDone('come_here'), '');
  assert.equal(templates.stepDone('follow_me'), '');
});

