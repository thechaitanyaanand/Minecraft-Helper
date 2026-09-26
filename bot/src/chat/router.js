'use strict';

function createRouter({
  botUsername = 'Helper',
  ownerName,
  prefixes = ['helper', '!', '@helper'],
  onCommand,
  onIntentText,
  getPendingQuestion,
}) {
  if (!ownerName) throw new Error('createRouter: ownerName required');

  return function handleChat(username, rawMessage) {
    // 1. Ignore messages from the bot itself
    if (username === botUsername) return;

    // 2. Ignore messages from anyone except ownerName (exact match)
    if (username !== ownerName) return;

    const trimmed = (rawMessage || '').trim();
    if (!trimmed) return;

    // 3. If starts with '!', it is a command
    if (trimmed.startsWith('!')) {
      const parts = trimmed.slice(1).trim().split(/\s+/);
      const cmd = parts[0].toLowerCase();
      const rest = parts.slice(1).join(' ');
      if (typeof onCommand === 'function') {
        onCommand(cmd, rest);
      }
      return;
    }

    // 5. Plain yes/no/1/2/3 while a question is pending counts as command
    const lower = trimmed.toLowerCase();
    const isConfirmation = ['yes', 'no', '1', '2', '3'].includes(lower);
    if (isConfirmation && typeof getPendingQuestion === 'function' && getPendingQuestion()) {
      if (typeof onCommand === 'function') {
        onCommand(lower, '');
      }
      return;
    }

    // 4. Check if it starts with one of the prefixes
    for (const prefix of prefixes) {
      if (prefix === '!') continue; // Already handled above
      const pLower = prefix.toLowerCase();
      if (lower.startsWith(pLower)) {
        const nextChar = trimmed[pLower.length];
        if (nextChar === undefined || nextChar === ' ' || nextChar === ',' || nextChar === ':') {
          const rest = trimmed.slice(pLower.length).replace(/^[\s,:]+/, '').trim();
          if (rest && typeof onIntentText === 'function') {
            onIntentText(rest);
          }
          return;
        }
      }
    }

    // 6. Anything else: ignore
  };
}

module.exports = { createRouter };
