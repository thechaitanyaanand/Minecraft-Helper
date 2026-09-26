'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mockDecide } = require('../src/decision/mock');
const questions = require('../src/decision/questions');

test('mockDecide: keyword intent rules', async () => {
  const q = questions.intent();

  const cases = [
    { msg: 'i need wood', expected: 'get_wood' },
    { msg: 'chop this tree', expected: 'get_wood' },
    { msg: 'lakdi chahiye', expected: 'get_wood' },
    { msg: 'make me a pickaxe', expected: 'make_tools' },
    { msg: 'craft an axe', expected: 'make_tools' },
    { msg: 'im hungry', expected: 'get_food' },
    { msg: 'khana lao', expected: 'get_food' },
    { msg: 'its dark outside', expected: 'survive_night' },
    { msg: 'raat ho gayi', expected: 'survive_night' },
    { msg: 'follow me please', expected: 'follow_me' },
    { msg: 'come here', expected: 'come_here' },
    { msg: 'stop right now', expected: 'stop' },
    { msg: 'play for me', expected: 'autopilot' },
    { msg: 'how do i craft a bed', expected: 'explain' },
    { msg: 'random gibberish xyz', expected: 'unclear' },
  ];

  for (const c of cases) {
    const res = await mockDecide({ player_message: c.msg }, q);
    assert.equal(res.backend, 'mock');
    assert.equal(res.answers.intent.choice, c.expected, `Failed for message: "${c.msg}"`);
    if (c.expected === 'unclear') {
      assert.equal(res.answers.intent.confidence, 0.3);
    } else {
      assert.equal(res.answers.intent.confidence, 0.9);
    }

    // Probabilities sum to ~1
    const sum = Object.values(res.answers.intent.probabilities).reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(sum - 1.0) < 0.05, `Sum ${sum} not close to 1.0`);
  }
});

test('mockDecide: wants_to_learn noul probability', async () => {
  const q = questions.intent();

  const learnRes = await mockDecide({ player_message: 'how do i make planks' }, q);
  assert.ok(learnRes.answers.wants_to_learn.p > 0.6);

  const directRes = await mockDecide({ player_message: 'give me planks' }, q);
  assert.ok(directRes.answers.wants_to_learn.p < 0.3);
});

test('mockDecide: danger noul in interrupt / state', async () => {
  const q = {
    danger: {
      type: 'noul',
      instructions: 'Is danger present?',
      criteria: { true: 'danger', false: 'safe' },
    },
  };

  const dangerRes = await mockDecide({ health: 4 }, q);
  assert.ok(dangerRes.answers.danger.p > 0.7);

  const safeRes = await mockDecide({ health: 20 }, q);
  assert.ok(safeRes.answers.danger.p < 0.3);
});
