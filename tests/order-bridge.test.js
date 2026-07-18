const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const listeners = {};
const dispatched = [];
const messages = [];

class CustomEvent {
  constructor(type, options = {}) {
    this.type = type;
    this.detail = options.detail;
  }
}

class MutationObserver {
  constructor(callback) {
    this.callback = callback;
  }
  observe() {}
}

const window = {
  location: { origin: 'http://localhost:3001' },
  addEventListener(type, callback) {
    listeners[type] = callback;
  },
  dispatchEvent(event) {
    dispatched.push(event);
  },
};

const context = vm.createContext({
  chrome: {
    runtime: {
      lastError: null,
      getManifest: () => ({ version: '1.14.1' }),
      sendMessage(message, callback) {
        messages.push(message);
        callback({ success: true, started: true });
      },
    },
  },
  console,
  CustomEvent,
  document: {
    documentElement: {},
    getElementById: () => null,
  },
  MutationObserver,
  window,
});

vm.runInContext(fs.readFileSync(require.resolve('../order-bridge.js'), 'utf8'), context);
listeners['vendorpro:place-order']({
  detail: {
    orderId: 'order-1',
    extensionToken: 'token',
    apiBaseUrl: 'http://localhost:3001',
    placedAt: '2026-07-18T00:00:00.000Z',
  },
});

assert.equal(messages.length, 1);
assert.equal(messages[0].type, 'START_CART_PLACEMENT');
assert.equal(messages[0].payload.orderId, 'order-1');
assert.equal(dispatched.length, 1);
assert.equal(dispatched[0].type, 'vendorpro:placement-ack');
assert.equal(dispatched[0].detail.version, '1.14.1');
console.log('order bridge fixture passed');
