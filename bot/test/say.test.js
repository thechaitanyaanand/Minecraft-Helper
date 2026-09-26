'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createSay, splitIntoChunks } = require('../src/chat/say');
const FakeBot = require('./fakeBot');

test('splitIntoChunks splits long text at word boundaries', () => {
  const text = 'word1 word2 word3 word4 word5';
  const chunks = splitIntoChunks(text, 12);
  assert.deepEqual(chunks, ['word1 word2', 'word3 word4', 'word5']);
});

test('say sends message to bot.chat', () => {
  const bot = new FakeBot();
  const say = createSay(bot, { minGapMs: 50 });
  say('hello world');
  assert.equal(bot.chatLog.length, 1);
  assert.equal(bot.chatLog[0], 'hello world');
  say.clear();
});

test('say throttles multiple messages', async () => {
  const bot = new FakeBot();
  const say = createSay(bot, { minGapMs: 50 });
  say('msg 1');
  say('msg 2');

  assert.equal(bot.chatLog.length, 1);
  assert.equal(bot.chatLog[0], 'msg 1');

  await new Promise(r => setTimeout(r, 60));
  assert.equal(bot.chatLog.length, 2);
  assert.equal(bot.chatLog[1], 'msg 2');
  say.clear();
});

test('say drops non-important messages when queue is full', () => {
  const bot = new FakeBot();
  // minGapMs long enough that nothing is processed immediately after first
  const say = createSay(bot, { minGapMs: 500, maxQueue: 2 });
  say('msg 1'); // pops and sends immediately
  say('normal 2'); // in queue [normal 2]
  say('normal 3'); // in queue [normal 2, normal 3]
  say('important 4', { important: true }); // drops oldest non-important (normal 2)

  assert.equal(say.getQueueLength(), 2);
  say.clear();
});
