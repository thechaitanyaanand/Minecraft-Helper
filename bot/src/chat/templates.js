'use strict';

const templates = {
  welcome(name) {
    return `Hi ${name}! I'm your helper. Tell me what you want starting with "helper" (e.g. "helper get wood", "helper make a pickaxe"). Type !help for commands or !stop to stop me.`;
  },

  help() {
    return 'Commands: !help (this list), !stop (stop immediately), !come (walk to you), !follow (follow you), !status (health & current task), !auto (autopilot), !why (explain last decision), !give (give items).';
  },

  status({ health = 20, food = 20, timeOfDay = 'day', activity = 'idle', backend = 'mock' } = {}) {
    return `Status: Health ${health}/20, Food ${food}/20, Time: ${timeOfDay}, Activity: ${activity}, Backend: ${backend}`;
  },

  whyLast(decision) {
    if (!decision) return 'No decisions made yet.';
    const pStr = decision.topProbs ? Object.entries(decision.topProbs).map(([k, v]) => `${k}:${Math.round(v * 100)}%`).join(' ') : 'none';
    return `Last decision: ${decision.purpose} -> ${decision.chosen} (${Math.round((decision.confidence || 0) * 100)}% conf). Top: [${pStr}]. Backend: ${decision.backend}${decision.fallback ? ' (fallback)' : ''}`;
  },

  didYouMean(optionLabel) {
    return `Did you mean: ${optionLabel}? (yes / no)`;
  },

  pickOne(options = []) {
    const list = options.map((opt, i) => `${i + 1}) ${opt}`).join(' ');
    return `I'm not sure. Pick one: ${list}`;
  },

  unclear() {
    return 'I didn\'t understand that. Try "helper get wood", "helper make a pickaxe", or type !help.';
  },

  announceGoal(goalId, learn = false) {
    const map = {
      get_wood: 'Going to collect wood logs from nearby trees. Wood is the foundation of everything in Minecraft!',
      make_tools: 'Making tools: starting with a wooden pickaxe, then upgrading to stone.',
      get_food: 'Hunting for food nearby so we don\'t starve.',
      survive_night: 'Night is dangerous! Looking for shelter or digging a safe hole.',
      follow_me: 'Following you now.',
      come_here: 'Coming to where you are.',
      give_items: 'Dropping items for you.',
      autopilot: 'Autopilot enabled! Surviving and gathering resources.',
    };
    return map[goalId] || `Starting task: ${goalId}`;
  },

  stepStart(skill, args = {}, learn = false) {
    switch (skill) {
      case 'collect_logs':
        return learn
          ? 'Chopping trees. Punch trees with bare hands or an axe to gather logs!'
          : `Chopping logs (target: ${args.count || 4})...`;
      case 'craft_planks':
        return learn
          ? 'Placing logs in crafting grid (E) to make planks. 1 log = 4 planks.'
          : 'Crafting planks from logs...';
      case 'craft_sticks':
        return learn
          ? 'Crafting sticks: put 2 planks vertically in crafting grid to get 4 sticks.'
          : 'Crafting sticks...';
      case 'place_crafting_table':
        return learn
          ? 'Placing a crafting table. 4 planks in a 2x2 grid gives you a 3x3 table for advanced recipes.'
          : 'Placing crafting table...';
      case 'craft_tool':
        return `Crafting ${args.item || 'tool'} at the crafting table...`;
      case 'mine_stone':
        return 'Mining stone with pickaxe to collect cobblestone...';
      case 'hunt_food':
        return 'Hunting nearby animals for meat...';
      case 'eat':
        return 'Eating food to restore hunger...';
      case 'flee':
        return 'Danger! Running away from hostile monster!';
      case 'fight':
        return 'Attacking hostile monster with weapon!';
      case 'dig_in':
        return learn
          ? 'Digging a 3-block hole and sealing the ceiling to safely wait out the night.'
          : 'Digging an emergency night shelter...';
      default:
        return `Performing ${skill}...`;
    }
  },

  stepDone(skill, message = '') {
    return message ? `Done: ${message}` : `Finished ${skill}.`;
  },

  stepFailed(skill, reason = '') {
    switch (reason) {
      case 'no_target':
        return 'I can\'t find any targets nearby — exploring around.';
      case 'timeout':
        return `Taking too long to finish ${skill}, cancelling.`;
      case 'stuck':
        return 'I got stuck while moving — clearing path.';
      default:
        return `Couldn't complete ${skill}: ${reason || 'unknown reason'}.`;
    }
  },

  explain(topic) {
    const map = {
      crafting_table: 'A crafting table allows a 3x3 crafting grid. Place 4 wood planks in your 2x2 inventory grid to make one.',
      pickaxe: 'A wooden pickaxe mines stone, which lets you craft durable stone tools. You can\'t mine stone with bare hands.',
      night: 'At night, hostile monsters (zombies, skeletons, creepers) spawn in the dark. Sleep in a bed or hide in a shelter until dawn.',
      food: 'When hunger drops below 18, you stop healing. At 0, you lose health. Hunt animals and eat meat to restore it.',
    };
    return map[topic] || 'Ask me about: crafting_table, pickaxe, night, or food.';
  },
};

module.exports = templates;
