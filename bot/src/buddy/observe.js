'use strict';
const { ownerEntity, HOSTILE_MOBS } = require('../state/world');

const WINDOW_MS = 20_000;

function createObserver(bot, ownerName) {
  const broke = [];
  const placed = [];
  const hurt = [];
  const died = [];
  const positions = [];

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
    } else if (oldIsAir && !newIsAir) {
      placed.push({ t, name: newBlock.name });
    }
  }

  function onEntityHurt(entity) {
    if (entity?.username === ownerName || (ownerName && entity === ownerEntity(bot, ownerName))) {
      hurt.push(Date.now());
    }
  }

  function onChat(username, message) {
    if (typeof message === 'string' && /died|slain|burned|drowned|fell|blew up/i.test(message) && message.includes(ownerName)) {
      died.push(Date.now());
    }
  }

  let posInterval = null;
  function startTracking() {
    if (!bot?.on) return;
    bot.on('blockUpdate', onBlockUpdate);
    bot.on('entityHurt', onEntityHurt);
    bot.on('chat', onChat);
    posInterval = setInterval(() => {
      const owner = ownerEntity(bot, ownerName);
      if (owner?.position) {
        positions.push({ t: Date.now(), pos: { x: owner.position.x, y: owner.position.y, z: owner.position.z } });
      }
    }, 1000);
  }

  function stopTracking() {
    if (!bot?.removeListener) return;
    bot.removeListener('blockUpdate', onBlockUpdate);
    bot.removeListener('entityHurt', onEntityHurt);
    bot.removeListener('chat', onChat);
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
    recordBroke: (name) => broke.push({ t: Date.now(), name }),
    recordPlaced: (name) => placed.push({ t: Date.now(), name }),
    recordHurt: () => hurt.push(Date.now()),
    recordDied: () => died.push(Date.now()),
    recordMove: (dist) => {
      const t = Date.now();
      positions.push({ t, pos: { x: 0, y: 0, z: 0 } });
      positions.push({ t, pos: { x: dist, y: 0, z: 0 } });
    },
  };
}

module.exports = { createObserver, WINDOW_MS };
