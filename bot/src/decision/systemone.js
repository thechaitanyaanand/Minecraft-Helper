'use strict';

class DecisionError extends Error {
  constructor(msg, { status, body } = {}) {
    super(msg);
    this.name = 'DecisionError';
    this.status = status;
    this.body = body;
  }
}

/**
 * @param {{baseUrl:string, apiKey?:string, authHeader?:string, model?:string, timeoutMs:number}} opts
 */
function createSystemOneClient(opts) {
  if (!opts || !opts.baseUrl) throw new Error('systemone: baseUrl required');
  const url = opts.baseUrl.replace(/\/+$/, '') + '/v1/systemone';

  return async function call(state, questions) {
    const headers = { 'content-type': 'application/json' };
    if (opts.apiKey) {
      const h = opts.authHeader || 'Authorization';
      headers[h] = h.toLowerCase() === 'authorization' ? `Bearer ${opts.apiKey}` : opts.apiKey;
    }
    const body = { state, questions, independent: true };
    if (opts.model) body.model = opts.model;

    let res;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(opts.timeoutMs),
      });
    } catch (e) {
      throw new DecisionError(`network/timeout: ${e.name}: ${e.message}`);
    }
    const text = await res.text();
    if (!res.ok) throw new DecisionError(`HTTP ${res.status}`, { status: res.status, body: text.slice(0, 500) });
    try {
      return JSON.parse(text);
    } catch {
      throw new DecisionError('invalid JSON from decision server', { body: text.slice(0, 500) });
    }
  };
}

module.exports = { createSystemOneClient, DecisionError };
