'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const questions = require('../src/decision/questions');

test('questions.intent: builds intent choice and wants_to_learn noul', () => {
  const q = questions.intent();

  assert.ok(q.intent);
  assert.equal(q.intent.type, 'choice');
  assert.ok(q.wants_to_learn);
  assert.equal(q.wants_to_learn.type, 'noul');

  const criteriaKeys = Object.keys(q.intent.criteria);
  assert.equal(criteriaKeys.length, 12);
  assert.ok(criteriaKeys.includes('get_wood'));
  assert.ok(criteriaKeys.includes('make_tools'));
  assert.ok(criteriaKeys.includes('get_food'));
  assert.ok(criteriaKeys.includes('unclear'));

  // All keys snake_case, <= 24 chars, descriptions 3-15 words
  for (const [id, desc] of Object.entries(q.intent.criteria)) {
    assert.match(id, /^[a-z_]{1,24}$/);
    const words = desc.trim().split(/\s+/).length;
    assert.ok(words >= 3 && words <= 15, `Description for ${id} has ${words} words`);
  }
});

test('questions.interrupt: returns choice when >= 2 options', () => {
  const q = questions.interrupt(['continue_task', 'flee']);
  assert.ok(q);
  assert.ok(q.interrupt);
  assert.equal(q.interrupt.type, 'choice');
  assert.deepEqual(Object.keys(q.interrupt.criteria).sort(), ['continue_task', 'flee']);
});

test('questions.interrupt: returns null when < 2 options', () => {
  assert.equal(questions.interrupt(['continue_task']), null);
  assert.equal(questions.interrupt([]), null);
  assert.equal(questions.interrupt(['non_existent']), null);
});

test('questions.next_goal: returns choice when >= 2 options', () => {
  const q = questions.next_goal(['get_wood', 'make_tools']);
  assert.ok(q);
  assert.ok(q.next_goal);
  assert.equal(q.next_goal.type, 'choice');
  assert.deepEqual(Object.keys(q.next_goal.criteria).sort(), ['get_wood', 'make_tools']);
});

test('questions.next_goal: returns null when < 2 options', () => {
  assert.equal(questions.next_goal(['get_wood']), null);
  assert.equal(questions.next_goal([]), null);
});
