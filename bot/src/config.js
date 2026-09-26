'use strict';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });

function parseNumber(val, defaultVal, name) {
  if (val === undefined || val === null || val === '') return defaultVal;
  const num = Number(val);
  if (!Number.isFinite(num)) {
    throw new Error(`Config error: ${name} must be a finite number, got "${val}"`);
  }
  return num;
}

const ownerName = process.env.OWNER_NAME;
if (!ownerName || ownerName === 'CHANGE_ME') {
  throw new Error('Config error: OWNER_NAME is missing or set to CHANGE_ME in .env');
}

const backend = (process.env.DECISION_BACKEND || 'mock').toLowerCase();
if (!['mock', 'local', 'jev'].includes(backend)) {
  throw new Error(`Config error: DECISION_BACKEND must be mock, local, or jev, got "${backend}"`);
}

const confAct = parseNumber(process.env.CONF_ACT, 0.70, 'CONF_ACT');
const confAsk = parseNumber(process.env.CONF_ASK, 0.45, 'CONF_ASK');
if (confAsk >= confAct) {
  throw new Error(`Config error: CONF_ASK (${confAsk}) must be less than CONF_ACT (${confAct})`);
}

const jevBaseUrl = process.env.JEV_BASE_URL || '';
const jevApiKey = process.env.JEV_API_KEY || '';
if (backend === 'jev' && (!jevBaseUrl || !jevApiKey)) {
  throw new Error('Config error: JEV_BASE_URL and JEV_API_KEY are required when DECISION_BACKEND is jev');
}

const prefixes = (process.env.CHAT_PREFIXES || 'helper,!,@helper')
  .split(',')
  .map(p => p.trim())
  .filter(Boolean);

const config = Object.freeze({
  mc: Object.freeze({
    host: process.env.MC_HOST || '127.0.0.1',
    port: parseNumber(process.env.MC_PORT, 25565, 'MC_PORT'),
    version: process.env.MC_VERSION || '1.20.4',
    username: process.env.BOT_USERNAME || 'Helper',
  }),
  ownerName,
  chatPrefixes: Object.freeze(prefixes),
  decision: Object.freeze({
    backend,
    timeoutMs: parseNumber(process.env.DECISION_TIMEOUT_MS, 4000, 'DECISION_TIMEOUT_MS'),
    confAct,
    confAsk,
    local: Object.freeze({
      baseUrl: process.env.LOCAL_BASE_URL || 'http://127.0.0.1:8000',
      model: process.env.LOCAL_MODEL || '',
    }),
    jev: Object.freeze({
      baseUrl: jevBaseUrl,
      apiKey: jevApiKey,
      model: process.env.JEV_MODEL || '',
      authHeader: process.env.JEV_AUTH_HEADER || 'Authorization',
      maxCallsPerMin: parseNumber(process.env.JEV_MAX_CALLS_PER_MIN, 30, 'JEV_MAX_CALLS_PER_MIN'),
    }),
  }),
  webPort: parseNumber(process.env.WEB_PORT, 3000, 'WEB_PORT'),
  log: Object.freeze({
    dir: process.env.LOG_DIR || '../logs',
    decisions: process.env.LOG_DECISIONS === 'true',
  }),
});

module.exports = config;
