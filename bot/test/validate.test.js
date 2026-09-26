'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { normalize } = require('../src/decision/validate');
const { DecisionError } = require('../src/decision/systemone');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'systemone_response_example.json');
const fixture = JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf8'));

const questions = {
  intent: {
    type: 'choice',
    instructions: 'What does the player want?',
    criteria: {
      get_wood: 'collect wood / logs / trees',
      get_food: 'find or make food',
      unclear: 'unclear message',
    },
  },
  danger: {
    type: 'noul',
    instructions: 'Is the player in immediate danger?',
    criteria: { true: 'danger close', false: 'safe' },
  },
};

test('normalize: validates and normalizes real fixture', () => {
  const norm = normalize(fixture, questions);

  assert.equal(norm.intent.type, 'choice');
  assert.equal(norm.intent.choice, 'get_wood');
  assert.equal(norm.intent.confidence, 0.9342);
  assert.deepEqual(norm.intent.probabilities, fixture.answers.intent.probabilities);

  assert.equal(norm.danger.type, 'noul');
  assert.equal(norm.danger.p, 0.1408);
});

test('normalize: rejects choice not offered in criteria', () => {
  const broken = JSON.parse(JSON.stringify(fixture));
  broken.answers.intent.choice = 'unoffered_action';

  assert.throws(
    () => normalize(broken, questions),
    (err) => {
      assert.ok(err instanceof DecisionError);
      assert.match(err.message, /not in offered criteria/);
      return true;
    }
  );
});

test('normalize: rejects type mismatch', () => {
  const broken = JSON.parse(JSON.stringify(fixture));
  broken.answers.intent.type = 'noul';

  assert.throws(
    () => normalize(broken, questions),
    (err) => {
      assert.ok(err instanceof DecisionError);
      assert.match(err.message, /type mismatch/);
      return true;
    }
  );
});

test('normalize: rejects missing answer for question', () => {
  const broken = JSON.parse(JSON.stringify(fixture));
  delete broken.answers.danger;

  assert.throws(
    () => normalize(broken, questions),
    (err) => {
      assert.ok(err instanceof DecisionError);
      assert.match(err.message, /missing answer for question "danger"/);
      return true;
    }
  );
});

test('normalize: rejects invalid confidence', () => {
  const broken = JSON.parse(JSON.stringify(fixture));
  broken.answers.intent.confidence = 1.5; // > 1

  assert.throws(
    () => normalize(broken, questions),
    (err) => {
      assert.ok(err instanceof DecisionError);
      assert.match(err.message, /confidence.*must be finite number in \[0, 1\]/);
      return true;
    }
  );
});

test('normalize: rejects invalid noul', () => {
  const broken = JSON.parse(JSON.stringify(fixture));
  broken.answers.danger.noul = -0.1; // < 0

  assert.throws(
    () => normalize(broken, questions),
    (err) => {
      assert.ok(err instanceof DecisionError);
      assert.match(err.message, /noul.*must be finite number in \[0, 1\]/);
      return true;
    }
  );
});

test('normalize: rejects malformed response without answers', () => {
  assert.throws(
    () => normalize({}, questions),
    (err) => {
      assert.ok(err instanceof DecisionError);
      assert.match(err.message, /missing answers object/);
      return true;
    }
  );
});
