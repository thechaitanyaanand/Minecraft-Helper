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
});

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


  // Mob check for kill/attack
  const mobs = ['spider', 'zombie', 'skeleton', 'creeper', 'cow', 'pig', 'sheep', 'chicken', 'drowned', 'enderman'];
  for (const m of mobs) {
    if (new RegExp(`\\b${m}s?\\b`, 'i').test(clean)) {
      return `mob:${m}`;
    }
  }

  for (const [alias, mapped] of Object.entries(ALIASES)) {
    if (new RegExp(`\\b${alias}\\b`, 'i').test(clean)) {
      return mapped;
    }
  }

  // Exact item / block check
  const words = clean.split(/\s+/);
  for (let i = 0; i < words.length; i++) {
    for (let len = 3; len >= 1; len--) {
      if (i + len <= words.length) {
        const candidate = words.slice(i, i + len).join('_');
        if (mcData?.itemsByName[candidate] || mcData?.blocksByName[candidate]) {
          return candidate;
        }
        const singular = candidate.replace(/es$/, '').replace(/s$/, '');
        if (singular && (mcData?.itemsByName[singular] || mcData?.blocksByName[singular])) {
          return singular;
        }
      }
    }
  }
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
