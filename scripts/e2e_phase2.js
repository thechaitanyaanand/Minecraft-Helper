'use strict';
const { execSync } = require('child_process');
const config = require('../bot/src/config');
const log = require('../bot/src/log');
const { createDecider } = require('../bot/src/decision');
const questions = require('../bot/src/decision/questions');

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function run() {
  console.log('--- Phase 2 E2E Verification ---');
  let latestDecision = null;
  log.onDecision = (entry) => {
    latestDecision = entry;
  };

  const decider = createDecider(config);
  const q = questions.intent();

  // Test 1: Local Decider running
  console.log('Test 1: Querying local Decider with "i need wood"...');
  const res1 = await decider.decide({ player_message: 'i need wood' }, q, { purpose: 'intent' });

  console.log('Result 1:', {
    backend: res1.backend,
    fallback: res1.fallback,
    latencyMs: res1.latencyMs,
    choice: res1.answers?.intent?.choice,
    confidence: res1.answers?.intent?.confidence,
  });
  console.log('Logged Decision 1:', {
    backend: latestDecision?.backend,
    fallback: latestDecision?.fallback,
    choice: latestDecision?.answers?.intent?.choice,
  });

  if (res1.backend !== 'local' || res1.fallback !== false) {
    throw new Error('Test 1 failed: Expected local backend with fallback=false');
  }
  if (!latestDecision || latestDecision.fallback !== false) {
    throw new Error('Test 1 failed: Logged decision mismatch');
  }
  if (res1.answers.intent.choice !== 'get_wood') {
    throw new Error(`Test 1 failed: Expected get_wood, got ${res1.answers.intent.choice}`);
  }
  console.log('✓ Test 1 PASSED: Local Decider works, classifies correctly, logs without fallback.\n');

  // Test 2: Stop WSL Decider -> fallback=true
  console.log('Test 2: Stopping WSL Decider process...');
  execSync('wsl -d Debian pkill -9 -f uvicorn || true');
  await sleep(1000);

  console.log('Querying with WSL Decider stopped...');
  const res2 = await decider.decide({ player_message: 'i need wood' }, q, { purpose: 'intent' });

  console.log('Result 2:', {
    backend: res2.backend,
    fallback: res2.fallback,
    latencyMs: res2.latencyMs,
    choice: res2.answers?.intent?.choice,
    confidence: res2.answers?.intent?.confidence,
  });
  console.log('Logged Decision 2:', {
    backend: latestDecision?.backend,
    fallback: latestDecision?.fallback,
    choice: latestDecision?.answers?.intent?.choice,
  });

  if (res2.fallback !== true) {
    throw new Error('Test 2 failed: Expected fallback=true when WSL Decider is stopped');
  }
  if (!latestDecision || latestDecision.fallback !== true) {
    throw new Error('Test 2 failed: Logged decision did not show fallback=true');
  }
  if (res2.answers.intent.choice !== 'get_wood') {
    throw new Error(`Test 2 failed: Expected mock get_wood, got ${res2.answers.intent.choice}`);
  }
  console.log('✓ Test 2 PASSED: Fallback triggers cleanly to mock.\n');

  // Test 3: Restart WSL Decider -> recovers to local
  console.log('Test 3: Restarting WSL Decider...');
  execSync('powershell.exe -Command "Start-Process wsl -ArgumentList \'-d\', \'Debian\', \'bash\', \'/mnt/c/Users/ChaitanyaAnand/Documents/GitHub/System1-Applications/decider-server/start_wsl.sh\' -WindowStyle Hidden"');

  // Poll health until back up
  let ready = false;
  for (let i = 0; i < 20; i++) {
    await sleep(1500);
    try {
      const res = await fetch('http://127.0.0.1:8000/health', { signal: AbortSignal.timeout(1000) });
      if (res.ok) {
        ready = true;
        break;
      }
    } catch (_) {}
  }

  if (!ready) {
    throw new Error('WSL Decider failed to recover within 30s');
  }
  console.log('WSL Decider is back online!');

  const res3 = await decider.decide({ player_message: 'i need wood' }, q, { purpose: 'intent' });

  console.log('Result 3:', {
    backend: res3.backend,
    fallback: res3.fallback,
    latencyMs: res3.latencyMs,
    choice: res3.answers?.intent?.choice,
    confidence: res3.answers?.intent?.confidence,
  });
  console.log('Logged Decision 3:', {
    backend: latestDecision?.backend,
    fallback: latestDecision?.fallback,
    choice: latestDecision?.answers?.intent?.choice,
  });

  if (res3.backend !== 'local' || res3.fallback !== false) {
    throw new Error('Test 3 failed: Expected recovery to local backend with fallback=false');
  }
  console.log('✓ Test 3 PASSED: Decider recovered to local backend.\n');

  console.log('ALL PHASE 2 E2E CHECKS PASSED SUCCESSFULLY!');
}

run().catch((err) => {
  console.error('E2E Check Failed:', err);
  process.exit(1);
});
