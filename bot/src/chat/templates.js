'use strict';

const pretty = (name = '') => String(name).replace(/^group:/, '').replace(/_/g, ' ');

// 'obtain:stone_pickaxe:1' -> 'stone pickaxe', 'blueprint:hut_5x5' -> 'hut 5x5', 'mob:zombie' -> 'zombie'
function goalLabel(goalId = '') {
  if (String(goalId).startsWith('goto:')) return 'the trip';
  const m = String(goalId).match(/^obtain:(.+):\d+$/);
  if (m) return pretty(m[1]);
  return pretty(String(goalId).replace(/^(blueprint|mob|obtain):/, ''));
}

function describeStep(s) {
  const a = s.args || {};
  if (s.skill === 'collect_block') return `gather ${a.count} ${pretty(a.dropName || a.blockNames?.[0])}`;
  if (s.skill === 'hunt') return `hunt ${a.mobNames?.length > 2 ? 'animals' : pretty(a.mobNames?.[0])}`;
  if (s.skill === 'craft') return /_(pickaxe|axe|sword|shovel)$|^furnace$/.test(a.item) ? `craft ${pretty(a.item)}` : null;
  if (s.skill === 'smelt') return `smelt ${pretty(a.item)}`;
  return null;
}

const templates = {
  goalLabel,

  planSummary(target, count, steps = []) {
    if (!steps.length) return '';
    const name = `${count > 1 ? `${count} ` : ''}${pretty(target)}`;
    if (!steps.some((s) => s.skill === 'collect_block' || s.skill === 'hunt')) return `I already have the materials — making ${name} now.`;
    const parts = [];
    for (const s of steps) { const d = describeStep(s); if (d && !parts.includes(d)) parts.push(d); }
    const final = `craft ${pretty(target)}`;
    if (steps[steps.length - 1]?.skill === 'craft' && !parts.includes(final)) parts.push(final);
    return `Getting ${name}: ${parts.join(' > ')}`;
  },

  obtained(target, count, gave) {
    const name = `${count > 1 ? `${count} ` : ''}${pretty(target)}`;
    return gave ? `Here you go — ${name}!` : `Got ${name}.`;
  },

  goalDone(goalId) {
    if (goalId === 'survive_night') return 'Morning! Safe to head out.';
    if (goalId === 'go_home') return 'Home sweet home!';
    if (goalId === 'sleep_with_owner') return 'Good morning!';
    if (goalId === 'deep_mine') return 'Diamond expedition complete!';
    if (goalId === 'enter_nether') return 'Welcome to the Nether!';
    if (goalId === 'get_blaze_rods') return 'Blaze rods secured!';
    if (goalId === 'gather_ender_pearls') return 'Ender pearls collected!';
    if (goalId === 'craft_eyes_of_ender') return 'Eyes of ender crafted!';
    if (goalId === 'find_stronghold') return 'Stronghold located!';
    if (goalId === 'activate_end_portal') return 'End Portal activated!';
    if (goalId === 'defeat_ender_dragon' || goalId === 'beat_game') return 'The Ender Dragon is slain! Victory!';
    if (goalId.startsWith('goto:')) return 'Here we are!';
    if (goalId === 'explore') return 'Finished scouting!';
    if (['come_here', 'follow_me', 'give_items', 'recover_items'].includes(goalId)) return '';
    return `Done with ${goalLabel(goalId)}.`;
  },

  welcome(name) {
    return `Hi ${name}! I'm your butler. Tell me what you want in normal words, starting with "butler". Try: "butler get wood", "butler make a pickaxe", "butler play for me". Type !stop to stop me, !help for more.`;
  },

  help() {
    return 'Commands: /plan (roadmap), /boost (gear up), /goal <name>, !stop, !come, !follow, !give, !status, !auto, !why, !kit, !home, !stuff, !where. Or talk: "butler get wood".';
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
    return 'I didn\'t understand that. Try "butler get wood", "butler make a pickaxe", or type !help.';
  },

  announceGoal(goalId, learn = false) {
    if (goalId.startsWith('goto:')) return ''; // talk.goPlace already said where
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
      follow_me: '',
      come_here: '',
      give_items: 'Dropping items for you.',
      go_home: 'Heading home.',
      sleep_with_owner: 'Bedtime? Coming to sleep too!',
      recover_items: 'Going to fetch your stuff from where you died!',
      explore: '',
      autopilot: 'Autopilot enabled! Surviving and gathering resources.',
      deep_mine: 'Descending deep underground to Y=-58 to mine diamonds!',
      enter_nether: 'Building and igniting a Nether portal to enter the Nether!',
      get_blaze_rods: 'Navigating the Nether to find a fortress and harvest blaze rods!',
      gather_ender_pearls: 'Bartering with Piglins and hunting Endermen for ender pearls!',
      craft_eyes_of_ender: 'Crafting eyes of ender to locate the Stronghold!',
      find_stronghold: 'Throwing eyes of ender to triangulate the Stronghold!',
      activate_end_portal: 'Entering the Stronghold, clearing silverfish, and filling the End portal!',
      defeat_ender_dragon: 'Entering the End to destroy crystals and slay the Ender Dragon!',
      beat_game: 'Starting the journey to defeat the Ender Dragon and beat Minecraft!',
    };
    return map[goalId] ?? `On it: ${goalLabel(goalId)}.`;
  },

  stepStart(skill, args = {}, learn = false) {
    switch (skill) {
      case 'deep_mine':
      case 'mine_diamonds':
        return `Mining down to Y=-58 and strip mining for diamonds (target: ${args.count || 3})...`;
      case 'build_portal':
      case 'build_nether_portal':
        return 'Constructing 4x5 obsidian portal frame and lighting it...';
      case 'enter_portal':
        return 'Walking into portal to transition dimensions...';
      case 'find_fortress':
        return 'Exploring the Nether looking for a nether fortress...';
      case 'hunt_blaze':
        return `Fighting blazes behind shield to gather blaze rods (target: ${args.count || 6})...`;
      case 'barter_piglin':
        return `Bartering gold ingots with Piglins for ender pearls (target: ${args.count || 12})...`;
      case 'hunt_enderman':
        return 'Hunting Endermen under a safe 2-block ceiling...';
      case 'triangulate_stronghold':
        return 'Throwing eyes of ender to triangulate stronghold coordinates...';
      case 'find_stronghold':
        return 'Traveling to stronghold coordinates and digging down safely...';
      case 'activate_end_portal':
        return 'Clearing silverfish and inserting eyes of ender into frames...';
      case 'fight_dragon':
      case 'defeat_dragon':
        return 'Fighting the Ender Dragon: destroying crystals and striking when perched!';
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
      case 'come_to_owner':
      case 'follow_owner':
        return '';
      default:
        return `Performing ${skill}...`;
    }
  },

  stepDone(skill, message = '') {
    if (['come_to_owner', 'follow_owner', 'come_here', 'follow_me'].includes(skill)) return '';
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
      case 'no_progress':
        return `I keep going in circles on ${pretty(skill)} without making progress, so I'm stopping. Try helping me get closer to the materials.`;
      case 'no_source':
        return 'I don\'t know how to obtain that item yet.';
      case 'too_deep':
        return 'Recipe is too complex or circular to plan.';
      default:
        return `Couldn't complete ${pretty(skill)}: ${String(reason || 'unknown issue').replace(/_/g, ' ')}.`;
    }
  },

};

module.exports = templates;

