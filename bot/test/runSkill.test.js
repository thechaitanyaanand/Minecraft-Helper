'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { runSkill } = require('../src/skills/runSkill');
const { CancelToken } = require('../src/cancel');
const FakeBot = require('./fakeBot');

test('runSkill: success returns ok and duration', async () => {
  const bot = new FakeBot();
  const parentToken = new CancelToken();
  const skill = {
    name: 'test_success',
    timeoutMs: 5000,
    run: async (b, ctx, token, args) => ({ ok: true, message: `worked: ${args.x}` }),
  };

  const res = await runSkill(skill, bot, {}, parentToken, { x: 42 });
  assert.equal(res.ok, true);
  assert.equal(res.message, 'worked: 42');
  assert.ok(res.durationMs >= 0);
});

test('runSkill: cancel from parent cancels child and triggers cleanup', async () => {
  const bot = new FakeBot();
  const parentToken = new CancelToken();
  let cleanupCalled = false;
  bot.pathfinder.stop = () => { cleanupCalled = true; };

  const skill = {
    name: 'test_cancel',
    timeoutMs: 5000,
    run: async (b, ctx, token) => {
      await new Promise((r) => setTimeout(r, 20));
      token.throwIfCancelled();
      return { ok: true };
    },
  };

  const promise = runSkill(skill, bot, {}, parentToken);
  parentToken.cancel('user stopped');
  const res = await promise;

  assert.equal(res.ok, false);
  assert.equal(res.reason, 'user stopped');
  assert.equal(cleanupCalled, true);
});

test('runSkill: thrown error is caught and returns reason error', async () => {
  const bot = new FakeBot();
  const skill = {
    name: 'test_error',
    timeoutMs: 5000,
    run: async () => {
      throw new Error('Something broke inside skill');
    },
  };

  const res = await runSkill(skill, bot, {}, new CancelToken());
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'error');
  assert.match(res.message, /Something broke/);
});

test('runSkill: timeout cancels skill with reason timeout', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] });
  const bot = new FakeBot();
  const skill = {
    name: 'test_timeout',
    timeoutMs: 100,
    run: async (b, ctx, token) => {
      await new Promise((r) => setTimeout(r, 500));
      token.throwIfCancelled();
      return { ok: true };
    },
  };

  const promise = runSkill(skill, bot, {}, new CancelToken());
  t.mock.timers.tick(150);
  t.mock.timers.tick(400);
  const res = await promise;

  assert.equal(res.ok, false);
  assert.equal(res.reason, 'timeout');
  t.mock.timers.reset();
});

test('runSkill: stuck detector cancels when pathfinder isMoving but distance < 0.5 for 15s', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] });
  const bot = new FakeBot();
  bot.pathfinder.isMoving = () => true;
  bot.entity.position = { x: 0, y: 64, z: 0 };

  const skill = {
    name: 'test_stuck',
    timeoutMs: 60000,
    run: async (b, ctx, token) => {
      // Long running loop that checks token
      for (let i = 0; i < 20; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        token.throwIfCancelled();
      }
      return { ok: true };
    },
  };

  const promise = runSkill(skill, bot, {}, new CancelToken());

  // Tick past 15s (5 ticks of 3s)
  for (let i = 0; i < 6; i++) {
    t.mock.timers.tick(3000);
  }

  const res = await promise;
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'stuck');
  t.mock.timers.reset();
});
