'use strict';
const log = require('../log');
const { createSystemOneClient } = require('./systemone');
const { normalize } = require('./validate');
const { mockDecide } = require('./mock');

/**
 * Creates the decider adapter.
 * @param {object} cfg - Config object (see config.js)
 * @param {object} [injected] - Optional dependencies for testing ({ client })
 */
function createDecider(cfg, injected = {}) {
  const backend = cfg.decision.backend;
  let client = injected.client || null;

  if (!client) {
    if (backend === 'local') {
      client = createSystemOneClient({
        baseUrl: cfg.decision.local.baseUrl,
        model: cfg.decision.local.model || undefined,
        timeoutMs: cfg.decision.timeoutMs,
      });
    } else if (backend === 'jev') {
      client = createSystemOneClient({
        baseUrl: cfg.decision.jev.baseUrl,
        apiKey: cfg.decision.jev.apiKey,
        authHeader: cfg.decision.jev.authHeader,
        model: cfg.decision.jev.model || undefined,
        timeoutMs: cfg.decision.timeoutMs,
      });
    }
  }

  let lastLatencyMs = 0;
  let lastError = null;

  /**
   * Decide action based on state and questions.
   * @param {object} state
   * @param {object} questions
   * @param {object} [meta] - { purpose, goal, heuristicPick }
   */
  async function decide(state, questions, meta = {}) {
    const t0 = Date.now();
    let answers = null;
    let fallback = false;

    if (backend === 'mock' || !client) {
      const res = await mockDecide(state, questions);
      answers = res.answers;
      lastLatencyMs = Math.max(1, Date.now() - t0);
    } else {
      try {
        const raw = await client(state, questions);
        answers = normalize(raw, questions);
        lastLatencyMs = Math.max(1, Date.now() - t0);
        lastError = null;
      } catch (err) {
        log.warn(`Decision backend (${backend}) failed, falling back to mock:`, err.message);
        lastError = err.message;
        fallback = true;
        const res = await mockDecide(state, questions);
        answers = res.answers;
        lastLatencyMs = Math.max(1, Date.now() - t0);
      }
    }

    log.logDecision({
      backend,
      fallback,
      latencyMs: lastLatencyMs,
      meta,
      state,
      answers,
    });

    return {
      answers,
      latencyMs: lastLatencyMs,
      backend,
      fallback,
    };
  }

  function status() {
    return {
      backend,
      lastLatencyMs,
      lastError,
    };
  }

  return { decide, status };
}

module.exports = { createDecider };
