'use strict';
const http = require('http');

function listenForDecision(timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const req = http.get('http://127.0.0.1:3000/events', (res) => {
      let buffer = '';
      const timer = setTimeout(() => {
        req.destroy();
        reject(new Error(`Timeout waiting for decision event after ${timeoutMs}ms`));
      }, timeoutMs);

      res.on('data', (chunk) => {
        buffer += chunk.toString();
        const lines = buffer.split('\n\n');
        buffer = lines.pop(); // keep remainder

        for (const block of lines) {
          if (block.includes('event: decision')) {
            const dataLine = block.split('\n').find((l) => l.startsWith('data: '));
            if (dataLine) {
              try {
                const parsed = JSON.parse(dataLine.slice(6));
                clearTimeout(timer);
                req.destroy();
                resolve(parsed);
                return;
              } catch (_) {}
            }
          }
        }
      });
    });

    req.on('error', reject);
  });
}

async function run() {
  console.log('Listening to live view on http://127.0.0.1:3000/events...');
  console.log('Ready for in-game or simulated decision.');
}

if (require.main === module) {
  run();
}

module.exports = { listenForDecision };
