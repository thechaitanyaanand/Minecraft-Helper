'use strict';
const fs = require('fs');
const path = require('path');
const config = require('./config');

const logDir = path.resolve(__dirname, '..', config.log.dir);
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

const decisionsFile = path.join(logDir, 'decisions.jsonl');
const botLogFile = path.join(logDir, 'bot.log');

function timestamp() {
  return new Date().toISOString();
}

function writeBotLog(level, ...args) {
  const line = `[${timestamp()}] [${level}] ${args.map(a => (typeof a === 'object' ? JSON.stringify(a) : a)).join(' ')}\n`;
  try {
    fs.appendFileSync(botLogFile, line);
  } catch (_) {
    // best-effort
  }
}

const logger = {
  info(...args) {
    console.log(`[INFO]`, ...args);
    writeBotLog('INFO', ...args);
  },
  warn(...args) {
    console.warn(`[WARN]`, ...args);
    writeBotLog('WARN', ...args);
  },
  error(...args) {
    console.error(`[ERROR]`, ...args);
    writeBotLog('ERROR', ...args);
  },
  onDecision: null,   // set by index.js to mirror decisions to the live view
  logDecision(entry) {
    const cleanEntry = {
      ts: timestamp(),
      ...entry,
    };
    if (logger.onDecision) logger.onDecision(cleanEntry);
    if (!config.log.decisions) return;
    // Ensure no API keys are ever logged (split/join: keys may contain regex characters)
    const key = config.decision.jev.apiKey;
    let str = JSON.stringify(cleanEntry);
    if (key) str = str.split(key).join('[REDACTED]');
    str += '\n';
    try {
      fs.appendFileSync(decisionsFile, str);
    } catch (err) {
      console.error('[logDecision error]', err.message);
    }
  },
};

module.exports = logger;
