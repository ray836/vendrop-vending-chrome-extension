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
    querySelector() { return null; },
    querySelectorAll() { return []; },
    ...properties,
  };
}

async function run() {
  let increaseClicks = 0;
  const quantityInput = visibleElement({
    value: '1',
    getAttribute(name) {
      if (name === 'name') return 'quantity-100381489';
      if (name === 'value') return this.value;
      return null;
    },
  });
  const increase = visibleElement({
    textContent: '+',
    getAttribute(name) {
      if (name === 'aria-label') return 'Increase Quantity';
      if (name === 'data-testid') return 'qty-increase-cart-100381489';
      return null;
    },
    click() {
      increaseClicks += 1;
      quantityInput.value = String(Number(quantityInput.value) + 1);
      // Reproduce Costco optimistically showing 3, briefly rolling it back to
      // 2, then applying the still-pending server update. The extension must
      // wait instead of sending another competing increment or reporting a
      // false failure while the cart is about to settle at 3.
      if (increaseClicks === 2) {
        setTimeout(() => { quantityInput.value = '2'; }, 50);
        setTimeout(() => { quantityInput.value = '3'; }, 500);
      }
    },
  });
  const body = visibleElement();
  const row = visibleElement({
    parentElement: body,
    querySelector(selector) {
      if (selector.includes('qty-increase') || selector.includes('Increase quantity')) return increase;
      if (selector.startsWith('input[')) return quantityInput;
      return null;
    },
    querySelectorAll(selector) {
      return selector === 'button' ? [increase] : [];
    },
  });
  const link = visibleElement({
    textContent: 'Cheez-It Crackers, Cheddar, 1.5 oz, 45-count',
    parentElement: row,
    getAttribute(name) {
      return name === 'href' ? '/p/-/cheez-it-crackers/100381489' : null;
    },
  });
  const cartHeader = visibleElement();
  Object.defineProperty(cartHeader, 'textContent', {
    get() { return `Cart (${quantityInput.value} Items)`; },
  });
  const document = {
    body,
    querySelectorAll(selector) {
      if (selector === 'a[href]') return [link];
      if (selector.includes('h1, h2')) return [cartHeader];
      return [];
    },
  };
  const context = vm.createContext({
    chrome: { runtime: { onMessage: { addListener() {} } } },
    console,
    document,
    window: {
      location: { hostname: 'www.costco.com', pathname: '/CheckoutCartDisplayView' },
      getComputedStyle: () => ({ display: 'block', visibility: 'visible' }),
    },
    setTimeout,
    clearTimeout,
    Promise,
    decodeURIComponent,
  });
  vm.runInContext(source, context);

  const result = await context.setCurrentVendorCartQuantities('costco', [{
    name: 'Cheez-It Crackers, Cheddar, 1.5 oz, 45-count',
    vendorLink: 'https://www.costco.com/p/-/cheez-it-crackers/100381489',
    quantity: 3,
  }]);

  assert.deepEqual({ ...result }, { totalCases: 3, productCount: 1 });
  assert.equal(increaseClicks, 2);
  assert.equal(quantityInput.value, '3');
  console.log('Costco cart quantity fixture passed');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
