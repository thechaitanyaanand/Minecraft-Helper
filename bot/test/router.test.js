'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createRouter } = require('../src/chat/router');

test('router ignores messages from the bot itself', () => {
  let called = false;
  const router = createRouter({
    botUsername: 'Helper',
    ownerName: 'Steve',
    onCommand: () => { called = true; },
    onIntentText: () => { called = true; },
  });

  router('Helper', '!help');
  assert.equal(called, false);
});

test('router ignores messages from non-owner players', () => {
  let called = false;
  const router = createRouter({
    botUsername: 'Helper',
    ownerName: 'Steve',
    onCommand: () => { called = true; },
    onIntentText: () => { called = true; },
  });

  router('Griefer', '!help');
  router('Stranger', 'helper get wood');
  assert.equal(called, false);
});

test('router parses !commands for owner', () => {
  const commands = [];
  const router = createRouter({
    botUsername: 'Helper',
    ownerName: 'Steve',
    onCommand: (cmd, rest) => { commands.push({ cmd, rest }); },
  });

  router('Steve', '!help');
  router('Steve', '!come to me');
  router('Steve', '!STOP');

  assert.deepEqual(commands, [
    { cmd: 'help', rest: '' },
    { cmd: 'come', rest: 'to me' },
    { cmd: 'stop', rest: '' },
  ]);
});

test('router parses prefix intent text', () => {
  const intents = [];
  const router = createRouter({
    botUsername: 'Helper',
    ownerName: 'Steve',
    prefixes: ['helper', '!', '@helper'],
    onIntentText: (text) => { intents.push(text); },
  });

  router('Steve', 'helper i need wood');
  router('Steve', 'Helper: make me a pickaxe');
  router('Steve', '@helper, get food');

  assert.deepEqual(intents, [
    'i need wood',
    'make me a pickaxe',
    'get food',
  ]);
});

test('router handles yes/no/1/2/3 when pendingQuestion is active', () => {
  const commands = [];
  let pending = true;
  const router = createRouter({
    botUsername: 'Helper',
    ownerName: 'Steve',
    getPendingQuestion: () => pending,
    onCommand: (cmd, rest) => { commands.push({ cmd, rest }); },
  });

  router('Steve', 'yes');
  router('Steve', '2');

  pending = false;
  router('Steve', 'yes'); // should be ignored now

  assert.deepEqual(commands, [
    { cmd: 'yes', rest: '' },
    { cmd: '2', rest: '' },
  ]);
});

test('router ignores regular chat without prefix or command', () => {
  let called = false;
  const router = createRouter({
    botUsername: 'Helper',
    ownerName: 'Steve',
    onCommand: () => { called = true; },
    onIntentText: () => { called = true; },
  });

  router('Steve', 'hello world, this is normal chat');
  assert.equal(called, false);
});

test('router parses prefix at end of message', () => {
  const intents = [];
  const router = createRouter({
    botUsername: 'Helper',
    ownerName: 'Steve',
    prefixes: ['helper', '!', '@helper'],
    onIntentText: (text) => { intents.push(text); },
  });

  router('Steve', 'follow me helper');
  router('Steve', 'give me food, helper');
  router('Steve', 'stop following me and give me food helper');

  assert.deepEqual(intents, [
    'follow me',
    'give me food',
    'stop following me and give me food',
  ]);
});
