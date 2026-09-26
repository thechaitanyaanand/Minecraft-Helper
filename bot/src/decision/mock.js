'use strict';

let heuristics = null;
try {
  heuristics = require('../planner/heuristics');
} catch (_) {
  // heuristics not created yet in Phase 2
}

const INTENT_RULES = [
  { intent: 'explain', regex: /\b(how\b|why\b|what is\b|what's\b|what are\b|explain\b|kaise\b|kya hai\b|batao\b)/i },
  { intent: 'get_wood', regex: /(wood|log|tree|lakdi|lakadi|chop|katna|wod|woood|choping)/i },
  { intent: 'make_tools', regex: /(pickaxe|picaxe|pikaxe|pick|tool|axe|sword|hathoda|banau|banao|craft)/i },
  { intent: 'get_food', regex: /(food|hungry|eat|khana|hunt|bhookh|bhuk|shikar|fod|chiken|khao)/i },
  { intent: 'survive_night', regex: /(night|dark|raat|hide|shelter|safe|zombie|bachao|chupna|dusk)/i },
  { intent: 'follow_me', regex: /\b(follow|piche|saath|aage|chal)\b/i },
  { intent: 'come_here', regex: /\b(come|here|aao|idhar|paas)\b/i },
  { intent: 'give_items', regex: /\b(give|drop|hand over|de do|dedo|saman)\b/i },
  { intent: 'autopilot', regex: /(auto|play for me|what do i do|idk|bored|khel|khelna|kuch karo)\b/i },
  { intent: 'stop', regex: /\b(stop|ruko|ruk|tham|stopp|wait)\b/i },
  { intent: 'status', regex: /\b(status|kya kar rahe|state|info)\b/i },
];

function spreadProbabilities(options, chosen, chosenP) {
  const otherCount = options.length - 1;
  const otherP = otherCount > 0 ? (1 - chosenP) / otherCount : 0;
  const probs = {};
  for (const opt of options) {
    probs[opt] = opt === chosen ? Number(chosenP.toFixed(4)) : Number(otherP.toFixed(4));
  }
  return probs;
}

function mockDecideSync(state, questions) {
  const answers = {};
  const msg = (state && (state.player_message || state.message || '')).trim();

  for (const [id, q] of Object.entries(questions)) {
    if (q.type === 'choice') {
      const options = Object.keys(q.criteria || {});
      if (options.length < 2) continue;

      let chosen = null;
      let conf = 0.8;

      if (id === 'intent') {
        for (const rule of INTENT_RULES) {
          if (rule.regex.test(msg) && options.includes(rule.intent)) {
            chosen = rule.intent;
            conf = 0.9;
            break;
          }
        }
        if (!chosen) {
          chosen = options.includes('unclear') ? 'unclear' : options[0];
          conf = chosen === 'unclear' ? 0.3 : 0.5;
        }
      } else if (id === 'interrupt') {
        if (heuristics && typeof heuristics.interrupt === 'function') {
          chosen = heuristics.interrupt(state, q.criteria);
        } else {
          // Heuristic default
          if (options.includes('flee') && (state?.health <= 6 || state?.nearby?.hostile_mobs?.length > 0)) {
            chosen = 'flee';
          } else if (options.includes('eat_food') && state?.food < 14) {
            chosen = 'eat_food';
          } else if (options.includes('continue_task')) {
            chosen = 'continue_task';
          } else {
            chosen = options[0];
          }
        }
        conf = 0.8;
      } else if (id === 'next_goal') {
        if (heuristics && typeof heuristics.nextGoal === 'function') {
          chosen = heuristics.nextGoal(state, q.criteria);
        } else {
          if (options.includes('survive_night') && (state?.time_of_day === 'night' || state?.time_of_day === 'dusk')) {
            chosen = 'survive_night';
          } else if (options.includes('get_wood')) {
            chosen = 'get_wood';
          } else if (options.includes('make_tools')) {
            chosen = 'make_tools';
          } else if (options.includes('get_food')) {
            chosen = 'get_food';
          } else {
            chosen = options[0];
          }
        }
        conf = 0.8;
      } else {
        chosen = options[0];
      }

      answers[id] = {
        type: 'choice',
        choice: chosen,
        confidence: conf,
        probabilities: spreadProbabilities(options, chosen, conf),
      };
    } else if (q.type === 'noul') {
      let p = 0.1;
      if (id === 'wants_to_learn') {
        p = /(how|learn|teach|why|kaise)/i.test(msg) ? 0.85 : 0.15;
      } else if (id === 'danger') {
        const lowHealth = state?.health !== undefined && state.health <= 6;
        const hostiles = (state?.nearby?.hostile_mobs?.length || 0) > 0 || state?.nearby_mob === 'zombie' || state?.nearby_mob === 'creeper';
        p = lowHealth || hostiles ? 0.85 : 0.1;
      }
      answers[id] = {
        type: 'noul',
        p,
      };
    } else if (q.type === 'score') {
      answers[id] = {
        type: 'score',
        score: 1,
        confidence: 0.8,
        probabilities: {},
      };
    }
  }

  return answers;
}

/**
 * Mock decision backend matching decide() contract.
 * @param {object} state
 * @param {object} questions
 * @returns {Promise<{answers:object, latencyMs:number, backend:string, raw:object}>}
 */
async function mockDecide(state, questions) {
  const start = Date.now();
  const answers = mockDecideSync(state, questions);
  const latencyMs = Math.max(1, Date.now() - start);

  return {
    answers,
    latencyMs,
    backend: 'mock',
    raw: { model: 'mock', answers },
  };
}

module.exports = { mockDecide, mockDecideSync };
