'use strict';

const ALIASES = Object.freeze({
  lakdi: 'oak_log',
  lakadi: 'oak_log',
  khana: 'cooked_beef',
  patthar: 'cobblestone',
  pathar: 'cobblestone',
  hathoda: 'wooden_pickaxe',
  bistar: 'white_bed',
  bed: 'white_bed',
  wood: 'oak_log',
  plank: 'oak_planks',
  planks: 'oak_planks',
  sticks: 'stick',
  pick: 'wooden_pickaxe',
  axe: 'wooden_axe',
  sword: 'wooden_sword',
  torch: 'torch',
  table: 'crafting_table',
  furnace: 'furnace',
  door: 'oak_door',
  iron: 'iron_ingot',
  gold: 'gold_ingot',
  copper: 'copper_ingot',
  diamond: 'diamond',
  diamonds: 'diamond',
  obsidian: 'obsidian',
  blaze: 'blaze_rod',
  pearl: 'ender_pearl',
  pearls: 'ender_pearl',
  eye: 'ender_eye',
  eyes: 'ender_eye',
});

// Exact names that almost always mean something else in chat ("get stone" = cobblestone, not smelted stone).
const PREFER = Object.freeze({ stone: 'cobblestone' });

function getTrigrams(str) {
  const clean = ' ' + str.toLowerCase().replace(/[^a-z0-9]/g, ' ').trim() + ' ';
  const trigrams = new Set();
  for (let i = 0; i <= clean.length - 3; i++) {
    trigrams.add(clean.slice(i, i + 3));
  }
  return trigrams;
}

function trigramSimilarity(strA, strB) {
  if (!strA || !strB) return 0;
  const setA = getTrigrams(strA);
  const setB = getTrigrams(strB);
  if (!setA.size || !setB.size) return 0;
  let intersection = 0;
  for (const tri of setA) {
    if (setB.has(tri)) intersection++;
  }
  return intersection / (setA.size + setB.size - intersection);
}

function parseAmount(text) {
  if (!text) return 1;
  const t = text.toLowerCase();
  if (/\ba\s+stack\b/i.test(t) || /\b64\b/.test(t)) return 64;
  if (/\bhalf\s+a?\s*stack\b/i.test(t) || /\b32\b/.test(t)) return 32;
  if (/\ba\s+few\b/i.test(t)) return 4;
  if (/\ba\s+couple\b/i.test(t)) return 2;
  const m = t.match(/\b(\d+)\b/);
  if (m) {
    const n = parseInt(m[1], 10);
    if (n > 0 && n <= 64) return n;
  }
  return 1;
}

function parseDirectTarget(text, mcData) {
  if (!text) return null;
  const clean = text.toLowerCase().replace(/[^a-z0-9_\s]/g, ' ').replace(/\s+/g, ' ').trim();

  // Blueprint check
  if (/\b(hut|house|shelter)\b/.test(clean)) {
    return /\b(big|larger|bigger|large|7x7)\b/.test(clean) ? 'blueprint:hut_7x7' : 'blueprint:hut_5x5';
  }


  // Exact item/block names first (longest phrase at each position) so "iron sword" beats the "sword" alias
  const words = clean.split(/\s+/);
  for (let i = 0; i < words.length; i++) {
    for (let len = 3; len >= 1; len--) {
      if (i + len > words.length) continue;
      const c = words.slice(i, i + len).join('_');
      for (const cand of [c, c.replace(/s$/, ''), c.replace(/es$/, '')]) {
        if (cand && (mcData?.itemsByName[cand] || mcData?.blocksByName[cand])) return PREFER[cand] || cand;
      }
    }
  }

  // Mob check for kill/attack
  const mobs = ['spider', 'zombie', 'skeleton', 'creeper', 'cow', 'pig', 'sheep', 'chicken', 'drowned', 'enderman', 'blaze', 'ender_dragon', 'dragon'];
  const mob = mobs.find((m) => words.includes(m) || words.includes(`${m}s`));
  if (mob) return mob === 'dragon' ? 'mob:ender_dragon' : `mob:${mob}`;

  const alias = Object.keys(ALIASES).find((a) => words.includes(a));
  if (alias) return ALIASES[alias];
  return null;
}

function rankShortlist(message, itemsArray, limit = 40) {
  if (!Array.isArray(itemsArray)) return [];
  const scored = [];
  for (const item of itemsArray) {
    const sim = Math.max(
      trigramSimilarity(message, item.name.replace(/_/g, ' ')),
      trigramSimilarity(message, item.displayName || item.name)
    );
    if (sim > 0.05) {
      scored.push({ item, score: sim });
    }
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((s) => s.item.name);
}

module.exports = {
  ALIASES,
  trigramSimilarity,
  parseAmount,
  parseDirectTarget,
  rankShortlist,
};
