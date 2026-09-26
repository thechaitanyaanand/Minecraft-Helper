'use strict';

function splitIntoChunks(text, maxLen = 240) {
  if (text.length <= maxLen) return [text];
  const words = text.split(' ');
  const chunks = [];
  let current = '';

  for (const word of words) {
    if (!current) {
      current = word;
    } else if (current.length + 1 + word.length <= maxLen) {
      current += ' ' + word;
    } else {
      chunks.push(current);
      current = word;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

function createSay(bot, { minGapMs = 1200, maxLen = 240, maxQueue = 10 } = {}) {
  const queue = [];
  let timer = null;
  let lastSentTime = 0;

  function processQueue() {
    if (!queue.length) {
      timer = null;
      return;
    }

    const now = Date.now();
    const wait = Math.max(0, minGapMs - (now - lastSentTime));

    if (wait > 0) {
      if (!timer) {
        timer = setTimeout(processQueue, wait);
      }
      return;
    }

    const item = queue.shift();
    lastSentTime = Date.now();
    if (bot && typeof bot.chat === 'function') {
      bot.chat(item.text);
    }

    if (queue.length > 0) {
      timer = setTimeout(processQueue, minGapMs);
    } else {
      timer = null;
    }
  }

  function say(text, { important = false } = {}) {
    if (!text || typeof text !== 'string') return;
    const clean = text.replace(/[\r\n]+/g, ' ').trim();
    if (!clean) return;

    const chunks = splitIntoChunks(clean, maxLen);
    for (const chunk of chunks) {
      if (queue.length >= maxQueue) {
        // Drop oldest non-important item
        const dropIdx = queue.findIndex(item => !item.important);
        if (dropIdx !== -1) {
          queue.splice(dropIdx, 1);
        } else if (!important) {
          // If all in queue are important and this isn't important, drop this chunk
          continue;
        }
      }
      queue.push({ text: chunk, important });
    }

    processQueue();
  }

  say.clear = () => {
    queue.length = 0;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };

  say.getQueueLength = () => queue.length;

  return say;
}

module.exports = { createSay, splitIntoChunks };
