const { EventEmitter } = require('node:events');

class FakeSocket extends EventEmitter {
  constructor(id, { data = {}, onEmit } = {}) {
    super();
    this.id = id;
    this.data = data;
    this.onEmit = onEmit;
    this.rooms = new Set();
    this.sent = [];
  }

  join(room) { this.rooms.add(room); }
  leave(room) { this.rooms.delete(room); }
  emit(type, ...args) {
    this.sent.push({ type, payload: args[0] });
    this.onEmit?.(type, ...args);
    return true;
  }

  async receive(type, ...args) {
    for (const listener of this.listeners(type)) await listener(...args);
  }
}

function createFakeIo({ sockets = new Map(), onEmit } = {}) {
  const emitted = [];
  function to(room) {
    return {
      emit(event, ...args) {
        emitted.push({ room, event, payload: args[0] });
        onEmit?.(room, event, ...args);
      },
      compress() { return this; },
    };
  }
  return {
    emitted,
    sockets: { sockets },
    to,
    addSocket(id, options) {
      const socket = new FakeSocket(id, options);
      sockets.set(id, socket);
      return socket;
    },
  };
}

module.exports = { createFakeIo };
