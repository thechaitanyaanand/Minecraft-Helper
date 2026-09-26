'use strict';
const { DecisionError } = require('./systemone');

/**
 * Normalizes and validates raw SystemOne response against asked questions.
 * @param {object} raw - Parsed JSON response from /v1/systemone
 * @param {object} questions - Questions map passed to decide()
 * @returns {object} Map of normalized answers: { [id]: NormalizedAnswer }
 */
function normalize(raw, questions) {
  if (!raw || typeof raw !== 'object' || !raw.answers || typeof raw.answers !== 'object') {
    throw new DecisionError('malformed response: missing answers object');
  }

  const normalized = {};

  for (const [id, q] of Object.entries(questions)) {
    const a = raw.answers[id];
    if (!a || typeof a !== 'object') {
      throw new DecisionError(`missing answer for question "${id}"`);
    }

    if (a.type !== q.type) {
      throw new DecisionError(`type mismatch for question "${id}": expected "${q.type}", got "${a.type}"`);
    }

    if (q.type === 'choice') {
      if (typeof a.choice !== 'string') {
        throw new DecisionError(`choice for question "${id}" must be a string`);
      }
      if (!q.criteria || !Object.prototype.hasOwnProperty.call(q.criteria, a.choice)) {
        throw new DecisionError(`choice "${a.choice}" for question "${id}" was not in offered criteria`);
      }
      if (typeof a.confidence !== 'number' || !Number.isFinite(a.confidence) || a.confidence < 0 || a.confidence > 1) {
        throw new DecisionError(`confidence for question "${id}" must be finite number in [0, 1]`);
      }
      if (!a.probabilities || typeof a.probabilities !== 'object') {
        throw new DecisionError(`probabilities for question "${id}" must be an object`);
      }

      normalized[id] = {
        type: 'choice',
        choice: a.choice,
        confidence: a.confidence,
        probabilities: a.probabilities,
      };
    } else if (q.type === 'noul') {
      if (typeof a.noul !== 'number' || !Number.isFinite(a.noul) || a.noul < 0 || a.noul > 1) {
        throw new DecisionError(`noul for question "${id}" must be finite number in [0, 1]`);
      }
      normalized[id] = {
        type: 'noul',
        p: a.noul,
      };
    } else if (q.type === 'score') {
      if (typeof a.score !== 'number' || !Number.isFinite(a.score)) {
        throw new DecisionError(`score for question "${id}" must be a finite number`);
      }
      const confidence = typeof a.confidence === 'number' && Number.isFinite(a.confidence) ? a.confidence : 0;
      normalized[id] = {
        type: 'score',
        score: a.score,
        confidence,
        probabilities: a.probabilities || {},
      };
    } else {
      throw new DecisionError(`unknown question type "${q.type}" for question "${id}"`);
    }
  }

  return normalized;
}

module.exports = { normalize };
