const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const fullSource = fs.readFileSync(require.resolve('../content.js'), 'utf8');
const prefix = fullSource.slice(0, fullSource.indexOf('// Extract product information'));
const helpers = fullSource.slice(
  fullSource.indexOf('function productJsonLdNodes'),
  fullSource.indexOf('// Extract Sam\'s Club product information')
);

function run() {
  let pageText = 'Add to cart Shipping available Instant Savings Save $4.00';
  const addButton = {
    disabled: false,
    textContent: 'Add to Cart',
    getAttribute() { return null; },
    getBoundingClientRect() { return { width: 100, height: 40 }; },
  };
  const document = {
    body: {
      get innerText() { return pageText; },
      get textContent() { return pageText; },
    },
    querySelector(selector) {
      if (selector === 'button[data-automation-id="atc"]') return addButton;
      return null;
    },
    querySelectorAll(selector) {
      return selector === 'button' ? [addButton] : [];
    },
  };
  const context = vm.createContext({
    chrome: { runtime: { onMessage: { addListener() {} } } },
    console,
    document,
    window: {
      getComputedStyle: () => ({ display: 'block', visibility: 'visible' }),
    },
  });
  vm.runInContext(`${prefix}\n${helpers}`, context);

  const status = {
    vendor_availability: 'unknown',
    vendor_on_sale: false,
    vendor_delivery_eligible: null,
  };
  context.applyVisibleVendorStatus(status);
  assert.deepEqual({ ...status }, {
    vendor_availability: 'in_stock',
    vendor_on_sale: true,
    vendor_delivery_eligible: true,
  });

  pageText = 'This item is sold out and not available for delivery';
  const unavailable = {
    vendor_availability: 'unknown',
    vendor_on_sale: false,
    vendor_delivery_eligible: null,
  };
  context.applyVisibleVendorStatus(unavailable);
  assert.equal(unavailable.vendor_availability, 'out_of_stock');
  assert.equal(unavailable.vendor_delivery_eligible, false);

  const structured = {
    vendor_availability: 'unknown',
    vendor_on_sale: false,
    vendor_delivery_eligible: null,
  };
  context.applyStructuredVendorStatus(structured, {
    '@type': 'Product',
    offers: {
      availability: 'https://schema.org/InStock',
      price: 12,
      highPrice: 16,
      shippingDetails: {},
    },
  });
  assert.deepEqual({ ...structured }, {
    vendor_availability: 'in_stock',
    vendor_on_sale: true,
    vendor_delivery_eligible: true,
  });

  console.log('vendor status fixture passed');
}

run();
