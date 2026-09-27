'use strict';
let heuristics = null;
try { heuristics = require('../planner/heuristics'); } catch (_) {}

const ADVERSARIAL_REGEX = /\b(ignore|disregard|jailbreak|swear|bypass|system prompt)\b/i;
const INTENT_RULES = [
  { intent: 'stop', regex: /\b(stop|ruko|ruk|tham|stopp|wait|halt|freeze|cancel)\b/i },
  { intent: 'status', regex: /\b(status|kya kar rahe|state|info|health|food do you have|how are you|what are you doing|what you are doing|current status|hal batao)\b/i },
  { intent: 'give_items', regex: /\b(give|drop|hand over|de do|dedo|saman|inventory|toss|maal|giv itms)\b/i },
  { intent: 'explain', regex: /\b(how\b|why\b|what is\b|what's\b|what are\b|what happens\b|explain\b|kaise\b|kya hai\b|kya kaam\b|kya hota\b|batao\b|tell me how)/i },
  { intent: 'follow_me', regex: /\b(follow|folow|piche|saath|aage|chal|stay with|walk behind|tag along|side|keep following)\b/i },
  { intent: 'come_here', regex: /\b(come here|cm here|idhar aao|mere paas aao|come over|come to|meet me|yahan aao|helper come|walk over)\b/i },
  { intent: 'survive_night', regex: /(night|dark|raat|shelter|safe|zombie|bachao|chupna|dusk|monsters)/i },
  { intent: 'make_tools', regex: /(pickaxe|picaxe|pikaxe|pick\b|tools?|axe\b|sword|hathoda|tools to stone)/i },
  { intent: 'get_wood', regex: /(wood|log|tree|lakdi|lakadi|chop|katna|wod|woood|choping)/i },
  { intent: 'get_food', regex: /(food|hungry|hungri|eat|khana|hunt|bhookh|bhuk|shikar|fod|chiken|khao|meat)/i },
  { intent: 'autopilot', regex: /(auto|play for me|what do i do|dont know|don't know|idk|bored|khel|khelna|kuch karo|play by yourself|take over)/i },
];

function spreadProbabilities(options, chosen, chosenP) {
  const otherCount = options.length - 1;
  const otherP = otherCount > 0 ? (1 - chosenP) / otherCount : 0;
  const probs = {};
  for (const opt of options) probs[opt] = opt === chosen ? Number(chosenP.toFixed(4)) : Number(otherP.toFixed(4));
  return probs;
}

function mockDecideSync(state, questions) {
  const answers = {}, msg = (state?.player_message || state?.message || '').trim();

  for (const [id, q] of Object.entries(questions)) {
    if (q.type === 'choice') {
      const options = Object.keys(q.criteria || {});
      if (options.length < 2) continue;
      let chosen = null, conf = 0.8;

      if (id === 'intent') {
        if (ADVERSARIAL_REGEX.test(msg) && options.includes('unclear')) { chosen = 'unclear'; conf = 0.9; }
        else {
          for (const rule of INTENT_RULES) {
            if (rule.regex.test(msg) && options.includes(rule.intent)) { chosen = rule.intent; conf = 0.9; break; }
          }
        }
        if (!chosen) { chosen = options.includes('unclear') ? 'unclear' : options[0]; conf = chosen === 'unclear' ? 0.3 : 0.5; }
      } else if (id === 'interrupt') {
        if (heuristics?.interrupt) chosen = heuristics.interrupt(state, q.criteria);
        else if (options.includes('flee') && (state?.health <= 6 || state?.nearby?.hostile_mobs?.length > 0)) chosen = 'flee';
        else if (options.includes('eat_food') && state?.food < 14) chosen = 'eat_food';
        else chosen = options.includes('continue_task') ? 'continue_task' : options[0];
        conf = 0.8;
      } else if (id === 'next_goal') {
        if (heuristics?.nextGoal) chosen = heuristics.nextGoal(state, q.criteria);
        else if (options.includes('survive_night') && (state?.time_of_day === 'night' || state?.time_of_day === 'dusk')) chosen = 'survive_night';
        else if (options.includes('get_wood')) chosen = 'get_wood';
        else if (options.includes('make_tools')) chosen = 'make_tools';
        else chosen = options.includes('get_food') ? 'get_food' : options[0];
        conf = 0.8;
      } else if (id === 'owner_activity') {
        const r = state?.owner?.recent || {};
        if (r.hurt > 0) chosen = 'fighting';
        else if (Object.keys(r.broke || {}).some(k => /(log|wood|stem)/.test(k))) chosen = 'chopping_wood';
        else if (Object.keys(r.broke || {}).some(k => /(stone|cobblestone|deepslate|_ore)/.test(k))) chosen = 'mining';
        else if (Object.keys(r.placed || {}).length > 0) chosen = 'building';
        else if ((r.moved || 0) > 40) chosen = 'exploring';
        else if ((r.moved || 0) < 2) chosen = 'idle';
        else chosen = options.includes('unknown') ? 'unknown' : options[0];
        conf = 0.8;
      } else if (id === 'buddy_action') {
        const hostiles = (state?.owner?.hostiles_near_owner?.length || 0) > 0;
        if (options.includes('protect_owner') && hostiles) chosen = 'protect_owner';
        else if (options.includes('gather_same') && Object.keys(state?.owner?.recent?.broke || {}).length > 0) chosen = 'gather_same';
        else if (options.includes('bring_materials') && Object.keys(state?.owner?.recent?.placed || {}).length > 0) chosen = 'bring_materials';
        else if (options.includes('scout_ahead') && (state?.owner?.recent?.moved || 0) > 40) chosen = 'scout_ahead';
        else chosen = options.includes('stay_close') ? 'stay_close' : options[0];
        conf = 0.8;
      } else if (id === 'verb') {
        if (/give|drop|de do/i.test(msg)) chosen = 'give';
        else if (/kill|attack|marna/i.test(msg)) chosen = 'attack';
        else if (/build|house|shelter|hut/i.test(msg)) chosen = 'build';
        else if (/protect|safe|bachao/i.test(msg)) chosen = 'protect';
        else if (/come|idhar aao/i.test(msg)) chosen = 'go_to';
        else if (/follow|piche/i.test(msg)) chosen = 'follow';
        else if (/stop|ruko/i.test(msg)) chosen = 'stop';
        else if (/explain|how|why|kaise/i.test(msg)) chosen = 'explain';
        else if (/buddy|together/i.test(msg)) chosen = 'buddy';
        else if (/status/i.test(msg)) chosen = 'status';
        else if (/get|need|craft|make|chahiye/i.test(msg)) chosen = 'obtain';
        else chosen = options.includes('unclear') ? 'unclear' : options[0];
        conf = 0.85;
      } else if (id === 'category') {
        if (/pickaxe|axe|shovel|hoe/i.test(msg)) chosen = 'tools';
        else if (/sword|bow|shield|armor/i.test(msg)) chosen = 'weapons_armor';
        else if (/wood|log|plank|stick|lakdi/i.test(msg)) chosen = 'wood';
        else if (/stone|coal|iron|gold|diamond|patthar/i.test(msg)) chosen = 'stone_ores';
        else if (/food|beef|meat|bread|apple|khana/i.test(msg)) chosen = 'food';
        else if (/torch|bed|chest|furnace|door|table/i.test(msg)) chosen = 'utility';
        else if (/block|house|hut/i.test(msg)) chosen = 'building_blocks';
        else if (/zombie|skeleton|spider|creeper|cow|pig/i.test(msg)) chosen = 'mob';
        else chosen = options.includes('none') ? 'none' : options[0];
        conf = 0.85;
      } else {
        chosen = options[0];
      }

      answers[id] = { type: 'choice', choice: chosen, confidence: conf, probabilities: spreadProbabilities(options, chosen, conf) };
    } else if (q.type === 'noul') {
      let p = 0.1;
      if (id === 'wants_to_learn') p = /(how|learn|teach|why|kaise)/i.test(msg) ? 0.85 : 0.15;
      else if (id === 'danger') {
        const lowHealth = state?.health !== undefined && state.health <= 6;
        const hostiles = (state?.nearby?.hostile_mobs?.length || 0) > 0 || state?.nearby_mob === 'zombie' || state?.nearby_mob === 'creeper';
        p = lowHealth || hostiles ? 0.85 : 0.1;
      } else if (id === 'needs_help') {
        const r = state?.owner?.recent || {};
        p = (r.hurt > 0 || (state?.owner?.health && state.owner.health <= 8) || r.died > 0) ? 0.85 : 0.15;
      }
      answers[id] = { type: 'noul', p };
    } else if (q.type === 'score') {
      answers[id] = { type: 'score', score: 1, confidence: 0.8, probabilities: {} };
    }
  }

  return answers;
}

async function mockDecide(state, questions) {
  const start = Date.now();
  const answers = mockDecideSync(state, questions);
  return { answers, latencyMs: Math.max(1, Date.now() - start), backend: 'mock', raw: { model: 'mock', answers } };
}

module.exports = { mockDecide, mockDecideSync };
