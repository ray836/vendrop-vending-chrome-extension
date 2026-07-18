const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const fullSource = fs.readFileSync(require.resolve('../content.js'), 'utf8');
const source = fullSource.slice(0, fullSource.indexOf('// Extract product information'));

function createElement(label, onClick = () => {}) {
  return {
    disabled: false,
    isConnected: true,
    innerText: label,
    textContent: label,
    click: onClick,
    getAttribute(name) {
      if (name === 'aria-label') return label;
      return null;
    },
    getBoundingClientRect() {
      return { width: 100, height: 40 };
    },
    querySelectorAll() {
      return [];
    },
  };
}

async function run() {
  const removeControls = [];
  const cartHeader = createElement('Cart contains 1 item');
  const remove = createElement('Remove', () => {
    remove.isConnected = false;
    removeControls.length = 0;
    cartHeader.getAttribute = (name) => name === 'aria-label' ? 'Cart contains 0 items' : null;
    cartHeader.textContent = 'Cart contains 0 items';
    body.innerText = 'Your cart is empty';
    body.textContent = 'Your cart is empty';
  });
  removeControls.push(remove);

  const body = createElement('Cart');
  const document = {
    body,
    querySelector(selector) {
      if (selector.includes('main')) return body;
      return null;
    },
    querySelectorAll(selector) {
      if (selector === 'button, a') return removeControls.slice();
      if (selector.includes('button[aria-label]')) return [cartHeader];
      if (selector.includes('[role="dialog"]')) return [];
      return [];
    },
  };
  body.querySelectorAll = (selector) => document.querySelectorAll(selector);

  const context = vm.createContext({
    chrome: { runtime: { onMessage: { addListener() {} } } },
    console,
    document,
    window: {
      location: { hostname: 'www.samsclub.com', pathname: '/cart' },
      getComputedStyle: () => ({ display: 'block', visibility: 'visible' }),
    },
    setTimeout,
    clearTimeout,
    Promise,
  });
  vm.runInContext(source, context);

  const result = await context.clearCurrentSamsCart();
  assert.deepEqual({ ...result }, { removedLineItems: 1 });
  assert.equal(remove.isConnected, false);

  context.window.location.pathname = '/p/example';
  await assert.rejects(() => context.clearCurrentSamsCart(), /Open the Sam's Club cart/);
  console.log('cart clearing fixture passed');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
