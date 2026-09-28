'use strict';
const { ownerEntity, HOSTILE_MOBS, RANGED_MOBS } = require('../state/world');
const memory = require('../memory');

const WINDOW_MS = 20_000;

// Every vanilla death message ("%1$s was blown up by %2$s", "%1$s hit the ground too hard", ...), 99 in 1.20.4.
const DEATH_TEMPLATES = Object.entries(require('minecraft-data')('1.20.4').language)
  // Real death messages start with the victim; this skips link text ("Intentional Game Design") and the too-long fallback.
  .filter(([k, v]) => k.startsWith('death.') && /^%(1\$)?s /.test(v)).map(([, v]) => v);
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// One regex per template, with the owner's name in the victim slot (the first placeholder).
function deathMatchers(name) {
  return DEATH_TEMPLATES.map((t) => {
    let first = true;
    const body = t.split(/(%(?:\d\$)?s)/).map((part) => {
      if (!/^%(\d\$)?s$/.test(part)) return escapeRe(part);
      const victim = first || part === '%1$s';
      first = false;
      return victim ? escapeRe(name) : '.+';
    }).join('');
    return new RegExp(`^${body}$`);
  });
}

// Minecraft doesn't say who dealt damage. Best guess: the closest melee mob within reach, else the closest shooter.
function guessAttacker(bot, owner) {
  let best = null, bestScore = Infinity;
  for (const e of Object.values(bot?.entities || {})) {
    if (!e?.position || !HOSTILE_MOBS.has(e.name)) continue;
    const d = owner.position.distanceTo(e.position), ranged = RANGED_MOBS.has(e.name);
    if (d > (ranged ? 20 : 4)) continue;
    const score = ranged ? d + 10 : d;
    if (score < bestScore) { best = e; bestScore = score; }
  }
  return best;
}

