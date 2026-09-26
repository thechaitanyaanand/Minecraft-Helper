'use strict';
const EventEmitter = require('events');

class FakeBot extends EventEmitter {
  constructor(username = 'Helper') {
    super();
    this.username = username;
    this.version = '1.20.4';
    this.entity = {
      position: {
        x: 0,
        y: 64,
        z: 0,
        distanceTo: (p) => Math.hypot((p?.x ?? 0) - this.entity.position.x, (p?.y ?? 64) - this.entity.position.y, (p?.z ?? 0) - this.entity.position.z),
      },
      isInWater: false,
    };
    this.health = 20;
    this.food = 20;
    this.time = { timeOfDay: 6000 };
    this.chatLog = [];
    this.pathfinder = {
      isMoving: () => false,
      stop: () => { this.pathfinderStopped = true; },
      setGoal: (goal) => { this.currentGoal = goal; },
      goto: async () => {},
      setMovements: () => {},
    };
    this.pathfinderStopped = false;
    this.controlStatesCleared = false;
    this.inventory = {
      items: () => this._items || [],
    };
    this.entities = {};
    this.players = {};
    this._items = [];
    this._foundBlocks = [];
    this._foundBlock = null;
  }

  findBlocks(opts) {
    return typeof this._foundBlocks === 'function' ? this._foundBlocks(opts) : this._foundBlocks;
  }

  findBlock(opts) {
    return typeof this._foundBlock === 'function' ? this._foundBlock(opts) : this._foundBlock;
  }

  blockAt(pos) {
    return this._blockAtFn ? this._blockAtFn(pos) : { name: 'air' };
  }

  chat(msg) {
    this.chatLog.push(msg);
    this.emit('chatSent', msg);
  }

  clearControlStates() {
    this.controlStatesCleared = true;
  }
}

module.exports = FakeBot;
