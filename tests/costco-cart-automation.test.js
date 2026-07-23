const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const fullSource = fs.readFileSync(require.resolve('../content.js'), 'utf8');
const source = fullSource.slice(0, fullSource.indexOf('// Extract product information'));

function visibleElement(properties = {}) {
  return {
    disabled: false,
    isConnected: true,
    textContent: '',
    getAttribute() { return null; },
    getBoundingClientRect() { return { width: 100, height: 40 }; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    ...properties,
  };
}

async function run() {
  let addClicks = 0;
  const add = visibleElement({
    textContent: 'Add Cheez-It Crackers, Cheddar, 1.5 oz, 45-count',
    click() { addClicks += 1; },
    getAttribute(name) {
      if (name === 'data-testid') return 'Button_addToCartDrawer_pdp';
      return null;
    },
  });
  const body = visibleElement({ innerText: 'Online Price In Stock' });
  const document = {
    body,
    querySelector(selector) {
      return selector === 'button[data-testid="Button_addToCartDrawer_pdp"]' ? add : null;
    },
    querySelectorAll(selector) {
      return selector === 'button' ? [add] : [];
    },
  };
  const context = vm.createContext({
    chrome: { runtime: { onMessage: { addListener() {} } } },
    console,
    document,
    window: {
      location: {
        hostname: 'www.costco.com',
        pathname: '/p/-/cheez-it-crackers/100381489',
      },
      getComputedStyle: () => ({ display: 'block', visibility: 'visible' }),
    },
    setTimeout,
    clearTimeout,
    Promise,
  });
  vm.runInContext(source, context);

  const result = await context.addCurrentProductToCart('costco', 1);
  assert.deepEqual({ ...result }, { quantityAdded: 1 });
  assert.equal(addClicks, 1);
  assert.equal(context.costcoProductId('https://www.costco.com/p/-/cheez-it/100381489?langId=-1'), '100381489');

  context.window.location.pathname = '/CheckoutCartView';
  assert.equal(context.requireRetailerPage('costco', true).name, 'Costco');
  context.window.location.pathname = '/CheckoutCartDisplayView';
  assert.equal(context.requireRetailerPage('costco', true).name, 'Costco');
  const cartHeader = visibleElement({
    getAttribute(name) { return name === 'aria-label' ? 'Cart (1)' : null; },
  });
  const removeControls = [];
  const remove = visibleElement({
    textContent: 'Delete Item',
    getAttribute(name) { return name === 'aria-label' ? 'Delete Item' : null; },
    click() {
      remove.isConnected = false;
      removeControls.length = 0;
      cartHeader.getAttribute = (name) => name === 'aria-label' ? 'Cart (0)' : null;
      body.innerText = 'Your shopping cart is empty';
      body.textContent = body.innerText;
    },
  });
  removeControls.push(remove);
  body.innerText = 'Cart';
  body.textContent = body.innerText;
  document.querySelector = (selector) => selector.includes('main') ? body : null;
  document.querySelectorAll = (selector) => {
    if (selector === 'button, a') return removeControls.slice();
    if (selector.includes('button[aria-label]')) return [cartHeader];
    if (selector.includes('[role="dialog"]')) return [];
    return [];
  };
  const cleared = await context.clearCurrentVendorCart('costco');
  assert.deepEqual({ ...cleared }, { removedLineItems: 1 });

  console.log('Costco cart automation fixture passed');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