function createObserver(bot, ownerName, opts = {}) {
  const broke = [];
  const placed = [];
  const hurt = [];
  const died = [];
  const positions = [];
  let lastAttacker = null, lastSeen = null;
  const deaths = ownerName ? deathMatchers(ownerName) : [];

  function prune(now = Date.now()) {
    const cutoff = now - WINDOW_MS;
    while (broke.length && broke[0].t < cutoff) broke.shift();
    while (placed.length && placed[0].t < cutoff) placed.shift();
    while (hurt.length && hurt[0] < cutoff) hurt.shift();
    while (died.length && died[0] < cutoff) died.shift();
    while (positions.length && positions[0].t < cutoff) positions.shift();
  }

  function onBlockUpdate(oldBlock, newBlock) {
    const owner = ownerEntity(bot, ownerName);
    if (!owner?.position || !oldBlock?.position) return;
    const dist = owner.position.distanceTo ? owner.position.distanceTo(oldBlock.position) : 0;
    if (dist > 6) return;

    const t = Date.now();
    const oldIsAir = !oldBlock.name || oldBlock.name === 'air';
    const newIsAir = !newBlock?.name || newBlock.name === 'air';

    if (!oldIsAir && newIsAir) {
      broke.push({ t, name: oldBlock.name });
      if (oldBlock.name === 'chest') memory.removeChest(oldBlock.position);
    } else if (oldIsAir && !newIsAir) {
      placed.push({ t, name: newBlock.name });
      if (newBlock.name === 'chest') memory.addChest(oldBlock.position);
      if (/_bed$/.test(newBlock.name) && !memory.get().home) memory.set('home', oldBlock.position);
    }
  }

  function onEntityHurt(entity) {
    if (entity?.username === ownerName || (ownerName && entity === ownerEntity(bot, ownerName))) {
      hurt.push(Date.now());
      const owner = ownerEntity(bot, ownerName), attacker = owner?.position && guessAttacker(bot, owner);
      if (attacker) lastAttacker = { entity: attacker, t: Date.now() };
    }
  }

  // Two signals for one death: the chat message (works anywhere, unless death messages are turned off) and the
  // entity death status (only when we can see the owner). Whichever comes first counts; the other is ignored.
  function recordOwnerDeath(text) {
    const now = Date.now();
    if (died.length && now - died[died.length - 1] < 5000) return;
    died.push(now);
    memory.addEvent(text);
    // Last place we saw them, if recent enough to be where their items dropped.
    const spot = lastSeen && now - lastSeen.t < 60_000 ? lastSeen.pos : null;
    if (spot) memory.set('deathSpot', spot);
    opts.onOwnerDeath?.(spot);
  }

  // Death messages are system messages, so they arrive on 'messagestr', not 'chat'.
  function onMessage(message) {
    if (typeof message === 'string' && deaths.some((re) => re.test(message.trim()))) recordOwnerDeath(message.trim());
  }

  function onEntityDead(entity) {
    if (entity && entity.username === ownerName) recordOwnerDeath(`${ownerName} died`);
  }

  let posInterval = null;
  function startTracking() {
    if (!bot?.on) return;
    bot.on('blockUpdate', onBlockUpdate);
    bot.on('entityHurt', onEntityHurt);
    bot.on('messagestr', onMessage);
    bot.on('entityDead', onEntityDead);
    posInterval = setInterval(() => {
      const owner = ownerEntity(bot, ownerName);
      if (owner?.position) {
        const entry = { t: Date.now(), pos: { x: owner.position.x, y: owner.position.y, z: owner.position.z } };
        positions.push(entry);
        lastSeen = entry;
      }
    }, 1000);
  }

  function stopTracking() {
    if (!bot?.removeListener) return;
    bot.removeListener('blockUpdate', onBlockUpdate);
    bot.removeListener('entityHurt', onEntityHurt);
    bot.removeListener('messagestr', onMessage);
    bot.removeListener('entityDead', onEntityDead);
    if (posInterval) clearInterval(posInterval);
  }

  function getOwnerState(now = Date.now()) {
    prune(now);
    const owner = ownerEntity(bot, ownerName);
    const botPos = bot?.entity?.position;
    const distance = (owner?.position && botPos && typeof botPos.distanceTo === 'function')
      ? Math.round(botPos.distanceTo(owner.position))
      : null;

    let moved = 0;
    for (let i = 1; i < positions.length; i++) {
      const p1 = positions[i - 1].pos;
      const p2 = positions[i].pos;
      const dx = p2.x - p1.x, dy = p2.y - p1.y, dz = p2.z - p1.z;
      moved += Math.sqrt(dx * dx + dy * dy + dz * dz);
    }

    const brokeCounts = {};
    for (const b of broke) brokeCounts[b.name] = (brokeCounts[b.name] || 0) + 1;
    const placedCounts = {};
    for (const p of placed) placedCounts[p.name] = (placedCounts[p.name] || 0) + 1;

    let health = 20;
    if (typeof owner?.health === 'number') health = Math.round(owner.health);
    else if (hurt.length > 0) health = Math.max(1, 20 - hurt.length * 2);

    const hostiles = [];
    if (owner?.position && bot?.entities) {
      for (const e of Object.values(bot.entities)) {
        if (!e || e === bot.entity || e === owner || !e.position) continue;
        if (HOSTILE_MOBS.has(e.name)) {
          const d = owner.position.distanceTo ? Math.round(owner.position.distanceTo(e.position)) : 0;
          if (d <= 12) hostiles.push({ type: e.name, distance: d });
        }
      }
    }
    hostiles.sort((a, b) => a.distance - b.distance);

    return {
      distance,
      held: owner?.heldItem?.name || null,
      health,
      recent: {
        broke: brokeCounts,
        placed: placedCounts,
        hurt: hurt.length,
        moved: Math.round(moved),
        died: died.length,
      },
      hostiles_near_owner: hostiles,
    };
  }

  startTracking();

  return {
    getOwnerState,
    stopTracking,
    // The mob that most likely just hurt the owner, while it's still alive and recent.
    getLastAttacker: () => (lastAttacker?.entity?.isValid && Date.now() - lastAttacker.t < 15_000 ? lastAttacker.entity : null),
    recordBroke: (name) => broke.push({ t: Date.now(), name }),
    recordPlaced: (name) => placed.push({ t: Date.now(), name }),
    recordHurt: () => hurt.push(Date.now()),
    recordDied: () => died.push(Date.now()),
    recordMove: (dist) => {
      const t = Date.now();
      positions.push({ t, pos: { x: 0, y: 0, z: 0 } });
      positions.push({ t, pos: { x: dist, y: 0, z: 0 } });
      lastSeen = positions[positions.length - 1];
    },
  };
}

module.exports = { createObserver, deathMatchers, DEATH_TEMPLATES, WINDOW_MS };
