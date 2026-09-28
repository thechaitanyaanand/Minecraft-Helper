'use strict';

const FOOD_PRIORITY = Object.freeze([
  'cooked_beef', 'cooked_porkchop', 'bread', 'cooked_chicken', 'cooked_mutton', 'cooked_rabbit',
  'baked_potato', 'apple', 'carrot', 'beef', 'porkchop', 'mutton', 'chicken', 'rabbit',
]);

function findBestFood(bot) {
  if (!bot.inventory?.items) return null;
  const items = bot.inventory.items();
  for (const name of FOOD_PRIORITY) {
    const it = items.find((item) => item.name === name);
    if (it) return it;
  }
  return null;
}

module.exports = {
  name: 'eat',
  describe: 'eat food from inventory to restore hunger',
  timeoutMs: 10_000,
  FOOD_PRIORITY,

  isAvailable(bot) {
    // Hurt bots top up to 20: full food + saturation is what drives fast healing.
    const healing = (bot?.health ?? 20) <= 14 && (bot?.food ?? 20) < 20;
    if ((bot?.food ?? 20) >= 18 && !healing) {
      return { ok: false, reason: 'not_hungry' };
    }
    const food = findBestFood(bot);
    if (!food) {
      return { ok: false, reason: 'no_food' };
    }
    return { ok: true };
  },

  async run(bot, ctx, token) {
    token.throwIfCancelled();

    const food = findBestFood(bot);
    if (!food) {
      return { ok: false, reason: 'no_food', message: 'No edible food in inventory' };
    }

    if ((bot?.food ?? 20) >= 20) {
      return { ok: true, message: 'already full' };
    }

    token.throwIfCancelled();
    if (bot.equip) {
      await bot.equip(food, 'hand');
    }

    token.throwIfCancelled();
    if (bot.consume) {
      await bot.consume();
    }
    token.throwIfCancelled();

    return {
      ok: true,
      message: `ate ${food.name}`,
      foodItem: food.name,
    };
  },
};
