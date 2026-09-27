'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createDecider } = require('../src/decision/index');
const questions = require('../src/decision/questions');
const log = require('../src/log');

log.logDecision = () => {};

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'systemone_response_example.json');
const fixture = JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf8'));

test('createDecider: mock backend returns mock answers', async () => {
  const cfg = {
    decision: {
      backend: 'mock',
      timeoutMs: 1000,
    },
  };

  const decider = createDecider(cfg);
  const q = questions.intent();
  const res = await decider.decide({ player_message: 'i need wood' }, q, { purpose: 'intent' });

  assert.equal(res.backend, 'mock');
  assert.equal(res.fallback, false);
  assert.equal(res.answers.intent.choice, 'get_wood');
});

test('createDecider: local backend with successful client', async () => {
  const fakeClient = async () => fixture;
  const cfg = {
    decision: {
      backend: 'local',
      timeoutMs: 1000,
      local: { baseUrl: 'http://127.0.0.1:8000' },
    },
  };

  const decider = createDecider(cfg, { client: fakeClient });
  const q = {
    intent: {
      type: 'choice',
      instructions: 'What do they want?',
      criteria: {
        get_wood: 'collect wood',
        get_food: 'find food',
        unclear: 'unclear',
      },
    },
    danger: {
      type: 'noul',
      instructions: 'Is danger present?',
      criteria: { true: 'danger', false: 'safe' },
    },
  };

  const res = await decider.decide({ player_message: 'i need wood' }, q, { purpose: 'intent' });
  assert.equal(res.backend, 'local');
  assert.equal(res.fallback, false);
  assert.equal(res.answers.intent.choice, 'get_wood');
  assert.equal(res.answers.intent.confidence, 0.9342);
  assert.equal(res.answers.danger.p, 0.1408);
});

test('createDecider: local backend falls back to mock on client error', async () => {
  const failingClient = async () => {
    throw new Error('Connection refused to decision server');
  };
  const cfg = {
    decision: {
      backend: 'local',
      timeoutMs: 1000,
      local: { baseUrl: 'http://127.0.0.1:8000' },
    },
  };

  const decider = createDecider(cfg, { client: failingClient });
  const q = questions.intent();

  const res = await decider.decide({ player_message: 'i need wood' }, q, { purpose: 'intent' });
  assert.equal(res.backend, 'local');
  assert.equal(res.fallback, true);
  assert.equal(res.answers.intent.choice, 'get_wood'); // mock matched keyword

  const st = decider.status();
  assert.equal(st.backend, 'local');
  assert.match(st.lastError, /Connection refused/);
});

test('createDecider: jev backend falls back to mock on rate limit cap', async () => {
  let callCount = 0;
  const fakeJevClient = async () => {
    callCount++;
    return {
      ...fixture,
      answers: {
        ...fixture.answers,
        wants_to_learn: { type: 'noul', noul: 0.1 },
      },
    };
  };

  const cfg = {
    decision: {
      backend: 'jev',
      timeoutMs: 1000,
      jev: {
        baseUrl: 'https://api.jev.ai',
        apiKey: 'secret',
        maxCallsPerMin: 2,
      },
    },
  };

  const decider = createDecider(cfg, { client: fakeJevClient });
  const q = questions.intent();

  // Call 1 & 2 succeed
  const r1 = await decider.decide({ player_message: 'get wood' }, q);
  const r2 = await decider.decide({ player_message: 'get wood' }, q);
  assert.equal(r1.fallback, false);
  assert.equal(r2.fallback, false);
  assert.equal(callCount, 2);

  // Call 3 exceeds maxCallsPerMin (2), triggers mock fallback without calling client
  const r3 = await decider.decide({ player_message: 'get wood' }, q);
  assert.equal(r3.fallback, true);
  assert.equal(r3.answers.intent.choice, 'get_wood');
  assert.equal(callCount, 2);
  assert.equal(decider.status().lastError, 'rate_limit_cap');
});

test('createDecider: slot questions resolve verb and category correctly', async () => {
  const cfg = { decision: { backend: 'mock', timeoutMs: 1000 } };
  const decider = createDecider(cfg);
  const q = questions.slots();
  const res = await decider.decide({ player_message: 'helper get 10 oak planks' }, q);

  assert.equal(res.answers.verb.choice, 'obtain');
  assert.equal(res.answers.category.choice, 'wood');
});

