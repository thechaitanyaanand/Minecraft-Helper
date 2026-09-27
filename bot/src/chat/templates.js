'use strict';

function matchTopic(text = '') {
  const t = String(text).toLowerCase();
  if (/crafting|table|workbench|desk/i.test(t)) return 'crafting_table';
  if (/pickaxe|pick|stone|tool|hathoda/i.test(t)) return 'pickaxe';
  if (/night|dark|raat|monster|zombie|creeper|skeleton|shelter|dusk/i.test(t)) return 'night';
  if (/food|hungry|eat|hunger|khana|starv|meat/i.test(t)) return 'food';
  return t.replace(/\s+/g, '_');
}

const templates = {
  welcome(name) {
    return `Hi ${name}! I'm your helper. Tell me what you want in normal words, starting with "helper". Try: "helper get wood", "helper make a pickaxe", "helper play for me". Type !stop to stop me, !help for more.`;
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
    if (learn) {
      const learnMap = {
        get_wood: 'Logs make planks, which craft sticks and tools. Punch tree trunks to gather logs!',
        make_tools: 'Wooden pickaxe mines cobblestone, which makes faster stone pickaxes and swords!',
        get_food: 'Keep hunger above 18 to naturally heal. Hunt animals to cook food!',
        survive_night: 'Monsters spawn in dark areas. Dig 3 blocks down and seal the roof until morning!',
      };
      if (learnMap[goalId]) return learnMap[goalId];
    }
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
        return learn
          ? `Crafting ${args.item || 'tool'} at the table: tools need sticks and material (wood, stone, iron).`
          : `Crafting ${args.item || 'tool'} at the crafting table...`;
      case 'mine_stone':
        return learn
          ? 'Mine smooth stone with any pickaxe to collect cobblestone. Hands won\'t drop stone!'
          : 'Mining stone with pickaxe to collect cobblestone...';
      case 'hunt_food':
        return learn
          ? 'Defeating animals drops meat. Cooking it in a furnace restores much more hunger.'
          : 'Hunting nearby animals for meat...';
      case 'eat':
        return learn
          ? 'Hold food in hand and eat to keep hunger above 18 so your health regenerates.'
          : 'Eating food to restore hunger...';
      case 'flee':
        return 'Danger! Running away from hostile monster!';
      case 'fight':
        return learn
          ? 'Attacking monster! Time attacks with the cooldown sweep for maximum damage.'
          : 'Attacking hostile monster with weapon!';
      case 'dig_in':
        return learn
          ? 'Digging a 3-block hole and sealing the ceiling to safely wait out the night.'
          : 'Digging an emergency night shelter...';
      case 'collect_block': {
        const blocks = Array.isArray(args.blockNames) ? args.blockNames : [args.blockNames].filter(Boolean);
        const isWood = blocks.some((b) => /(log|wood|stem)$/.test(b));
        const isStone = blocks.some((b) => /(stone|cobblestone|deepslate)$/.test(b));
        if (isWood) return learn ? 'Chopping trees with bare hands or an axe to gather wood logs.' : `Chopping logs (target: ${args.count || 4})...`;
        if (isStone) return learn ? 'Mining stone with a pickaxe to get cobblestone. Hands won\'t drop stone!' : `Mining cobblestone (target: ${args.count || 3})...`;
        return `Collecting ${blocks[0] || 'blocks'} (target: ${args.count || 1})...`;
      }
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
      case 'no_path':
        return 'I cannot find a walkable path to the target — there may be steep cliffs or deep drops in the way.';
      case 'timeout':
        return `Taking too long to finish ${skill}, cancelling.`;
      case 'stuck':
        return 'I got stuck while moving — clearing path.';
      case 'no_space':
        return 'No suitable open spot found nearby to place the block.';
      case 'no_recipe_or_missing_items':
        return 'Missing ingredients or crafting table to craft this.';
      case 'owner_not_found':
        return 'I can\'t see you — please come closer (within ~60 blocks).';
      case 'too_many_steps':
        return 'This task exceeded maximum step limit. Stopping for safety.';
      case 'no_source':
        return 'I don\'t know how to obtain that item yet.';
      case 'too_deep':
        return 'Recipe is too complex or circular to plan.';
      default:
        return `Couldn't complete ${skill}: ${String(reason || 'unknown issue').replace(/_/g, ' ')}.`;
    }
  },

  explain(topic = '') {
    const key = matchTopic(topic);
    const map = {
      crafting_table: 'A crafting table gives you a 3x3 crafting grid. Put 4 wood planks in your 2x2 inventory grid (E) to make one.',
      pickaxe: 'A wooden pickaxe mines stone for durable stone tools. Bare hands cannot mine stone blocks.',
      night: 'At night, hostile monsters (zombies, skeletons, creepers) spawn in the dark. Sleep in a bed or hide in a shelter until dawn.',
      food: 'When hunger drops below 18, you stop healing. At 0, you take starvation damage. Hunt animals and eat meat to restore it.',
    };
    return map[key] || 'Ask me about: crafting_table, pickaxe, night, or food.';
  },
};

module.exports = templates;

