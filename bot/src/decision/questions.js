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

  if (Object.keys(criteria).length < 2) {
    return null;
  }

  return {
    next_goal: {
      type: 'choice',
      instructions: 'You are helping a brand new player survive their first day. Which goal should come next?',
      criteria,
    },
  };
}

module.exports = {
  INTENT_CRITERIA,
  INTERRUPT_CRITERIA,
  NEXT_GOAL_CRITERIA,
  intent: buildIntentQuestions,
  interrupt: buildInterruptQuestions,
  next_goal: buildNextGoalQuestions,
};
