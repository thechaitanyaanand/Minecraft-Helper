'use strict';
const http = require('http');
const config = require('../src/config');
const { createDecider } = require('../src/decision');
const questions = require('../src/decision/questions');

async function main() {
  console.log('1. Testing local backend...');
  const decider = createDecider(config);
  const q = questions.intent();

  // Test 1: with local backend running
  const res1 = await decider.decide({ player_message: 'i need wood' }, q, { purpose: 'intent' });
  console.log('Decision 1:', {
    backend: res1.backend,
    fallback: res1.fallback,
    choice: res1.answers.intent.choice,
    confidence: res1.answers.intent.confidence,
    latencyMs: res1.latencyMs,
  });

  if (res1.backend !== 'local' || res1.fallback !== false) {
    throw new Error(`Expected backend local and fallback false, got ${res1.backend} and ${res1.fallback}`);
  }

  console.log('Local backend test PASSED.');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
