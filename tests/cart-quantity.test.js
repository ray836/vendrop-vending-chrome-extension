const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const fullSource = fs.readFileSync(require.resolve('../content.js'), 'utf8');
const source = fullSource.slice(0, fullSource.indexOf('// Extract product information'));

function visibleElement(properties = {}) {
  return {
    disabled: false,
    textContent: '',
    getAttribute() { return null; },
    getBoundingClientRect() { return { width: 100, height: 40 }; },
    ...properties,
  };
}

async function run() {
  let cartTotal = 1;
  let increaseClicks = 0;
  const header = visibleElement({
    getAttribute(name) {
      return name === 'aria-label' ? `Cart contains ${cartTotal} items` : null;
    },
  });
  const increase = visibleElement({
    textContent: '+',
    getAttribute(name) {
      return name === 'aria-label' ? 'Increase quantity' : null;
    },
    click() {
      increaseClicks += 1;
      cartTotal += 1;
    },
  });
  const body = visibleElement();
  const row = visibleElement({
    parentElement: body,
    querySelector(selector) {
      return selector.includes('increase') || selector.includes('Increase quantity') ? increase : null;
    },
    querySelectorAll(selector) {
      return selector === 'button' ? [increase] : [];
    },
  });
  const link = visibleElement({
    textContent: 'Nissin Cup Noodles, Chicken Flavor 2.25 oz., 24 ct.',
    parentElement: row,
    querySelector() { return null; },
    querySelectorAll() { return []; },
    getAttribute(name) {
      return name === 'href'
        ? '/ip/nissin-cup-noodles-chicken-flavor/12345678901'
        : null;
    },
  });
  const document = {
    body,
    querySelectorAll(selector) {
      if (selector.includes('button[aria-label]')) return [header];
      if (selector === 'a[href]') return [link];
      return [];
    },
  };

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
    decodeURIComponent,
  });
  vm.runInContext(source, context);

  const result = await context.setCurrentSamsCartQuantities([{
    name: 'Nissin Cup Noodles, Chicken Flavor 2.25 oz., 24 ct.',
    vendorLink: 'https://www.samsclub.com/ip/nissin-cup-noodles-chicken-flavor/12345678901',
    quantity: 2,
  }]);

  assert.deepEqual({ ...result }, { totalCases: 2, productCount: 1 });
  assert.equal(increaseClicks, 1, 'one cart increment changes one case into two');
  assert.equal(cartTotal, 2);
  console.log('cart quantity fixture passed');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
