'use strict';

class CancelledError extends Error {
  constructor(reason) { super(`cancelled: ${reason}`); this.name = 'CancelledError'; this.reason = reason; }
}

class CancelToken {
  constructor() { this.cancelled = false; this.reason = null; this._handlers = []; }
  cancel(reason = 'cancelled') {
    if (this.cancelled) return;
    this.cancelled = true; this.reason = reason;
    for (const h of this._handlers) { try { h(reason); } catch (_) { /* ignore */ } }
  }
  onCancel(fn) { if (this.cancelled) fn(this.reason); else this._handlers.push(fn); }
  throwIfCancelled() { if (this.cancelled) throw new CancelledError(this.reason); }
}

module.exports = { CancelToken, CancelledError };
