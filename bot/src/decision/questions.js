'use strict';

const INTENT_CRITERIA = Object.freeze({
  get_wood: 'get wood, logs, trees, or planks',
  make_tools: 'craft a pickaxe, axe, sword or other tools',
  get_food: 'find food or stop being hungry',
  survive_night: 'stay safe at night or hide from monsters',
  follow_me: 'follow the player around',
  come_here: 'walk to where the player is',
  give_items: 'give the player items the helper has',
  autopilot: 'play by itself and decide what to do next',
  explain: 'player asks how or why something works, no action',
  stop: 'stop what the helper is doing',
  status: 'player asks what the helper is doing or has',
  unclear: 'message is not a request or is unclear',
});

const INTERRUPT_CRITERIA = Object.freeze({
  continue_task: 'keep doing the current task',
  eat_food: 'eat food now because hunger is low',
  flee: 'run away from the nearby monster',
  fight: 'fight the nearby monster with a weapon',
  dig_in: 'dig a hole and hide until morning',
  get_food: 'go hunt animals for food now',
});

const NEXT_GOAL_CRITERIA = Object.freeze({
  get_wood: 'collect wood logs from trees',
  make_tools: 'craft a pickaxe, then stone tools',
  get_food: 'find or hunt food to survive',
  survive_night: 'find shelter or dig in for the night',
});

/**
 * Builds the intent question set: choice (12 options) + wants_to_learn (noul).
 * @returns {object} Questions map
 */
function buildIntentQuestions() {
  return {
    intent: {
      type: 'choice',
      instructions: 'A new Minecraft player typed player_message to their helper. What do they want?',
      criteria: { ...INTENT_CRITERIA },
    },
    wants_to_learn: {
      type: 'noul',
      instructions: 'Does the player want to learn how to do it themselves?',
      criteria: {
        true: 'player asks how to do it or wants to learn',
        false: 'player wants the helper to do the task',
      },
    },
  };
}

/**
 * Builds the interrupt question given a list of legal option IDs.
 * Never emits a choice with < 2 options; returns null instead.
 * @param {string[]} legalOptions - Array of legal interrupt IDs (must include 'continue_task')
 * @returns {object|null}
 */
function buildInterruptQuestions(legalOptions) {
  const criteria = {};
  const options = Array.isArray(legalOptions) ? legalOptions : Object.keys(INTERRUPT_CRITERIA);

  for (const opt of options) {
    if (INTERRUPT_CRITERIA[opt]) {
      criteria[opt] = INTERRUPT_CRITERIA[opt];
    }
  }

  // Never emit choice with fewer than 2 options
  if (Object.keys(criteria).length < 2) {
    return null;
  }

  return {
    interrupt: {
      type: 'choice',
      instructions: 'Should the helper interrupt its current task?',
      criteria,
    },
  };
}

/**
 * Builds the next_goal question given available goal IDs.
 * Never emits a choice with < 2 options; returns null instead.
 * @param {string[]} availableGoals - Array of available goal IDs
 * @returns {object|null}
 */
function buildNextGoalQuestions(availableGoals) {
  const criteria = {};
  const options = Array.isArray(availableGoals) ? availableGoals : Object.keys(NEXT_GOAL_CRITERIA);

  for (const g of options) {
    if (NEXT_GOAL_CRITERIA[g]) {
      criteria[g] = NEXT_GOAL_CRITERIA[g];
    }
  }

  if (Object.keys(criteria).length < 2) return null;
  return {
    next_goal: {
      type: 'choice',
      instructions: 'You are helping a brand new player survive their first day. Which goal should come next?',
      criteria,
    },
  };
}

const OWNER_ACTIVITY_CRITERIA = Object.freeze({
  chopping_wood: 'breaking logs',
  mining: 'breaking stone or ores',
  building: 'placing blocks',
  fighting: 'fighting or being hurt by monsters',
  exploring: 'walking far',
  idle: 'standing still',
  unknown: 'cannot tell',
});

const BUDDY_ACTION_CRITERIA = Object.freeze({
  stay_close: 'stay near the player and follow them',
  protect_owner: 'fight monsters threatening the player',
  gather_same: 'gather the same resource nearby',
  bring_materials: 'bring building blocks to the player',
  give_food: 'give food to the hungry or hurt player',
  build_shelter_near_owner: 'build a quick shelter near the player',
  scout_ahead: 'walk ahead and scout for resources or danger',
  continue_own_task: 'continue the current ongoing task',
});

function buildBuddyQuestions(legalActions) {
  const criteria = {};
  const options = Array.isArray(legalActions) ? legalActions : Object.keys(BUDDY_ACTION_CRITERIA);
  for (const opt of options) {
    if (BUDDY_ACTION_CRITERIA[opt]) criteria[opt] = BUDDY_ACTION_CRITERIA[opt];
  }
  const q = {
    owner_activity: {
      type: 'choice',
      instructions: 'What is the player doing right now?',
      criteria: { ...OWNER_ACTIVITY_CRITERIA },
    },
    needs_help: {
      type: 'noul',
      instructions: 'Does this new player look like they are struggling?',
      criteria: { true: 'player is in danger or needs help', false: 'player is doing fine' },
    },
  };
  if (Object.keys(criteria).length >= 2) {
    q.buddy_action = {
      type: 'choice',
      instructions: 'How should the helper help the player now?',
      criteria,
    };
  }
  return q;
}

module.exports = {
  INTENT_CRITERIA,
  INTERRUPT_CRITERIA,
  NEXT_GOAL_CRITERIA,
  OWNER_ACTIVITY_CRITERIA,
  BUDDY_ACTION_CRITERIA,
  intent: buildIntentQuestions,
  interrupt: buildInterruptQuestions,
  next_goal: buildNextGoalQuestions,
  buddy: buildBuddyQuestions,
};
