const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const fullSource = fs.readFileSync(require.resolve('../content.js'), 'utf8');
const source = fullSource.slice(0, fullSource.indexOf('// Extract product information'));

function createButton(label, onClick) {
  return {
    disabled: false,
    textContent: label,
    click: onClick,
    getAttribute(name) {
      if (name === 'aria-label') return label;
      return null;
    },
    getBoundingClientRect() {
      return { width: 100, height: 40 };
    },
  };
}

async function run() {
  let clicks = 0;
  let added = false;
  const add = createButton('Add to Cart - Test Product', () => {
    clicks += 1;
    added = true;
  });
  const increase = createButton('Increase quantity', () => {
    clicks += 1;
  });

  const document = {
    body: { innerText: 'Test product in stock' },
    querySelector(selector) {
      if (selector === 'button[data-automation-id="atc"]') return added ? null : add;
      if (selector.includes('increase-quantity')) return added ? increase : null;
      return null;
    },
    querySelectorAll(selector) {
      return selector === 'button' ? (added ? [increase] : [add]) : [];
    },
  };
  const window = {
    location: { hostname: 'www.samsclub.com', pathname: '/p/test-product' },
    getComputedStyle: () => ({ display: 'block', visibility: 'visible' }),
  };
  const context = vm.createContext({
    chrome: { runtime: { onMessage: { addListener() {} } } },
    console,
    document,
    window,
    setTimeout,
    clearTimeout,
    Promise,
  });
  vm.runInContext(source, context);

  const result = await context.addCurrentSamsProductToCart(3);
  assert.deepEqual({ ...result }, { quantityAdded: 3 });
  assert.equal(clicks, 3, 'one Add to Cart click plus two quantity increases');

  document.querySelector = () => null;
  document.querySelectorAll = () => [];
  await assert.rejects(() => context.addCurrentSamsProductToCart(1), /Could not find the Add to Cart button/);
  console.log('cart automation fixture passed');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
